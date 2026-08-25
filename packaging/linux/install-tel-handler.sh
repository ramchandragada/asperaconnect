#!/usr/bin/env bash
# Register Aspera Connect Call as the default handler for tel: / callto: (Linux).
# Uses ~/.local/bin/aspera-tel which dials via ADB — does not launch the Tauri UI
# (debug builds need Vite and show "Could not connect to localhost").
set -euo pipefail

BIN_DIR="${HOME}/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
APP_ID="aspera-connect-tel.desktop"
mkdir -p "$BIN_DIR" "$APPS"

cat > "$BIN_DIR/aspera-tel" << 'EOF'
#!/usr/bin/env bash
# Aspera Connect — handle tel:/callto: and place call on connected Android phone.
set -euo pipefail

RAW="${1:-}"
if [[ -z "$RAW" ]]; then
  notify-send "Aspera Call" "No phone number provided" 2>/dev/null || true
  exit 1
fi

NUM="$RAW"
NUM="${NUM#tel:}"
NUM="${NUM#TEL:}"
NUM="${NUM#callto:}"
NUM="${NUM#CALLTO:}"
NUM="$(printf '%b' "${NUM//%/\\x}")"
NUM="$(echo "$NUM" | sed 's/[?\;#].*//; s/[^0-9+]//g')"

if [[ ${#NUM} -lt 3 ]]; then
  notify-send "Aspera Call" "Invalid number: $RAW" 2>/dev/null || true
  exit 1
fi

ADB="$(command -v adb || true)"
if [[ -z "$ADB" ]]; then
  notify-send "Aspera Call" "adb not found — sudo apt install adb" 2>/dev/null || true
  exit 1
fi

SERIAL="$("$ADB" devices 2>/dev/null | awk '/\tdevice$/{print $1; exit}')"
if [[ -z "$SERIAL" ]]; then
  notify-send "Aspera Call" "No phone connected (USB / wireless debugging)" 2>/dev/null || true
  exit 1
fi

if ! "$ADB" -s "$SERIAL" shell am start -a android.intent.action.CALL -d "tel:${NUM}" >/dev/null 2>&1; then
  "$ADB" -s "$SERIAL" shell am start -a android.intent.action.DIAL -d "tel:${NUM}" >/dev/null 2>&1 || true
  notify-send "Aspera Call" "Opened dialer for ${NUM} — tap Call on phone" 2>/dev/null || true
else
  notify-send "Aspera Call" "Calling ${NUM} via phone / BT headset" 2>/dev/null || true
fi
EOF
chmod +x "$BIN_DIR/aspera-tel"

cat > "$APPS/$APP_ID" <<EOF
[Desktop Entry]
Name=Aspera Connect Call
Comment=Place calls via connected Android phone (Zoho / Hub / browser)
Exec=$BIN_DIR/aspera-tel %u
Icon=phone
Terminal=false
Type=Application
Categories=Network;Telephony;
MimeType=x-scheme-handler/tel;x-scheme-handler/callto;
StartupNotify=false
EOF

update-desktop-database "$APPS" 2>/dev/null || true
xdg-mime default "$APP_ID" x-scheme-handler/tel
xdg-mime default "$APP_ID" x-scheme-handler/callto

echo "OK — tel: / callto: → $BIN_DIR/aspera-tel"
echo "Test: xdg-open 'tel:+919876543210'"
echo "Default handler: $(xdg-mime query default x-scheme-handler/tel)"
