# Aspera cloud relay (cross-network QR)

WhatsApp works across networks because both devices talk to WhatsApp’s servers.
Aspera Connect uses the same idea: a small **relay** both PC and phone dial into.

## Security

- QR contains a random **session id + secret** (not your phone number)
- Session expires in ~10 minutes
- Only one PC + one phone per session
- Traffic is WebSocket; deploy with HTTPS/`wss://`

## Deploy (free) — one-time for your company

### Option A: Render

1. Push this repo to GitHub
2. https://render.com → New → Web Service → connect repo
3. Root directory: `apps/relay`
4. Build: `npm install` · Start: `npm start`
5. Copy the public URL, e.g. `https://aspera-relay.onrender.com`
6. On each PC set relay (or rebuild with default):

```bash
# ~/.config/aspera-connect/config.json
# "relayUrl": "wss://YOUR-SERVICE.onrender.com"
```

### Option B: Docker

```bash
cd apps/relay
docker build -t aspera-relay .
docker run -p 8787:8787 aspera-relay
# put TLS in front (Caddy/nginx) → wss://relay.yourcompany.com
```

### Option C: Local test

```bash
cd apps/relay && npm start
# PORT 8787 — only works on same machine unless you tunnel
```

## App flow

1. PC: **Show QR to pair** (creates relay session)
2. Phone: **Scan PC QR** (joins over internet)
3. Calls/contacts go through the relay

LAN IP connect still works when on the same network.
