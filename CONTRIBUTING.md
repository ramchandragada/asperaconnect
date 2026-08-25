# Contributing to Aspera Connect

Thanks for helping Linux users get a first-class Android bridge.

## Ground rules

- Keep the app **free forever** — no freemium, no account walls.
- Prefer local-first features; any telemetry must be opt-in.
- Pro mode (adb/scrcpy) stays the gold path for latency.
- Translate user-facing errors; never dump raw tool stderr in the UI.

## Dev setup

1. Install Rust (rustup), Node 20+, `adb`, `scrcpy`.
2. Install Tauri Linux deps (see README).
3. `cd apps/desktop && npm install && npm run tauri:dev`

## Project layout

- `apps/desktop` — Tauri + React UI
- `crates/core` — ADB / scrcpy / pairing / config
- `apps/android` — Easy mode companion APK
- `packaging` — deb/AppImage/Flatpak helpers
- `docs` — user docs
- `website` — landing page

## Pull requests

- Small, focused PRs
- Include screenshots for UI changes
- Test on at least one Debian-based distro when touching Pro mode
