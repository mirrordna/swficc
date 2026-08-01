#!/usr/bin/env bash
set -euo pipefail

HOST="${SWFIPN_HOST:-}"
DOMAIN="${SWFIPN_DOMAIN:-}"
SITE_ADDRESSES="${SWFIPN_SITE_ADDRESSES:-$DOMAIN, dashboard.swfi.com}"
API_DOMAIN="${SWFIPN_API_DOMAIN:-api.swfi.com}"
REMOTE_ROOT="${SWFIPN_REMOTE_ROOT:-/opt/swfipn-acceptance}"
FRONTEND_REPO="${SWFIPN_FRONTEND_REPO:-$(pwd)}"
SSH_OPTS="${SWFIPN_SSH_OPTS:--o StrictHostKeyChecking=accept-new}"
COMPOSE_PROJECT="${SWFIPN_COMPOSE_PROJECT:-swfipn_acceptance}"
PREFLIGHT_IMAGE="${SWFIPN_PREFLIGHT_IMAGE:-swfipn/browser-qa:20260801-e3d64cd}"

if [[ -z "$HOST" || -z "$DOMAIN" ]]; then
  echo "usage: SWFIPN_HOST=user@ip SWFIPN_DOMAIN=host.example.com $0" >&2
  exit 2
fi
if [[ -n "$(git -C "$FRONTEND_REPO" status --porcelain --untracked-files=normal)" ]]; then
  echo "refusing frontend-only deploy from dirty source" >&2
  exit 2
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)-frontend"
ASSET_VERSION="${SWFIPN_ASSET_VERSION:-$STAMP}"
GIT_SHA="$(git -C "$FRONTEND_REPO" rev-parse HEAD)"
REMOTE_RELEASE="$REMOTE_ROOT/releases/$STAMP"
PREVIOUS_RELEASE="$(ssh $SSH_OPTS "$HOST" "readlink -f '$REMOTE_ROOT/current'")"
PREVIOUS_WEB_IMAGE_REF="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Config.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")"
PREVIOUS_WEB_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")"
BACKEND_IMAGE_REF="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Config.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")"
BACKEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")"
BACKEND_TAG="${BACKEND_IMAGE_REF##*:}"

case "$PREVIOUS_RELEASE" in
  "$REMOTE_ROOT"/releases/*) ;;
  *) echo "refusing invalid current release: $PREVIOUS_RELEASE" >&2; exit 2 ;;
esac
[[ "$PREVIOUS_WEB_IMAGE_REF" == swfipn/web:* ]] || { echo "unexpected current web image: $PREVIOUS_WEB_IMAGE_REF" >&2; exit 2; }
[[ "$BACKEND_IMAGE_REF" == swfipn/swfi2-backend:* ]] || { echo "unexpected current backend image: $BACKEND_IMAGE_REF" >&2; exit 2; }

ssh $SSH_OPTS "$HOST" "set -eu; test -d '$PREVIOUS_RELEASE'; test ! -e '$REMOTE_RELEASE'; mkdir '$REMOTE_RELEASE'; cp -a '$PREVIOUS_RELEASE/.' '$REMOTE_RELEASE/'; rm -rf '$REMOTE_RELEASE/swfi-dashboard'; mkdir '$REMOTE_RELEASE/swfi-dashboard'"

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

# Keep deployment verification on DO. The control Mac only transfers the clean,
# immutable source; Node, npm, Python, and test dependencies come from the pinned
# QA image and disposable volumes on the production host.
ssh $SSH_OPTS "$HOST" "set -eu; node_volume='swfipn-preflight-node-$STAMP'; output_volume='swfipn-preflight-output-$STAMP'; trap 'docker volume rm -f \"\$node_volume\" \"\$output_volume\" >/dev/null 2>&1 || true' EXIT; docker image inspect '$PREFLIGHT_IMAGE' >/dev/null; docker run --rm --network host -e PYTHONDONTWRITEBYTECODE=1 -v '$REMOTE_RELEASE/swfi-dashboard:/app:ro' -v \"\$node_volume:/app/node_modules\" -v \"\$output_volume:/app/output\" -w /app '$PREFLIGHT_IMAGE' sh -lc 'npm ci --ignore-scripts && npm run security:runtime-audit && npm run test:search-gateway'"

ssh $SSH_OPTS "$HOST" "set -eu; cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/Caddyfile' '$REMOTE_RELEASE/Caddyfile'; cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/compose.acceptance.yml' '$REMOTE_RELEASE/compose.acceptance.yml'; ln -sfn '$REMOTE_ROOT/shared/.env.swfi2-backend' '$REMOTE_RELEASE/.env.swfi2-backend'; ln -sfn '$REMOTE_ROOT/shared/.env.swfipn-web' '$REMOTE_RELEASE/.env.swfipn-web'; printf '%s\n' 'SWFIPN_IMAGE_TAG=$STAMP' 'SWFI2_BACKEND_IMAGE_TAG=$BACKEND_TAG' 'SWFIPN_FRONTEND_IMAGE_TAG=$STAMP' 'SWFIPN_ASSET_VERSION=$ASSET_VERSION' 'SWFIPN_GIT_SHA=$GIT_SHA' 'SWFIPN_GIT_DIRTY=0' > '$REMOTE_RELEASE/.release.env'"

ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml build swfipn-web"

if ! ssh $SSH_OPTS "$HOST" "cd '$REMOTE_RELEASE' && SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --no-deps --wait --wait-timeout 180 swfipn-web && /usr/local/sbin/swfipn-freshness-audit"; then
  echo "frontend activation failed; restoring exact previous web image" >&2
  ssh $SSH_OPTS "$HOST" "set -eu; docker tag '$PREVIOUS_WEB_IMAGE_ID' 'swfipn/web:rollback-$STAMP'; cd '$REMOTE_RELEASE'; SWFIPN_FRONTEND_IMAGE_TAG='rollback-$STAMP' SWFIPN_DOMAIN='$DOMAIN' SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' SWFIPN_API_DOMAIN='$API_DOMAIN' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --no-deps --wait --wait-timeout 180 swfipn-web"
  exit 1
fi

CURRENT_BACKEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")"
if [[ "$CURRENT_BACKEND_IMAGE_ID" != "$BACKEND_IMAGE_ID" ]]; then
  echo "backend image changed during frontend-only deploy; restoring frontend and refusing promotion" >&2
  ssh $SSH_OPTS "$HOST" "set -eu; docker tag '$PREVIOUS_WEB_IMAGE_ID' 'swfipn/web:rollback-$STAMP'; cd '$REMOTE_RELEASE'; SWFIPN_FRONTEND_IMAGE_TAG='rollback-$STAMP' docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --no-deps --wait --wait-timeout 180 swfipn-web"
  exit 1
fi

FRONTEND_IMAGE_ID="$(ssh $SSH_OPTS "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")"
ssh $SSH_OPTS "$HOST" "set -eu; ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current'; test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$REMOTE_RELEASE'"

mkdir -p "$FRONTEND_REPO/output"
SWFIPN_RECEIPT="$FRONTEND_REPO/output/swfipn-frontend-only-deploy-latest.json" \
SWFIPN_RELEASE="$REMOTE_RELEASE" \
SWFIPN_PREVIOUS_RELEASE="$PREVIOUS_RELEASE" \
SWFIPN_GIT_SHA="$GIT_SHA" \
SWFIPN_ASSET_VERSION="$ASSET_VERSION" \
SWFIPN_PREVIOUS_WEB_IMAGE_REF="$PREVIOUS_WEB_IMAGE_REF" \
SWFIPN_PREVIOUS_WEB_IMAGE_ID="$PREVIOUS_WEB_IMAGE_ID" \
SWFIPN_FRONTEND_IMAGE_ID="$FRONTEND_IMAGE_ID" \
SWFIPN_BACKEND_IMAGE_REF="$BACKEND_IMAGE_REF" \
SWFIPN_BACKEND_IMAGE_ID="$BACKEND_IMAGE_ID" \
python3 - <<'PY'
import datetime
import json
import os
from pathlib import Path

receipt = {
    "schema_version": "swfipn.frontend_only_deploy.v1",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
    "status": "pass",
    "scope": "frontend_only",
    "release": os.environ["SWFIPN_RELEASE"],
    "previous_release": os.environ["SWFIPN_PREVIOUS_RELEASE"],
    "frontend_git_sha": os.environ["SWFIPN_GIT_SHA"],
    "asset_version": os.environ["SWFIPN_ASSET_VERSION"],
    "previous_frontend_image_ref": os.environ["SWFIPN_PREVIOUS_WEB_IMAGE_REF"],
    "previous_frontend_image_id": os.environ["SWFIPN_PREVIOUS_WEB_IMAGE_ID"],
    "frontend_image_id": os.environ["SWFIPN_FRONTEND_IMAGE_ID"],
    "backend_image_ref": os.environ["SWFIPN_BACKEND_IMAGE_REF"],
    "backend_image_id": os.environ["SWFIPN_BACKEND_IMAGE_ID"],
    "backend_unchanged": True,
}
Path(os.environ["SWFIPN_RECEIPT"]).write_text(json.dumps(receipt, indent=2) + "\n")
PY

cat "$FRONTEND_REPO/output/swfipn-frontend-only-deploy-latest.json"
