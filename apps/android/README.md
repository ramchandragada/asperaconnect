# Android companion (Easy mode)

Kotlin + Jetpack Compose app that:

1. Requests **MediaProjection** (screen capture)
2. Listens on TCP **17891** for desktop Hello / input
3. Optional **AccessibilityService** for taps / Back / Home / Recents
4. Optional **NotificationListener** for notification payloads

## Build

Open this folder in Android Studio (Hedgehog+) or:

```bash
# after adding the Gradle wrapper jar via Android Studio once
./gradlew :app:assembleDebug
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## Protocol (v1)

Newline-delimited JSON on port 17891:

- `{"type":"hello","protocol":1,"pin":""}`
- `{"type":"helloAck","ok":true,"protocol":1}`
- `{"type":"startMirror"}`
- `{"type":"input","kind":"tap","x":100,"y":200}`
- `{"type":"input","kind":"back"|"home"|"recents"}`

Video elementary stream negotiation uses port **17892** (extension point).
