#!/usr/bin/env bash
# shellcheck disable=SC2029,SC2329
set -euo pipefail

# This deploy path intentionally has no local dashboard/backend source
# dependency. GitHub supplies the exact frontend commit and the verified
# current DigitalOcean release supplies the immutable backend snapshot.

MODE="${1:-deploy}"
HOST="${SWFIPN_HOST:-}"
DOMAIN="${SWFIPN_DOMAIN:-}"
SITE_ADDRESSES="${SWFIPN_SITE_ADDRESSES:-$DOMAIN, dashboard.swfi.com}"
API_DOMAIN="${SWFIPN_API_DOMAIN:-api.swfi.com}"
REMOTE_ROOT="${SWFIPN_REMOTE_ROOT:-/opt/swfipn-acceptance}"
COMPOSE_PROJECT="${SWFIPN_COMPOSE_PROJECT:-swfipn_acceptance}"
FRONTEND_GIT_URL="${SWFIPN_FRONTEND_GIT_URL:-https://github.com/mirrordna/swficc.git}"
FRONTEND_GIT_SHA="${SWFIPN_FRONTEND_GIT_SHA:-}"
BASELINE_MANIFEST="${SWFIPN_BASELINE_MANIFEST:-infra/digitalocean/acceptance-baseline.json}"
if [[ "$MODE" == "preflight" ]]; then
  DEFAULT_RECEIPT_PATH="output/swfipn-git-deploy-preflight-latest.json"
else
  DEFAULT_RECEIPT_PATH="output/swfipn-strict-acceptance-deploy-latest.json"
fi
RECEIPT_PATH="${SWFIPN_DEPLOY_RECEIPT:-$DEFAULT_RECEIPT_PATH}"
SSH_OPTS_RAW="${SWFIPN_SSH_OPTS:--o BatchMode=yes -o StrictHostKeyChecking=yes}"
read -r -a SSH_OPTS <<<"$SSH_OPTS_RAW"

STAGE="initialization"
STATUS="fail"
FAILURE=""
EXIT_CODE=1
STAMP=""
ASSET_VERSION=""
REMOTE_RELEASE=""
PREVIOUS_RELEASE=""
FRONTEND_GIT_TREE=""
FRONTEND_TREE_SHA256=""
BACKEND_TREE_SHA256=""
FRONTEND_IMAGE_ID=""
BACKEND_IMAGE_ID=""
PREVIOUS_FRONTEND_IMAGE_ID=""
PREVIOUS_BACKEND_IMAGE_ID=""
ROLLBACK_IMAGES_PRESENT=0
FRESHNESS_AUDIT_RECEIPT=""
FRESHNESS_AUDIT_SHA256=""
FRESHNESS_TIMER_ACTIVE=""
PUBLIC_MARKER_SHA256=""
BASELINE_SHA256=""
BASELINE_RELEASE=""
BASELINE_FRONTEND_GIT_SHA=""
BASELINE_BACKEND_GIT_SHA=""
BASELINE_FRONTEND_IMAGE_ID=""
BASELINE_BACKEND_IMAGE_ID=""

write_receipt() {
  mkdir -p "$(dirname "$RECEIPT_PATH")"
  SWFIPN_RECEIPT_PATH="$RECEIPT_PATH" \
  SWFIPN_RECEIPT_GENERATED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  SWFIPN_RECEIPT_STATUS="$STATUS" \
  SWFIPN_RECEIPT_MODE="$MODE" \
  SWFIPN_RECEIPT_STAGE="$STAGE" \
  SWFIPN_RECEIPT_EXIT_CODE="$EXIT_CODE" \
  SWFIPN_RECEIPT_FAILURE="$FAILURE" \
  SWFIPN_RECEIPT_HOST="$HOST" \
  SWFIPN_RECEIPT_DOMAIN="$DOMAIN" \
  SWFIPN_RECEIPT_SITE_ADDRESSES="$SITE_ADDRESSES" \
  SWFIPN_RECEIPT_API_DOMAIN="$API_DOMAIN" \
  SWFIPN_RECEIPT_REMOTE_ROOT="$REMOTE_ROOT" \
  SWFIPN_RECEIPT_RELEASE="$REMOTE_RELEASE" \
  SWFIPN_RECEIPT_PREVIOUS_RELEASE="$PREVIOUS_RELEASE" \
  SWFIPN_RECEIPT_ASSET_VERSION="$ASSET_VERSION" \
  SWFIPN_RECEIPT_FRONTEND_GIT_URL="$FRONTEND_GIT_URL" \
  SWFIPN_RECEIPT_FRONTEND_GIT_SHA="$FRONTEND_GIT_SHA" \
  SWFIPN_RECEIPT_FRONTEND_GIT_TREE="$FRONTEND_GIT_TREE" \
  SWFIPN_RECEIPT_FRONTEND_TREE_SHA256="$FRONTEND_TREE_SHA256" \
  SWFIPN_RECEIPT_BACKEND_GIT_SHA="$BASELINE_BACKEND_GIT_SHA" \
  SWFIPN_RECEIPT_BACKEND_TREE_SHA256="$BACKEND_TREE_SHA256" \
  SWFIPN_RECEIPT_BASELINE_MANIFEST="$BASELINE_MANIFEST" \
  SWFIPN_RECEIPT_BASELINE_SHA256="$BASELINE_SHA256" \
  SWFIPN_RECEIPT_BASELINE_RELEASE="$BASELINE_RELEASE" \
  SWFIPN_RECEIPT_FRONTEND_IMAGE_ID="$FRONTEND_IMAGE_ID" \
  SWFIPN_RECEIPT_BACKEND_IMAGE_ID="$BACKEND_IMAGE_ID" \
  SWFIPN_RECEIPT_PREVIOUS_FRONTEND_IMAGE_ID="$PREVIOUS_FRONTEND_IMAGE_ID" \
  SWFIPN_RECEIPT_PREVIOUS_BACKEND_IMAGE_ID="$PREVIOUS_BACKEND_IMAGE_ID" \
  SWFIPN_RECEIPT_ROLLBACK_IMAGES_PRESENT="$ROLLBACK_IMAGES_PRESENT" \
  SWFIPN_RECEIPT_FRESHNESS_AUDIT_RECEIPT="$FRESHNESS_AUDIT_RECEIPT" \
  SWFIPN_RECEIPT_FRESHNESS_AUDIT_SHA256="$FRESHNESS_AUDIT_SHA256" \
  SWFIPN_RECEIPT_FRESHNESS_TIMER_ACTIVE="$FRESHNESS_TIMER_ACTIVE" \
  SWFIPN_RECEIPT_PUBLIC_MARKER_SHA256="$PUBLIC_MARKER_SHA256" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

def optional(name):
    return os.environ.get(name) or None

receipt = {
    "schema_version": "swfipn.strict_acceptance_deploy.v6",
    "generated_at": os.environ["SWFIPN_RECEIPT_GENERATED_AT"],
    "status": os.environ["SWFIPN_RECEIPT_STATUS"],
    "mode": os.environ["SWFIPN_RECEIPT_MODE"],
    "stage": os.environ["SWFIPN_RECEIPT_STAGE"],
    "exit_code": int(os.environ["SWFIPN_RECEIPT_EXIT_CODE"]),
    "failure": optional("SWFIPN_RECEIPT_FAILURE"),
    "source_mode": "github_exact_commit_plus_current_release_backend",
    "host": optional("SWFIPN_RECEIPT_HOST"),
    "domain": optional("SWFIPN_RECEIPT_DOMAIN"),
    "site_addresses": optional("SWFIPN_RECEIPT_SITE_ADDRESSES"),
    "api_domain": optional("SWFIPN_RECEIPT_API_DOMAIN"),
    "remote_root": os.environ["SWFIPN_RECEIPT_REMOTE_ROOT"],
    "release": optional("SWFIPN_RECEIPT_RELEASE"),
    "previous_release": optional("SWFIPN_RECEIPT_PREVIOUS_RELEASE"),
    "asset_version": optional("SWFIPN_RECEIPT_ASSET_VERSION"),
    "git_sha": optional("SWFIPN_RECEIPT_FRONTEND_GIT_SHA"),
    "git_dirty": False,
    "frontend_git_sha": optional("SWFIPN_RECEIPT_FRONTEND_GIT_SHA"),
    "frontend_git_dirty": False,
    "backend_git_sha": optional("SWFIPN_RECEIPT_BACKEND_GIT_SHA"),
    "backend_git_dirty": False,
    "release_is_real_directory": bool(optional("SWFIPN_RECEIPT_RELEASE")),
    "image_tag": optional("SWFIPN_RECEIPT_ASSET_VERSION"),
    "frontend_image_id": optional("SWFIPN_RECEIPT_FRONTEND_IMAGE_ID"),
    "backend_image_id": optional("SWFIPN_RECEIPT_BACKEND_IMAGE_ID"),
    "previous_frontend_image_id": optional("SWFIPN_RECEIPT_PREVIOUS_FRONTEND_IMAGE_ID"),
    "previous_backend_image_id": optional("SWFIPN_RECEIPT_PREVIOUS_BACKEND_IMAGE_ID"),
    "rollback_images_present": os.environ["SWFIPN_RECEIPT_ROLLBACK_IMAGES_PRESENT"] == "1",
    "freshness_audit_receipt": optional("SWFIPN_RECEIPT_FRESHNESS_AUDIT_RECEIPT"),
    "freshness_audit_sha256": optional("SWFIPN_RECEIPT_FRESHNESS_AUDIT_SHA256"),
    "freshness_timer_active": os.environ["SWFIPN_RECEIPT_FRESHNESS_TIMER_ACTIVE"] == "active",
    "frontend": {
        "git_url": os.environ["SWFIPN_RECEIPT_FRONTEND_GIT_URL"],
        "git_sha": optional("SWFIPN_RECEIPT_FRONTEND_GIT_SHA"),
        "git_tree": optional("SWFIPN_RECEIPT_FRONTEND_GIT_TREE"),
        "tree_sha256": optional("SWFIPN_RECEIPT_FRONTEND_TREE_SHA256"),
        "git_dirty": False,
    },
    "backend": {
        "source_mode": "copied_from_verified_current_release",
        "git_sha": optional("SWFIPN_RECEIPT_BACKEND_GIT_SHA"),
        "tree_sha256": optional("SWFIPN_RECEIPT_BACKEND_TREE_SHA256"),
        "git_dirty": False,
    },
    "baseline": {
        "manifest": os.environ["SWFIPN_RECEIPT_BASELINE_MANIFEST"],
        "manifest_sha256": optional("SWFIPN_RECEIPT_BASELINE_SHA256"),
        "release": optional("SWFIPN_RECEIPT_BASELINE_RELEASE"),
    },
    "images": {
        "frontend": optional("SWFIPN_RECEIPT_FRONTEND_IMAGE_ID"),
        "backend": optional("SWFIPN_RECEIPT_BACKEND_IMAGE_ID"),
        "previous_frontend": optional("SWFIPN_RECEIPT_PREVIOUS_FRONTEND_IMAGE_ID"),
        "previous_backend": optional("SWFIPN_RECEIPT_PREVIOUS_BACKEND_IMAGE_ID"),
        "rollback_images_present": os.environ["SWFIPN_RECEIPT_ROLLBACK_IMAGES_PRESENT"] == "1",
    },
    "freshness": {
        "receipt": optional("SWFIPN_RECEIPT_FRESHNESS_AUDIT_RECEIPT"),
        "receipt_sha256": optional("SWFIPN_RECEIPT_FRESHNESS_AUDIT_SHA256"),
        "timer_active": os.environ["SWFIPN_RECEIPT_FRESHNESS_TIMER_ACTIVE"] == "active",
    },
    "public_release_marker_sha256": optional("SWFIPN_RECEIPT_PUBLIC_MARKER_SHA256"),
    "production_mutation_attempted": (
        os.environ["SWFIPN_RECEIPT_MODE"] == "deploy"
        and os.environ["SWFIPN_RECEIPT_STAGE"] not in {
            "initialization",
            "baseline_validation",
            "github_verification",
            "remote_preflight",
        }
    ),
    "active_release_changed": (
        os.environ["SWFIPN_RECEIPT_MODE"] == "deploy"
        and os.environ["SWFIPN_RECEIPT_STAGE"] == "complete"
        and os.environ["SWFIPN_RECEIPT_STATUS"] == "pass"
    ),
}
Path(os.environ["SWFIPN_RECEIPT_PATH"]).write_text(json.dumps(receipt, indent=2) + "\n")
PY
}

on_exit() {
  local code=$?
  trap - EXIT
  EXIT_CODE=$code
  if [[ "$code" == "0" ]]; then
    STATUS="pass"
  elif [[ -z "$FAILURE" ]]; then
    FAILURE="command_failed_during_$STAGE"
  fi
  write_receipt
  exit "$code"
}
trap on_exit EXIT

die() {
  FAILURE="$1"
  echo "$FAILURE" >&2
  exit 2
}

json_value() {
  python3 - "$BASELINE_MANIFEST" "$1" <<'PY'
import json
import sys

value = json.load(open(sys.argv[1]))
for key in sys.argv[2].split("."):
    value = value[key]
print(value)
PY
}

[[ "$MODE" == "preflight" || "$MODE" == "deploy" ]] || die "usage: $0 [preflight|deploy]"
[[ -n "$HOST" && "$HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ ]] || die "SWFIPN_HOST must be user@host"
[[ -n "$DOMAIN" && "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "SWFIPN_DOMAIN must be a hostname"
[[ "$SITE_ADDRESSES" =~ ^[A-Za-z0-9.,[:space:]-]+$ ]] || die "invalid SWFIPN_SITE_ADDRESSES"
[[ "$API_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid SWFIPN_API_DOMAIN"
[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]] || die "refusing noncanonical remote root: $REMOTE_ROOT"
[[ "$COMPOSE_PROJECT" == "swfipn_acceptance" ]] || die "refusing noncanonical compose project: $COMPOSE_PROJECT"
[[ "$FRONTEND_GIT_URL" == "https://github.com/mirrordna/swficc.git" ]] || die "refusing unapproved frontend repository: $FRONTEND_GIT_URL"
[[ "$FRONTEND_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die "SWFIPN_FRONTEND_GIT_SHA must be a full lowercase commit sha"
[[ -s "$BASELINE_MANIFEST" ]] || die "missing baseline manifest: $BASELINE_MANIFEST"

STAGE="baseline_validation"
BASELINE_SHA256="$(shasum -a 256 "$BASELINE_MANIFEST" | awk '{print $1}')"
[[ "$(json_value schema_version)" == "swfipn.acceptance_baseline.v1" ]] || die "unsupported baseline manifest schema"
[[ "$(json_value remote_root)" == "$REMOTE_ROOT" ]] || die "baseline remote root mismatch"
BASELINE_RELEASE="$(json_value release)"
BASELINE_FRONTEND_GIT_SHA="$(json_value frontend_git_sha)"
BASELINE_BACKEND_GIT_SHA="$(json_value backend_git_sha)"
BASELINE_FRONTEND_IMAGE_ID="$(json_value frontend_image_id)"
BASELINE_BACKEND_IMAGE_ID="$(json_value backend_image_id)"
[[ "$BASELINE_RELEASE" == "$REMOTE_ROOT/releases/"* ]] || die "baseline release outside canonical release root"
[[ "$BASELINE_FRONTEND_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die "invalid baseline frontend sha"
[[ "$BASELINE_BACKEND_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die "invalid baseline backend sha"

STAGE="github_verification"
VERIFY_DIR="$(mktemp -d)"
trap 'rm -rf "$VERIFY_DIR"' RETURN
git -C "$VERIFY_DIR" init -q
git -C "$VERIFY_DIR" remote add origin "$FRONTEND_GIT_URL"
git -C "$VERIFY_DIR" fetch -q --depth=1 origin "$FRONTEND_GIT_SHA"
[[ "$(git -C "$VERIFY_DIR" rev-parse FETCH_HEAD)" == "$FRONTEND_GIT_SHA" ]] || die "GitHub returned a different frontend commit"
FRONTEND_GIT_TREE="$(git -C "$VERIFY_DIR" show -s --format=%T FETCH_HEAD)"
rm -rf "$VERIFY_DIR"
trap - RETURN

STAGE="remote_preflight"
PREVIOUS_RELEASE="$(ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; test -L '$REMOTE_ROOT/current'; readlink -f '$REMOTE_ROOT/current'")"
[[ "$PREVIOUS_RELEASE" == "$BASELINE_RELEASE" ]] || die "current release differs from pinned baseline: $PREVIOUS_RELEASE"
ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  test -d '$PREVIOUS_RELEASE'; test ! -L '$PREVIOUS_RELEASE'; \
  test -d '$PREVIOUS_RELEASE/SWFI2.0-final'; test ! -L '$PREVIOUS_RELEASE/SWFI2.0-final'; \
  test -s '$REMOTE_ROOT/shared/.env.swfi2-backend'; \
  test -s '$REMOTE_ROOT/shared/.env.swfipn-web'; \
  test -x /usr/local/sbin/swfipn-freshness-audit; \
  test \"\$(systemctl is-active swfipn-freshness-audit.timer)\" = active; \
  command -v git >/dev/null; command -v python3 >/dev/null; command -v docker >/dev/null; \
  docker compose version >/dev/null; \
  docker image inspect '$BASELINE_FRONTEND_IMAGE_ID' '$BASELINE_BACKEND_IMAGE_ID' >/dev/null"

PREVIOUS_FRONTEND_IMAGE_ID="$(ssh "${SSH_OPTS[@]}" "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")"
PREVIOUS_BACKEND_IMAGE_ID="$(ssh "${SSH_OPTS[@]}" "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")"
[[ "$PREVIOUS_FRONTEND_IMAGE_ID" == "$BASELINE_FRONTEND_IMAGE_ID" ]] || die "active frontend image differs from pinned baseline"
[[ "$PREVIOUS_BACKEND_IMAGE_ID" == "$BASELINE_BACKEND_IMAGE_ID" ]] || die "active backend image differs from pinned baseline"

if [[ "$MODE" == "preflight" ]]; then
  STAGE="complete"
  STATUS="pass"
  exit 0
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
ASSET_VERSION="${SWFIPN_ASSET_VERSION:-$STAMP}"
[[ "$ASSET_VERSION" =~ ^[A-Za-z0-9._-]+$ ]] || die "invalid SWFIPN_ASSET_VERSION"
REMOTE_RELEASE="$REMOTE_ROOT/releases/$STAMP"

STAGE="release_materialization"
ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  test ! -e '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'; \
  mkdir '$REMOTE_RELEASE'; test -d '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'; \
  git -C '$REMOTE_RELEASE' init -q frontend-git; \
  git -C '$REMOTE_RELEASE/frontend-git' remote add origin '$FRONTEND_GIT_URL'; \
  git -C '$REMOTE_RELEASE/frontend-git' fetch -q --depth=1 origin '$FRONTEND_GIT_SHA'; \
  test \"\$(git -C '$REMOTE_RELEASE/frontend-git' rev-parse FETCH_HEAD)\" = '$FRONTEND_GIT_SHA'; \
  test \"\$(git -C '$REMOTE_RELEASE/frontend-git' show -s --format=%T FETCH_HEAD)\" = '$FRONTEND_GIT_TREE'; \
  mkdir '$REMOTE_RELEASE/swfi-dashboard' '$REMOTE_RELEASE/SWFI2.0-final'; \
  git -C '$REMOTE_RELEASE/frontend-git' archive '$FRONTEND_GIT_SHA' | tar -x -C '$REMOTE_RELEASE/swfi-dashboard'; \
  cp -a '$PREVIOUS_RELEASE/SWFI2.0-final/.' '$REMOTE_RELEASE/SWFI2.0-final/'; \
  rm -rf '$REMOTE_RELEASE/frontend-git'; \
  cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/Caddyfile' '$REMOTE_RELEASE/Caddyfile'; \
  cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/compose.acceptance.yml' '$REMOTE_RELEASE/compose.acceptance.yml'; \
  ln -s '$REMOTE_ROOT/shared/.env.swfi2-backend' '$REMOTE_RELEASE/.env.swfi2-backend'; \
  ln -s '$REMOTE_ROOT/shared/.env.swfipn-web' '$REMOTE_RELEASE/.env.swfipn-web'"

FRONTEND_TREE_JSON="$(ssh "${SSH_OPTS[@]}" "$HOST" "python3 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/tree_digest.py' '$REMOTE_RELEASE/swfi-dashboard'")"
BACKEND_SOURCE_TREE_JSON="$(ssh "${SSH_OPTS[@]}" "$HOST" "python3 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/tree_digest.py' '$PREVIOUS_RELEASE/SWFI2.0-final'")"
BACKEND_COPY_TREE_JSON="$(ssh "${SSH_OPTS[@]}" "$HOST" "python3 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/tree_digest.py' '$REMOTE_RELEASE/SWFI2.0-final'")"
FRONTEND_TREE_SHA256="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<<"$FRONTEND_TREE_JSON")"
BACKEND_SOURCE_TREE_SHA256="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<<"$BACKEND_SOURCE_TREE_JSON")"
BACKEND_TREE_SHA256="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<<"$BACKEND_COPY_TREE_JSON")"
[[ "$BACKEND_SOURCE_TREE_SHA256" == "$BACKEND_TREE_SHA256" ]] || die "backend snapshot copy digest mismatch"

ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  printf '%s\n' \
    'SWFIPN_IMAGE_TAG=$STAMP' \
    'SWFIPN_ASSET_VERSION=$ASSET_VERSION' \
    'SWFIPN_GIT_SHA=$FRONTEND_GIT_SHA' \
    'SWFIPN_GIT_DIRTY=0' \
    'SWFIPN_BACKEND_GIT_SHA=$BASELINE_BACKEND_GIT_SHA' \
    'SWFIPN_SOURCE_MODE=github_exact_commit_plus_current_release_backend' \
    > '$REMOTE_RELEASE/.release.env'; \
  FRONTEND_GIT_URL='$FRONTEND_GIT_URL' \
  FRONTEND_GIT_SHA='$FRONTEND_GIT_SHA' \
  FRONTEND_GIT_TREE='$FRONTEND_GIT_TREE' \
  FRONTEND_TREE_SHA256='$FRONTEND_TREE_SHA256' \
  BACKEND_GIT_SHA='$BASELINE_BACKEND_GIT_SHA' \
  BACKEND_TREE_SHA256='$BACKEND_TREE_SHA256' \
  BASELINE_RELEASE='$BASELINE_RELEASE' \
  python3 -c 'import json,os,pathlib; pathlib.Path(\"$REMOTE_RELEASE/source-manifest.json\").write_text(json.dumps({\"schema_version\":\"swfipn.release_source.v1\",\"frontend\":{\"git_url\":os.environ[\"FRONTEND_GIT_URL\"],\"git_sha\":os.environ[\"FRONTEND_GIT_SHA\"],\"git_tree\":os.environ[\"FRONTEND_GIT_TREE\"],\"tree_sha256\":os.environ[\"FRONTEND_TREE_SHA256\"]},\"backend\":{\"source_mode\":\"copied_from_verified_current_release\",\"git_sha\":os.environ[\"BACKEND_GIT_SHA\"],\"tree_sha256\":os.environ[\"BACKEND_TREE_SHA256\"],\"source_release\":os.environ[\"BASELINE_RELEASE\"]}},indent=2)+\"\\n\")'"

STAGE="image_build"
ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_RELEASE' && \
  SWFI2_BACKEND_CONTEXT=./SWFI2.0-final \
  SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard \
  SWFIPN_DOMAIN='$DOMAIN' \
  SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
  SWFIPN_API_DOMAIN='$API_DOMAIN' \
  docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml build"

restore_previous_release() {
  ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_RELEASE' && docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml down --remove-orphans || true"
  ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; cd '$PREVIOUS_RELEASE'; \
    SWFIPN_DOMAIN='$DOMAIN' \
    SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
    SWFIPN_API_DOMAIN='$API_DOMAIN' \
    docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --wait --wait-timeout 240; \
    ln -sfn '$PREVIOUS_RELEASE' '$REMOTE_ROOT/current'; \
    test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$PREVIOUS_RELEASE'"
}

STAGE="activation"
if ! ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; cd '$REMOTE_RELEASE'; \
  SWFI2_BACKEND_CONTEXT=./SWFI2.0-final \
  SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard \
  SWFIPN_DOMAIN='$DOMAIN' \
  SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
  SWFIPN_API_DOMAIN='$API_DOMAIN' \
  docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --wait --wait-timeout 240; \
  /usr/local/sbin/swfipn-freshness-audit"; then
  FAILURE="activation failed; restoring previous release"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi

STAGE="public_release_verification"
PUBLIC_MARKER_FILE="$(mktemp)"
PUBLIC_MARKER_OK=0
for _ in $(seq 1 24); do
  if curl --fail --silent --show-error --location \
    "https://dashboard.swfi.com/swficc/swficc-release.json?qa=$STAMP" \
    -o "$PUBLIC_MARKER_FILE" \
    && python3 - "$PUBLIC_MARKER_FILE" "$FRONTEND_GIT_SHA" "$ASSET_VERSION" <<'PY'
import json
import sys

marker = json.load(open(sys.argv[1]))
if marker.get("schema_version") != "swfipn.release_marker.v1":
    raise SystemExit(1)
if marker.get("git_sha") != sys.argv[2]:
    raise SystemExit(1)
if marker.get("asset_version") != sys.argv[3]:
    raise SystemExit(1)
PY
  then
    PUBLIC_MARKER_OK=1
    break
  fi
  sleep 5
done
if [[ "$PUBLIC_MARKER_OK" != "1" ]]; then
  FAILURE="public release marker did not attest the candidate; restoring previous release"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi
PUBLIC_MARKER_SHA256="$(shasum -a 256 "$PUBLIC_MARKER_FILE" | awk '{print $1}')"
rm -f "$PUBLIC_MARKER_FILE"

STAGE="activation_evidence"
collect_activation_evidence() {
  FRONTEND_IMAGE_ID="$(ssh "${SSH_OPTS[@]}" "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1'")" || return 1
  BACKEND_IMAGE_ID="$(ssh "${SSH_OPTS[@]}" "$HOST" "docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1'")" || return 1
  if ssh "${SSH_OPTS[@]}" "$HOST" "docker image inspect '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID' >/dev/null"; then
    ROLLBACK_IMAGES_PRESENT=1
  else
    return 1
  fi
  FRESHNESS_AUDIT_DIR="/var/lib/swfipn/freshness"
  FRESHNESS_AUDIT_LATEST="$FRESHNESS_AUDIT_DIR/latest.json"
  FRESHNESS_AUDIT_RECEIPT="$(ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; receipt=\$(readlink -f '$FRESHNESS_AUDIT_LATEST'); case \"\$receipt\" in '$FRESHNESS_AUDIT_DIR'/swfipn-freshness-audit-*.json) ;; *) exit 1 ;; esac; printf '%s' \"\$receipt\"")" || return 1
  FRESHNESS_AUDIT_SHA256="$(ssh "${SSH_OPTS[@]}" "$HOST" "test -s '$FRESHNESS_AUDIT_RECEIPT'; sha256sum '$FRESHNESS_AUDIT_RECEIPT' | awk '{print \$1}'")" || return 1
  FRESHNESS_TIMER_ACTIVE="$(ssh "${SSH_OPTS[@]}" "$HOST" "systemctl is-active swfipn-freshness-audit.timer")" || return 1
  [[ "$FRESHNESS_TIMER_ACTIVE" == "active" ]] || return 1
}
if ! collect_activation_evidence; then
  FAILURE="activation evidence incomplete; restoring previous release"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi

STAGE="current_switch"
if ! ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  test -d '$REMOTE_RELEASE'; test ! -L '$REMOTE_RELEASE'; \
  ln -sfn '$REMOTE_RELEASE' '$REMOTE_ROOT/current'; \
  test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$REMOTE_RELEASE'; \
  cd '$REMOTE_RELEASE'; \
  SWFIPN_DOMAIN='$DOMAIN' \
  SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
  SWFIPN_API_DOMAIN='$API_DOMAIN' \
  docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml ps"; then
  FAILURE="current release switch failed; restoring previous release"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi

STAGE="complete"
STATUS="pass"
exit 0
