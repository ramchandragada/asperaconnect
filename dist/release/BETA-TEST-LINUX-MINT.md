# Aspera Connect — employee beta test (Linux Mint Xfce)

**What it does:** PC → phone **click-to-call** (Zoho, browser `tel:` links, Contacts, Call from clipboard).  
**What testers need:** Linux Mint PC (Xfce) + Android phone on the **same office network**.

---

## Part 1 — PC (Linux Mint)

Open **Terminal** and run:

```bash
# Install the desktop app (single file, no sudo)
mkdir -p ~/.local/bin
curl -L -o ~/.local/bin/aspera-connect \
  "https://raw.githubusercontent.com/ramchandragada/asperaconnect/cursor/phone-contacts-sync-5b4f/dist/release/aspera-connect-linux-x64"
chmod +x ~/.local/bin/aspera-connect

# Clipboard “Call from clipboard” (Mint Xfce uses X11 — use xclip)
sudo apt update
sudo apt install -y xclip

# Optional: add to PATH if not already (log out/in after)
grep -q '.local/bin' ~/.profile 2>/dev/null || echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.profile
export PATH="$HOME/.local/bin:$PATH"
```

**Launch:** run `aspera-connect` in Terminal, or create a menu shortcut:

```bash
mkdir -p ~/.local/share/applications
cat > ~/.local/share/applications/aspera-connect.desktop << 'EOF'
[Desktop Entry]
Name=Aspera Connect
Comment=PC to phone click-to-call
Exec=/home/USER/.local/bin/aspera-connect
Icon=phone
Terminal=false
Type=Application
Categories=Network;Telephony;
EOF
# Replace USER with your username, e.g. sed -i "s/USER/$USER/" ~/.local/share/applications/aspera-connect.desktop
sed -i "s|/home/USER|/home/$USER|" ~/.local/share/applications/aspera-connect.desktop
```

After install, **Aspera Connect** should appear in the app menu.

---

## Part 2 — Phone (Android)

**No USB debugging required.** Install the companion APK:

### Option A — Install on the phone (easiest for most staff)

1. On the phone, open this link in Chrome (same Wi‑Fi as PC):  
   `https://github.com/ramchandragada/asperaconnect/raw/cursor/phone-contacts-sync-5b4f/dist/release/AsperaConnect-0.3.6.apk`
2. Allow **Install unknown apps** for Chrome when prompted.
3. Open **Aspera Connect** → grant **Phone**, **Answer calls**, and **Contacts** → tap **Start for calls**.
4. Note the **IP address** shown (e.g. `192.168.1.8`).

### Option B — IT installs via USB (adb)

```bash
sudo apt install -y adb
curl -L --http1.1 -o /tmp/AsperaConnect-0.3.6.apk \
  "https://raw.githubusercontent.com/ramchandragada/asperaconnect/cursor/phone-contacts-sync-5b4f/dist/release/AsperaConnect-0.3.6.apk"
adb install -t /tmp/AsperaConnect-0.3.6.apk
```

---

## Part 3 — Connect PC and phone

1. Phone: **Start for calls** (keep the notification — you can leave the app).
2. PC: open **Aspera Connect** → **Phone calls**.
3. Enter the phone IP **or** click **Find phone on network** → **Connect for phone calls**.
4. When sidebar shows **Linked** and contacts sync, you’re ready.

**Wi‑Fi tip:** If your router splits **2.4 GHz** and **5 GHz**, PC and phone must use the **same band** (or use **Find phone on network** after switching).

---

## What to test

| Test | How |
|------|-----|
| Connect | Phone calls tab → Connect → sidebar **Linked** |
| Contacts | **Contacts** tab → search → **Call** |
| Zoho / browser | Click a phone number link (register tel handler once if asked) |
| Clipboard | Copy a number → tray icon → **Call from clipboard** |
| Hang up | During a call, **Hang up** on the PC banner |

---

## Report back to IT / Shree

Please send:

- Linux Mint version (`cat /etc/linuxmint/info`)
- Phone model + Android version
- Connected? Y/N — IP used
- Which tests worked / failed
- Screenshot of any red error banner

---

## Uninstall

**PC:** `rm ~/.local/bin/aspera-connect ~/.local/share/applications/aspera-connect.desktop`

**Phone:** Settings → Apps → Aspera Connect → Uninstall

---

Version: desktop `cursor/phone-contacts-sync-5b4f` · phone APK **0.3.6**
