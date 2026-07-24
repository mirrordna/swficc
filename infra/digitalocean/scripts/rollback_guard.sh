#!/usr/bin/env bash
set -euo pipefail

REMOTE_RELEASE="${1:?candidate release required}"
PREVIOUS_RELEASE="${2:?previous release required}"
REMOTE_ROOT="${3:?remote root required}"
COMPOSE_PROJECT="${4:?compose project required}"
DOMAIN="${5:?domain required}"
SITE_ADDRESSES="${6:?site addresses required}"
API_DOMAIN="${7:?api domain required}"
PENDING_FILE="$REMOTE_RELEASE/.activation-pending"

[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]]
[[ "$REMOTE_RELEASE" == "$REMOTE_ROOT/releases/"* ]]
[[ "$PREVIOUS_RELEASE" == "$REMOTE_ROOT/releases/"* ]]
[[ -f "$PENDING_FILE" ]] || exit 0

cd "$REMOTE_RELEASE"
docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml down --remove-orphans || true

cd "$PREVIOUS_RELEASE"
SWFIPN_DOMAIN="$DOMAIN" \
SWFIPN_SITE_ADDRESSES="$SITE_ADDRESSES" \
SWFIPN_API_DOMAIN="$API_DOMAIN" \
  docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml up -d --wait --wait-timeout 240

ln -sfn "$PREVIOUS_RELEASE" "$REMOTE_ROOT/current"
[[ "$(readlink -f "$REMOTE_ROOT/current")" == "$PREVIOUS_RELEASE" ]]
rm -f "$PENDING_FILE"
