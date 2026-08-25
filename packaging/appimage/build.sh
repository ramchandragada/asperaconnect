#!/usr/bin/env bash
# AppImage is produced by `tauri build` when targets include appimage.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT/apps/desktop"
npm ci
npm run tauri:build
find src-tauri/target/release/bundle/appimage -type f -name '*.AppImage' -print
