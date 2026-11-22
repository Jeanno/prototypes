# Fathom crew server

Cloudflare Worker with one Durable Object per boat. The object runs the authoritative sim; station pages are thin clients over WebSocket.

There are no players. The crew code is the only key: anyone with it can do anything from any screen, so one person can run the whole boat by switching screens.

```
npm install
npm run dev        # ws://localhost:8787
npm test           # smoke test against the dev server (SERVER=wss://… to test a deploy)
npx wrangler login && npm run deploy
```

Deployed at `wss://fathom-crew.fathom-crew-server.workers.dev` (`DEFAULT_SERVER` in `../net.js`). To use a local dev server, pass `?server=ws://localhost:8787` once.

## Connect

`GET /room/<CODE>?seat=<station id>` upgraded to WebSocket. `seat` only labels which screen acted (`from` in the log); ids match `STATIONS` in `crew.js`, anything else is `spectator`. Boats are created on first connect and kept in storage.

## Server → client

- `{type:'hello', screen}` once.
- `{type:'state', clock:'0351:12Z', s}` on connect, after every action, and every 0.5 s.
- `{type:'error', a, error}` when an action is refused (e.g. "Too deep: masts need 60 ft").

`s`:

| field | |
|---|---|
| `t`, `scale` | game seconds since 0347:00Z; time multiplier (1, 10, 30) |
| `own` | `course speed depth` actual, `oCourse oSpeed oDepth` ordered, `blow` |
| `comms` | `mast` (bool), `copied` (broadcast keys like `"0400Z"`) |
| `requests[]` | `{id, at, from, to:'captain', kind, text, status:'pending'\|'held'\|'approved'\|'denied'}`, newest first |
| `orders[]` | `{id, at, from, to:'helm', kind:'depth'\|'speed'\|'course', value, text, status:'new'\|'ack'\|'done'}`, newest first |
| `log[]` | `{id, at, from, text, kind:''\|'ok'\|'warn'\|'alert'\|'msg'}`, newest first |

## Client → server

`{type:'action', a, …}`. With `net.js`: `NET.send(a, payload)`.

| a | payload | effect |
|---|---|---|
| `request` | `kind, text` | adds a pending request for the Captain |
| `decide` | `id, status:'approved'\|'denied'\|'held'` | approving `antenna-depth`, `ahead-slow` or `snorkel` sends Helm an order |
| `order` | `kind, value, text` | new order to Helm |
| `ack` | `id` | Helm acknowledges; sets the ordered value; turns `done` when reached |
| `helm` | `oCourse?, oSpeed?, oDepth?, emergency?:'crash'\|'blow'` | direct ship control |
| `mast` | `up` | refused deeper than 62 ft; auto-lowers below 65 ft |
| `message` | `to, text` | log entry, e.g. decoded traffic or a contact report |
| `scale` | `value: 1\|10\|30` | game speed |
| `reset` | | fresh scenario |

Broadcasts go out on every hour. A raised mast during the first 10 game minutes copies it; otherwise the log records a miss.

Crew codes are the only access control. Fine for a prototype, not for anything public.
