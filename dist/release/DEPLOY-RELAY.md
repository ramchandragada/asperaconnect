# Aspera cloud relay — LIVE

**Status:** Deployed and healthy on Render (Free plan).

| | |
|---|---|
| HTTPS | https://aspera-connect-relay.onrender.com |
| WSS (apps use this) | `wss://aspera-connect-relay.onrender.com` |
| Health | https://aspera-connect-relay.onrender.com/health → `{"ok":true,...}` |

New desktop builds already default to this URL. Existing installs can set it once:

```bash
mkdir -p ~/.config/aspera-connect
python3 - <<'PY'
import json, pathlib
p = pathlib.Path.home() / ".config/aspera-connect/config.json"
cfg = {}
if p.exists():
    cfg = json.loads(p.read_text() or "{}")
cfg["relayUrl"] = "wss://aspera-connect-relay.onrender.com"
p.write_text(json.dumps(cfg, indent=2))
print("Saved", p, "→", cfg["relayUrl"])
PY
```

Then: PC **Show QR to pair** → Phone **Scan PC QR**. No IP typing. Works across any network.

## Cold start (Free plan)

After ~15 minutes idle, Render may sleep the service. First connect can take ~30–60 seconds to wake; then it is instant. Upgrade the Render plan if you need always-on.

## Re-deploy / fork your own

One-click Blueprint:

https://render.com/deploy?repo=https://github.com/ramchandragada/asperaconnect&branch=cursor/phone-contacts-sync-5b4f

Or: `RENDER_API_KEY=... ./scripts/deploy-relay-render.sh`
