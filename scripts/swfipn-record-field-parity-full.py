#!/usr/bin/env python3
import datetime as dt
import json
import math
import os
import re
import sys
from pathlib import Path

from bson import ObjectId
from bson.codec_options import DatetimeConversion
from pymongo import MongoClient


REPO_ROOT = Path.cwd()
OUTPUT_DIR = REPO_ROOT / "output"
RECEIPT_PATH = OUTPUT_DIR / "swfipn-record-field-parity-full-latest.json"
MAPPING_RECEIPT_PATH = OUTPUT_DIR / "swfipn-full-universe-mapping-latest.json"
PAGE_LIMIT = max(1, min(int(os.environ.get("SWFIPN_FIELD_PARITY_LIMIT", "1000")), 5000))
MONGO_DB = os.environ.get("SWFIPN_RECORD_PARITY_MONGO_DB", "swfi")
MONGO_URI = (
    os.environ.get("SWFIPN_RECORD_PARITY_MONGO_URI")
    or os.environ.get("SWFI_MONGODB_URI")
    or os.environ.get("MONGODB_URI")
)


def text(value):
    return str(value if value is not None else "").strip()


def normalized_text(value):
    return re.sub(r"\s+", " ", text(value).replace("&amp;", "&").replace("’", "'")).lower()


def disclosure_gap(value):
    return re.match(r"^(not disclosed|undisclosed|n/a|null|none|unknown)?$", text(value), re.I) is not None


def scalar_number(value):
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    parsed = re.sub(r"[^0-9.-]", "", text(value))
    try:
        return float(parsed)
    except ValueError:
        return math.nan


def scalar_date(value):
    if isinstance(value, dt.datetime):
        return value.date().isoformat()
    if isinstance(value, dt.date):
        return value.isoformat()
    return text(value)[:10]


def first_value(doc, fields):
    for field in fields:
        value = doc.get(field)
        if value is not None and text(value) != "":
            return value
    return None


def source_number_value(doc, fields):
    zero_value = None
    for field in fields:
        value = doc.get(field)
        if value is None or text(value) == "":
            continue
        num = scalar_number(value)
        if not math.isnan(num) and num != 0:
            return value
        if zero_value is None:
            zero_value = value
    return zero_value


def first_array_item(value):
    return value[0] if isinstance(value, list) and value else {}


def compare_string(field_id, live, source, skip_gap=True, allow_includes=False):
    if skip_gap and (disclosure_gap(live) or disclosure_gap(source)):
        return {"field": field_id, "status": "skipped", "reason": "disclosure_gap"}
    live_text = normalized_text(live)
    source_text = normalized_text(source)
    if not live_text and not source_text:
        return {"field": field_id, "status": "skipped", "reason": "both_missing"}
    if live_text == source_text:
        return {"field": field_id, "status": "match"}
    if allow_includes and live_text and source_text and (live_text in source_text or source_text in live_text):
        return {"field": field_id, "status": "allowed_normalization", "reason": "name_variant"}
    return {"field": field_id, "status": "mismatch", "live": text(live), "source": text(source)}


def compare_number(field_id, live, source, *, zero_is_undisclosed=False):
    live_num = scalar_number(live)
    source_num = scalar_number(source)
    if math.isnan(live_num) and math.isnan(source_num):
        return {"field": field_id, "status": "skipped", "reason": "both_missing"}
    if zero_is_undisclosed and math.isnan(live_num) and source_num == 0:
        return {"field": field_id, "status": "allowed_normalization", "reason": "source_zero_is_undisclosed_sentinel"}
    if math.isnan(live_num) != math.isnan(source_num):
        return {"field": field_id, "status": "mismatch", "reason": "one_side_missing", "live": text(live), "source": text(source)}
    if live_num == source_num:
        return {"field": field_id, "status": "match"}
    if not math.isnan(live_num) and not math.isnan(source_num) and abs(live_num - source_num) < 1:
        return {"field": field_id, "status": "allowed_normalization", "reason": "sub_dollar_numeric_precision"}
    return {"field": field_id, "status": "mismatch", "live": text(live), "source": text(source)}


def compare_date(field_id, live, source, skip_gap=True):
    if skip_gap and (disclosure_gap(live) or disclosure_gap(source)):
        return {"field": field_id, "status": "skipped", "reason": "disclosure_gap"}
    live_date = scalar_date(live)
    source_date = scalar_date(source)
    if not live_date and not source_date:
        return {"field": field_id, "status": "skipped", "reason": "both_missing"}
    if live_date == source_date:
        return {"field": field_id, "status": "match"}
    return {"field": field_id, "status": "mismatch", "live": live_date, "source": source_date}


SPECS = {
    "entities": {
        "collection": "entities",
        "projection": None,
        "compare": lambda row, doc: [
            compare_string("name", row.get("name"), doc.get("name")),
            compare_string("type", row.get("type"), doc.get("type")),
            compare_string("country", row.get("country"), doc.get("country")),
            compare_string("region", row.get("region"), doc.get("region")),
            compare_number("assets", first_value(row, ["assets", "aum"]), source_number_value(doc, ["assets", "managedAssets"]), zero_is_undisclosed=True),
        ],
    },
    "people": {
        "collection": "people",
        "projection": None,
        "compare": lambda row, doc: [
            compare_string(
                "name",
                row.get("name"),
                " ".join([text(doc.get("firstName")), text(doc.get("middleName")), text(doc.get("lastName")), text(doc.get("suffix"))]).strip()
                or doc.get("name"),
                False,
                True,
            ),
            compare_string("country", row.get("country"), doc.get("country")),
            compare_string("region", row.get("region"), doc.get("region")),
        ],
    },
    "transactions": {
        "collection": "transactions",
        "projection": {
            "_id": 1,
            "name": 1,
            "title": 1,
            "country": 1,
            "region": 1,
            "industry": 1,
            "investmentType": 1,
            "amount": 1,
            "announcedAt": 1,
            "closedAt": 1,
            "buyerEntities": {"$slice": 1},
            "sellerEntities": {"$slice": 1},
        },
        "compare": lambda row, doc: [
            compare_string("name", row.get("name") or row.get("title"), doc.get("name") or doc.get("title")),
            compare_string("country", row.get("country"), doc.get("country")),
            compare_string("region", row.get("region"), doc.get("region")),
            compare_string("industry", row.get("industry"), doc.get("industry")),
            compare_string("investment_type", row.get("investment_type"), doc.get("investmentType")),
            compare_number("amount", first_value(row, ["amount", "capital", "value"]), doc.get("amount"), zero_is_undisclosed=True),
            compare_date("closed_at", row.get("closed_at") or row.get("activity_date") or row.get("relevant_date"), doc.get("closedAt") or doc.get("announcedAt")),
            compare_string("buyer_entity", row.get("buyer_entity") or row.get("institution"), first_array_item(doc.get("buyerEntities")).get("name")),
            compare_string("seller_entity", row.get("seller_entity"), first_array_item(doc.get("sellerEntities")).get("name")),
        ],
    },
    "compass": {
        "collection": "compass",
        "projection": None,
        "compare": lambda row, doc: [
            compare_string("name", row.get("name") or row.get("title"), doc.get("name") or doc.get("title")),
            compare_string("type", row.get("type"), doc.get("type")),
            compare_string("institution", row.get("institution"), doc.get("entityName")),
            compare_string("country", row.get("country"), doc.get("country")),
            compare_string("region", row.get("region"), doc.get("region")),
            compare_string("investment_type", row.get("investment_type") or row.get("strategy") or row.get("asset_class_or_strategy"), doc.get("investmentType")),
            compare_number("amount", first_value(row, ["amount", "value"]), doc.get("amount"), zero_is_undisclosed=True),
            compare_date("due_at", row.get("due_at") or row.get("deadline") or row.get("relevant_date"), doc.get("dueAt")),
            compare_date("posted_at", row.get("posted_at"), doc.get("postedAt")),
        ],
    },
}


def load_mapping():
    receipt = json.loads(MAPPING_RECEIPT_PATH.read_text())
    if receipt.get("status") != "pass":
        raise RuntimeError(f"mapping_receipt_not_pass:{receipt.get('status')}")
    return receipt


def iter_records(path):
    with Path(path).open() as handle:
        for line in handle:
            clean = line.strip()
            if clean:
                yield json.loads(clean)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    if not MONGO_URI:
        raise RuntimeError("mongo_uri_unavailable")
    mapping = load_mapping()
    client = MongoClient(MONGO_URI, datetime_conversion=DatetimeConversion.DATETIME_AUTO)
    db = client[MONGO_DB]
    family_by_id = {family["id"]: family for family in mapping.get("families", [])}
    state = {
        key: {"count": 0, "checked": 0, "matched": 0, "mismatched": 0, "missing_source_record": 0, "blocked": 0, "pages": 0}
        for key in SPECS
    }
    failures = []
    for family_id, spec in SPECS.items():
        family = family_by_id.get(family_id)
        if not family:
            continue
        file_path = Path(family.get("output", ""))
        state[family_id]["count"] = int(family.get("rows_written") or family.get("rows_seen") or family.get("source_total") or 0)
        batch = []
        for record in iter_records(file_path):
            record_id = text(record.get("id")).lower()
            source_fields = record.get("source_fields")
            if not re.match(r"^[a-f0-9]{24}$", record_id) or not isinstance(source_fields, dict):
                state[family_id]["blocked"] += 1
                if len(failures) < 1000:
                    failures.append({"collection": family_id, "id": record_id or "missing", "reason": "invalid_snapshot_record"})
                continue
            batch.append((record_id, source_fields))
            if len(batch) >= PAGE_LIMIT:
                process_batch(db, family_id, spec, batch, state, failures)
                batch = []
        if batch:
            process_batch(db, family_id, spec, batch, state, failures)
    for item in state.values():
        if item["checked"] > item["count"]:
            item["count"] = item["checked"]
    total_count = sum(item["count"] for item in state.values())
    total_checked = sum(item["checked"] for item in state.values())
    failed = sum(item["mismatched"] + item["missing_source_record"] + item["blocked"] for item in state.values())
    receipt = {
        "status": "pass" if failed == 0 and total_checked == total_count and total_count > 0 else "fail",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "scope": "full required-field parity from frozen SWFIPN mapping snapshot to projected Mongo by source id",
        "verification_mode": "frozen_mapping_source_fields_to_projected_mongo_python",
        "mapping_receipt": "output/swfipn-full-universe-mapping-latest.json",
        "mongo": {"database": MONGO_DB, "uri_redacted": True},
        "page_limit": PAGE_LIMIT,
        "collections_requested": list(SPECS),
        "rules": {
            "generic_missing_zero_distinct": "Missing generic numeric values and explicit zero are distinct; one-sided absence is a mismatch.",
            "money_zero_undisclosed_sentinel": "For contracted entity AUM, transaction amount, and Compass amount fields only, public missing may normalize source zero as the upstream undisclosed sentinel.",
        },
        "totals": {"count": total_count, "checked": total_checked, "failed": failed},
        "collections": state,
        "failures": failures[:1000],
    }
    RECEIPT_PATH.write_text(json.dumps(receipt, indent=2) + "\n")
    print(json.dumps({"status": receipt["status"], "totals": receipt["totals"], "receipt": str(RECEIPT_PATH)}, indent=2))
    raise SystemExit(0 if receipt["status"] == "pass" else 1)


def process_batch(db, family_id, spec, batch, state, failures):
    state[family_id]["pages"] += 1
    print(f"[field-parity:python] {family_id}: batch={state[family_id]['pages']} checked={state[family_id]['checked']}", flush=True)
    ids = [ObjectId(record_id) for record_id, _ in batch]
    cursor = db[spec["collection"]].find({"_id": {"$in": ids}}, spec.get("projection"))
    docs = {str(doc["_id"]): doc for doc in cursor}
    for record_id, row in batch:
        state[family_id]["checked"] += 1
        doc = docs.get(record_id)
        if not doc:
            state[family_id]["missing_source_record"] += 1
            if len(failures) < 1000:
                failures.append({"collection": family_id, "id": record_id, "reason": "missing_source_record"})
            continue
        comparisons = spec["compare"](row, doc)
        mismatches = [item for item in comparisons if item.get("status") == "mismatch"]
        if mismatches:
            state[family_id]["mismatched"] += 1
            if len(failures) < 1000:
                failures.append({"collection": family_id, "id": record_id, "reason": "field_mismatch", "mismatches": mismatches})
        else:
            state[family_id]["matched"] += 1


def self_test():
    checks = [
        ("zero_matches_zero", compare_number("value", 0, 0)["status"], "match"),
        ("missing_live_rejects_source_zero", compare_number("value", None, 0)["status"], "mismatch"),
        ("money_missing_live_accepts_source_zero", compare_number("amount", None, 0, zero_is_undisclosed=True)["status"], "allowed_normalization"),
        ("money_live_zero_rejects_missing_source", compare_number("amount", 0, None, zero_is_undisclosed=True)["status"], "mismatch"),
        ("live_zero_rejects_missing_source", compare_number("value", 0, None)["status"], "mismatch"),
        ("both_missing_skips", compare_number("value", None, None)["status"], "skipped"),
        ("live_alias_preserves_zero", first_value({"amount": 0, "capital": 12}, ["amount", "capital"]), 0),
        ("source_zero_fallback_preserved", source_number_value({"assets": 0}, ["assets", "managedAssets"]), 0),
        ("nonzero_source_alias_preferred", source_number_value({"assets": 0, "managedAssets": 12}, ["assets", "managedAssets"]), 12),
    ]
    failures = [{"check": name, "actual": actual, "expected": expected} for name, actual, expected in checks if actual != expected]
    print(json.dumps({"status": "fail" if failures else "pass", "checks": len(checks), "failures": failures}, indent=2))
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(self_test() if "--self-test" in sys.argv else main())
