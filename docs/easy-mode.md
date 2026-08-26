# Easy mode (companion APK)

No Developer Options / USB debugging required. Same Wi‑Fi as the Linux PC.

## What works today

1. **Listen for PC** — control plane on TCP **17891** (+ mDNS `_aspera-connect._tcp`)
2. **Click-to-call** — desktop / Hub `tel:` → companion places the call (`CALL` / dialer)
3. Optional screen mirror / accessibility (experimental; full Easy mirror is next)

## Phone setup

1. Build/install APK from `apps/android` (Android Studio or Gradle).
2. Open **Aspera Connect** → **Listen for PC**.
3. Tap **Allow phone calls** (recommended for direct dial).
4. Note the phone IP shown on screen.

## Desktop setup

1. Aspera Connect → **Easy mode**
2. Enter phone IP (or **Scan LAN**)
3. Optional matching PIN → **Connect Easy mode**
4. **Test call via companion**, or use Hub / Home Call (falls back to companion when ADB is off)

Config is saved under `~/.config/aspera-connect/config.json` (`companionHost`, `companionPin`).

## Protocol (v1)

Newline-delimited JSON on port 17891:

- `{"type":"hello","protocol":1,"pin":""}`
- `{"type":"helloAck","ok":true,"protocol":1,"capabilities":{"placeCall":true}}`
- `{"type":"placeCall","number":"+91…","direct":true}`
- `{"type":"placeCallAck","ok":true,"message":"…"}`
- `{"type":"ping"}` / `{"type":"pong"}`

Traffic stays on your LAN. Set a PIN on both sides for a simple shared secret.
