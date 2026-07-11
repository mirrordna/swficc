#!/usr/bin/env bash
set -euo pipefail

HOST="${SWFIPN_HOST:-swfipn-do}"
REMOTE_ROOT="${SWFIPN_PARITY_REMOTE_ROOT:-/opt/swfipn-acceptance/parity}"
MAPPING_RECEIPT="${SWFIPN_MAPPING_RECEIPT:-output/swfipn-full-universe-mapping-latest.json}"
LOCAL_OUTPUT="${SWFIPN_FIELD_PARITY_OUTPUT:-output/swfipn-record-field-parity-full-latest.json}"
BATCH_SIZE="${SWFIPN_FIELD_PARITY_LIMIT:-5000}"
STAMP="${SWFIPN_PARITY_RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)}"
REMOTE_RUN="$REMOTE_ROOT/runs/$STAMP"

if [[ ! -s "$MAPPING_RECEIPT" ]]; then
  echo "missing mapping receipt: $MAPPING_RECEIPT" >&2
  exit 2
fi

SNAPSHOTS=()
SNAPSHOT_LIST=$(mktemp)
trap 'rm -f "$SNAPSHOT_LIST"' EXIT
python3 - "$MAPPING_RECEIPT" >"$SNAPSHOT_LIST" <<'PY'
import json
import sys
from pathlib import Path

receipt = json.loads(Path(sys.argv[1]).read_text())
if receipt.get("status") != "pass":
    raise SystemExit(f"mapping receipt is not pass: {receipt.get('status')}")
families = {item.get("id"): item for item in receipt.get("families", [])}
for name in ("entities", "people", "transactions", "compass"):
    output = families.get(name, {}).get("output")
    if not output or not Path(output).is_file():
        raise SystemExit(f"missing {name} snapshot: {output}")
    print(output)
PY
while IFS= read -r snapshot; do
  SNAPSHOTS+=("$snapshot")
done <"$SNAPSHOT_LIST"

ssh "$HOST" mkdir -p "$REMOTE_RUN/input"
rsync -az --partial --stats "$MAPPING_RECEIPT" "$HOST:$REMOTE_RUN/mapping.json"
rsync -az --partial --stats tools/field-parity/swfipn_field_parity_remote.py "$HOST:$REMOTE_RUN/"
for snapshot in "${SNAPSHOTS[@]}"; do
  rsync -az --partial --stats "$snapshot" "$HOST:$REMOTE_RUN/input/"
done
ssh "$HOST" chown -R 10002:10002 "$REMOTE_RUN"

RESET_FLAG=""
if [[ -n "${SWFIPN_PARITY_RESET:-}" ]]; then
  RESET_FLAG="--reset"
fi

set +e
ssh "$HOST" bash -s -- "$REMOTE_RUN" "$BATCH_SIZE" "$RESET_FLAG" <<'REMOTE'
set -eu
remote_run="$1"
batch_size="$2"
reset_flag="${3:-}"
current=$(readlink -f /opt/swfipn-acceptance/current)
docker run --rm \
  --env-file "$current/.env.swfi2-backend" \
  -v "$remote_run:/work" \
  swfipn/swfi2-backend:acceptance \
  python /work/swfipn_field_parity_remote.py \
    --mapping-receipt /work/mapping.json \
    --snapshot-root /work/input \
    --output /work/receipt.json \
    --state /work/state.json \
    --batch-size "$batch_size" \
    $reset_flag
REMOTE
RUN_STATUS=$?
set -e

mkdir -p "$(dirname "$LOCAL_OUTPUT")" output/field-parity
scp "$HOST:$REMOTE_RUN/receipt.json" "output/field-parity/swfipn-record-field-parity-$STAMP.json"
scp "$HOST:$REMOTE_RUN/state.json" "output/field-parity/swfipn-record-field-parity-$STAMP-state.json"
python3 - "output/field-parity/swfipn-record-field-parity-$STAMP.json" "$LOCAL_OUTPUT" <<'PY'
import json
import shutil
import sys
from pathlib import Path

source = Path(sys.argv[1])
target = Path(sys.argv[2])
receipt = json.loads(source.read_text())
if receipt.get("status") != "pass" or receipt.get("partial_run") is True:
    raise SystemExit(f"run is not canonical: status={receipt.get('status')} partial={receipt.get('partial_run')}")
target.parent.mkdir(parents=True, exist_ok=True)
shutil.copy2(source, target)
print(json.dumps({"status": "pass", "receipt": str(target), "run_receipt": str(source)}, indent=2))
PY

exit "$RUN_STATUS"
