# ChamCall – Self-Hosted WebRTC 1:1 Platform

This repo contains a minimal but production-oriented reference implementation of a self-hosted WebRTC 1:1 calling platform with REST APIs, Socket.IO signaling, TURN credentialing, multi-tenant app model, and an embeddable React frontend.

## Structure
- `backend/` – Node.js + Express API and Socket.IO signaling server.
- `frontend/` – React client (Vite) usable standalone or embedded.
- `docs/ARCHITECTURE.md` – high-level design, API contracts, flows.

## Quick start (dev)
```bash
# backend
cd backend
npm install
cp ../frontend/public/config.example.json ../frontend/public/config.json || true
npm run dev

# frontend (new shell)
cd frontend
npm install
npm run dev
```
- Backend defaults: demo app (`appId=demo-app`, `appSecret=demo-secret`), `https://vc.valliams.com`.
- Frontend dev server: `http://localhost:5173`.

## Core flows
1) Create a room: `POST /api/v1/rooms` with headers `X-App-Id: demo-app`, `X-App-Key: demo-secret`.
2) Join a room: `POST /api/v1/rooms/:roomId/join` with same headers and `{ "userId": "alice" }` body. Receive room token, ICE servers, signaling URL.
3) Client connects Socket.IO with `auth.token`, exchanges offers/answers/ICE, and streams media P2P with TURN fallback.

## TURN setup
Use a self-hosted Coturn with `use-auth-secret` and `static-auth-secret` matching `TURN_STATIC_SECRET`. ICE URLs configured via `TURN_URLS` env.

## Embedding
- Iframe: `/embed?roomId=...&token=...&userId=...`
- React component: import `VideoCall` from `frontend/src/components/VideoCall.jsx` (or publish as SDK).
- Runtime config from `public/config.json`; avoid hardcoding backend URLs.

See `docs/ARCHITECTURE.md` for integration steps, webhook details, and scaling roadmap.

