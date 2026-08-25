#!/usr/bin/env bash
# Sync local work to GitHub so every machine stays on the same latest main.
# Usage:
#   scripts/sync-github.sh           # commit dirty files (if any) + push
#   scripts/sync-github.sh --push-only
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PUSH_ONLY=0
if [[ "${1:-}" == "--push-only" ]]; then
  PUSH_ONLY=1
fi

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not a git repository: $ROOT" >&2
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [[ "$branch" == "HEAD" ]]; then
  echo "Detached HEAD — skip sync" >&2
  exit 0
fi

if [[ "$PUSH_ONLY" -eq 0 ]]; then
  # Stage tracked + untracked (respects .gitignore; never force-adds secrets)
  git add -A
  if ! git diff --cached --quiet; then
    msg="chore: auto-sync $(date -u +%Y-%m-%dT%H:%MZ)"
    git commit -m "$msg"
    echo "Committed: $msg"
  else
    echo "Nothing to commit"
  fi
fi

# Push if we have a remote and we are ahead (or just after a commit)
if git remote get-url origin >/dev/null 2>&1; then
  git push -u origin "$branch"
  echo "Pushed $branch → origin"
else
  echo "No origin remote configured" >&2
  exit 1
fi
