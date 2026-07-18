#!/usr/bin/env bash
set -euo pipefail

CONTAINER="${SWFIPN_FRESHNESS_CONTAINER:-swfipn_acceptance-swfi2-backend-1}"
ORIGIN="${SWFIPN_FRESHNESS_ORIGIN:-https://dashboard.swfi.com}"
RECEIPT_DIR="${SWFIPN_FRESHNESS_RECEIPT_DIR:-/var/lib/swfipn/freshness}"

mkdir -p "$RECEIPT_DIR"
RAW_RECEIPT="$(mktemp)"
trap 'rm -f "$RAW_RECEIPT"' EXIT

HEALTH="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$CONTAINER")"
if [[ "$HEALTH" != "healthy" ]]; then
  echo "freshness audit requires a healthy backend container: $CONTAINER is $HEALTH" >&2
  exit 1
fi

IMAGE_ID="$(docker inspect --format '{{.Image}}' "$CONTAINER")"
docker exec --env HOME=/tmp/swfipn-freshness "$CONTAINER" \
  python /app/scripts/staleness_monitor.py --backend-origin "$ORIGIN" > "$RAW_RECEIPT"

SWFIPN_FRESHNESS_RAW_RECEIPT="$RAW_RECEIPT" \
SWFIPN_FRESHNESS_RECEIPT_DIR="$RECEIPT_DIR" \
SWFIPN_FRESHNESS_ORIGIN="$ORIGIN" \
SWFIPN_FRESHNESS_CONTAINER="$CONTAINER" \
SWFIPN_FRESHNESS_IMAGE_ID="$IMAGE_ID" \
python3 - <<'PY'
import hashlib
import json
import os
from datetime import datetime, timezone
from pathlib import Path

raw_path = Path(os.environ["SWFIPN_FRESHNESS_RAW_RECEIPT"])
receipt_dir = Path(os.environ["SWFIPN_FRESHNESS_RECEIPT_DIR"])
gate = json.loads(raw_path.read_text())
if gate.get("status") != "pass":
    raise SystemExit("staleness monitor did not pass")

generated_at = datetime.now(timezone.utc)
stamp = generated_at.strftime("%Y%m%dT%H%M%SZ")
receipt = {
    "schema_version": "swfipn.daily_freshness_audit.v1",
    "generated_at": generated_at.isoformat().replace("+00:00", "Z"),
    "status": "pass",
    "origin": os.environ["SWFIPN_FRESHNESS_ORIGIN"],
    "container": os.environ["SWFIPN_FRESHNESS_CONTAINER"],
    "image_id": os.environ["SWFIPN_FRESHNESS_IMAGE_ID"],
    "mode": "read_only_verification",
    "source_refresh_claimed": False,
    "gate_sha256": hashlib.sha256(raw_path.read_bytes()).hexdigest(),
    "gate": gate,
}
body = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
versioned = receipt_dir / f"swfipn-freshness-audit-{stamp}.json"
temporary = receipt_dir / f".{versioned.name}.tmp"
temporary.write_text(body)
temporary.chmod(0o640)
temporary.replace(versioned)

latest = receipt_dir / "latest.json"
latest_tmp = receipt_dir / ".latest.json.tmp"
latest_tmp.write_text(body)
latest_tmp.chmod(0o640)
latest_tmp.replace(latest)
print(json.dumps({"status": "pass", "receipt": str(versioned)}))
PY

find "$RECEIPT_DIR" -type f -name 'swfipn-freshness-audit-*.json' -mtime +35 -delete
