#!/usr/bin/env bash
# Cursor stop hook: after the agent finishes, commit + push so GitHub stays current.
set -euo pipefail

# Consume hook JSON from stdin (required)
cat >/dev/null

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SYNC="$ROOT/scripts/sync-github.sh"

if [[ ! -x "$SYNC" ]]; then
  chmod +x "$SYNC" 2>/dev/null || true
fi

# Fail open for the agent UI — log to stderr, always return valid empty JSON
if ! "$SYNC" >/tmp/aspera-sync-github.log 2>&1; then
  echo "sync-to-github failed; see /tmp/aspera-sync-github.log" >&2
fi

echo '{}'
exit 0
