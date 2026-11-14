#!/usr/bin/env bash
# deploy.sh — pull latest code and update the app, with maintenance mode.
# Usage: ./deploy.sh [branch]      (default branch: main)
#        ./deploy.sh down          put site into maintenance mode only
#        ./deploy.sh up            bring site back up only
set -euo pipefail
cd "$(dirname "$0")"
PHP="${PHP:-php}"
COMPOSER="${COMPOSER:-composer}"
BRANCH="${1:-main}"

case "$BRANCH" in
  down) $PHP artisan down --retry=60 --refresh=15; echo "Site is in maintenance mode."; exit 0 ;;
  up)   $PHP artisan up; echo "Site is live."; exit 0 ;;
esac

# Always bring the site back up, even if a step fails.
trap '$PHP artisan up >/dev/null 2>&1 || true' EXIT

echo "==> Maintenance mode on"
$PHP artisan down --retry=60 --refresh=15 || true

echo "==> Pulling origin/$BRANCH"
git fetch origin "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "==> Installing PHP dependencies"
$COMPOSER install --no-dev --prefer-dist --optimize-autoloader --no-interaction

[[ -f .env ]] || { cp .env.example .env; $PHP artisan key:generate --force; echo "!! Created .env — review it."; }

echo "==> Permissions"
mkdir -p storage/framework/{cache,sessions,views} storage/logs bootstrap/cache
chmod -R ug+rwX storage bootstrap/cache

if grep -q '^DB_CONNECTION=sqlite' .env; then
  touch database/database.sqlite
fi
echo "==> Migrations"
$PHP artisan migrate --force

echo "==> Refreshing caches"
./cx.sh --cache

echo "==> Maintenance mode off"
$PHP artisan up
trap - EXIT
echo "==> Deployed $(git rev-parse --short HEAD)"
