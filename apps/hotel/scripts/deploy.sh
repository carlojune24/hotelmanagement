#!/usr/bin/env bash
# Upload the working tree to the server, rebuild and restart pm2 (mm-hotel).
#   pnpm deploy:hotel            # code only
#   pnpm deploy:hotel --migrate  # also run DB migrations before restart
# Needs key-based ssh. The server's apps/hotel/.env is never overwritten.
set -euo pipefail

HOST="${HOTEL_DEPLOY_HOST:-mmserver@100.109.167.10}"
DIR="${HOTEL_DEPLOY_DIR:-mmhotel}"   # relative to the server home
APP="${HOTEL_DEPLOY_PM2:-mm-hotel}"
PORT="${HOTEL_DEPLOY_PORT:-3011}"
MIGRATE=""; [ "${1:-}" = "--migrate" ] && MIGRATE=1

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

echo "→ packing $ROOT"
tar -C "$ROOT" --exclude=node_modules --exclude=.git --exclude=build --exclude=.svelte-kit \
  --exclude=.env --exclude='.env.*' --anchored --exclude=./uploads --exclude=./apps/hotel/uploads --exclude=./apps/hr/uploads --no-anchored --exclude='*.worktrees' --exclude='*_snapshot.json' \
  -czf "$TMP/src.tgz" .

echo "→ uploading to $HOST"
scp -q "$TMP/src.tgz" "$HOST:/tmp/mmsrc-hotel.tgz"

echo "→ building and restarting on the server"
ssh "$HOST" "set -e
  mkdir -p ~/$DIR
  cd ~/$DIR
  rm -rf apps/hotel/src apps/hotel/static apps/hotel/drizzle   # drop files deleted locally
  tar xzf /tmp/mmsrc-hotel.tgz && rm -f /tmp/mmsrc-hotel.tgz
  pnpm install --frozen-lockfile --filter @mm/hotel... 2>&1 | tail -2
  cd apps/hotel
  pnpm exec svelte-kit sync
  pnpm build 2>&1 | tail -3
  if [ -n '$MIGRATE' ]; then pnpm exec tsx --env-file=.env src/lib/server/db/migrate.ts; fi
  pm2 describe $APP >/dev/null 2>&1 && pm2 restart $APP --update-env \
    || pm2 start build/index.js --name $APP --node-args='--env-file=.env'
  pm2 save >/dev/null
  sleep 3
  curl -s -o /dev/null -w 'local check: HTTP %{http_code}\n' http://127.0.0.1:$PORT/"
echo "✓ deployed"
