// Fathom crew server: one Durable Object per boat (room code) runs the authoritative sim.
// No players: anyone with the crew code can do anything from any screen. `from` only labels which screen acted.

const SEATS = ['captain', 'sonar', 'comms', 'nav', 'helm', 'weapons', 'torpedo', 'power', 'life', 'damage'];
const BASE = 3 * 3600 + 47 * 60; // game clock starts at 0347:00Z
const ANTENNA = 60;
const WINDOW = 600; // a broadcast can be copied for 10 game minutes after the hour

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const m = url.pathname.match(/^\/room\/([A-Za-z0-9-]{3,24})$/);
    if (m) {
      if (req.headers.get('Upgrade') !== 'websocket') return new Response('Expected WebSocket', { status: 426 });
      const stub = env.BOAT.get(env.BOAT.idFromName(m[1].toUpperCase()));
      return stub.fetch(req);
    }
    if (url.pathname === '/') return new Response('fathom-crew ok\n');
    return new Response('Not found', { status: 404 });
  },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const norm = d => ((d % 360) + 360) % 360;
const angDiff = (a, b) => ((a - b + 540) % 360) - 180;
const approach = (v, t, m) => v + Math.sign(t - v) * Math.min(Math.abs(t - v), m);
const zulu = t => {
  const s = Math.floor(BASE + t) % 86400, p = n => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}${p(Math.floor(s / 60) % 60)}:${p(s % 60)}Z`;
};

function fresh() {
  const s = {
    v: 1, t: 0, scale: 1, nextId: 1,
    own: { course: 45, speed: 8, depth: 150, oCourse: 45, oSpeed: 8, oDepth: 150, blow: false },
    comms: { mast: false, copied: [] },
    requests: [], orders: [], log: [],
  };
  // Stations that aren't networked yet still raise their requests, so the Captain's queue is real from the start.
  addRequest(s, 'weapons', 'flood-tube', 'Solution 55% on S3. Request permission to flood tube 2.');
  addRequest(s, 'damage', 'ahead-slow', 'Shaft seal leaking 4 gal/min. Request ahead slow to cut the leak.');
  addRequest(s, 'power', 'snorkel', 'Battery 58%. Request a snorkel window to recharge.');
  addLog(s, 'captain', 'Battle stations. Tracking hostile sub S3.');
  return s;
}

function addLog(s, from, text, kind = '') {
  s.log.unshift({ id: s.nextId++, at: zulu(s.t), from, text, kind });
  s.log.length = Math.min(s.log.length, 80);
}
function addRequest(s, from, kind, text) {
  const r = { id: s.nextId++, at: zulu(s.t), from, to: 'captain', kind, text, status: 'pending' };
  s.requests.unshift(r);
  s.requests.length = Math.min(s.requests.length, 40);
  return r;
}
function addOrder(s, from, to, kind, value, text) {
  const o = { id: s.nextId++, at: zulu(s.t), from, to, kind, value, text, status: 'new' };
  s.orders.unshift(o);
  s.orders.length = Math.min(s.orders.length, 40);
  addLog(s, from, `Order to ${to}: ${text}`);
  return o;
}

// What approving each kind of request sets in motion.
const ON_APPROVE = {
  'antenna-depth': s => addOrder(s, 'captain', 'helm', 'depth', ANTENNA, `Make your depth ${ANTENNA} ft`),
  'ahead-slow': s => addOrder(s, 'captain', 'helm', 'speed', 5, 'All ahead one third'),
  snorkel: s => addOrder(s, 'captain', 'helm', 'depth', 50, 'Make your depth 50 ft, snorkel'),
};

const ORDER_FIELD = { depth: 'oDepth', speed: 'oSpeed', course: 'oCourse' };
const ORDER_RANGE = { depth: [0, 800], speed: [-7, 20], course: [0, 359] };

export class Boat {
  constructor(ctx) {
    this.ctx = ctx;
    this.socks = new Map(); // ws -> screen id, for log labels
    this.s = null;
    this.timer = null;
    ctx.blockConcurrencyWhile(async () => { this.s = (await ctx.storage.get('state')) || fresh(); });
  }

  async fetch(req) {
    const url = new URL(req.url);
    const screen = SEATS.includes(url.searchParams.get('seat')) ? url.searchParams.get('seat') : 'spectator';
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();
    this.socks.set(server, screen);
    server.addEventListener('message', e => this.onMessage(server, e.data));
    const bye = () => { this.socks.delete(server); if (!this.socks.size) this.stop(); };
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    this.start();
    this.send(server, { type: 'hello', screen });
    this.send(server, this.snapshot());
    return new Response(null, { status: 101, webSocket: client });
  }

  start() {
    if (this.timer) return;
    let last = Date.now(), acc = 0, saveAcc = 0;
    this.timer = setInterval(() => {
      const now = Date.now(), dt = (now - last) / 1000;
      last = now;
      this.step(dt * this.s.scale);
      acc += dt; saveAcc += dt;
      if (acc >= 0.5) { acc = 0; this.broadcast(); }
      if (saveAcc >= 5) { saveAcc = 0; this.save(); }
    }, 100);
  }
  stop() { clearInterval(this.timer); this.timer = null; this.save(); }
  save() { return this.ctx.storage.put('state', this.s); }

  step(dt) {
    const s = this.s, o = s.own;
    s.t += dt;
    o.course = norm(o.course + clamp(angDiff(o.oCourse, o.course), -3 * dt, 3 * dt));
    o.speed = approach(o.speed, o.oSpeed, 0.4 * dt);
    const rate = o.blow ? 14 : 2 + Math.abs(o.speed) * 0.15;
    o.depth = approach(o.depth, o.oDepth, rate * dt);
    if (o.blow && o.depth <= 0) { o.blow = false; addLog(s, 'helm', 'Surfaced after emergency blow.', 'alert'); }

    if (s.comms.mast && o.depth > ANTENNA + 5) { s.comms.mast = false; addLog(s, 'comms', 'Masts lowered: boat went below antenna depth.', 'warn'); }

    // Hourly broadcasts: copy one if the mast is up during its window, or log the miss once.
    const clock = BASE + s.t, hour = Math.floor(clock / 3600), since = clock - hour * 3600, key = zulu(hour * 3600 - BASE).slice(0, 4) + 'Z';
    if (since < WINDOW && s.comms.mast && !s.comms.copied.includes(key)) {
      s.comms.copied.push(key);
      addLog(s, 'comms', `Fleet broadcast ${key} copied. FLASH traffic for Captain, decoding.`, 'ok');
    } else if (since >= WINDOW && since < WINDOW + dt + 0.2 && !s.comms.copied.includes(key) && s.t > 1) {
      addLog(s, 'comms', `Missed the ${key} broadcast. Next window on the hour.`, 'alert');
    }

    for (const ord of s.orders) {
      if (ord.status !== 'ack') continue;
      const actual = { depth: o.depth, speed: o.speed, course: o.course }[ord.kind];
      const off = ord.kind === 'course' ? Math.abs(angDiff(actual, ord.value)) : Math.abs(actual - ord.value);
      if (off < (ord.kind === 'speed' ? 0.2 : 1)) { ord.status = 'done'; addLog(s, 'helm', `Steady: ${ord.text}.`, 'ok'); }
    }
  }

  onMessage(ws, raw) {
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    if (m?.type !== 'action') return;
    const err = this.act(this.socks.get(ws), m);
    if (err) this.send(ws, { type: 'error', a: m.a, error: err });
    else { this.broadcast(); this.save(); }
  }

  // Returns an error string, or nothing on success.
  act(screen, m) {
    const s = this.s, o = s.own;

    switch (m.a) {
      case 'request': {
        if (typeof m.text !== 'string' || !m.text) return 'Missing text';
        if (s.requests.some(r => r.status === 'pending' && r.from === screen && r.kind === m.kind)) return 'Already pending';
        const r = addRequest(s, screen, String(m.kind || 'other').slice(0, 24), m.text.slice(0, 200));
        addLog(s, screen, `Request: ${r.text}`);
        return;
      }
      case 'decide': {
        const r = s.requests.find(r => r.id === m.id);
        if (!r) return 'No such request';
        if (!['approved', 'denied', 'held'].includes(m.status)) return 'Bad status';
        if (r.status === 'approved' || r.status === 'denied') return 'Already decided';
        r.status = m.status;
        addLog(s, 'captain', `${m.status[0].toUpperCase() + m.status.slice(1)}: ${r.text}`, m.status === 'denied' ? 'warn' : 'ok');
        if (m.status === 'approved') ON_APPROVE[r.kind]?.(s);
        return;
      }
      case 'order': {
        if (!ORDER_FIELD[m.kind]) return 'Bad order';
        const [lo, hi] = ORDER_RANGE[m.kind], v = Number(m.value);
        if (!(v >= lo && v <= hi)) return 'Out of range';
        addOrder(s, screen, 'helm', m.kind, v, String(m.text || `${m.kind} ${v}`).slice(0, 80));
        return;
      }
      case 'ack': {
        const ord = s.orders.find(x => x.id === m.id);
        if (!ord) return 'No such order';
        if (ord.status !== 'new') return 'Already acknowledged';
        ord.status = 'ack';
        o[ORDER_FIELD[ord.kind]] = ord.value;
        addLog(s, 'helm', `Aye: ${ord.text}.`);
        return;
      }
      case 'helm': {
        if (m.oCourse != null) o.oCourse = norm(Math.round(Number(m.oCourse)) || 0);
        if (m.oSpeed != null) o.oSpeed = clamp(Number(m.oSpeed) || 0, -7, 20);
        if (m.oDepth != null) o.oDepth = clamp(Number(m.oDepth) || 0, 0, 800);
        if (m.emergency === 'blow') { o.blow = true; o.oDepth = 0; addLog(s, 'helm', 'EMERGENCY BLOW. All main ballast.', 'alert'); }
        if (m.emergency === 'crash') { o.blow = false; o.oDepth = 400; o.oSpeed = 16; addLog(s, 'helm', 'CRASH DIVE. Flood negative, full dive.', 'alert'); }
        return;
      }
      case 'mast': {
        if (m.up && o.depth > ANTENNA + 2) return `Too deep: masts need ${ANTENNA} ft`;
        s.comms.mast = !!m.up;
        addLog(s, 'comms', m.up ? 'Masts raised.' : 'Masts lowered.');
        return;
      }
      case 'message': {
        if (typeof m.text !== 'string' || !m.text) return 'Missing text';
        addLog(s, screen, `To ${SEATS.includes(m.to) ? m.to : "all"}: ${m.text.slice(0, 400)}`, 'msg');
        return;
      }
      case 'scale': {
        if (![1, 10, 30].includes(m.value)) return 'Scale is 1, 10 or 30';
        s.scale = m.value;
        return;
      }
      case 'reset': {
        this.s = fresh();
        return;
      }
      default: return 'Unknown action';
    }
  }

  snapshot() { return { type: 'state', clock: zulu(this.s.t), s: this.s }; }
  send(ws, msg) { try { ws.send(JSON.stringify(msg)); } catch {} }
  broadcast() {
    const msg = JSON.stringify(this.snapshot());
    for (const ws of this.socks.keys()) try { ws.send(msg); } catch {}
  }
}
