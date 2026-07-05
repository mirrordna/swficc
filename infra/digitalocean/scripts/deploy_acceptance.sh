#!/usr/bin/env bash
set -euo pipefail

HOST="${SWFIPN_HOST:-}"
DOMAIN="${SWFIPN_DOMAIN:-}"
SITE_ADDRESSES="${SWFIPN_SITE_ADDRESSES:-$DOMAIN}"
API_DOMAIN="${SWFIPN_API_DOMAIN:-api.swfi.com}"
REMOTE_ROOT="${SWFIPN_REMOTE_ROOT:-/opt/swfipn-acceptance}"
FRONTEND_REPO="${SWFIPN_FRONTEND_REPO:-/Users/mirror-pro/repos/swfi-dashboard}"
BACKEND_REPO="${SWFI2_BACKEND_REPO:-/Users/mirror-pro/repos/SWFI2.0-final}"
SSH_OPTS="${SWFIPN_SSH_OPTS:--o StrictHostKeyChecking=accept-new}"
COMPOSE_PROJECT="${SWFIPN_COMPOSE_PROJECT:-swfipn_acceptance}"

if [[ -z "$HOST" || -z "$DOMAIN" ]]; then
  echo "usage: SWFIPN_HOST=user@ip SWFIPN_DOMAIN=host.example.com $0" >&2
  exit 2
fi

for path in "$FRONTEND_REPO" "$BACKEND_REPO"; do
  if [[ ! -d "$path" ]]; then
    echo "missing repo: $path" >&2
    exit 2
  fi
done

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ASSET_VERSION="${SWFIPN_ASSET_VERSION:-$STAMP}"
GIT_SHA="$(git -C "$FRONTEND_REPO" rev-parse HEAD 2>/dev/null || printf 'unknown')"
if git -C "$FRONTEND_REPO" diff --quiet 2>/dev/null && git -C "$FRONTEND_REPO" diff --cached --quiet 2>/dev/null; then
  GIT_DIRTY=0
else
  GIT_DIRTY=1
fi
REMOTE_RELEASE="$REMOTE_ROOT/releases/$STAMP"

ssh $SSH_OPTS "$HOST" "mkdir -p '$REMOTE_RELEASE' '$REMOTE_ROOT/shared'"

rsync -az --delete --timeout=120 --stats -e "ssh $SSH_OPTS" \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'out' \
  --exclude 'output' \
  --exclude 'tmp' \
  "$FRONTEND_REPO/" "$HOST:$REMOTE_RELEASE/swfi-dashboard/"

rsync -az --delete --timeout=120 --stats -e "ssh $SSH_OPTS" \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude 'output' \
  "$BACKEND_REPO/" "$HOST:$REMOTE_RELEASE/SWFI2.0-final/"

ssh $SSH_OPTS "$HOST" "cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/Caddyfile' '$REMOTE_RELEASE/Caddyfile' && cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/compose.acceptance.yml' '$REMOTE_RELEASE/compose.acceptance.yml'"

ssh $SSH_OPTS "$HOST" "test -s '$REMOTE_ROOT/shared/.env.swfi2-backend' && test -s '$REMOTE_ROOT/shared/.env.swfipn-web'"

ssh $SSH_OPTS "$HOST" "ln -sfn '$REMOTE_ROOT/shared/.env.swfi2-backend' '$REMOTE_RELEASE/.env.swfi2-backend' && ln -sfn '$REMOTE_ROOT/shared/.env.swfipn-web' '$REMOTE_RELEASE/.env.swfipn-web'"

ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFI2_BACKEND_CONTEXT=./SWFI2.0-final SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' SWFIPN_ASSET_VERSION='$ASSET_VERSION' SWFIPN_GIT_SHA='$GIT_SHA' SWFIPN_GIT_DIRTY='$GIT_DIRTY' docker compose -p '$COMPOSE_PROJECT' -f compose.acceptance.yml build"

ssh $SSH_OPTS "$HOST" "docker volume create swfipn_acceptance_caddy_data >/dev/null && docker volume create swfipn_acceptance_caddy_config >/dev/null && cid=\$(docker ps --filter 'name=caddy-1' --format '{{.Names}}' | head -n 1); if [ -n \"\$cid\" ]; then docker run --rm --volumes-from \"\$cid\" -v swfipn_acceptance_caddy_data:/to-data -v swfipn_acceptance_caddy_config:/to-config alpine sh -c 'cp -a /data/. /to-data/ 2>/dev/null || true; cp -a /config/. /to-config/ 2>/dev/null || true'; fi"

ssh $SSH_OPTS "$HOST" "if [ -L '$REMOTE_ROOT/current' ]; then current=\$(readlink -f '$REMOTE_ROOT/current'); if [ -n \"\$current\" ] && [ -f \"\$current/compose.acceptance.yml\" ]; then release_project=\$(basename \"\$current\" | tr '[:upper:]' '[:lower:]'); cd \"\$current\" && for project in '$COMPOSE_PROJECT' \"\$release_project\" current; do SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose -p \"\$project\" -f compose.acceptance.yml down --remove-orphans || true; done; fi; fi"

ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFI2_BACKEND_CONTEXT=./SWFI2.0-final SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' SWFIPN_ASSET_VERSION='$ASSET_VERSION' SWFIPN_GIT_SHA='$GIT_SHA' SWFIPN_GIT_DIRTY='$GIT_DIRTY' docker compose -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d"

ssh $SSH_OPTS "$HOST" "ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current' && cd '$REMOTE_RELEASE' && SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose -p '$COMPOSE_PROJECT' -f compose.acceptance.yml ps"

mkdir -p "$FRONTEND_REPO/output"
SWFIPN_DEPLOY_RECEIPT="$FRONTEND_REPO/output/swfipn-strict-acceptance-deploy-latest.json" \
SWFIPN_DEPLOY_GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
SWFIPN_DEPLOY_RELEASE="$REMOTE_RELEASE" \
SWFIPN_DEPLOY_DOMAIN="$DOMAIN" \
SWFIPN_DEPLOY_SITE_ADDRESSES="$SITE_ADDRESSES" \
SWFIPN_DEPLOY_API_DOMAIN="$API_DOMAIN" \
SWFIPN_DEPLOY_HOST="$HOST" \
SWFIPN_DEPLOY_ASSET_VERSION="$ASSET_VERSION" \
SWFIPN_DEPLOY_GIT_SHA="$GIT_SHA" \
SWFIPN_DEPLOY_GIT_DIRTY="$GIT_DIRTY" \
python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schema_version": "swfipn.strict_acceptance_deploy.v2",
    "generated_at": os.environ["SWFIPN_DEPLOY_GENERATED_AT"],
    "status": "pass",
    "release": os.environ["SWFIPN_DEPLOY_RELEASE"],
    "domain": os.environ["SWFIPN_DEPLOY_DOMAIN"],
    "site_addresses": os.environ["SWFIPN_DEPLOY_SITE_ADDRESSES"],
    "api_domain": os.environ["SWFIPN_DEPLOY_API_DOMAIN"],
    "host": os.environ["SWFIPN_DEPLOY_HOST"],
    "asset_version": os.environ["SWFIPN_DEPLOY_ASSET_VERSION"],
    "git_sha": os.environ["SWFIPN_DEPLOY_GIT_SHA"],
    "git_dirty": os.environ["SWFIPN_DEPLOY_GIT_DIRTY"] == "1",
}
Path(os.environ["SWFIPN_DEPLOY_RECEIPT"]).write_text(json.dumps(receipt, indent=2) + "\n")
PY

echo "$REMOTE_RELEASE"
