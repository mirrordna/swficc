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
ACTIVATION_RECEIPT="${SWFIPN_ACTIVATION_RECEIPT:-output/swfipn-strict-acceptance-deploy-latest.json}"
BROWSER_GATE_RECEIPT="${SWFIPN_BROWSER_GATE_RECEIPT:-output/swfipn-dashboard20-e2e-contract-post-deploy.json}"
SEMANTIC_GATE_RECEIPT="${SWFIPN_SEMANTIC_GATE_RECEIPT:-output/swfipn-semantic-search-retest-post-deploy.json}"
WORKFLOW_RUN_ID="${SWFIPN_WORKFLOW_RUN_ID:-}"
EXPECTED_BROWSER_ORIGIN="https://dashboard.swfi.com/swficc"
EXPECTED_SEMANTIC_ORIGIN="https://dashboard.swfi.com"
POST_DEPLOY_RECEIPT_MAX_AGE_SECONDS=900
SSH_KEY_FINGERPRINT="${SWFIPN_SSH_KEY_FINGERPRINT:-}"
SSH_ACCESS_RUN_ID="${SWFIPN_SSH_ACCESS_RUN_ID:-}"
case "$MODE" in
  preflight) DEFAULT_RECEIPT_PATH="output/swfipn-git-deploy-preflight-latest.json" ;;
  deploy) DEFAULT_RECEIPT_PATH="output/swfipn-strict-acceptance-deploy-latest.json" ;;
  finalize) DEFAULT_RECEIPT_PATH="output/swfipn-strict-acceptance-finalize-latest.json" ;;
  rollback) DEFAULT_RECEIPT_PATH="output/swfipn-strict-acceptance-rollback-latest.json" ;;
  authorize-access) DEFAULT_RECEIPT_PATH="output/swfipn-ssh-access-authorized-latest.json" ;;
  revoke-access) DEFAULT_RECEIPT_PATH="output/swfipn-ssh-access-revoked-latest.json" ;;
  *) DEFAULT_RECEIPT_PATH="output/swfipn-strict-acceptance-invalid-mode-latest.json" ;;
esac
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
ROLLBACK_GUARD_ARMED=0
POST_DEPLOY_GATES_PASSED=0
BROWSER_GATE_RECEIPT_SHA256=""
SEMANTIC_GATE_RECEIPT_SHA256=""
SSH_ACCESS_STATE=""
SSH_ACCESS_RECEIPT_SHA256=""
SSH_ACCESS_RECEIPT_PATH=""
MONGO_SOURCE_VERIFIED=0
MONGO_SOURCE_RECEIPT_SHA256=""
MONGO_POLICY_RECEIPT_SHA256=""
MONGO_SOURCE_IDENTITY_SHA256=""
MONGO_EFFECTIVE_DESTINATIONS_SHA256=""
MONGO_RUNTIME_DNS_PIN_SHA256=""
MONGO_RUNTIME_PIN_HOST=""
MONGO_RUNTIME_PIN_IP=""
MONGO_RUNTIME_PIN_PORT=""

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
  SWFIPN_RECEIPT_ROLLBACK_GUARD_ARMED="$ROLLBACK_GUARD_ARMED" \
  SWFIPN_RECEIPT_POST_DEPLOY_GATES_PASSED="$POST_DEPLOY_GATES_PASSED" \
  SWFIPN_RECEIPT_BROWSER_GATE_SHA256="$BROWSER_GATE_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_SEMANTIC_GATE_SHA256="$SEMANTIC_GATE_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_SSH_ACCESS_STATE="$SSH_ACCESS_STATE" \
  SWFIPN_RECEIPT_SSH_ACCESS_RECEIPT_SHA256="$SSH_ACCESS_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_SSH_ACCESS_RECEIPT_PATH="$SSH_ACCESS_RECEIPT_PATH" \
  SWFIPN_RECEIPT_MONGO_SOURCE_VERIFIED="$MONGO_SOURCE_VERIFIED" \
  SWFIPN_RECEIPT_MONGO_SOURCE_RECEIPT_SHA256="$MONGO_SOURCE_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_MONGO_POLICY_SHA256="$MONGO_POLICY_RECEIPT_SHA256" \
  SWFIPN_RECEIPT_MONGO_SOURCE_IDENTITY_SHA256="$MONGO_SOURCE_IDENTITY_SHA256" \
  SWFIPN_RECEIPT_MONGO_EFFECTIVE_DESTINATIONS_SHA256="$MONGO_EFFECTIVE_DESTINATIONS_SHA256" \
  SWFIPN_RECEIPT_MONGO_RUNTIME_DNS_PIN_SHA256="$MONGO_RUNTIME_DNS_PIN_SHA256" \
  python3 - <<'PY'
import json
import os
from pathlib import Path

def optional(name):
    return os.environ.get(name) or None

receipt = {
    "schema_version": "swfipn.strict_acceptance_deploy.v10",
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
    "rollback_guard_armed": os.environ["SWFIPN_RECEIPT_ROLLBACK_GUARD_ARMED"] == "1",
    "post_deploy_gates": {
        "passed": os.environ["SWFIPN_RECEIPT_POST_DEPLOY_GATES_PASSED"] == "1",
        "browser_receipt_sha256": optional("SWFIPN_RECEIPT_BROWSER_GATE_SHA256"),
        "semantic_receipt_sha256": optional("SWFIPN_RECEIPT_SEMANTIC_GATE_SHA256"),
    },
    "ssh_access": {
        "state": optional("SWFIPN_RECEIPT_SSH_ACCESS_STATE"),
        "server_receipt_sha256": optional("SWFIPN_RECEIPT_SSH_ACCESS_RECEIPT_SHA256"),
        "server_receipt_path": optional("SWFIPN_RECEIPT_SSH_ACCESS_RECEIPT_PATH"),
        "key_material_recorded": False,
    },
    "mongo_source": {
        "verified": os.environ["SWFIPN_RECEIPT_MONGO_SOURCE_VERIFIED"] == "1",
        "verification_receipt_sha256": optional("SWFIPN_RECEIPT_MONGO_SOURCE_RECEIPT_SHA256"),
        "policy_sha256": optional("SWFIPN_RECEIPT_MONGO_POLICY_SHA256"),
        "source_identity_sha256": optional("SWFIPN_RECEIPT_MONGO_SOURCE_IDENTITY_SHA256"),
        "effective_destinations_sha256": optional("SWFIPN_RECEIPT_MONGO_EFFECTIVE_DESTINATIONS_SHA256"),
        "runtime_dns_pin_sha256": optional("SWFIPN_RECEIPT_MONGO_RUNTIME_DNS_PIN_SHA256"),
        "secrets_recorded": False,
    },
    "production_mutation_attempted": (
        os.environ["SWFIPN_RECEIPT_MODE"] in {"deploy", "finalize", "rollback"}
        and os.environ["SWFIPN_RECEIPT_STAGE"] not in {
            "initialization",
            "baseline_validation",
            "github_verification",
            "remote_preflight",
        }
    ),
    "active_release_changed": (
        os.environ["SWFIPN_RECEIPT_MODE"] == "finalize"
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

validate_ssh_access_inputs() {
  [[ -n "$HOST" && "$HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ ]] \
    || die "SWFIPN_HOST must be user@host"
  [[ "$SSH_KEY_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]+$ ]] \
    || die "SWFIPN_SSH_KEY_FINGERPRINT must be an OpenSSH SHA256 fingerprint"
  [[ "$SSH_ACCESS_RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]] \
    || die "SWFIPN_SSH_ACCESS_RUN_ID must be a safe run identifier"
}

ssh_access_contract() {
  local action="$1"
  local finalize_mode="${2:-0}"
  local server_receipt
  local local_server_receipt="${SWFIPN_SSH_ACCESS_SERVER_RECEIPT:-output/swfipn-ssh-access-server-${action}-latest.json}"
  local expected_state
  if [[ "$action" == "authorize" ]]; then
    expected_state="authorized"
  else
    expected_state="revoked"
  fi

  STAGE="ssh_access_${action}"
  if [[ "$action" == "revoke" && -s "$local_server_receipt" ]]; then
    if SSH_ACCESS_RECEIPT_PATH="$(SWFIPN_EXPECTED_SSH_ACCESS_STATE="$expected_state" \
      SWFIPN_EXPECTED_SSH_KEY_FINGERPRINT="$SSH_KEY_FINGERPRINT" \
      SWFIPN_SSH_ACCESS_RUN_ID="$SSH_ACCESS_RUN_ID" \
      python3 - "$local_server_receipt" <<'PY'
import json
import os
import re
import sys

receipt = json.load(open(sys.argv[1]))
assert receipt["schema_version"] == "swfipn.ssh_access.v1"
assert receipt["state"] == os.environ["SWFIPN_EXPECTED_SSH_ACCESS_STATE"]
assert receipt["run_id"] == os.environ["SWFIPN_SSH_ACCESS_RUN_ID"]
assert receipt["key_fingerprint"] == os.environ["SWFIPN_EXPECTED_SSH_KEY_FINGERPRINT"]
assert re.fullmatch(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
    receipt["generated_at"],
)
assert receipt["key_material_recorded"] is False
assert receipt["secret_values_recorded"] is False
for key in ("matches_before", "removed_count", "matches_after"):
    assert type(receipt[key]) is int and receipt[key] >= 0
assert receipt["matches_after"] == 0
assert re.fullmatch(r"[0-9a-f]{64}", receipt["authorized_keys_sha256"])
expected_path = (
    "/opt/swfipn-acceptance/access-receipts/"
    f"swfipn-ssh-access-{receipt['run_id']}-{receipt['state']}.json"
)
assert receipt["server_receipt_path"] == expected_path
print(receipt["server_receipt_path"])
PY
    )"; then
      SSH_ACCESS_RECEIPT_SHA256="$(shasum -a 256 "$local_server_receipt" | awk '{print $1}')"
      SSH_ACCESS_STATE="$expected_state"
      return 0
    fi
  fi

  server_receipt="$(ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- \
    "$action" "$SSH_KEY_FINGERPRINT" "$SSH_ACCESS_RUN_ID" "$REMOTE_ROOT" \
    "$finalize_mode" "$REMOTE_RELEASE" "$PREVIOUS_RELEASE" "$COMPOSE_PROJECT" \
    "$DOMAIN" "$SITE_ADDRESSES" "$API_DOMAIN" \
    "$PREVIOUS_FRONTEND_IMAGE_ID" "$PREVIOUS_BACKEND_IMAGE_ID" \
    "$FRONTEND_IMAGE_ID" "$BASELINE_BACKEND_IMAGE_ID" "$ROLLBACK_GUARD_UNIT" <<'REMOTE'
set -euo pipefail

ACTION="$1"
KEY_FINGERPRINT="$2"
RUN_ID="$3"
REMOTE_ROOT="$4"
FINALIZE_MODE="$5"
REMOTE_RELEASE="$6"
PREVIOUS_RELEASE="$7"
COMPOSE_PROJECT="$8"
DOMAIN="$9"
SITE_ADDRESSES="${10}"
API_DOMAIN="${11}"
PREVIOUS_FRONTEND_IMAGE_ID="${12}"
PREVIOUS_BACKEND_IMAGE_ID="${13}"
FRONTEND_IMAGE_ID="${14}"
BASELINE_BACKEND_IMAGE_ID="${15}"
ROLLBACK_GUARD_UNIT="${16}"

[[ "$ACTION" == "authorize" || "$ACTION" == "revoke" ]]
[[ "$KEY_FINGERPRINT" =~ ^SHA256:[A-Za-z0-9+/]+$ ]]
[[ "$RUN_ID" =~ ^[A-Za-z0-9._-]+$ ]]
[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]]
[[ "$FINALIZE_MODE" == "0" || "$FINALIZE_MODE" == "1" ]]

if [[ "$FINALIZE_MODE" == "1" ]]; then
  [[ "$ACTION" == "revoke" ]]
  [[ "$REMOTE_RELEASE" =~ ^/opt/swfipn-acceptance/releases/[0-9]{8}T[0-9]{6}Z$ ]]
  [[ "$PREVIOUS_RELEASE" =~ ^/opt/swfipn-acceptance/releases/[0-9]{8}T[0-9]{6}Z$ ]]
  [[ "$REMOTE_RELEASE" != "$PREVIOUS_RELEASE" ]]
  [[ "$COMPOSE_PROJECT" == "swfipn_acceptance" ]]
  [[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]
  [[ "$SITE_ADDRESSES" =~ ^[A-Za-z0-9.,[:space:]-]+$ ]]
  [[ "$API_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]
  [[ "$PREVIOUS_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$PREVIOUS_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$BASELINE_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
  [[ "$ROLLBACK_GUARD_UNIT" =~ ^swfipn-rollback-[0-9]{8}T[0-9]{6}Z$ ]]
  [[ "${REMOTE_RELEASE##*/}" == "${ROLLBACK_GUARD_UNIT#swfipn-rollback-}" ]]
  exec 9>"$REMOTE_ROOT/.rollback.lock"
  flock -x 9
  [[ -f "$REMOTE_RELEASE/.activation-pending" ]]
  [[ "$(readlink -f "$REMOTE_ROOT/current")" == "$REMOTE_RELEASE" ]]
  [[ "$(docker inspect --format '{{.Image}}' "$COMPOSE_PROJECT-swfipn-web-1")" == "$FRONTEND_IMAGE_ID" ]]
  [[ "$(docker inspect --format '{{.Image}}' "$COMPOSE_PROJECT-swfi2-backend-1")" == "$BASELINE_BACKEND_IMAGE_ID" ]]
  rollback_on_error() {
    flock -u 9 || true
    "$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/rollback_guard.sh" \
      "$REMOTE_RELEASE" "$PREVIOUS_RELEASE" "$REMOTE_ROOT" "$COMPOSE_PROJECT" \
      "$DOMAIN" "$SITE_ADDRESSES" "$API_DOMAIN" \
      "$PREVIOUS_FRONTEND_IMAGE_ID" "$PREVIOUS_BACKEND_IMAGE_ID"
  }
  trap rollback_on_error ERR
fi

access_receipt="$(python3 - "$ACTION" "$KEY_FINGERPRINT" "$RUN_ID" "$REMOTE_ROOT" <<'PY'
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
from datetime import datetime, timezone

action, expected_fingerprint, run_id, remote_root = __import__("sys").argv[1:]
if action not in {"authorize", "revoke"}:
    raise SystemExit("invalid_action")
if not re.fullmatch(r"SHA256:[A-Za-z0-9+/]+", expected_fingerprint):
    raise SystemExit("invalid_fingerprint")
if not re.fullmatch(r"[A-Za-z0-9._-]+", run_id):
    raise SystemExit("invalid_run_id")
if remote_root != "/opt/swfipn-acceptance":
    raise SystemExit("invalid_remote_root")

authorized_keys = Path.home() / ".ssh" / "authorized_keys"
if not authorized_keys.is_file() or authorized_keys.is_symlink():
    raise SystemExit("authorized_keys_not_regular")
original = authorized_keys.read_text(encoding="utf-8")
lines = original.splitlines(keepends=True)

def fingerprint(line):
    tokens = line.strip().split()
    for index, token in enumerate(tokens[:-1]):
        if re.fullmatch(r"(?:ssh-|ecdsa-|sk-)[A-Za-z0-9@._+-]+", token):
            try:
                blob = base64.b64decode(tokens[index + 1], validate=True)
            except Exception:
                return None
            digest = base64.b64encode(hashlib.sha256(blob).digest()).decode("ascii").rstrip("=")
            return f"SHA256:{digest}"
    return None

matches_before = [index for index, line in enumerate(lines) if fingerprint(line) == expected_fingerprint]
if action == "authorize" and len(matches_before) != 1:
    raise SystemExit("temporary_key_authorization_count_mismatch")
if action == "revoke" and len(matches_before) > 1:
    raise SystemExit("temporary_key_duplicate_authorizations")

removed_count = 0
if action == "revoke" and matches_before:
    kept = [line for index, line in enumerate(lines) if index not in set(matches_before)]
    updated = "".join(kept)
    stat = authorized_keys.stat()
    fd, temporary_name = tempfile.mkstemp(prefix=".authorized_keys.", dir=authorized_keys.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(updated)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary_name, stat.st_mode & 0o777)
        os.chown(temporary_name, stat.st_uid, stat.st_gid)
        os.replace(temporary_name, authorized_keys)
        directory_fd = os.open(authorized_keys.parent, os.O_RDONLY)
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    finally:
        if os.path.exists(temporary_name):
            os.unlink(temporary_name)
    removed_count = len(matches_before)

updated_text = authorized_keys.read_text(encoding="utf-8")
matches_after = sum(
    1 for line in updated_text.splitlines(keepends=True)
    if fingerprint(line) == expected_fingerprint
)
if action == "authorize" and matches_after != 1:
    raise SystemExit("temporary_key_authorization_not_stable")
if action == "revoke" and matches_after != 0:
    raise SystemExit("temporary_key_revocation_failed")

receipt_dir = Path(remote_root) / "access-receipts"
receipt_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
os.chmod(receipt_dir, 0o700)
state = "authorized" if action == "authorize" else "revoked"
receipt_path = receipt_dir / f"swfipn-ssh-access-{run_id}-{state}.json"
receipt = {
    "schema_version": "swfipn.ssh_access.v1",
    "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
    "run_id": run_id,
    "state": state,
    "key_fingerprint": expected_fingerprint,
    "matches_before": len(matches_before),
    "removed_count": removed_count,
    "matches_after": matches_after,
    "authorized_keys_sha256": hashlib.sha256(updated_text.encode("utf-8")).hexdigest(),
    "server_receipt_path": str(receipt_path),
    "key_material_recorded": False,
    "secret_values_recorded": False,
}
encoded = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
fd, temporary_name = tempfile.mkstemp(prefix=f".{receipt_path.name}.", dir=receipt_dir)
try:
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(encoded)
        handle.flush()
        os.fsync(handle.fileno())
    os.chmod(temporary_name, 0o600)
    os.replace(temporary_name, receipt_path)
finally:
    if os.path.exists(temporary_name):
        os.unlink(temporary_name)
print(encoded, end="")
PY
)"

if [[ "$FINALIZE_MODE" == "1" ]]; then
  systemctl stop "$ROLLBACK_GUARD_UNIT.timer" "$ROLLBACK_GUARD_UNIT.service"
  rm -f "$REMOTE_RELEASE/.activation-pending"
  trap - ERR
fi

printf '%s' "$access_receipt"
REMOTE
)"

  mkdir -p "$(dirname "$local_server_receipt")"
  printf '%s' "$server_receipt" > "$local_server_receipt"
  if ! SSH_ACCESS_RECEIPT_PATH="$(printf '%s' "$server_receipt" \
    | SWFIPN_EXPECTED_SSH_ACCESS_STATE="$expected_state" \
      SWFIPN_EXPECTED_SSH_KEY_FINGERPRINT="$SSH_KEY_FINGERPRINT" \
      SWFIPN_SSH_ACCESS_RUN_ID="$SSH_ACCESS_RUN_ID" \
      python3 -c '
import json
import os
import re
import sys

receipt = json.load(sys.stdin)
expected_state = os.environ["SWFIPN_EXPECTED_SSH_ACCESS_STATE"]
expected_run_id = os.environ["SWFIPN_SSH_ACCESS_RUN_ID"]
assert receipt["schema_version"] == "swfipn.ssh_access.v1"
assert receipt["state"] == expected_state
assert receipt["run_id"] == expected_run_id
assert receipt["key_fingerprint"] == os.environ["SWFIPN_EXPECTED_SSH_KEY_FINGERPRINT"]
assert re.fullmatch(
    r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}Z",
    receipt["generated_at"],
)
assert receipt["key_material_recorded"] is False
assert receipt["secret_values_recorded"] is False
for key in ("matches_before", "removed_count", "matches_after"):
    assert type(receipt[key]) is int and receipt[key] >= 0
assert receipt["matches_after"] == (1 if expected_state == "authorized" else 0)
assert re.fullmatch(r"[0-9a-f]{64}", receipt["authorized_keys_sha256"])
expected_path = (
    "/opt/swfipn-acceptance/access-receipts/"
    f"swfipn-ssh-access-{expected_run_id}-{expected_state}.json"
)
assert receipt["server_receipt_path"] == expected_path
print(receipt["server_receipt_path"])
')"; then
    die "server SSH access receipt validation failed"
  fi
  SSH_ACCESS_RECEIPT_SHA256="$(printf '%s' "$server_receipt" | shasum -a 256 | awk '{print $1}')"
  SSH_ACCESS_STATE="$expected_state"
}

load_activation_receipt() {
  [[ -s "$ACTIVATION_RECEIPT" ]] || die "missing activation receipt: $ACTIVATION_RECEIPT"
  local fields
  if ! fields="$(python3 - "$ACTIVATION_RECEIPT" "$FRONTEND_GIT_SHA" <<'PY'
import json
import re
import sys

receipt = json.load(open(sys.argv[1]))
assert receipt["schema_version"] == "swfipn.strict_acceptance_deploy.v10"
assert receipt["mode"] == "deploy"
expected_sha = sys.argv[2]
assert re.fullmatch(r"[0-9a-f]{40}", expected_sha)
assert receipt["frontend_git_sha"] == expected_sha
assert re.fullmatch(r"[0-9a-f]{40}", receipt["backend_git_sha"])
assert receipt["status"] in {"pass", "fail"}
assert receipt["stage"] in {
    "initialization",
    "baseline_validation",
    "github_verification",
    "remote_preflight",
    "release_materialization",
    "image_build",
    "activation",
    "public_release_verification",
    "activation_evidence",
    "current_switch",
    "post_deploy_gates_pending",
}

for key in (
    "activation_started",
    "deploy_committed",
    "rollback_succeeded",
    "rollback_guard_armed",
):
    assert type(receipt[key]) is bool

release_pattern = re.compile(r"/opt/swfipn-acceptance/releases/[0-9]{8}T[0-9]{6}Z")
image_pattern = re.compile(r"sha256:[0-9a-f]{64}")
guard_pattern = re.compile(r"swfipn-rollback-[0-9]{8}T[0-9]{6}Z")
digest_pattern = re.compile(r"[0-9a-f]{64}")
assert release_pattern.fullmatch(receipt["release"])
assert release_pattern.fullmatch(receipt["previous_release"])
assert receipt["release"] != receipt["previous_release"]
assert image_pattern.fullmatch(receipt["frontend_image_id"])
assert image_pattern.fullmatch(receipt["backend_image_id"])
assert image_pattern.fullmatch(receipt["previous_frontend_image_id"])
assert image_pattern.fullmatch(receipt["previous_backend_image_id"])
assert guard_pattern.fullmatch(receipt["rollback_guard_unit"])
assert receipt["release"].rsplit("/", 1)[1] == receipt["rollback_guard_unit"].removeprefix("swfipn-rollback-")
assert receipt["asset_version"] == expected_sha[:7]
assert digest_pattern.fullmatch(receipt["public_release_marker_sha256"])

values = [
    receipt["status"],
    receipt["stage"],
    "1" if receipt["activation_started"] else "0",
    "1" if receipt["deploy_committed"] else "0",
    "1" if receipt["rollback_succeeded"] else "0",
    "1" if receipt["rollback_guard_armed"] else "0",
    receipt["release"],
    receipt["previous_release"],
    receipt["frontend_image_id"],
    receipt["backend_image_id"],
    receipt["previous_frontend_image_id"],
    receipt["previous_backend_image_id"],
    receipt["rollback_guard_unit"],
    receipt["backend_git_sha"],
    receipt["asset_version"],
    receipt["public_release_marker_sha256"],
]
print("\n".join(values))
PY
)"; then
    die "activation receipt validation failed"
  fi
  local lines=()
  while IFS= read -r line; do
    lines+=("$line")
  done <<<"$fields"
  ACTIVATION_RECEIPT_STATUS="${lines[0]:-}"
  ACTIVATION_RECEIPT_STAGE="${lines[1]:-}"
  ACTIVATION_STARTED="${lines[2]:-0}"
  DEPLOY_COMMITTED="${lines[3]:-0}"
  ROLLBACK_SUCCEEDED="${lines[4]:-0}"
  ROLLBACK_GUARD_ARMED="${lines[5]:-0}"
  REMOTE_RELEASE="${lines[6]:-}"
  PREVIOUS_RELEASE="${lines[7]:-}"
  FRONTEND_IMAGE_ID="${lines[8]:-}"
  BACKEND_IMAGE_ID="${lines[9]:-}"
  PREVIOUS_FRONTEND_IMAGE_ID="${lines[10]:-}"
  PREVIOUS_BACKEND_IMAGE_ID="${lines[11]:-}"
  ROLLBACK_GUARD_UNIT="${lines[12]:-}"
  BASELINE_BACKEND_GIT_SHA="${lines[13]:-}"
  ASSET_VERSION="${lines[14]:-}"
  PUBLIC_MARKER_SHA256="${lines[15]:-}"
  BASELINE_BACKEND_IMAGE_ID="$BACKEND_IMAGE_ID"
}

validate_post_deploy_gate_receipts() {
  local hashes
  [[ "$WORKFLOW_RUN_ID" =~ ^[1-9][0-9]{0,19}$ ]] \
    || die "SWFIPN_WORKFLOW_RUN_ID must be the numeric GitHub workflow run id"
  if ! hashes="$(python3 - \
    "$BROWSER_GATE_RECEIPT" \
    "$SEMANTIC_GATE_RECEIPT" \
    "$EXPECTED_BROWSER_ORIGIN" \
    "$EXPECTED_SEMANTIC_ORIGIN" \
    "$FRONTEND_GIT_SHA" \
    "$WORKFLOW_RUN_ID" \
    "$PUBLIC_MARKER_SHA256" \
    "$POST_DEPLOY_RECEIPT_MAX_AGE_SECONDS" <<'PY'
from datetime import datetime, timezone
import hashlib
import json
import re
import sys

(
    browser_path,
    semantic_path,
    expected_browser_origin,
    expected_semantic_origin,
    expected_sha,
    expected_run_id,
    expected_marker_sha256,
    max_age_raw,
) = sys.argv[1:]
assert re.fullmatch(r"[0-9a-f]{40}", expected_sha)
assert re.fullmatch(r"[1-9][0-9]{0,19}", expected_run_id)
assert re.fullmatch(r"[0-9a-f]{64}", expected_marker_sha256)
max_age_seconds = int(max_age_raw)
assert 60 <= max_age_seconds <= 3600

browser_bytes = open(browser_path, "rb").read()
semantic_bytes = open(semantic_path, "rb").read()
browser = json.loads(browser_bytes)
semantic = json.loads(semantic_bytes)

def validate_generated_at(value):
    assert isinstance(value, str)
    assert re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?Z", value)
    generated = datetime.fromisoformat(value.removesuffix("Z") + "+00:00")
    age = (datetime.now(timezone.utc) - generated).total_seconds()
    assert -30 <= age <= max_age_seconds

def validate_release_marker(receipt):
    marker = receipt["release_marker"]
    assert isinstance(marker, dict)
    assert marker["url"] == "https://dashboard.swfi.com/swficc/swficc-release.json"
    assert marker["schema_version"] == "swfipn.release_marker.v1"
    assert marker["git_sha"] == expected_sha
    assert marker["asset_version"] == expected_sha[:7]
    assert marker["sha256"] == expected_marker_sha256

def validate_provenance(receipt, expected_origin):
    validate_generated_at(receipt["generated_at"])
    assert receipt["origin"] == expected_origin
    assert receipt["candidate_sha"] == expected_sha
    assert receipt["workflow_run_id"] == expected_run_id
    validate_release_marker(receipt)

assert browser["schema_version"] == "swfipn.dashboard20_e2e_contract.v1"
validate_provenance(browser, expected_browser_origin)
summary = browser["summary"]
for key in ("pages", "passed", "failed", "failures"):
    assert type(summary[key]) is int
required_pages = {
    "/",
    "/profiles/",
    "/people/",
    "/transactions/",
    "/deals/",
    "/allocators/",
    "/comparisons/",
    "/mandates/",
    "/intelligence/",
    "/aggregates/",
    "/reports/",
}
assert isinstance(browser["pages"], list)
page_ids = [entry["page"] for entry in browser["pages"]]
assert len(page_ids) == len(required_pages)
assert len(set(page_ids)) == len(page_ids)
assert set(page_ids) == required_pages
assert all(entry["status"] == "pass" and entry["failures"] == [] for entry in browser["pages"])
assert summary["pages"] == len(required_pages)
assert summary["failed"] == 0
assert summary["failures"] == 0
assert summary["passed"] == summary["pages"]

assert semantic["schema_version"] == "swfipn.semantic_search_retest.v1"
validate_provenance(semantic, expected_semantic_origin)
assert semantic["status"] == "pass"
assert semantic["failures"] == []
required_checks = {
    "semantic_top_active_investors",
    "semantic_rfps_from_the_middle_east",
    "semantic_sovereign_wealth_funds_investing_in_ai",
    "semantic_pension_funds_in_europe",
    "semantic_open_manager_searches_in_emea",
    "semantic_central_banks_in_apac",
    "semantic_family_offices_deploying_capital_into_real_estate",
    "two_screen_transition",
    "detailed_category_refinement",
}
assert isinstance(semantic["checks"], list)
check_ids = [check["id"] for check in semantic["checks"]]
assert len(check_ids) == len(required_checks)
assert len(set(check_ids)) == len(check_ids)
assert set(check_ids) == required_checks
assert all(check["status"] == "PASS" for check in semantic["checks"])

print(hashlib.sha256(browser_bytes).hexdigest())
print(hashlib.sha256(semantic_bytes).hexdigest())
PY
)"; then
    die "post-deploy gate receipt validation failed"
  fi
  local lines=()
  while IFS= read -r line; do
    lines+=("$line")
  done <<<"$hashes"
  BROWSER_GATE_RECEIPT_SHA256="${lines[0]:-}"
  SEMANTIC_GATE_RECEIPT_SHA256="${lines[1]:-}"
  POST_DEPLOY_GATES_PASSED=1
}

restore_previous_release() {
  ROLLBACK_ATTEMPTED=1
  if ssh "${SSH_OPTS[@]}" "$HOST" bash -s -- \
    "$REMOTE_RELEASE" \
    "$PREVIOUS_RELEASE" \
    "$REMOTE_ROOT" \
    "$COMPOSE_PROJECT" \
    "$DOMAIN" \
    "$SITE_ADDRESSES" \
    "$API_DOMAIN" \
    "$PREVIOUS_FRONTEND_IMAGE_ID" \
    "$PREVIOUS_BACKEND_IMAGE_ID" \
    "$ROLLBACK_GUARD_UNIT" <<'REMOTE'
set -euo pipefail

REMOTE_RELEASE="$1"
PREVIOUS_RELEASE="$2"
REMOTE_ROOT="$3"
COMPOSE_PROJECT="$4"
DOMAIN="$5"
SITE_ADDRESSES="$6"
API_DOMAIN="$7"
PREVIOUS_FRONTEND_IMAGE_ID="$8"
PREVIOUS_BACKEND_IMAGE_ID="$9"
ROLLBACK_GUARD_UNIT="${10}"

[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]]
[[ "$REMOTE_RELEASE" =~ ^/opt/swfipn-acceptance/releases/[0-9]{8}T[0-9]{6}Z$ ]]
[[ "$PREVIOUS_RELEASE" =~ ^/opt/swfipn-acceptance/releases/[0-9]{8}T[0-9]{6}Z$ ]]
[[ "$REMOTE_RELEASE" != "$PREVIOUS_RELEASE" ]]
[[ "$COMPOSE_PROJECT" == "swfipn_acceptance" ]]
[[ "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]
[[ "$SITE_ADDRESSES" =~ ^[A-Za-z0-9.,[:space:]-]+$ ]]
[[ "$API_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]]
[[ "$PREVIOUS_FRONTEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$PREVIOUS_BACKEND_IMAGE_ID" =~ ^sha256:[0-9a-f]{64}$ ]]
[[ "$ROLLBACK_GUARD_UNIT" =~ ^swfipn-rollback-[0-9]{8}T[0-9]{6}Z$ ]]
[[ "${REMOTE_RELEASE##*/}" == "${ROLLBACK_GUARD_UNIT#swfipn-rollback-}" ]]

exec 9>"$REMOTE_ROOT/.rollback.lock"
flock -x 9
cd "$REMOTE_RELEASE"
docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml down --remove-orphans || true
cd "$PREVIOUS_RELEASE"
previous_tag="$(sed -n 's/^SWFIPN_IMAGE_TAG=//p' .release.env | tail -1)"
case "$previous_tag" in
  *[!A-Za-z0-9._-]*|'') exit 1 ;;
esac
docker image tag "$PREVIOUS_FRONTEND_IMAGE_ID" "swfipn/web:$previous_tag"
docker image tag "$PREVIOUS_BACKEND_IMAGE_ID" "swfipn/swfi2-backend:$previous_tag"
SWFIPN_DOMAIN="$DOMAIN" \
SWFIPN_SITE_ADDRESSES="$SITE_ADDRESSES" \
SWFIPN_API_DOMAIN="$API_DOMAIN" \
docker compose --env-file .release.env -p "$COMPOSE_PROJECT" -f compose.acceptance.yml \
  up -d --wait --wait-timeout 240 --pull never --no-build
ln -sfn "$PREVIOUS_RELEASE" "$REMOTE_ROOT/current"
test "$(readlink -f "$REMOTE_ROOT/current")" = "$PREVIOUS_RELEASE"
test "$(docker inspect --format '{{.Image}}' "${COMPOSE_PROJECT}-swfipn-web-1")" = "$PREVIOUS_FRONTEND_IMAGE_ID"
test "$(docker inspect --format '{{.Image}}' "${COMPOSE_PROJECT}-swfi2-backend-1")" = "$PREVIOUS_BACKEND_IMAGE_ID"
rm -f "$REMOTE_RELEASE/.activation-pending"
systemctl stop "$ROLLBACK_GUARD_UNIT.timer" "$ROLLBACK_GUARD_UNIT.service" >/dev/null 2>&1 || true
REMOTE
  then
    ROLLBACK_SUCCEEDED=1
    ROLLBACK_GUARD_ARMED=0
    ACTIVATION_STARTED=0
    return 0
  fi
  ROLLBACK_SUCCEEDED=0
  return 1
}

[[ "$MODE" == "preflight" || "$MODE" == "deploy" || "$MODE" == "finalize" \
  || "$MODE" == "rollback" || "$MODE" == "authorize-access" || "$MODE" == "revoke-access" ]] \
  || die "usage: $0 [preflight|deploy|finalize|rollback|authorize-access|revoke-access]"

if [[ "$MODE" == "authorize-access" || "$MODE" == "revoke-access" ]]; then
  validate_ssh_access_inputs
  if [[ "$MODE" == "authorize-access" ]]; then
    ssh_access_contract authorize
  else
    ssh_access_contract revoke
  fi
  STAGE="complete"
  STATUS="pass"
  exit 0
fi

[[ -n "$HOST" && "$HOST" =~ ^[A-Za-z0-9._-]+@[A-Za-z0-9.:-]+$ ]] || die "SWFIPN_HOST must be user@host"
[[ -n "$DOMAIN" && "$DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "SWFIPN_DOMAIN must be a hostname"
[[ "$SITE_ADDRESSES" =~ ^[A-Za-z0-9.,[:space:]-]+$ ]] || die "invalid SWFIPN_SITE_ADDRESSES"
[[ "$API_DOMAIN" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid SWFIPN_API_DOMAIN"
[[ "$REMOTE_ROOT" == "/opt/swfipn-acceptance" ]] || die "refusing noncanonical remote root: $REMOTE_ROOT"
[[ "$COMPOSE_PROJECT" == "swfipn_acceptance" ]] || die "refusing noncanonical compose project: $COMPOSE_PROJECT"
[[ "$FRONTEND_GIT_URL" == "https://github.com/mirrordna/swficc.git" ]] || die "refusing unapproved frontend repository: $FRONTEND_GIT_URL"
[[ "$FRONTEND_GIT_SHA" =~ ^[0-9a-f]{40}$ ]] || die "SWFIPN_FRONTEND_GIT_SHA must be a full lowercase commit sha"
EXPECTED_ASSET_VERSION="${FRONTEND_GIT_SHA:0:7}"
ASSET_VERSION="${SWFIPN_ASSET_VERSION:-$EXPECTED_ASSET_VERSION}"
[[ "$ASSET_VERSION" == "$EXPECTED_ASSET_VERSION" ]] \
  || die "SWFIPN_ASSET_VERSION must equal the candidate commit prefix"

if [[ "$MODE" == "finalize" || "$MODE" == "rollback" ]]; then
  validate_ssh_access_inputs
  load_activation_receipt
  if [[ "$MODE" == "finalize" ]]; then
    [[ "$ACTIVATION_RECEIPT_STATUS" == "pass" ]] || die "cannot finalize failed activation"
    [[ "$ACTIVATION_RECEIPT_STAGE" == "post_deploy_gates_pending" ]] \
      || die "activation is not awaiting post-deploy gates"
    [[ "$ACTIVATION_STARTED" == "1" && "$DEPLOY_COMMITTED" == "0" && "$ROLLBACK_GUARD_ARMED" == "1" ]] \
      || die "activation receipt does not prove an armed rollback window"
    validate_post_deploy_gate_receipts
    STAGE="finalization"
    ssh_access_contract revoke 1
    ROLLBACK_GUARD_ARMED=0
    DEPLOY_COMMITTED=1
    STAGE="complete"
    STATUS="pass"
    exit 0
  fi

  if [[ "$ACTIVATION_STARTED" == "1" && "$ROLLBACK_SUCCEEDED" != "1" ]]; then
    STAGE="workflow_rollback"
    restore_previous_release || die "workflow rollback failed"
  fi
  ssh_access_contract revoke
  STAGE="complete"
  STATUS="pass"
  exit 0
fi

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
    '$BASELINE_BACKEND_IMAGE_ID' python -c 'import socket; socket.getaddrinfo(\"example.com\", 443)' >/dev/null"
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
assert receipt["schema_version"] == "swfipn.backend_env_verification.v5"
assert receipt["status"] == "pass"
assert receipt["resolver_mode"] == "live"
assert receipt["connection_mode"] == "direct_single_endpoint"
assert receipt["no_secret_values_written"] is True
for field in (
    "policy_sha256",
    "source_identity_sha256",
    "effective_destinations_sha256",
    "runtime_dns_pin_sha256",
    "options_sha256",
    "required_options_sha256",
):
    value = receipt[field]
    assert isinstance(value, str) and len(value) == 64
assert receipt["options_sha256"] == receipt["required_options_sha256"]
print(receipt["policy_sha256"])
print(receipt["source_identity_sha256"])
print(receipt["effective_destinations_sha256"])
print(receipt["runtime_dns_pin_sha256"])
')"; then
  die "backend Mongo source receipt validation failed"
fi
MONGO_SOURCE_FIELD_LINES=()
while IFS= read -r line; do
  MONGO_SOURCE_FIELD_LINES+=("$line")
done <<<"$MONGO_SOURCE_FIELDS"
MONGO_POLICY_RECEIPT_SHA256="${MONGO_SOURCE_FIELD_LINES[0]:-}"
MONGO_SOURCE_IDENTITY_SHA256="${MONGO_SOURCE_FIELD_LINES[1]:-}"
MONGO_EFFECTIVE_DESTINATIONS_SHA256="${MONGO_SOURCE_FIELD_LINES[2]:-}"
MONGO_RUNTIME_DNS_PIN_SHA256="${MONGO_SOURCE_FIELD_LINES[3]:-}"
[[ "$MONGO_POLICY_RECEIPT_SHA256" == "$MONGO_POLICY_SHA256" ]] || die "backend Mongo policy digest mismatch"
if ! MONGO_RUNTIME_PIN_FIELDS="$(ssh "${SSH_OPTS[@]}" "$HOST" \
  "python3 -c 'import hashlib,ipaddress,json,sys; b=open(sys.argv[1],\"rb\").read(); assert hashlib.sha256(b).hexdigest() == sys.argv[2]; p=json.loads(b); e=p[\"allowed_direct_endpoint\"]; r=p[\"runtime_dns_pin\"]; assert p[\"schema_version\"] == \"swfipn.mongo_source_policy.v3\"; assert p[\"connection_mode\"] == \"direct_single_endpoint\"; assert e[\"host\"] == r[\"host\"]; ipaddress.ip_address(r[\"ip\"]); print(r[\"host\"]); print(r[\"ip\"]); print(e[\"port\"])' '$REMOTE_ROOT/shared/mongo-source-policy.json' '$MONGO_POLICY_SHA256'")"; then
  die "backend Mongo runtime DNS pin extraction failed"
fi
MONGO_RUNTIME_PIN_LINES=()
while IFS= read -r line; do
  MONGO_RUNTIME_PIN_LINES+=("$line")
done <<<"$MONGO_RUNTIME_PIN_FIELDS"
MONGO_RUNTIME_PIN_HOST="${MONGO_RUNTIME_PIN_LINES[0]:-}"
MONGO_RUNTIME_PIN_IP="${MONGO_RUNTIME_PIN_LINES[1]:-}"
MONGO_RUNTIME_PIN_PORT="${MONGO_RUNTIME_PIN_LINES[2]:-}"
[[ "$MONGO_RUNTIME_PIN_HOST" =~ ^[A-Za-z0-9.-]+$ ]] || die "invalid Mongo runtime pin host"
python3 -c 'import ipaddress,sys; ipaddress.ip_address(sys.argv[1])' "$MONGO_RUNTIME_PIN_IP" \
  || die "invalid Mongo runtime pin IP"
if [[ ! "$MONGO_RUNTIME_PIN_PORT" =~ ^[0-9]+$ ]] \
  || (( MONGO_RUNTIME_PIN_PORT < 1 || MONGO_RUNTIME_PIN_PORT > 65535 )); then
  die "invalid Mongo runtime pin port"
fi
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

ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; umask 077; \
  printf '%s\n' \
    'SWFIPN_IMAGE_TAG=$STAMP' \
    'SWFIPN_ASSET_VERSION=$ASSET_VERSION' \
    'SWFIPN_GIT_SHA=$FRONTEND_GIT_SHA' \
    'SWFIPN_GIT_DIRTY=0' \
    'SWFIPN_BACKEND_GIT_SHA=$BASELINE_BACKEND_GIT_SHA' \
    'SWFIPN_SOURCE_MODE=github_exact_commit_plus_pinned_backend_image' \
    'SWFIPN_MONGO_PINNED_HOST=$MONGO_RUNTIME_PIN_HOST' \
    'SWFIPN_MONGO_PINNED_IP=$MONGO_RUNTIME_PIN_IP' \
    'SWFIPN_MONGO_PINNED_PORT=$MONGO_RUNTIME_PIN_PORT' \
    > '$REMOTE_RELEASE/.release.env'; \
  test \"\$(stat -c '%U:%G:%a' '$REMOTE_RELEASE/.release.env')\" = 'root:root:600'; \
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

ROLLBACK_GUARD_UNIT="swfipn-rollback-$STAMP"
ssh "${SSH_OPTS[@]}" "$HOST" "set -eu; \
  touch '$REMOTE_RELEASE/.activation-pending'; \
  systemd-run --quiet --unit '$ROLLBACK_GUARD_UNIT' --on-active=15m --property=Type=oneshot \
    '$REMOTE_RELEASE/swfi-dashboard/infra/digitalocean/scripts/rollback_guard.sh' \
    '$REMOTE_RELEASE' '$PREVIOUS_RELEASE' '$REMOTE_ROOT' '$COMPOSE_PROJECT' \
    '$DOMAIN' '$SITE_ADDRESSES' '$API_DOMAIN' \
    '$PREVIOUS_FRONTEND_IMAGE_ID' '$PREVIOUS_BACKEND_IMAGE_ID'"
ROLLBACK_GUARD_ARMED=1

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
  test -f '$REMOTE_RELEASE/.activation-pending'; \
  test \"\$(systemctl is-active '$ROLLBACK_GUARD_UNIT.timer')\" = active"; then
  FAILURE="rollback guard was not armed through the post-deploy gate window"
  echo "$FAILURE" >&2
  restore_previous_release
  exit 1
fi

STAGE="post_deploy_gates_pending"
STATUS="pass"
exit 0
