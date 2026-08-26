#!/usr/bin/env bash
# Register Aspera Connect Call as the default handler for tel: / callto: (Linux).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
BIN_DIR="${HOME}/.local/bin"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
APP_ID="aspera-connect-tel.desktop"
mkdir -p "$BIN_DIR" "$APPS"

install -m 755 "$ROOT/aspera-tel" "$BIN_DIR/aspera-tel"

cat > "$APPS/$APP_ID" <<EOF
[Desktop Entry]
Name=Aspera Connect Call
Comment=Place calls via ADB or Easy-mode companion (Zoho / Hub / browser)
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
