# Easy mode (companion APK)

No Developer Options / USB debugging required.

**Purpose:** PC → phone click-to-call only (Hub / Zoho / `tel:`).

Phone and PC must be on the **same office network** so they can reach each other
(typical: phone on office Wi‑Fi, PC on wired LAN). They do **not** need the same
Wi‑Fi SSID.

## What works

1. **Start for calls** — control plane on TCP **17891** (+ mDNS `_aspera-connect._tcp`)
2. **Click-to-call** — desktop / Hub `tel:` → companion places the call
3. **Hang up from PC** — desktop **Hang up** → companion `TelecomManager.endCall()`
4. **Contacts sync** — `listContacts` → cached in Aspera Connect → search + Call

Screen mirroring was removed on purpose.

## Phone setup

1. Install companion APK (`apps/android`).
2. Open **Aspera Connect** → **Start for calls**.
3. Allow phone calls, answer/end calls, and contacts (+ battery unrestricted on OnePlus).
4. Note the phone IP. You can leave the app (keep the notification).

## Desktop setup

1. Aspera Connect opens on **Phone calls**
2. Enter phone IP → **Connect for phone calls** (auto-syncs contacts)
3. Use **Contacts** to search + Call, or Hub / Zoho / `tel:` links
4. While a call is active, use **Hang up** in the call banner to disconnect from the PC

Config: `~/.config/aspera-connect/config.json` (`companionHost`, `companionPin`).
Contacts cache: `~/.config/aspera-connect/contacts.json`.

## Protocol (v1)

Newline-delimited JSON on port 17891:

- `{"type":"hello","protocol":1,"pin":"","name":"PC"}`
- `{"type":"helloAck","ok":true,"protocol":1,"capabilities":{"placeCall":true,"endCall":true,"contacts":true,"mirror":false,"input":false}}`
- `{"type":"placeCall","number":"+91…","direct":true}`
- `{"type":"placeCallAck","ok":true,"message":"…"}`
- `{"type":"endCall"}` → `{"type":"endCallAck","ok":true,"message":"Call ended"}`
- `{"type":"listContacts"}` → `{"type":"contacts","ok":true,"contacts":[{"id":"1","name":"…","phones":["…"]}]}`
- `{"type":"ping"}` / `{"type":"pong"}`

Traffic stays on your LAN. Optional matching PIN on both sides.
