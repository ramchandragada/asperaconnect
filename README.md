# Aspera Connect

**Free, open-source Android companion for Linux** — mirror and control your phone from Ubuntu, Linux Mint, Zorin OS, Fedora, Arch, and friends.

No account. No paywall. Local network only by default.

## Features

- **Pro mode:** one-click USB / wireless mirroring via system `adb` + `scrcpy`
- **App windows:** open a phone app in its own PC window (`--new-display`, scrcpy 3.3+) while the phone stays free
- **Click-to-call:** handle `tel:` / `callto:` links (Zoho CRM, browser) and dial via the connected phone; Call from clipboard / tray
- **Meetings profile:** phone audio on PC + screen off for calls and presentations
- **Phone audio on PC:** forward audio while mirroring (Android 11+, scrcpy 2+)
- **Clipboard sync:** bidirectional clipboard while mirroring (toggle in Settings)
- **Session recording:** optional MP4 recordings to `~/Videos/aspera-connect-recordings`
- **Notification center:** Easy mode companion + pull from KDE Connect
- **SMS send:** via KDE Connect when paired, or open composer on phone via ADB
- **Drag & drop:** drop files/APKs on the window to push or install
- **Setup doctor:** checks adb/scrcpy versions and suggests fixes
- **Device nicknames** and phone skin preview on Home
- **Wireless Debugging** pair + connect (Android 11+)
- **Mirror profiles:** quality / balanced / battery / low-latency / meetings
- **Files & photos:** push to phone, pull Camera roll
- **Share:** open share sheet / clipboard helpers on device
- **Easy mode (companion APK):** LAN session, mDNS discovery, notification relay
- **KDE Connect bridge:** ping / ring / share file & text / SMS send / pull notifications
- **Tray icon, error translation, i18n** (en/es/de/fr/hi)

## Install (developers)

### Dependencies

```bash
# Ubuntu / Mint / Zorin
sudo apt update
sudo apt install adb scrcpy build-essential curl wget file \
  libwebkit2gtk-4.1-dev librsvg2-dev patchelf \
  libssl-dev libgtk-3-dev libayatana-appindicator3-dev libdbus-1-dev
```

Also need **Node.js 20+** and **Rust** (rustup).

If `npm` is “not found”, install Node via [fnm](https://github.com/Schniz/fnm) (already used on this machine):

```bash
# one-time, if fnm is installed under ~/.local/share/fnm
export PATH="$HOME/.local/share/fnm:$HOME/.cargo/bin:$PATH"
eval "$("$HOME/.local/share/fnm/fnm" env)"
fnm use 22
# open a new terminal, or: source ~/.bashrc
```

### Run

```bash
cd apps/desktop
npm install
npm run tauri:dev
```

### Build packages

```bash
cd apps/desktop
npm run tauri:build
# artifacts under src-tauri/target/release/bundle/{deb,appimage}
```

See [packaging/](packaging/) for Flatpak metadata and helper scripts.

## Android companion (Easy mode)

Open `apps/android` in Android Studio, build the APK, install on your phone, grant screen capture + accessibility + notification access, then register the session from the desktop **Easy mode** tab.

## License

Apache-2.0 — see [LICENSE](LICENSE). External tools are documented in [NOTICE](NOTICE).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
