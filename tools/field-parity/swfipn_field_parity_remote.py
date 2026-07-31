#!/usr/bin/env python3
"""Exhaustive SWFIPN mapping-to-Mongo field parity beside the data runtime.

The source side is a frozen, canonical full-universe NDJSON snapshot. Mongo is
queried read-only in batches from the DigitalOcean backend image. Checkpoints
are written after every batch so a long run can resume without weakening the
acceptance claim.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import sys
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import date, datetime, timezone
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable


DISCLOSURE_GAP = re.compile(r"^(not disclosed|undisclosed|n/a|null|none|unknown)?$", re.I)
HEX_ID = re.compile(r"^[a-f0-9]{24}$", re.I)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def normalized_text(value: Any) -> str:
    return re.sub(r"\s+", " ", text(value).replace("&amp;", "&").replace("’", "'")).lower()


def is_disclosure_gap(value: Any) -> bool:
    return bool(DISCLOSURE_GAP.fullmatch(text(value)))


def first_value(item: dict[str, Any], names: list[str]) -> Any:
    for name in names:
        value = item.get(name)
        if value is not None and text(value) != "":
            return value
    return None


def scalar_number(value: Any) -> float:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    if isinstance(value, (int, float, Decimal)):
        number = float(value)
        return number if math.isfinite(number) else math.nan
    if hasattr(value, "to_decimal"):
        try:
            return float(value.to_decimal())
        except Exception:
            return math.nan
    clean = re.sub(r"[^0-9.\-]", "", text(value))
    if clean == "":
        return math.nan
    try:
        number = float(clean)
        return number if math.isfinite(number) else math.nan
    except ValueError:
        return math.nan


def scalar_date(value: Any) -> str:
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).date().isoformat() if value.tzinfo else value.date().isoformat()
    if isinstance(value, date):
        return value.isoformat()
    if value.__class__.__name__ == "DatetimeMS":
        return civil_date_from_millis(int(value))
    if isinstance(value, dict) and "$date" in value:
        raw = value["$date"]
        if isinstance(raw, dict) and "$numberLong" in raw:
            try:
                return datetime.fromtimestamp(int(raw["$numberLong"]) / 1000, timezone.utc).date().isoformat()
            except (TypeError, ValueError, OverflowError):
                return ""
        return text(raw)[:10]
    return text(value)[:10]


def civil_date_from_millis(milliseconds: int) -> str:
    """Convert BSON milliseconds to a Gregorian date without Python's year cap."""
    days = milliseconds // 86_400_000
    shifted = days + 719468
    era = (shifted if shifted >= 0 else shifted - 146096) // 146097
    day_of_era = shifted - era * 146097
    year_of_era = (day_of_era - day_of_era // 1460 + day_of_era // 36524 - day_of_era // 146096) // 365
    year = year_of_era + era * 400
    day_of_year = day_of_era - (365 * year_of_era + year_of_era // 4 - year_of_era // 100)
    month_prime = (5 * day_of_year + 2) // 153
    day = day_of_year - (153 * month_prime + 2) // 5 + 1
    month = month_prime + 3 if month_prime < 10 else month_prime - 9
    year += 1 if month <= 2 else 0
    return f"{year:04d}-{month:02d}-{day:02d}"


def first_named(value: Any) -> str:
    if isinstance(value, list) and value and isinstance(value[0], dict):
        return text(value[0].get("name"))
    return ""


def first_positive(item: dict[str, Any], names: list[str]) -> Any:
    fallback = None
    for name in names:
        value = item.get(name)
        if value is None or text(value) == "":
            continue
        if fallback is None:
            fallback = value
        number = scalar_number(value)
        if math.isfinite(number) and number > 0:
            return value
    return fallback


@dataclass(frozen=True)
class FieldSpec:
    field_id: str
    kind: str
    live: Callable[[dict[str, Any]], Any]
    source: Callable[[dict[str, Any]], Any]
    skip_disclosure_gap: bool = False
    allow_includes: bool = False


def string_field(field_id: str, live_names: list[str], source_names: list[str] | None = None) -> FieldSpec:
    source_names = source_names or live_names
    return FieldSpec(
        field_id,
        "string",
        lambda row: first_value(row, live_names),
        lambda doc: first_value(doc, source_names),
        skip_disclosure_gap=True,
    )


def number_field(field_id: str, live_names: list[str], source_names: list[str] | None = None) -> FieldSpec:
    source_names = source_names or live_names
    return FieldSpec(
        field_id,
        "number",
        lambda row: first_value(row, live_names),
        lambda doc: first_value(doc, source_names),
    )


def date_field(field_id: str, live_names: list[str], source_names: list[str] | None = None) -> FieldSpec:
    source_names = source_names or live_names
    return FieldSpec(
        field_id,
        "date",
        lambda row: first_value(row, live_names),
        lambda doc: first_value(doc, source_names),
        skip_disclosure_gap=True,
    )


SPECS: dict[str, dict[str, Any]] = {
    "entities": {
        "mongo_collection": "entities",
        "projection": {"_id": 1, "name": 1, "type": 1, "country": 1, "region": 1, "assets": 1, "managedAssets": 1},
        "fields": [
            string_field("name", ["name"]),
            string_field("type", ["type"]),
            string_field("country", ["country"]),
            string_field("region", ["region"]),
            FieldSpec("assets", "number", lambda row: first_value(row, ["assets", "aum"]), lambda doc: first_positive(doc, ["assets", "managedAssets"])),
        ],
    },
    "people": {
        "mongo_collection": "people",
        "projection": {"_id": 1, "firstName": 1, "middleName": 1, "lastName": 1, "suffix": 1, "name": 1, "country": 1, "region": 1},
        "fields": [
            FieldSpec(
                "name",
                "string",
                lambda row: first_value(row, ["name"]),
                lambda doc: " ".join(text(doc.get(name)) for name in ["firstName", "middleName", "lastName", "suffix"] if text(doc.get(name))) or text(doc.get("name")),
                allow_includes=True,
            ),
            string_field("country", ["country"]),
            string_field("region", ["region"]),
        ],
    },
    "transactions": {
        "mongo_collection": "transactions",
        "projection": {"_id": 1, "name": 1, "title": 1, "country": 1, "region": 1, "industry": 1, "investmentType": 1, "amount": 1, "announcedAt": 1, "closedAt": 1, "buyerEntities": {"$slice": 1}, "sellerEntities": {"$slice": 1}},
        "fields": [
            string_field("name", ["name", "title"], ["name", "title"]),
            string_field("country", ["country"]),
            string_field("region", ["region"]),
            string_field("industry", ["industry"]),
            string_field("investment_type", ["investment_type"], ["investmentType"]),
            number_field("amount", ["amount", "capital", "value"], ["amount"]),
            date_field("closed_at", ["closed_at", "activity_date", "relevant_date"], ["closedAt", "announcedAt"]),
            FieldSpec("buyer_entity", "string", lambda row: first_value(row, ["buyer_entity", "institution"]), lambda doc: first_named(doc.get("buyerEntities")), skip_disclosure_gap=True),
            FieldSpec("seller_entity", "string", lambda row: first_value(row, ["seller_entity"]), lambda doc: first_named(doc.get("sellerEntities")), skip_disclosure_gap=True),
        ],
    },
    "compass": {
        "mongo_collection": "compass",
        "projection": {"_id": 1, "name": 1, "title": 1, "type": 1, "entityName": 1, "country": 1, "region": 1, "investmentType": 1, "amount": 1, "dueAt": 1, "postedAt": 1},
        "fields": [
            string_field("name", ["name", "title"], ["name", "title"]),
            string_field("type", ["type"]),
            string_field("institution", ["institution"], ["entityName"]),
            string_field("country", ["country"]),
            string_field("region", ["region"]),
            string_field("investment_type", ["investment_type", "strategy", "asset_class_or_strategy"], ["investmentType"]),
            number_field("amount", ["amount", "value"], ["amount"]),
            date_field("due_at", ["due_at", "deadline", "relevant_date"], ["dueAt"]),
            date_field("posted_at", ["posted_at"], ["postedAt"]),
        ],
    },
}


def compare_field(spec: FieldSpec, row: dict[str, Any], doc: dict[str, Any]) -> dict[str, Any]:
    live = spec.live(row)
    source = spec.source(doc)
    if spec.skip_disclosure_gap:
        live_gap = is_disclosure_gap(live)
        source_gap = is_disclosure_gap(source)
        if live_gap and source_gap:
            return {"field": spec.field_id, "status": "skipped", "reason": "both_missing"}
        if live_gap != source_gap:
            return {"field": spec.field_id, "status": "mismatch", "reason": "one_side_missing", "live": text(live), "source": text(source)}
    if spec.kind == "number":
        live_number = scalar_number(live)
        source_number = scalar_number(source)
        if math.isnan(live_number) and math.isnan(source_number):
            return {"field": spec.field_id, "status": "skipped", "reason": "both_missing"}
        if math.isnan(live_number) != math.isnan(source_number):
            return {"field": spec.field_id, "status": "mismatch", "reason": "one_side_missing", "live": text(live), "source": text(source)}
        if live_number == source_number:
            return {"field": spec.field_id, "status": "match"}
        if math.isfinite(live_number) and math.isfinite(source_number) and abs(live_number - source_number) < 1:
            return {"field": spec.field_id, "status": "allowed_normalization", "reason": "sub_dollar_numeric_precision"}
        return {"field": spec.field_id, "status": "mismatch", "live": text(live), "source": text(source)}
    if spec.kind == "date":
        live_date = scalar_date(live)
        source_date = scalar_date(source)
        if not live_date and not source_date:
            return {"field": spec.field_id, "status": "skipped", "reason": "both_missing"}
        if live_date == source_date:
            return {"field": spec.field_id, "status": "match"}
        return {"field": spec.field_id, "status": "mismatch", "live": live_date, "source": source_date}
    live_text = normalized_text(live)
    source_text = normalized_text(source)
    if not live_text and not source_text:
        return {"field": spec.field_id, "status": "skipped", "reason": "both_missing"}
    if live_text == source_text:
        return {"field": spec.field_id, "status": "match"}
    if spec.allow_includes and live_text and source_text and (live_text in source_text or source_text in live_text):
        return {"field": spec.field_id, "status": "allowed_normalization", "reason": "name_variant"}
    return {"field": spec.field_id, "status": "mismatch", "live": text(live), "source": text(source)}


@dataclass
class CollectionState:
    count: int = 0
    mongo_count: int = 0
    checked: int = 0
    matched: int = 0
    mismatched: int = 0
    missing_source_record: int = 0
    blocked: int = 0
    batches: int = 0
    byte_offset: int = 0
    completed: bool = False
    field_mismatches: dict[str, int] = field(default_factory=dict)


def atomic_json(path: Path, value: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(path.suffix + f".{os.getpid()}.tmp")
    temporary.write_text(json.dumps(value, indent=2, default=str) + "\n")
    temporary.replace(path)


def load_mapping(path: Path) -> dict[str, Any]:
    mapping = json.loads(path.read_text())
    if mapping.get("status") != "pass":
        raise RuntimeError(f"mapping_receipt_not_pass:{mapping.get('status', 'missing')}")
    return mapping


def load_state(path: Path, mapping: dict[str, Any], reset: bool) -> dict[str, Any]:
    identity = {"mapping_run_id": mapping.get("run_id"), "mapping_generated_at": mapping.get("generated_at")}
    if not reset and path.exists():
        state = json.loads(path.read_text())
        if all(state.get(key) == value for key, value in identity.items()):
            state.setdefault("data_anomalies", [])
            return state
    return {**identity, "started_at": utc_now(), "collections": {}, "failures": [], "data_anomalies": []}


def collection_state(state: dict[str, Any], name: str, expected: int) -> CollectionState:
    raw = state["collections"].get(name, {})
    raw["count"] = expected
    return CollectionState(**{key: raw.get(key, value) for key, value in asdict(CollectionState()).items()})


def save_state(path: Path, state: dict[str, Any], name: str, collection: CollectionState) -> None:
    state["collections"][name] = asdict(collection)
    state["updated_at"] = utc_now()
    atomic_json(path, state)


def family_file(family: dict[str, Any], snapshot_root: Path) -> Path:
    return snapshot_root / Path(text(family.get("output"))).name


def batches(stream: Any, start_offset: int, batch_size: int):
    stream.seek(start_offset)
    batch: list[tuple[str, dict[str, Any]]] = []
    while True:
        line = stream.readline()
        if not line:
            if batch:
                yield batch, stream.tell()
            break
        try:
            record = json.loads(line)
        except json.JSONDecodeError as error:
            yield [("", {"_parse_error": str(error)})], stream.tell()
            continue
        record_id = text(record.get("id")).lower()
        source_fields = record.get("source_fields")
        if not HEX_ID.fullmatch(record_id) or not isinstance(source_fields, dict):
            yield [(record_id, {"_parse_error": "invalid_id_or_source_fields"})], stream.tell()
            continue
        batch.append((record_id, source_fields))
        if len(batch) >= batch_size:
            yield batch, stream.tell()
            batch = []


def make_receipt(mapping_path: Path, mapping: dict[str, Any], state: dict[str, Any], selected: list[str], batch_size: int, partial_run: bool, status_override: str | None = None) -> dict[str, Any]:
    collections = state.get("collections", {})
    total_count = sum(int(collections.get(name, {}).get("count", 0)) for name in selected)
    total_checked = sum(int(collections.get(name, {}).get("checked", 0)) for name in selected)
    total_failed = sum(
        int(collections.get(name, {}).get("mismatched", 0))
        + int(collections.get(name, {}).get("missing_source_record", 0))
        + int(collections.get(name, {}).get("blocked", 0))
        for name in selected
    )
    complete = total_count > 0 and total_checked == total_count and all(collections.get(name, {}).get("completed") for name in selected)
    count_drifts = [
        {
            "collection": name,
            "mapping_count": int(collections.get(name, {}).get("count", 0)),
            "mongo_count": int(collections.get(name, {}).get("mongo_count", 0)),
        }
        for name in selected
        if int(collections.get(name, {}).get("mongo_count", 0)) != int(collections.get(name, {}).get("count", 0))
    ]
    blocking_count_drift = any(drift["mongo_count"] < drift["mapping_count"] for drift in count_drifts)
    status = status_override or ("fail" if total_failed or blocking_count_drift else "partial_pass" if partial_run else "pass" if complete else "fail")
    return {
        "schema_version": "swfipn.record_field_parity_full.v2",
        "status": status,
        "generated_at": utc_now(),
        "scope": "full required-field parity from frozen SWFIPN mapping snapshot to read-only production Mongo by source id",
        "verification_mode": "digitalocean_pymongo_batched_checkpointed",
        "mapping_receipt": str(mapping_path),
        "mapping_run_id": mapping.get("run_id"),
        "mapping_generated_at": mapping.get("generated_at"),
        "partial_run": partial_run,
        "partial_reason": "collection_or_batch_cap" if partial_run else "",
        "mongo": {"database": os.environ.get("SWFI_MONGO_DB", "swfi"), "source": "runtime:SWFI_MONGO_URI", "uri_redacted": True, "read_only": True},
        "batch_size": batch_size,
        "collections_requested": selected,
        "totals": {"count": total_count, "checked": total_checked, "failed": total_failed},
        "collections": collections,
        "count_drifts": count_drifts,
        "warnings": [
            {"collection": drift["collection"], "id": "post_snapshot_count_growth", **drift}
            for drift in count_drifts
            if drift["mongo_count"] > drift["mapping_count"]
        ],
        "data_anomalies": state.get("data_anomalies", [])[:1000],
        "failures": (state.get("failures", []) + [
            {"collection": drift["collection"], "id": "mapping_mongo_count_drift", **drift}
            for drift in count_drifts
            if drift["mongo_count"] < drift["mapping_count"]
        ])[:1000],
    }


def run(args: argparse.Namespace) -> int:
    from bson import ObjectId
    from bson.codec_options import DatetimeConversion
    from pymongo import MongoClient

    mapping_path = Path(args.mapping_receipt).resolve()
    snapshot_root = Path(args.snapshot_root).resolve()
    output_path = Path(args.output).resolve()
    state_path = Path(args.state).resolve()
    mapping = load_mapping(mapping_path)
    selected = [name.strip() for name in args.collections.split(",") if name.strip() in SPECS]
    partial_run = bool(args.max_batches or set(selected) != set(SPECS))
    state = load_state(state_path, mapping, args.reset)
    uri = os.environ.get("SWFI_MONGO_URI") or os.environ.get("SWFIPN_RECORD_PARITY_MONGO_URI")
    if not uri:
        receipt = make_receipt(mapping_path, mapping, state, selected, args.batch_size, partial_run, "blocked")
        receipt["failures"] = [{"id": "mongo_uri_unavailable"}]
        atomic_json(output_path, receipt)
        return 2
    client = MongoClient(
        uri,
        serverSelectionTimeoutMS=args.timeout_ms,
        connectTimeoutMS=args.timeout_ms,
        socketTimeoutMS=args.timeout_ms,
        datetime_conversion=DatetimeConversion.DATETIME_AUTO,
    )
    database = client[os.environ.get("SWFI_MONGO_DB", "swfi")]
    client.admin.command("ping")
    family_by_id = {family.get("id"): family for family in mapping.get("families", [])}
    try:
        for name in selected:
            family = family_by_id.get(name)
            if not family:
                state["failures"].append({"collection": name, "id": "mapping_family_missing"})
                continue
            expected = int(family.get("rows_written") or family.get("rows_seen") or family.get("source_total") or 0)
            current = collection_state(state, name, expected)
            if current.completed:
                continue
            source_path = family_file(family, snapshot_root)
            if not source_path.exists():
                current.blocked += expected or 1
                state["failures"].append({"collection": name, "id": "snapshot_missing", "path": str(source_path)})
                save_state(state_path, state, name, current)
                continue
            spec = SPECS[name]
            collection = database[spec["mongo_collection"]]
            current.mongo_count = collection.count_documents({}, maxTimeMS=args.timeout_ms)
            with source_path.open("rb") as stream:
                for batch, next_offset in batches(stream, current.byte_offset, args.batch_size):
                    if args.max_batches and current.batches >= args.max_batches:
                        break
                    invalid = [(record_id, row) for record_id, row in batch if "_parse_error" in row]
                    if invalid:
                        current.blocked += len(invalid)
                        state["failures"].extend({"collection": name, "id": record_id or "invalid_record", "reason": row["_parse_error"]} for record_id, row in invalid)
                    valid = [(record_id, row) for record_id, row in batch if "_parse_error" not in row]
                    documents = collection.find({"_id": {"$in": [ObjectId(record_id) for record_id, _ in valid]}}, spec["projection"])
                    by_id = {str(document["_id"]): document for document in documents}
                    for record_id, row in valid:
                        current.checked += 1
                        document = by_id.get(record_id)
                        if document is None:
                            current.missing_source_record += 1
                            if len(state["failures"]) < 1000:
                                state["failures"].append({"collection": name, "id": record_id, "reason": "missing_source_record"})
                            continue
                        for field_name, value in document.items():
                            if value.__class__.__name__ != "DatetimeMS":
                                continue
                            if len(state["data_anomalies"]) < 1000:
                                state["data_anomalies"].append({
                                    "collection": name,
                                    "id": record_id,
                                    "field": field_name,
                                    "reason": "out_of_range_bson_datetime",
                                    "milliseconds": int(value),
                                })
                        comparisons = [compare_field(field_spec, row, document) for field_spec in spec["fields"]]
                        mismatches = [comparison for comparison in comparisons if comparison["status"] == "mismatch"]
                        if mismatches:
                            current.mismatched += 1
                            counter = Counter(current.field_mismatches)
                            counter.update(comparison["field"] for comparison in mismatches)
                            current.field_mismatches = dict(counter)
                            if len(state["failures"]) < 1000:
                                state["failures"].append({"collection": name, "id": record_id, "reason": "field_mismatch", "mismatches": mismatches})
                        else:
                            current.matched += 1
                    current.batches += 1
                    current.byte_offset = next_offset
                    save_state(state_path, state, name, current)
                    print(f"[field-parity:remote] {name} batch={current.batches} checked={current.checked}/{expected}", file=sys.stderr, flush=True)
            if not args.max_batches or current.batches < args.max_batches:
                current.completed = current.checked + current.blocked >= expected
            save_state(state_path, state, name, current)
    except Exception as error:
        state["failures"].append({"id": "runtime_error", "reason": f"{type(error).__name__}:{str(error)[:500]}"})
        atomic_json(output_path, make_receipt(mapping_path, mapping, state, selected, args.batch_size, partial_run, "blocked"))
        raise
    receipt = make_receipt(mapping_path, mapping, state, selected, args.batch_size, partial_run)
    atomic_json(output_path, receipt)
    print(json.dumps({"status": receipt["status"], "totals": receipt["totals"], "output": str(output_path)}, indent=2))
    return 0 if receipt["status"] == "pass" else 1


def self_test() -> int:
    entity = {"name": "Test &amp; Fund", "type": "SWF", "assets": 100}
    mongo_entity = {"name": "Test & Fund", "type": "SWF", "assets": 100.0}
    assert compare_field(SPECS["entities"]["fields"][0], entity, mongo_entity)["status"] == "match"
    assert compare_field(SPECS["entities"]["fields"][4], entity, mongo_entity)["status"] == "match"
    person = {"name": "Yasir Al-Rumayyan"}
    mongo_person = {"firstName": "Yasir", "lastName": "Al-Rumayyan"}
    assert compare_field(SPECS["people"]["fields"][0], person, mongo_person)["status"] == "match"
    transaction = {"closed_at": "2026-07-11", "buyer_entity": "Not disclosed"}
    mongo_transaction = {"closedAt": datetime(2026, 7, 11), "buyerEntities": []}
    assert compare_field(SPECS["transactions"]["fields"][6], transaction, mongo_transaction)["status"] == "match"
    assert compare_field(SPECS["transactions"]["fields"][7], transaction, mongo_transaction)["status"] == "skipped"
    assert compare_field(SPECS["entities"]["fields"][0], {"name": "A"}, {"name": "B"})["status"] == "mismatch"
    assert compare_field(SPECS["entities"]["fields"][4], {}, {"assets": 0})["status"] == "mismatch"
    assert compare_field(SPECS["entities"]["fields"][4], {"assets": 0}, {})["status"] == "mismatch"
    assert compare_field(SPECS["entities"]["fields"][2], {}, {"country": "UAE"})["status"] == "mismatch"
    assert compare_field(SPECS["entities"]["fields"][2], {}, {})["status"] == "skipped"
    assert civil_date_from_millis(569510352000000) == "20017-01-24"
    print(json.dumps({"status": "pass", "checks": 11}))
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--mapping-receipt")
    parser.add_argument("--snapshot-root")
    parser.add_argument("--output", default="/work/field-parity-receipt.json")
    parser.add_argument("--state", default="/work/field-parity-state.json")
    parser.add_argument("--collections", default=",".join(SPECS))
    parser.add_argument("--batch-size", type=int, default=5000)
    parser.add_argument("--timeout-ms", type=int, default=120000)
    parser.add_argument("--max-batches", type=int, default=0)
    parser.add_argument("--reset", action="store_true")
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()
    if not args.self_test and (not args.mapping_receipt or not args.snapshot_root):
        parser.error("--mapping-receipt and --snapshot-root are required")
    if not 1 <= args.batch_size <= 10000:
        parser.error("--batch-size must be between 1 and 10000")
    return args


if __name__ == "__main__":
    arguments = parse_args()
    raise SystemExit(self_test() if arguments.self_test else run(arguments))
