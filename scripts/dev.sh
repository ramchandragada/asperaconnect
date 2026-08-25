#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${ROOT}/.tools/bin:${HOME}/.cargo/bin:${PATH}"

if command -v fnm >/dev/null 2>&1; then
  eval "$(fnm env)"
  fnm use 22 >/dev/null 2>&1 || true
fi

cd "${ROOT}/apps/desktop"
npm install
npm run tauri:dev
