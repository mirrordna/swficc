#!/usr/bin/env bash
# shellcheck disable=SC2029,SC2329
set -euo pipefail

# This deploy path intentionally has no local dashboard/backend source
# dependency. GitHub supplies the exact frontend commit and the pinned active
# DigitalOcean backend image is reused without rebuilding unverified source.

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
MONGO_POLICY_SHA256="${SWFIPN_MONGO_POLICY_SHA256:-}"
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
ACTIVATION_STARTED=0
DEPLOY_COMMITTED=0
ROLLBACK_ATTEMPTED=0
ROLLBACK_SUCCEEDED=0
ROLLBACK_GUARD_UNIT=""
MONGO_SOURCE_VERIFIED=0
MONGO_SOURCE_RECEIPT_SHA256=""
MONGO_POLICY_RECEIPT_SHA256=""
MONGO_SOURCE_IDENTITY_SHA256=""
MONGO_EFFECTIVE_DESTINATIONS_SHA256=""

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
  SWFIPN_RECEIPT_ACTIVATION_STARTED="$ACTIVATION_STARTED" \
  SWFIPN_RECEIPT_DEPLOY_COMMITTED="$DEPLOY_COMMITTED" \
  SWFIPN_RECEIPT_ROLLBACK_ATTEMPTED="$ROLLBACK_ATTEMPTED" \
  SWFIPN_RECEIPT_ROLLBACK_SUCCEEDED="$ROLLBACK_SUCCEEDED" \
  SWFIPN_RECEIPT_ROLLBACK_GUARD_UNIT="$ROLLBACK_GUARD_UNIT" \
  SWFIPN_RECEIPT_MONGO_SOURCE_VERIFIED="$MONGO_SOURCE_VERIFIED" \
  SWFIPN_RECEIPT_MONGO_SOURCE_RECEIPT_SHA256="$MONGO_SOURCE_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_MONGO_POLICY_SHA256="$MONGO_POLICY_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_MONGO_SOURCE_IDENTITY_SHA256="$MONGO_SOURCE_IDENTITY_SHA256" \
  SWFIPN_RECEIPT_MONGO_EFFECTIVE_DESTINATIONS_SHA256="$MONGO_EFFECTIVE_DESTINATIONS_SHA256" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

def optional(name):
    return os.environ.get(name) or None

receipt = {
    "schema_version": "swfipn.strict_acceptance_deploy.v8",
    "generated_at": os.environ["SWFIPN_RECEIPT_GENERATED_AT"],
    "status": os.environ["SWFIPN_RECEIPT_STATUS"],
    "mode": os.environ["SWFIPN_RECEIPT_MODE"],
    "stage": os.environ["SWFIPN_RECEIPT_STAGE"],
    "exit_code": int(os.environ["SWFIPN_RECEIPT_EXIT_CODE"]),
    "failure": optional("SWFIPN_RECEIPT_FAILURE"),
    "source_mode": "github_exact_commit_plus_pinned_backend_image",
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
        "source_mode": "pinned_existing_image",
        "git_sha": optional("SWFIPN_RECEIPT_BACKEND_GIT_SHA"),
        "tree_sha256": optional("SWFIPN_RECEIPT_BACKEND_TREE_SHA256"),
        "pinned_image_id": optional("SWFIPN_RECEIPT_PREVIOUS_BACKEND_IMAGE_ID"),
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
    "activation_started": os.environ["SWFIPN_RECEIPT_ACTIVATION_STARTED"] == "1",
    "deploy_committed": os.environ["SWFIPN_RECEIPT_DEPLOY_COMMITTED"] == "1",
    "rollback_attempted": os.environ["SWFIPN_RECEIPT_ROLLBACK_ATTEMPTED"] == "1",
    "rollback_succeeded": os.environ["SWFIPN_RECEIPT_ROLLBACK_SUCCEEDED"] == "1",
    "rollback_guard_unit": optional("SWFIPN_RECEIPT_ROLLBACK_GUARD_UNIT"),
    "mongo_source": {
        "verified": os.environ["SWFIPN_RECEIPT_MONGO_SOURCE_VERIFIED"] == "1",
        "verification_receipt_sha256": optional("SWFIPN_RECEIPT_MONGO_SOURCE_RECEIPT_SHA256"),
        "policy_sha256": optional("SWFIPN_RECEIPT_MONGO_POLICY_SHA256"),
        "source_identity_sha256": optional("SWFIPN_RECEIPT_MONGO_SOURCE_IDENTITY_SHA256"),
        "effective_destinations_sha256": optional("SWFIPN_RECEIPT_MONGO_EFFECTIVE_DESTINATIONS_SHA256"),
        "secrets_recorded": False,
    },
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
  if [[ "$code" != "0" && "$ACTIVATION_STARTED" == "1" && "$DEPLOY_COMMITTED" != "1" && "$ROLLBACK_ATTEMPTED" != "1" ]]; then
    if restore_previous_release; then
      ROLLBACK_SUCCEEDED=1
    else
      ROLLBACK_SUCCEEDED=0
      FAILURE="${FAILURE:-command_failed_during_$STAGE}; automatic rollback failed"
    fi
  fi
  if [[ "$code" == "0" ]]; then
    STATUS="pass"
  elif [[ -z "$FAILURE" ]]; then
    FAILURE="command_failed_during_$STAGE"
  fi
  write_receipt
  exit "$code"
}
trap on_exit EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

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
[[ "$MONGO_POLICY_SHA256" =~ ^[0-9a-f]{64}$ ]] || die "SWFIPN_MONGO_POLICY_SHA256 must be a full lowercase sha256 digest"
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
  test -s '$REMOTE_ROOT/shared/mongo-source-policy.json'; \
  test -s '$REMOTE_ROOT/shared/.env.swfipn-web'; \
  test \"\$(stat -c '%U:%G:%a' '$REMOTE_ROOT/shared/.env.swfi2-backend')\" = 'root:root:600'; \
  test \"\$(stat -c '%U:%G:%a' '$REMOTE_ROOT/shared/mongo-source-policy.json')\" = 'root:root:600'; \
  test \"\$(stat -c '%U:%G:%a' '$REMOTE_ROOT/shared/.env.swfipn-web')\" = 'root:root:600'; \
  test -x /usr/local/sbin/swfipn-freshness-audit; \
  test \"\$(systemctl is-active swfipn-freshness-audit.timer)\" = active; \
  command -v git >/dev/null; command -v python3 >/dev/null; command -v docker >/dev/null; command -v flock >/dev/null; command -v systemd-run >/dev/null; \
  docker compose version >/dev/null; \
  docker image inspect '$BASELINE_FRONTEND_IMAGE_ID' '$BASELINE_BACKEND_IMAGE_ID' >/dev/null; \
  docker run --rm --read-only --cap-drop ALL --security-opt no-new-privileges \
    '$BASELINE_BACKEND_IMAGE_ID' python -c 'import dns.resolver' >/dev/null"
if ! MONGO_SOURCE_RECEIPT="$(ssh "${SSH_OPTS[@]}" "$HOST" \
  "docker run --rm -i --read-only --cap-drop ALL --security-opt no-new-privileges \
    --pids-limit 64 --memory 128m --network bridge --user 0:0 \
    --tmpfs /tmp:rw,noexec,nosuid,size=16m \
    -v '$REMOTE_ROOT/shared/.env.swfi2-backend:/run/secrets/backend.env:ro' \
    -v '$REMOTE_ROOT/shared/mongo-source-policy.json:/run/secrets/mongo-policy.json:ro' \
    '$BASELINE_BACKEND_IMAGE_ID' python - \
    /run/secrets/backend.env /run/secrets/mongo-policy.json '$MONGO_POLICY_SHA256'" \
  < infra/digitalocean/scripts/verify_backend_env.py)"; then
  die "backend Mongo source verification failed"
fi
if ! MONGO_SOURCE_FIELDS="$(printf '%s' "$MONGO_SOURCE_RECEIPT" | python3 -c '
import json
import sys

receipt = json.load(sys.stdin)
assert receipt["schema_version"] == "swfipn.backend_env_verification.v2"
assert receipt["status"] == "pass"
assert receipt["resolver_mode"] == "live"
assert receipt["no_secret_values_written"] is True
for field in ("policy_sha256", "source_identity_sha256", "effective_destinations_sha256"):
    value = receipt[field]
    assert isinstance(value, str) and len(value) == 64
print(receipt["policy_sha256"])
print(receipt["source_identity_sha256"])
print(receipt["effective_destinations_sha256"])
')"; then
  die "backend Mongo source receipt validation failed"
fi
readarray -t MONGO_SOURCE_FIELD_LINES <<<"$MONGO_SOURCE_FIELDS"
MONGO_POLICY_RECEIPT_SHA256="${MONGO_SOURCE_FIELD_LINES[0]:-}"
MONGO_SOURCE_IDENTITY_SHA256="${MONGO_SOURCE_FIELD_LINES[1]:-}"
MONGO_EFFECTIVE_DESTINATIONS_SHA256="${MONGO_SOURCE_FIELD_LINES[2]:-}"
[[ "$MONGO_POLICY_RECEIPT_SHA256" == "$MONGO_POLICY_SHA256" ]] || die "backend Mongo policy digest mismatch"
mkdir -p output
printf '%s' "$MONGO_SOURCE_RECEIPT" > output/swfipn-mongo-source-verification-latest.json
MONGO_SOURCE_RECEIPT_SHA256="$(printf '%s' "$MONGO_SOURCE_RECEIPT" | shasum -a 256 | awk '{print $1}')"
MONGO_SOURCE_VERIFIED=1

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
  rm -rf '$REMOTE_RELEASE/frontend-git'; \
  cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/Caddyfile' '$REMOTE_RELEASE/Caddyfile'; \
  cp '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/compose.acceptance.yml' '$REMOTE_RELEASE/compose.acceptance.yml'; \
  ln -s '$REMOTE_ROOT/shared/.env.swfi2-backend' '$REMOTE_RELEASE/.env.swfi2-backend'; \
  ln -s '$REMOTE_ROOT/shared/.env.swfipn-web' '$REMOTE_RELEASE/.env.swfipn-web'"

FRONTEND_TREE_JSON="$(ssh "${SSH_OPTS[@]}" "$HOST" "python3 '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/tree_digest.py' '$REMOTE_RELEASE/swfi-dashboard'")"
FRONTEND_TREE_SHA256="$(python3 -c 'import json,sys; print(json.load(sys.stdin)["sha256"])' <<<"$FRONTEND_TREE_JSON")"

ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  printf '%s\n' \
    'SWFIPN_IMAGE_TAG=$STAMP' \
    'SWFIPN_ASSET_VERSION=$ASSET_VERSION' \
    'SWFIPN_GIT_SHA=$FRONTEND_GIT_SHA' \
    'SWFIPN_GIT_DIRTY=0' \
    'SWFIPN_BACKEND_GIT_SHA=$BASELINE_BACKEND_GIT_SHA' \
    'SWFIPN_SOURCE_MODE=github_exact_commit_plus_pinned_backend_image' \
    > '$REMOTE_RELEASE/.release.env'; \
  FRONTEND_GIT_URL='$FRONTEND_GIT_URL' \
  FRONTEND_GIT_SHA='$FRONTEND_GIT_SHA' \
  FRONTEND_GIT_TREE='$FRONTEND_GIT_TREE' \
  FRONTEND_TREE_SHA256='$FRONTEND_TREE_SHA256' \
  BACKEND_GIT_SHA='$BASELINE_BACKEND_GIT_SHA' \
  BACKEND_IMAGE_ID='$BASELINE_BACKEND_IMAGE_ID' \
  BASELINE_RELEASE='$BASELINE_RELEASE' \
  python3 -c 'import json,os,pathlib; pathlib.Path(\"$REMOTE_RELEASE/source-manifest.json\").write_text(json.dumps({\"schema_version\":\"swfipn.release_source.v2\",\"frontend\":{\"git_url\":os.environ[\"FRONTEND_GIT_URL\"],\"git_sha\":os.environ[\"FRONTEND_GIT_SHA\"],\"git_tree\":os.environ[\"FRONTEND_GIT_TREE\"],\"tree_sha256\":os.environ[\"FRONTEND_TREE_SHA256\"]},\"backend\":{\"source_mode\":\"pinned_existing_image\",\"git_sha\":os.environ[\"BACKEND_GIT_SHA\"],\"image_id\":os.environ[\"BACKEND_IMAGE_ID\"],\"source_release\":os.environ[\"BASELINE_RELEASE\"]}},indent=2)+\"\\n\")'"

STAGE="image_build"
ssh "${SSH_OPTS[@]}" "$HOST" "cd '$REMOTE_RELEASE' && \
  SWFI2_BACKEND_CONTEXT=./SWFI2.0-final \
  SWFIPN_FRONTEND_CONTEXT=./swfi-dashboard \
  SWFIPN_DOMAIN='$DOMAIN' \
  SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
  SWFIPN_API_DOMAIN='$API_DOMAIN' \
  docker image tag '$BASELINE_BACKEND_IMAGE_ID' 'swfipn/swfi2-backend:$STAMP'; \
  docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml build swfipn-web"

restore_previous_release() {
  ROLLBACK_ATTEMPTED=1
  if ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
    exec 9>'$REMOTE_ROOT/.rollback.lock'; flock -x 9; \
    cd '$REMOTE_RELEASE'; docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml down --remove-orphans || true; \
    cd '$PREVIOUS_RELEASE'; \
    previous_tag=\$(sed -n 's/^SWFIPN_IMAGE_TAG=//p' .release.env | tail -1); \
    case \"\$previous_tag\" in (*[!A-Za-z0-9._-]*|'') exit 1;; esac; \
    docker image tag '$PREVIOUS_FRONTEND_IMAGE_ID' \"swfipn/web:\$previous_tag\"; \
    docker image tag '$PREVIOUS_BACKEND_IMAGE_ID' \"swfipn/swfi2-backend:\$previous_tag\"; \
    SWFIPN_DOMAIN='$DOMAIN' \
    SWFIPN_SITE_ADDRESSES='$SITE_ADDRESSES' \
    SWFIPN_API_DOMAIN='$API_DOMAIN' \
    docker compose --env-file .release.env -p '$COMPOSE_PROJECT' -f compose.acceptance.yml up -d --wait --wait-timeout 240 --pull never --no-build; \
    ln -sfn '$PREVIOUS_RELEASE' '$REMOTE_ROOT/current'; \
    test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$PREVIOUS_RELEASE'; \
    test \"\$(docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1')\" = '$PREVIOUS_FRONTEND_IMAGE_ID'; \
    test \"\$(docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1')\" = '$PREVIOUS_BACKEND_IMAGE_ID'; \
    rm -f '$REMOTE_RELEASE/.activation-pending'; \
    systemctl stop '$ROLLBACK_GUARD_UNIT.timer' '$ROLLBACK_GUARD_UNIT.service' >/dev/null 2>&1 || true"; then
    ROLLBACK_SUCCEEDED=1
    ACTIVATION_STARTED=0
    return 0
  fi
  ROLLBACK_SUCCEEDED=0
  return 1
}

ROLLBACK_GUARD_UNIT="swfipn-rollback-$STAMP"
ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  touch '$REMOTE_RELEASE/.activation-pending'; \
  systemd-run --quiet --unit '$ROLLBACK_GUARD_UNIT' --on-active=15m --property=Type=oneshot \
    '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/rollback_guard.sh' \
    '$REMOTE_RELEASE' '$PREVIOUS_RELEASE' '$REMOTE_ROOT' '$COMPOSE_PROJECT' \
    '$DOMAIN' '$SITE_ADDRESSES' '$API_DOMAIN' \
    '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID'"

STAGE="activation"
ACTIVATION_STARTED=1
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
  [[ "$BACKEND_IMAGE_ID" == "$BASELINE_BACKEND_IMAGE_ID" ]] || return 1
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
if ! ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  exec 9>'$REMOTE_ROOT/.rollback.lock'; flock -x 9; \
  test \"\$(readlink -f '$REMOTE_ROOT/current')\" = '$REMOTE_RELEASE'; \
  test \"\$(docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfipn-web-1')\" = '$FRONTEND_IMAGE_ID'; \
  test \"\$(docker inspect --format '{{.Image}}' '$COMPOSE_PROJECT-swfi2-backend-1')\" = '$BASELINE_BACKEND_IMAGE_ID'; \
  rm -f '$REMOTE_RELEASE/.activation-pending'; \
  systemctl stop '$ROLLBACK_GUARD_UNIT.timer' '$ROLLBACK_GUARD_UNIT.service' >/dev/null 2>&1 || true"; then
  FAILURE="rollback guard disarm failed; restoring previous release"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi
DEPLOY_COMMITTED=1

STAGE="complete"
STATUS="pass"
exit 0
