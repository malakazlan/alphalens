#!/usr/bin/env bash
# Idempotent deploy for AlphaLens. Pulls latest main, rebuilds image,
# recreates the alphalens stack. Touches only /opt/alphalens — never /opt/anorra.
#
# Run as root on anorra-prod:
#   bash /opt/alphalens/src/deploy/deploy.sh
set -euo pipefail

ROOT=/opt/alphalens
ENV_FILE="$ROOT/.env"
COMPOSE="$ROOT/src/deploy/docker-compose.yml"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "ERROR: $ENV_FILE not found. Copy deploy/.env.example, fill it, chmod 600." >&2
  exit 1
fi

if [[ "$(stat -c %a "$ENV_FILE")" != "600" ]]; then
  echo "WARN: $ENV_FILE permissions are $(stat -c %a "$ENV_FILE"); fixing to 600"
  chmod 600 "$ENV_FILE"
fi

echo "→ pulling latest main"
cd "$ROOT/src"
git fetch origin main --quiet
git reset --hard origin/main

# Tag this deploy so Sentry can attribute errors to a specific commit.
# Exported into the environment so docker-compose substitutes ${SENTRY_RELEASE}.
export SENTRY_RELEASE="$(git rev-parse --short HEAD)"
echo "→ release tag: $SENTRY_RELEASE"

echo "→ rebuilding image"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" build --pull

echo "→ recreating stack"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" up -d --remove-orphans

echo "→ status"
docker compose -f "$COMPOSE" --env-file "$ENV_FILE" ps

echo "→ verifying anorra is still healthy"
docker ps --filter "name=anorra_" --format 'table {{.Names}}\t{{.Status}}'

echo "→ done"
