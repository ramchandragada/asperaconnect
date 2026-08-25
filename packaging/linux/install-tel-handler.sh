#!/usr/bin/env bash
# Register Aspera Connect as the default handler for tel: / callto: links (Linux).
set -euo pipefail

APP_ID="aspera-connect-tel.desktop"
APPS="${XDG_DATA_HOME:-$HOME/.local/share}/applications"
mkdir -p "$APPS"

# Prefer installed binary; fall back to cargo/debug path if present.
BIN="$(command -v aspera-connect || true)"
if [[ -z "$BIN" ]]; then
  echo "aspera-connect not on PATH. Install the .deb or run from tauri:dev and use Home → Make Aspera handle tel: links."
  exit 1
fi

cat > "$APPS/$APP_ID" <<EOF
[Desktop Entry]
Name=Aspera Connect Call
Comment=Place calls via connected Android phone
Exec="$BIN" %u
Icon=aspera-connect
Terminal=false
Type=Application
Categories=Network;Telephony;
MimeType=x-scheme-handler/tel;x-scheme-handler/callto;
NoDisplay=true
EOF

update-desktop-database "$APPS" 2>/dev/null || true
xdg-mime default "$APP_ID" x-scheme-handler/tel
xdg-mime default "$APP_ID" x-scheme-handler/callto

echo "OK — tel: / callto: → $BIN"
echo "Test: xdg-open 'tel:+919876543210'"
echo "Default handler: $(xdg-mime query default x-scheme-handler/tel)"
