# Publish Aspera Connect on Google Play (Internal testing)

**This is the only employee-proof phone install.** No USB, no Developer Options, no Play Protect fights.

Employees then: Play Store → search / open invite link → Install. Done.

## What you need (once)

1. Google account (company email fine)
2. [Google Play Console](https://play.google.com/console) — **$25 one-time** registration
3. ~30–60 minutes the first time

## Steps

### 1. Create the app

1. Play Console → **Create app**
2. App name: **Aspera Connect**
3. Default language: English
4. App or game: **App**
5. Free
6. Declarations: accept

### 2. Signing (important)

- Prefer **Play App Signing** (Google holds the app signing key).
- Create a **new upload keystore** on your PC (do **not** use the public `aspera-sideload.keystore` from git for Play).

```bash
keytool -genkeypair -v -keystore aspera-play-upload.keystore -alias aspera-upload \
  -keyalg RSA -keysize 2048 -validity 10000
```

Keep that keystore + passwords in a password manager. Never commit it.

In `apps/android/app/build.gradle.kts`, add a `play` signing config pointing at that keystore and build:

```bash
cd apps/android
./gradlew assembleRelease   # or a dedicated playRelease once configured
```

Upload the `.aab` (Android App Bundle) when Play asks — Forge/Gradle:

```bash
./gradlew bundleRelease
```

### 3. Store listing (can be minimal for Internal testing)

- Short description: `Click-to-call from Linux Aspera Hub / Zoho to your Android phone.`
- Full description: pair with QR, works across networks, contacts sync, hang up.
- Screenshots: 2 phone screenshots of the companion app
- Privacy policy URL: host a short page (required even for internal)

### 4. Internal testing track

1. **Testing → Internal testing → Create email list**
2. Add employee Gmail / Workspace emails
3. Create a release → upload AAB → review notes: `Internal company click-to-call companion`
4. Roll out to Internal testing
5. Copy the **join link** (or share Play Console invite)

### 5. What employees do

1. Open the **join / opt-in link** once on the phone (must use the same Google account)
2. Play Store → Aspera Connect → **Install**
3. Open → Start for calls → Scan PC QR

No APK. No USB. No “unknown sources”.

### 6. Closed testing (optional next)

When ready for more people: **Closed testing** with a larger email list, still no public listing.

## Why sideload keeps failing

Play Protect and OEMs (Xiaomi, some Samsungs) **hard-block** unknown APKs even with “Scan apps” off. USB/`adb` bypasses that for IT, but it is the wrong employee path. Play Store is the fix.

## After Play is live

Update employee share text to the Play link only. Keep APK for emergency IT installs.
