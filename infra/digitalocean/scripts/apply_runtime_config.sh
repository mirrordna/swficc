#!/usr/bin/env bash
set -euo pipefail

HOST="${SWFIPN_HOST:-}"
REMOTE_ROOT="${SWFIPN_REMOTE_ROOT:-/opt/swfipn-acceptance}"
SSH_OPTS="${SWFIPN_SSH_OPTS:--o StrictHostKeyChecking=accept-new}"
COMPOSE_PROJECT="${SWFIPN_COMPOSE_PROJECT:-swfipn_acceptance}"
OUT="${SWFIPN_RUNTIME_CONFIG_RECEIPT:-output/swfipn-runtime-config-apply-latest.json}"
RESTART="${SWFIPN_RESTART:-0}"

if [[ -z "$HOST" ]]; then
  echo "usage: SWFIPN_HOST=user@host [SWFIPN_RESTART=1] $0" >&2
  exit 2
fi

TMP_PAYLOAD="$(mktemp)"
trap 'rm -f "$TMP_PAYLOAD"' EXIT
chmod 600 "$TMP_PAYLOAD"

python3 - "$TMP_PAYLOAD" <<'PY'
import json
import os
import re
import sys

payload_path = sys.argv[1]

web_vars = [
    "SWFIPN_SWFI_SESSION_BRIDGE_SECRET",
    "SWFIPN_SWFI_SESSION_BRIDGE_ISSUER",
    "SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE",
    "SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED",
]
backend_vars = [
    "SWFI2_SENDGRID_API_KEY",
    "SENDGRID_API_KEY",
    "SWFI2_SENDGRID_FROM_EMAIL",
    "SENDGRID_FROM_EMAIL",
    "SWFI2_SENDGRID_FROM_NAME",
    "SENDGRID_FROM_NAME",
    "SWFI2_SENDGRID_SANDBOX_MODE",
    "SWFI2_SENDGRID_TIMEOUT_MS",
    "SWFI2_MSCI_COMPAT_KEY_IDS",
]

payload = {
    "schema_version": "swfipn.runtime_config_apply.v1",
    "web": {key: os.environ[key] for key in web_vars if os.environ.get(key, "")},
    "backend": {key: os.environ[key] for key in backend_vars if os.environ.get(key, "")},
}

errors = []
login_enabled = payload["web"].get("SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED", "").strip().lower() in {"1", "true", "yes", "on"}
if login_enabled and not payload["web"].get("SWFIPN_SWFI_SESSION_BRIDGE_SECRET"):
    errors.append("SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED requires SWFIPN_SWFI_SESSION_BRIDGE_SECRET")

sendgrid_key = payload["backend"].get("SWFI2_SENDGRID_API_KEY") or payload["backend"].get("SENDGRID_API_KEY")
sendgrid_from = payload["backend"].get("SWFI2_SENDGRID_FROM_EMAIL") or payload["backend"].get("SENDGRID_FROM_EMAIL")
if sendgrid_key and ("@" not in (sendgrid_from or "")):
    errors.append("SendGrid API key requires SWFI2_SENDGRID_FROM_EMAIL or SENDGRID_FROM_EMAIL")

msci_key_ids = payload["backend"].get("SWFI2_MSCI_COMPAT_KEY_IDS", "")
if msci_key_ids and not re.fullmatch(r"[0-9a-f]{12}(,[0-9a-f]{12})*", msci_key_ids):
    errors.append("SWFI2_MSCI_COMPAT_KEY_IDS must be a comma-separated list of 12-character lowercase hex key IDs")

if not payload["web"] and not payload["backend"]:
    errors.append("no runtime config environment variables were provided")

if errors:
    print(json.dumps({"status": "blocked", "errors": errors}, indent=2), file=sys.stderr)
    sys.exit(2)

with open(payload_path, "w", encoding="utf-8") as handle:
    json.dump(payload, handle)
PY

REMOTE_PAYLOAD="/tmp/swfipn-runtime-config-$(date -u +%Y%m%dT%H%M%SZ)-$$.json"
scp $SSH_OPTS "$TMP_PAYLOAD" "$HOST:$REMOTE_PAYLOAD" >/dev/null

mkdir -p "$(dirname "$OUT")"

ssh $SSH_OPTS "$HOST" \
  "REMOTE_ROOT='$REMOTE_ROOT' REMOTE_PAYLOAD='$REMOTE_PAYLOAD' COMPOSE_PROJECT='$COMPOSE_PROJECT' SWFIPN_RESTART='$RESTART' python3 -" >"$OUT" <<'PY'
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime, timezone

remote_root = Path(os.environ["REMOTE_ROOT"])
payload_path = Path(os.environ["REMOTE_PAYLOAD"])
restart = os.environ.get("SWFIPN_RESTART", "0").lower() in {"1", "true", "yes", "on"}
compose_project = os.environ.get("COMPOSE_PROJECT", "swfipn_acceptance")

try:
    payload = json.loads(payload_path.read_text(encoding="utf-8"))
finally:
    try:
        payload_path.unlink()
    except FileNotFoundError:
        pass

shared = remote_root / "shared"
web_env = shared / ".env.swfipn-web"
backend_env = shared / ".env.swfi2-backend"

def update_env(path: Path, updates: dict[str, str]) -> list[str]:
    path.parent.mkdir(parents=True, exist_ok=True)
    existing_lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(updates)
    new_lines: list[str] = []
    for line in existing_lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("#") or "=" not in line:
            new_lines.append(line)
            continue
        key = line.split("=", 1)[0]
        if key in remaining:
            value = remaining.pop(key)
            new_lines.append(f"{key}={value}")
        else:
            new_lines.append(line)
    if remaining and new_lines and new_lines[-1] != "":
        new_lines.append("")
    for key in sorted(remaining):
        new_lines.append(f"{key}={remaining[key]}")
    path.write_text("\n".join(new_lines).rstrip() + "\n", encoding="utf-8")
    path.chmod(0o600)
    return sorted(updates)

web_keys = update_env(web_env, payload.get("web", {})) if payload.get("web") else []
backend_keys = update_env(backend_env, payload.get("backend", {})) if payload.get("backend") else []

restart_result = {"requested": restart, "status": "skipped"}
if restart:
    current = (remote_root / "current").resolve()
    if not (current / "compose.acceptance.yml").exists():
        restart_result = {"requested": True, "status": "blocked", "reason": "compose.acceptance.yml_missing"}
    else:
        proc = subprocess.run(
            ["docker", "compose", "-p", compose_project, "-f", "compose.acceptance.yml", "up", "-d"],
            cwd=str(current),
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            timeout=240,
        )
        restart_result = {
            "requested": True,
            "status": "pass" if proc.returncode == 0 else "failed",
            "returncode": proc.returncode,
            "stdout_tail": proc.stdout[-1200:],
            "stderr_tail": proc.stderr[-1200:],
        }

receipt = {
    "schema_version": "swfipn.runtime_config_apply.v1",
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "status": "pass" if restart_result["status"] in {"skipped", "pass"} else "blocked",
    "remote_root": str(remote_root),
    "web_env": str(web_env),
    "backend_env": str(backend_env),
    "applied_keys": {
        "web": web_keys,
        "backend": backend_keys,
    },
    "values_redacted": True,
    "restart": restart_result,
}
print(json.dumps(receipt, indent=2, sort_keys=True))
PY

python3 - "$OUT" <<'PY'
import json
import sys
from pathlib import Path

path = Path(sys.argv[1])
receipt = json.loads(path.read_text(encoding="utf-8"))
print(json.dumps({
    "status": receipt.get("status"),
    "applied_keys": receipt.get("applied_keys"),
    "restart": receipt.get("restart", {}).get("status"),
    "receipt": str(path),
}, indent=2))
PY
