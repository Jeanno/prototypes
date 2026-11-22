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
  const server = read('fathom.server') || DEFAULT_SERVER || '';
  const room = read('fathom.room') || '';
  const seat = document.body.dataset.station;

  const subs = new Set(), errSubs = new Set();
  const net = {
    online: !!(room && server), server, room, seat,
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
    const state = net.connected ? 'on' : 'off';
    chip.dataset.state = state;
    chip.innerHTML = `<i></i>${net.room}<small>${net.connected ? `live${net.s && net.s.scale > 1 ? ` · ${net.s.scale}×` : ''}` : 'reconnecting'}</small>`;
  }

  function connect() {
    const u = `${server.replace(/\/$/, '')}/room/${encodeURIComponent(room)}?seat=${encodeURIComponent(seat)}`;
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


  // Before joining, a live page shows only this box: start a new crew or enter a crew code. A crew link joins directly.
  function joinGate() {
    document.documentElement.classList.add('net-gate');
    const st = STATIONS.find(x => x.id === seat);
    const esc = v => String(v || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const code = () => Array.from({ length: 4 }, () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 32)]).join('');
    const el = document.createElement('section');
    el.className = 'card join-gate';
    el.setAttribute('aria-labelledby', 'jgTitle');
    el.innerHTML = `
      <h2 id="jgTitle">${st ? esc(st.name) : 'Crew a boat'}<span class="h-note">live over the internet</span></h2>
      <div class="jg-pick" data-step="pick">
        <button type="button" class="jg-choice" data-go="new"><b>New crew</b><small>Start a boat and get its crew code</small></button>
        <button type="button" class="jg-choice" data-go="join"><b>Join crew</b><small>Enter an existing crew code</small></button>
      </div>
      <form class="join" data-step="form" novalidate hidden>
        <p class="jg-lead"></p>
        <label class="jg-code"><span class="lbl">Crew code</span><input name="room" maxlength="12" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="ABCD"></label>
        <div class="jg-made" hidden><span class="lbl">Your crew code</span><span class="jg-big"></span></div>
        <details open${server ? ' hidden' : ''}><summary>Server</summary><label><span class="lbl">WebSocket URL</span><input name="server" spellcheck="false" value="${esc(server)}"></label></details>
        <p class="jg-err" role="alert" hidden></p>
        <button class="btn primary jg-go" type="submit"></button>
        <button class="jg-back" type="button">← Back</button>
      </form>`;
    const f = el.querySelector('form'), pick = el.querySelector('.jg-pick'), err = el.querySelector('.jg-err');
    let mode = 'join';
    const show = (m, preset) => {
      mode = m;
      pick.hidden = !!m; f.hidden = !m; err.hidden = true;
      if (!m) return pick.querySelector('button').focus();
      const isNew = m === 'new';
      f.room.value = isNew ? code() : (preset || '');
      el.querySelector('.jg-code').hidden = isNew;
      el.querySelector('.jg-made').hidden = !isNew;
      el.querySelector('.jg-big').textContent = f.room.value;
      f.querySelector('.jg-lead').innerHTML = isNew ? 'Your new boat is ready. Anyone with this code controls it, from any screen.'
        : 'Anyone with the code controls the boat, from any screen.';
      f.querySelector('.jg-go').textContent = isNew ? 'Start crew' : 'Join crew';
      f.querySelector('.jg-back').hidden = !!preset;
      (isNew ? f.querySelector('.jg-go') : f.room).focus({ preventScroll: true });
    };
    pick.addEventListener('click', e => { const b = e.target.closest('[data-go]'); if (b) show(b.dataset.go); });
    f.querySelector('.jg-back').onclick = () => show(null);
    const fail = (msg, input) => { err.textContent = msg; err.hidden = false; input.focus(); };
    f.onsubmit = e => {
      e.preventDefault();
      const r = f.room.value.trim().toUpperCase(), sv = f.server.value.trim();
      if (!/^[A-Z0-9-]{3,12}$/.test(r)) return fail('Crew code is 3 to 12 letters or digits.', f.room);
      if (!/^wss?:\/\//.test(sv)) { el.querySelector('details').hidden = false; return fail('Server must start with wss://', f.server); }
      net.join(r, { server: sv });
      location.href = location.pathname;
    };
    (document.querySelector('header.bar') || document.body.firstChild).after(el);
    if (room) show('join', room);
  }

  if (net.online) {
    document.documentElement.classList.add('net-online');
    const nav = document.querySelector('.stations');
    if (nav) {
      chip = document.createElement('a');
      chip.className = 'net-chip';
      chip.href = 'index.html';
      chip.title = 'Live crew. Tap for the crew link.';
      nav.appendChild(chip);
    }
    paintChip();
    connect();
  } else {
    joinGate();
  }
  return net;
})();
