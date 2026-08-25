# Architecture

```
apps/desktop (Tauri 2 + React)
    └── invokes → crates/core (Rust)
                      ├── adb / pairing / mirror (scrcpy process)
                      ├── companion_net (Easy mode TCP)
                      └── kdeconnect (optional CLI bridge)
apps/android (companion APK)
    └── MirrorService :17891 + Accessibility + Notifications
```

**Pro mode** never embeds scrcpy; it spawns the system binary.

**Easy mode** is LAN-only with an optional shared PIN.
