# ChamCall – Self-Hosted 1:1 WebRTC Platform

## High-level architecture (textual diagram)
- Clients (standalone SPA, iframe embed, React SDK, mobile) connect to HTTPS REST for auth/room/turn/status.
- Clients connect to WSS (Socket.IO) for signaling; JWT-authenticated; no media through server.
- Clients exchange WebRTC P2P media; TURN only for relay; STUN/TURN served by self-hosted Coturn.
- Backend services: Auth service, Room service, TURN credential service, Webhook dispatcher, Tenant/rate-limit middleware, Socket presence.
- Data: (prototype uses in-memory) → production: PostgreSQL for apps/rooms/participants, Redis for rate limits/presence/webhook queues.
- Edge: Nginx TLS termination, routes /api to Express, /ws upgrade to Socket.IO, serves frontend bundle.

## Backend folder structure
- `backend/src/app.js` – Express app wiring, middleware, routes.
- `backend/src/server.js` – HTTP server + Socket.IO bootstrap.
- `backend/src/routes/` – REST endpoints (auth, rooms, turn, webhooks).
- `backend/src/services/` – token signing/verification.
- `backend/src/socket/` – Socket.IO signaling handlers.
- `backend/src/webhooks/` – outbound webhook dispatcher (signed, retries).
- `backend/src/data/` – prototype in-memory stores.
- `backend/src/utils/` – crypto helpers, logger.
- `backend/src/config.js` – env parsing.

## API contracts (v1)
- `POST /api/v1/auth/token`
  - Body: `{ appId, appSecret, user? { id, name, role } }`
  - Res: `{ token, expiresIn }`
- `POST /api/v1/rooms`
  - Auth: `X-App-Id` + `X-App-Key` or Bearer app JWT
  - Body: `{ metadata?, createdBy? }`
  - Res: `{ roomId, status }`
- `POST /api/v1/rooms/:roomId/join`
  - Auth: same as above
  - Body: `{ userId, name?, role? }`
  - Res: `{ roomId, token, signalingUrl, iceServers, ttl }`
- `GET /api/v1/rooms/:roomId/status`
  - Res: `{ roomId, status, participants: [{ userId, name, role, joinedAt }] }`
- `POST /api/v1/turn/credentials`
  - Res: `{ iceServers: [{ urls, username, credential }], ttl }`
- `POST /api/v1/webhooks/subscribe`
  - Body: `{ url, secret? }`
  - Res: `{ ok, webhookUrl }`
- `POST /api/v1/webhooks/test`
  - Fires test.event to configured endpoint.

## Socket.IO signaling flow
1) Client gets room token + ICE servers via `/rooms/:id/join`.
2) Connect to `wss://<host>/ws` with `auth.token`.
3) Server validates JWT (roomId + appId), joins Socket.IO room.
4) On `user-joined`, initiator sends `webrtc-offer`; peer replies `webrtc-answer`.
5) Both exchange `ice-candidate` events.
6) Server broadcasts `user-joined`/`user-left`; triggers webhooks.

## TURN credential flow
- Backend issues short-lived creds: username=`<expiryEpoch>:<appId>`, credential=`HMAC-SHA1(username, TURN_STATIC_SECRET)`, ttl from env.
- Returned via `/api/v1/turn/credentials` and `/rooms/:id/join`.
- Coturn configured with `use-auth-secret`, `static-auth-secret=<TURN_STATIC_SECRET>`, `realm=turn.example.com`.

## Webhook architecture
- Per-app config: `webhookUrl`, `webhookSecret`.
- Payload signed: `X-Signature: sha256=<hmac(timestamp.body)>`, `X-Timestamp`, `X-App-Id`, `X-Event`.
- Retry schedule (inline prototype) 0s, 30s, 120s, 600s, 1800s; production move to Redis queue + worker.
- Events (suggested): call.created, user.joined, user.left, call.started, call.ended, call.failed, test.event.

## Embedding strategy
- Iframe: host `/embed` (can reuse SPA with query params). Parent ↔ iframe via `postMessage` for events (join/leave/errors) and commands (mute/end).
- React component (see `frontend/src/components/VideoCall.jsx`) can be published as `@yourorg/webrtc-client`; props: `backendUrl`, `roomId`, `token`, `userId`, `userName`, callbacks.
- Runtime config via `public/config.json` to avoid hardcoded URLs.

## Deployment notes
- Nginx: TLS (HTTP/2), proxy `/api` to Node, `/ws` with `Upgrade` headers to Socket.IO, serve React build, gzip/brotli, CORS.
- PM2 (or systemd) to run Node backend; enable clustering if desired; health at `/health`.
- Redis for Socket.IO adapter (to scale signaling horizontally) and rate limits.
- PostgreSQL for persistence; run migrations; use read replicas if needed.
- Coturn: dedicated host(s) on UDP/TCP 3478 + TLS 5349; configure firewall to allow media; monitor relay usage.

## Scaling & future roadmap
- Move from P2P to SFU (Mediasoup/Janus) for group calls and recording; new media service negotiates SFU ICE/DTLS.
- Recording API shape: `POST /api/v1/rooms/:id/record/start|stop`, stores per-tenant bucket, webhook `call.recording.ready`.
- Add moderation (mute/kick), waiting rooms, E2EE insertable streams, analytics, mobile SDKs.

## Integration quickstart (tenant/app)
1) Obtain `appId` + `appSecret`; configure allowed domains and webhook endpoint.
2) Server side: call `POST /api/v1/auth/token` to get an app JWT (or just use headers).
3) Create room: `POST /api/v1/rooms`.
4) For each participant, call `POST /api/v1/rooms/:roomId/join` to get room token + ICE.
5) In client, load iframe or React component; pass `roomId`, `token`, `userId`, `userName`, `backendUrl`.
6) Client connects via WSS to signaling, negotiates WebRTC, uses TURN creds as needed.
7) Listen to webhooks for lifecycle events; verify signatures with `webhookSecret`.

