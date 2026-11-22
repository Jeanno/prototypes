// Drives a room through the Comms → Captain → Helm loop against a running server (default: local wrangler dev).
const BASE = process.env.SERVER || 'ws://localhost:8787';
const room = 'T' + Math.random().toString(36).slice(2, 7).toUpperCase();
const wait = ms => new Promise(r => setTimeout(r, ms));

function join(seat) {
  const ws = new WebSocket(`${BASE}/room/${room}?seat=${seat}`);
  const c = { ws, s: null, errors: [] };
  ws.onmessage = e => { const m = JSON.parse(e.data); if (m.type === 'state') c.s = m.s; if (m.type === 'error') c.errors.push(m.error); };
  c.send = (a, p = {}) => ws.send(JSON.stringify({ type: 'action', a, ...p }));
  return new Promise((res, rej) => { ws.onopen = () => res(c); ws.onerror = rej; });
}
async function until(c, fn, ms = 20000, what = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { if (c.s && fn(c.s)) return; await wait(100); }
  throw new Error('timeout: ' + what);
}
async function errored(c, re, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (c.errors.some(e => re.test(e))) return true; await wait(100); } return false; }
const ok = (cond, msg) => { if (!cond) throw new Error('FAIL ' + msg); console.log('ok', msg); };

const cap = await join('captain'), com = await join('comms'), helm = await join('helm');
await until(cap, s => s, 5000, 'state');
ok(cap.s.requests.length === 3, 'seeded 3 requests');

com.send('mast', { up: true });
ok(await errored(com, /Too deep/), 'mast refused at 150 ft');

const tube = cap.s.requests.find(r => r.kind === 'flood-tube');
helm.send('decide', { id: tube.id, status: 'denied' });
await until(cap, s => s.requests.find(r => r.id === tube.id).status === 'denied', 3000, 'helm decides');
ok(helm.errors.length === 0, 'any screen can do anything');

com.send('request', { kind: 'antenna-depth', text: 'Request antenna depth 60 ft for the 0400Z broadcast.' });
await until(cap, s => s.requests.some(r => r.kind === 'antenna-depth'), 3000, 'request arrives');
const req = cap.s.requests.find(r => r.kind === 'antenna-depth');
cap.send('decide', { id: req.id, status: 'approved' });
await until(helm, s => s.orders.some(o => o.to === 'helm' && o.value === 60), 3000, 'order arrives');
const ord = helm.s.orders.find(o => o.value === 60);
helm.send('ack', { id: ord.id });
com.send('scale', { value: 30 });
await until(helm, s => s.own.oDepth === 60, 3000, 'ordered depth set');
await until(helm, s => s.orders.find(o => o.id === ord.id).status === 'done', 30000, 'reach 60 ft');
ok(Math.abs(helm.s.own.depth - 60) < 1, 'boat at 60 ft');

com.send('mast', { up: true });
await until(com, s => s.comms.mast, 3000, 'mast up');
await until(com, s => s.comms.copied.includes('0400Z'), 40000, 'broadcast copied');
ok(true, 'copied 0400Z broadcast');

helm.send('helm', { oDepth: 150 });
await until(com, s => !s.comms.mast, 20000, 'mast auto-lowered');
ok(true, 'mast lowered when going deep');

cap.send('reset');
await until(cap, s => s.t < 5 && s.requests.length === 3, 3000, 'reset');
ok(true, 'reset room');
for (const c of [cap, com, helm]) c.ws.close();
console.log('room', room, 'passed');
process.exit(0);
