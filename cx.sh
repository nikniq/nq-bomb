#!/usr/bin/env bash
# cx.sh — clear (and optionally rebuild) all Laravel caches.
# Usage: ./cx.sh          clear everything
#        ./cx.sh --cache  clear, then rebuild config/route/view caches (production)
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"

echo "==> Clearing caches"
$PHP artisan optimize:clear      # config, route, view, event, compiled, cache store
rm -f bootstrap/cache/*.php 2>/dev/null || true

if [[ "${1:-}" == "--cache" ]]; then
  echo "==> Rebuilding caches"
  $PHP artisan optimize          # config, route, event, view caches
fi

echo "==> Done"
