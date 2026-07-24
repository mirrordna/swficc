#!/usr/bin/env bash
set -euo pipefail

REMOTE_RELEASE="${1:?candidate release required}"
PREVIOUS_RELEASE="${2:?previous release required}"
REMOTE_ROOT="${3:?remote root required}"
COMPOSE_PROJECT="${4:?compose project required}"
DOMAIN="${5:?domain required}"
SITE_ADDRESSES="${6:?site addresses required}"
API_DOMAIN="${7:?api domain required}"
PREVIOUS_FRONTEND_IMAGE_ID="${8:?previous frontend image id required}"
PREVIOUS_BACKEND_IMAGE_ID="${9:?previous backend image id required}"
PENDING_FILE="$REMOTE_RELEASE/.activation-pending"
LOCK_FILE="$REMOTE_ROOT/.rollback.lock"

[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]]
[[ "$REMOTE_RELEASE" == "$REMOTE_ROOT/releases/"* ]]
[[ "$PREVIOUS_RELEASE" == "$REMOTE_ROOT/releases/"* ]]
[[ "$PREVIOUS_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$PREVIOUS_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]

exec 9>"$LOCK_FILE"
flock -x 9
[[ -f "$PENDING_FILE" ]] || exit 0

cd "$REMOTE_RELEASE"
docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml down --remove-orphans || true

cd "$PREVIOUS_RELEASE"
PREVIOUS_IMAGE_TAG="$(sed -n 's/^SWFIPN_IMAGE_TAG=//p' .release.env | tail -1)"
[[ "$PREVIOUS_IMAGE_TAG" =~ ^[A-Za-z0-9._-]+$ ]]
docker image tag "$PREVIOUS_FRONTEND_IMAGE_ID" "swfipn/web:$PREVIOUS_IMAGE_TAG"
docker image tag "$PREVIOUS_BACKEND_IMAGE_ID" "swfipn/swfi2-backend:$PREVIOUS_IMAGE_TAG"
SWFIPN_DOMAIN="$DOMAIN" \
SWFIPN_SITE_ADDRESSES="$SITE_ADDRESSES" \
SWFIPN_API_DOMAIN="$API_DOMAIN" \
  docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml up -d --wait --wait-timeout 240 --pull never --no-build

ln -sfn "$PREVIOUS_RELEASE" "$REMOTE_ROOT/current"
[[ "$(readlink -f "$REMOTE_ROOT/current")" == "$PREVIOUS_RELEASE" ]]
[[ "$(docker inspect --format '{{.Image}}' "$COMPOSE_PROJECT-swfipn-web-1")" == "$PREVIOUS_FRONTEND_IMAGE_ID" ]]
[[ "$(docker inspect --format '{{.Image}}' "$COMPOSE_PROJECT-swfi2-backend-1")" == "$PREVIOUS_BACKEND_IMAGE_ID" ]]
rm -f "$PENDING_FILE"
