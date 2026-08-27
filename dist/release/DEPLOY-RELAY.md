# Deploy Aspera relay (one-time, ~5 minutes)

This is the WhatsApp-style cloud server so phone + PC can pair with QR on any network.

## Fastest: one-click Render (free)

1. Open this link (GitHub login may be asked):

   https://render.com/deploy?repo=https://github.com/ramchandragada/asperaconnect&branch=cursor/phone-contacts-sync-5b4f

2. Click **Apply** / **Create Web Service**
3. Wait until status is **Live**
4. Copy your service URL, for example:

   `https://aspera-connect-relay.onrender.com`

5. Tell Shree / Cursor the URL (or set it yourself below)

### Point the PC app at your relay

```bash
mkdir -p ~/.config/aspera-connect
python3 - <<'PY'
import json, pathlib
p = pathlib.Path.home() / ".config/aspera-connect/config.json"
cfg = {}
if p.exists():
    cfg = json.loads(p.read_text() or "{}")
# REPLACE with your real Render URL (https → wss)
cfg["relayUrl"] = "wss://aspera-connect-relay.onrender.com"
p.write_text(json.dumps(cfg, indent=2))
print("Saved", p, "→", cfg["relayUrl"])
PY
```

Then restart Aspera Connect → **Show QR to pair** → phone **Scan PC QR**.

## Manual Render (if the button fails)

1. https://dashboard.render.com → **New** → **Web Service**
2. Connect GitHub repo `ramchandragada/asperaconnect`
3. Branch: `cursor/phone-contacts-sync-5b4f` (or `main` after merge)
4. Root Directory: `apps/relay`
5. Build: `npm install`
6. Start: `npm start`
7. Instance: **Free**
8. Create → wait for Live → copy URL

## After it is live

Employees only need:

- PC: install `AsperaConnect-Desktop.deb` (with relayUrl set, or rebuilt default)
- Phone: install `AsperaConnect-Phone.apk`
- PC Show QR → Phone Scan QR

No same Wi‑Fi required.
