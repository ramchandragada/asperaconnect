#!/usr/bin/env bash
# Create a Play Console upload keystore (run on YOUR PC once).
# Login to Play as marketing@thegstco.com — do not commit the keystore.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AND="$ROOT/apps/android"
KEY="$AND/play-upload.keystore"
PROPS="$AND/play-upload.properties"

if [[ -f "$KEY" ]]; then
  echo "Already exists: $KEY"
  echo "Delete it first if you really want a new key (breaks Play updates if already uploaded)."
  exit 1
fi

PASS="$(openssl rand -base64 18 | tr -d '/+=' | head -c 24)"
ALIAS="aspera-upload"

keytool -genkeypair -v \
  -keystore "$KEY" \
  -alias "$ALIAS" \
  -keyalg RSA -keysize 2048 -validity 10000 \
  -storepass "$PASS" -keypass "$PASS" \
  -dname "CN=Aspera Connect, OU=The GST Co, O=The GST Co, L=India, ST=India, C=IN"

cat > "$PROPS" <<EOF
storeFile=play-upload.keystore
storePassword=$PASS
keyAlias=$ALIAS
keyPassword=$PASS
EOF

chmod 600 "$KEY" "$PROPS"
echo
echo "Created:"
echo "  $KEY"
echo "  $PROPS"
echo
echo "NEXT:"
echo "  1) Back up both files to your company password manager (marketing@thegstco.com)."
echo "  2) Build AAB:  ./scripts/build-play-aab.sh"
echo "  3) Upload AAB in Play Console → Internal testing."
echo
echo "Passwords are only in play-upload.properties — never commit them."
