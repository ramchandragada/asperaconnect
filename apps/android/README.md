# Android companion (Easy mode)

Kotlin + Jetpack Compose app for Linux Easy mode:

1. **CompanionService** — LAN listener on TCP **17891** (no Developer Options)
2. **placeCall** from the PC / Hub over the office LAN (Wi‑Fi phone + wired PC OK)
3. Optional **MediaProjection** mirror + **AccessibilityService** for taps
4. Optional **NotificationListener** (not required for company Hub users)

## Build

Open this folder in Android Studio (Hedgehog+) or:

```bash
# after adding the Gradle wrapper jar via Android Studio once
./gradlew :app:assembleDebug
# install (USB once is OK for sideload; daily use needs no debugging)
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## First-run on phone

1. Open app → **Listen for PC**
2. **Allow phone calls**
3. Enter the shown IP in desktop Easy mode

## Protocol (v1)

See [docs/easy-mode.md](../../docs/easy-mode.md).
