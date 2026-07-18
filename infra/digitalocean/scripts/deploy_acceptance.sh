#!/usr/bin/env bash
set -euo pipefail

HOST="${SWFIPN_HOST:-}"
DOMAIN="${SWFIPN_DOMAIN:-}"
# dashboard.swfi.com is the team's decided internal hostname (minutes
# 2026-07-03, decision M / action 5). It ships in the DEFAULT so a deploy run
# without ambient env can never silently drop its TLS again (2026-07-05
# incident: a deploy without SWFIPN_SITE_ADDRESSES exported rebuilt Caddy with
# only the swfipn domain and dashboard.swfi.com lost its certificate).
SITE_ADDRESSES="${SWFIPN_SITE_ADDRESSES:-$DOMAIN, dashboard.swfi.com}"
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
if [[ -z "$(git -C "$FRONTEND_REPO" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
  GIT_DIRTY=0
else
  GIT_DIRTY=1
fi
BACKEND_GIT_SHA="$(git -C "$BACKEND_REPO" rev-parse HEAD 2>/dev/null || printf 'unknown')"
if [[ -z "$(git -C "$BACKEND_REPO" status --porcelain --untracked-files=normal 2>/dev/null)" ]]; then
  BACKEND_GIT_DIRTY=0
else
  BACKEND_GIT_DIRTY=1
fi
if [[ "${SWFIPN_ALLOW_DIRTY:-0}" != "1" && ("$GIT_DIRTY" == "1" || "$BACKEND_GIT_DIRTY" == "1") ]]; then
  echo "refusing deploy from dirty source: frontend_dirty=$GIT_DIRTY backend_dirty=$BACKEND_GIT_DIRTY" >&2
  exit 2
fi
REMOTE_RELEASE="$REMOTE_ROOT/releases/$STAMP"
PREVIOUS_RELEASE="$(ssh $SSH_OPTS "$HOST" "if [ -L '$REMOTE_ROOT/current' ]; then readlink -f '$REMOTE_ROOT/current'; fi")"
PREVIOUS_FRONTEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1' 2>/dev/null || true")"
PREVIOUS_BACKEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1' 2>/dev/null || true")"

if [[ -n "$PREVIOUS_RELEASE" && "$PREVIOUS_RELEASE" != "$REMOTE_ROOT/releases/"* ]]; then
  echo "refusing deploy with invalid previous release: $PREVIOUS_RELEASE" >&2
  exit 2
fi

ssh $SSH_OPTS "$HOST" "set -eu; mkdir -p '$REMOTE_ROOT/releases' '$REMOTE_ROOT/shared'; test ! -e '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'; mkdir '$REMOTE_RELEASE'; test -d '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'"

rsync -az --delete --timeout=120 --stats -e "ssh $SSH_OPTS" \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude '.next' \
  --exclude 'out' \
  --exclude 'output' \
  --exclude 'tmp' \
  "$FRONTEND_REPO/" "$HOST:$REMOTE_RELEASE/swfi-dashboard/"

rsync -az --delete --timeout=120 --stats -e "ssh $SSH_OPTS" \
  --exclude '.git' \
  --exclude '.DS_Store' \
  --exclude '.env' \
  --exclude '.env.*' \
  --exclude 'node_modules' \
  --exclude '.venv' \
  --exclude '.verify-venv' \
  --exclude '__pycache__' \
  --exclude '*.pyc' \
  --exclude '.pytest_cache' \
  --exclude '.ruff_cache' \
  --exclude 'output' \
  "$BACKEND_REPO/" "$HOST:$REMOTE_RELEASE/SWFI2.0-final/"

ssh $SSH_OPTS "$HOST" "cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/Caddyfile' '$REMOTE_RELEASE/Caddyfile' && cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/compose.acceptance.yml' '$REMOTE_RELEASE/compose.acceptance.yml'"

ssh $SSH_OPTS "$HOST" "test -s '$REMOTE_ROOT/shared/.env.swfi2-backend' && test -s '$REMOTE_ROOT/shared/.env.swfipn-web'"

ssh $SSH_OPTS "$HOST" "ln -sfn '$REMOTE_ROOT/shared/.env.swfi2-backend' '$REMOTE_RELEASE/.env.swfi2-backend' && ln -sfn '$REMOTE_ROOT/shared/.env.swfipn-web' '$REMOTE_RELEASE/.env.swfipn-web'"

ssh $SSH_OPTS "$HOST" "printf '%s\n' 'SWFIPN_IMAGE_TAG=$STAMP' 'SWFIPN_ASSET_VERSION=$ASSET_VERSION' 'SWFIPN_GIT_SHA=$GIT_SHA' 'SWFIPN_GIT_DIRTY=$GIT_DIRTY' > '$REMOTE_RELEASE/.release.env'"

ssh $SSH_OPTS "$HOST" "set -eu; install -m 0755 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/run_freshness_audit.sh' /usr/local/sbin/swfipn-freshness-audit; install -m 0644 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/systemd/swfipn-freshness-audit.service' /etc/systemd/system/swfipn-freshness-audit.service; install -m 0644 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/systemd/swfipn-freshness-audit.timer' /etc/systemd/system/swfipn-freshness-audit.timer; mkdir -p /var/lib/swfipn/freshness; chmod 0750 /var/lib/swfipn/freshness; systemctl daemon-reload; systemctl enable --now swfipn-freshness-audit.timer"

ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFI2_BACKEND_CONTEXT=./SWFI2.0-final SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml build"

ssh $SSH_OPTS "$HOST" "docker volume create swfipn_acceptance_caddy_data >/dev/null && docker volume create swfipn_acceptance_caddy_config >/dev/null && cid=\$(docker ps --filter 'name=caddy-1' --format '{{.Names}}' | head -n 1); if [ -n \"\$cid\" ]; then docker run --rm --volumes-from \"\$cid\" -v swfipn_acceptance_caddy_data:/to-data -v swfipn_acceptance_caddy_config:/to-config alpine sh -c 'cp -a /data/. /to-data/ 2>/dev/null || true; cp -a /config/. /to-config/ 2>/dev/null || true'; fi"

if ! ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFI2_BACKEND_CONTEXT=./SWFI2.0-final SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --wait --wait-timeout 240 && /usr/local/sbin/swfipn-freshness-audit"; then
  echo "activation failed; restoring previous release" >&2
  ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml down --remove-orphans || true"
  if [[ -n "$PREVIOUS_RELEASE" ]]; then
    ssh $SSH_OPTS "$HOST" "set -eu; test -d '$PREVIOUS_RELEASE'; test ! -L '$PREVIOUS_RELEASE'; cd '$PREVIOUS_RELEASE'; if [ -s .release.env ]; then set -- --env-file .release.env; else set --; fi; SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose \"\$@\" -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --wait --wait-timeout 240"
  fi
  exit 1
fi

ssh $SSH_OPTS "$HOST" "set -eu; test -d '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'; ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current'; test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$REMOTE_RELEASE'; cd '$REMOTE_RELEASE'; SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml ps"

FRONTEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")"
BACKEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")"
ROLLBACK_IMAGES_PRESENT=0
if [[ -n "$PREVIOUS_RELEASE" && -n "$PREVIOUS_FRONTEND_IMAGE_ID" && -n "$PREVIOUS_BACKEND_IMAGE_ID" ]] \
  && ssh $SSH_OPTS "$HOST" "docker image inspect '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID' >/dev/null"; then
  ROLLBACK_IMAGES_PRESENT=1
fi
FRESHNESS_AUDIT_DIR="/var/lib/swfipn/freshness"
FRESHNESS_AUDIT_LATEST="$FRESHNESS_AUDIT_DIR/latest.json"
FRESHNESS_AUDIT_RECEIPT="$(ssh $SSH_OPTS "$HOST" "set -eu; receipt=\$(readlink -f '$FRESHNESS_AUDIT_LATEST'); case \"\$receipt\" in '$FRESHNESS_AUDIT_DIR'/swfipn-freshness-audit-*.json) ;; *) exit 1 ;; esac; printf '%s' \"\$receipt\"")"
FRESHNESS_AUDIT_SHA256="$(ssh $SSH_OPTS "$HOST" "test -s '$FRESHNESS_AUDIT_RECEIPT'; sha256sum '$FRESHNESS_AUDIT_RECEIPT' | awk '{print \$1}'")"
FRESHNESS_TIMER_ACTIVE="$(ssh $SSH_OPTS "$HOST" "systemctl is-active swfipn-freshness-audit.timer")"

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
SWFIPN_DEPLOY_BACKEND_GIT_SHA="$BACKEND_GIT_SHA" \
SWFIPN_DEPLOY_BACKEND_GIT_DIRTY="$BACKEND_GIT_DIRTY" \
SWFIPN_DEPLOY_PREVIOUS_RELEASE="$PREVIOUS_RELEASE" \
SWFIPN_DEPLOY_IMAGE_TAG="$STAMP" \
SWFIPN_DEPLOY_FRONTEND_IMAGE_ID="$FRONTEND_IMAGE_ID" \
SWFIPN_DEPLOY_BACKEND_IMAGE_ID="$BACKEND_IMAGE_ID" \
SWFIPN_DEPLOY_PREVIOUS_FRONTEND_IMAGE_ID="$PREVIOUS_FRONTEND_IMAGE_ID" \
SWFIPN_DEPLOY_PREVIOUS_BACKEND_IMAGE_ID="$PREVIOUS_BACKEND_IMAGE_ID" \
SWFIPN_DEPLOY_ROLLBACK_IMAGES_PRESENT="$ROLLBACK_IMAGES_PRESENT" \
SWFIPN_DEPLOY_FRESHNESS_AUDIT_RECEIPT="$FRESHNESS_AUDIT_RECEIPT" \
SWFIPN_DEPLOY_FRESHNESS_AUDIT_SHA256="$FRESHNESS_AUDIT_SHA256" \
SWFIPN_DEPLOY_FRESHNESS_TIMER_ACTIVE="$FRESHNESS_TIMER_ACTIVE" \
python3 - <<'PY'
import json
import os
from pathlib import Path

receipt = {
    "schema_version": "swfipn.strict_acceptance_deploy.v5",
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
    "frontend_git_sha": os.environ["SWFIPN_DEPLOY_GIT_SHA"],
    "frontend_git_dirty": os.environ["SWFIPN_DEPLOY_GIT_DIRTY"] == "1",
    "backend_git_sha": os.environ["SWFIPN_DEPLOY_BACKEND_GIT_SHA"],
    "backend_git_dirty": os.environ["SWFIPN_DEPLOY_BACKEND_GIT_DIRTY"] == "1",
    "release_is_real_directory": True,
    "previous_release": os.environ["SWFIPN_DEPLOY_PREVIOUS_RELEASE"] or None,
    "image_tag": os.environ["SWFIPN_DEPLOY_IMAGE_TAG"],
    "frontend_image_id": os.environ["SWFIPN_DEPLOY_FRONTEND_IMAGE_ID"],
    "backend_image_id": os.environ["SWFIPN_DEPLOY_BACKEND_IMAGE_ID"],
    "previous_frontend_image_id": os.environ["SWFIPN_DEPLOY_PREVIOUS_FRONTEND_IMAGE_ID"] or None,
    "previous_backend_image_id": os.environ["SWFIPN_DEPLOY_PREVIOUS_BACKEND_IMAGE_ID"] or None,
    "rollback_images_present": os.environ["SWFIPN_DEPLOY_ROLLBACK_IMAGES_PRESENT"] == "1",
    "freshness_audit_receipt": os.environ["SWFIPN_DEPLOY_FRESHNESS_AUDIT_RECEIPT"],
    "freshness_audit_sha256": os.environ["SWFIPN_DEPLOY_FRESHNESS_AUDIT_SHA256"],
    "freshness_timer_active": os.environ["SWFIPN_DEPLOY_FRESHNESS_TIMER_ACTIVE"] == "active",
}
Path(os.environ["SWFIPN_DEPLOY_RECEIPT"]).write_text(json.dumps(receipt, indent=2) + "\n")
PY

echo "$REMOTE_RELEASE"
