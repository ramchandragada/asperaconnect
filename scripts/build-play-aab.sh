#!/usr/bin/env bash
# Build signed Android App Bundle for Google Play (Internal testing).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
AND="$ROOT/apps/android"
PROPS="$AND/play-upload.properties"
KEY="$AND/play-upload.keystore"

if [[ ! -f "$PROPS" || ! -f "$KEY" ]]; then
  echo "Missing Play upload key. Run first:"
  echo "  ./scripts/create-play-upload-keystore.sh"
  exit 1
fi

cd "$AND"
./gradlew clean bundlePlay
AAB=$(find app/build/outputs/bundle/play -name '*.aab' | head -1)
if [[ -z "$AAB" ]]; then
  echo "AAB not found"
  exit 1
fi

mkdir -p "$ROOT/dist/release"
OUT="$ROOT/dist/release/AsperaConnect-Phone-Play.aab"
cp -f "$AAB" "$OUT"
ls -lh "$OUT"
echo
echo "Upload this file in Play Console (marketing@thegstco.com):"
echo "  $OUT"
echo "Release name suggestion: 0.3.11 internal"
