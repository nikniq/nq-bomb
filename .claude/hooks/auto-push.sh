#!/usr/bin/env bash
# Auto-commit and push all changes after each Claude turn.
cd "${CLAUDE_PROJECT_DIR:-$(dirname "$0")/../..}" || exit 0
git rev-parse --git-dir >/dev/null 2>&1 || exit 0
git add -A
if ! git diff --cached --quiet; then
  git commit -q -m "Auto-commit: $(date '+%Y-%m-%d %H:%M:%S')" || exit 0
fi
branch=$(git rev-parse --abbrev-ref HEAD)
if [ -n "$(git log "origin/$branch..HEAD" 2>/dev/null)" ] || ! git rev-parse --verify -q "origin/$branch" >/dev/null; then
  if git push -q -u origin "$branch" 2>/tmp/claude-autopush.err; then
    echo '{"systemMessage":"Auto-pushed to origin/'"$branch"'"}'
  else
    echo '{"systemMessage":"Auto-push failed: see /tmp/claude-autopush.err"}'
  fi
fi
exit 0
