#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
export PATH="${HOME}/.local/share/fnm:${HOME}/.cargo/bin:${PATH}"
if [[ -x "${HOME}/.local/share/fnm/fnm" ]]; then
  eval "$("${HOME}/.local/share/fnm/fnm" env)"
  fnm use 22 >/dev/null 2>&1 || true
fi

cd "${ROOT}/apps/desktop"
npm ci
npm run tauri:build
node "${ROOT}/packaging/collect-artifacts.mjs"
echo
echo "Share from: ${ROOT}/dist/release/"
ls -lh "${ROOT}/dist/release/"
