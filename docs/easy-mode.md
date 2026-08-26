# Easy mode (companion APK)

No Developer Options / USB debugging required.

**Purpose:** PC → phone click-to-call only (Hub / Zoho / `tel:`).

Phone and PC must be on the **same office network** so they can reach each other
(typical: phone on office Wi‑Fi, PC on wired LAN). They do **not** need the same
Wi‑Fi SSID.

## What works

1. **Start for calls** — control plane on TCP **17891** (+ mDNS `_aspera-connect._tcp`)
2. **Click-to-call** — desktop / Hub `tel:` → companion places the call

Screen mirroring was removed on purpose.

## Phone setup

1. Install companion APK (`apps/android`).
2. Open **Aspera Connect** → **Start for calls**.
3. Allow phone calls (+ battery unrestricted on OnePlus).
4. Note the phone IP. You can leave the app (keep the notification).

## Desktop setup

1. Aspera Connect → **Easy mode** (opens by default)
2. Enter phone IP → **Connect for phone calls**
3. Use Hub / Zoho / `tel:` links — dials every time

Config: `~/.config/aspera-connect/config.json` (`companionHost`, `companionPin`).

## Protocol (v1)

Newline-delimited JSON on port 17891:

- `{"type":"hello","protocol":1,"pin":"","name":"PC"}`
- `{"type":"helloAck","ok":true,"protocol":1,"capabilities":{"placeCall":true,"mirror":false,"input":false}}`
- `{"type":"placeCall","number":"+91…","direct":true}`
- `{"type":"placeCallAck","ok":true,"message":"…"}`
- `{"type":"ping"}` / `{"type":"pong"}`

Traffic stays on your LAN. Optional matching PIN on both sides.
