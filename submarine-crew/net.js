// Live link to a boat on the crew server. Without a room the page stays an offline mockup.
// Load after crew.js. Pages check NET.online and subscribe with NET.on(state => …).
const NET = (() => {
  const DEFAULT_SERVER = 'wss://fathom-crew.fathom-crew-server.workers.dev';
  const qs = new URLSearchParams(location.search);
  const local = location.protocol === 'file:' || ['localhost', '127.0.0.1'].includes(location.hostname);
  const store = (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} };
  const read = k => { try { return localStorage.getItem(k); } catch { return null; } };

  if (qs.has('server')) store('fathom.server', qs.get('server'));
  if (qs.has('room')) store('fathom.room', qs.get('room').toUpperCase() || null);
  if (qs.has('name')) store('fathom.name', qs.get('name'));
  const server = read('fathom.server') || DEFAULT_SERVER || '';
  const room = read('fathom.room') || '';
  const name = read('fathom.name') || '';
  const seat = document.body.dataset.station;

  const subs = new Set(), errSubs = new Set();
  const net = {
    online: !!(room && server), server, room, name, seat,
    connected: false, s: null, clock: null,
    on(fn) { subs.add(fn); if (net.s) fn(net.s); return () => subs.delete(fn); },
    onError(fn) { errSubs.add(fn); },
    send(a, payload = {}) {
      if (!ws || ws.readyState !== 1) { toast('Not connected'); return false; }
      ws.send(JSON.stringify({ type: 'action', a, ...payload }));
      return true;
    },
    // Game seconds since 0000Z, for countdowns.
    secs() { if (!net.clock) return null; const [h, m, s] = [0, 2, 5].map(i => +net.clock.slice(i, i + 2)); return h * 3600 + m * 60 + s; },
    join(code, opts = {}) {
      store('fathom.room', code ? code.toUpperCase() : null);
      if (opts.name != null) store('fathom.name', opts.name);
      if (opts.server != null) store('fathom.server', opts.server || null);
    },
    leave() { store('fathom.room', null); location.href = location.pathname; },
  };

  let ws = null, tries = 0, chip = null, toastEl = null;

  function toast(msg) {
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.className = 'net-toast';
      toastEl.setAttribute('role', 'status');
      document.body.appendChild(toastEl);
    }
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toast.t);
    toast.t = setTimeout(() => toastEl.classList.remove('show'), 2600);
  }
  net.toast = toast;

  function paintChip() {
    if (!chip) return;
    const aboard = net.s ? Object.entries(net.s.seats).filter(([k]) => k !== 'spectator').flatMap(([, v]) => v).length : 0;
    const state = net.connected ? 'on' : 'off';
    chip.dataset.state = state;
    chip.innerHTML = `<i></i>${net.room}<small>${net.connected ? `${aboard} aboard${net.s && net.s.scale > 1 ? ` · ${net.s.scale}×` : ''}` : 'reconnecting'}</small>`;
  }

  function connect() {
    const u = `${server.replace(/\/$/, '')}/room/${encodeURIComponent(room)}?seat=${encodeURIComponent(seat)}&name=${encodeURIComponent(name)}`;
    ws = new WebSocket(u);
    ws.onopen = () => { net.connected = true; tries = 0; paintChip(); };
    ws.onmessage = e => {
      let m; try { m = JSON.parse(e.data); } catch { return; }
      if (m.type === 'state') {
        net.s = m.s; net.clock = m.clock;
        paintChip();
        subs.forEach(fn => { try { fn(m.s); } catch (err) { console.error(err); } });
      } else if (m.type === 'error') {
        toast(m.error);
        errSubs.forEach(fn => fn(m));
      }
    };
    ws.onclose = () => {
      net.connected = false; paintChip();
      setTimeout(connect, Math.min(8000, 500 * 2 ** tries++));
    };
  }

  if (net.online) {
    document.documentElement.classList.add('net-online');
    const nav = document.querySelector('.stations');
    if (nav) {
      chip = document.createElement('a');
      chip.className = 'net-chip';
      chip.href = 'index.html';
      chip.title = 'Live crew room. Tap to see who is aboard.';
      nav.appendChild(chip);
    }
    paintChip();
    connect();
  }
  return net;
})();
