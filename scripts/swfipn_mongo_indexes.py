#!/usr/bin/env python3
from __future__ import annotations

import datetime as dt
import json
import os
import pathlib
import sys
from urllib.parse import urlparse

from pymongo import ASCENDING, DESCENDING, MongoClient
from pymongo.collation import Collation


OUTPUT = pathlib.Path("output/swfipn-mongo-indexes-latest.json")


INDEXES = [
    {
        "collection": "entities",
        "name": "swfipn_entities_name_lookup",
        "keys": [("name", ASCENDING)],
        "options": {"collation": Collation(locale="en", strength=2)},
        "brd_refs": ["52", "Global Search", "Entities list filters"],
    },
    {
        "collection": "entities",
        "name": "swfipn_entities_type_region_country_aum",
        "keys": [
            ("type", ASCENDING),
            ("region", ASCENDING),
            ("country", ASCENDING),
            ("aum", DESCENDING),
            ("updated_at", DESCENDING),
        ],
        "options": {},
        "brd_refs": ["52", "Entities filters", "AUM rankings"],
    },
    {
        "collection": "entitiesAUM",
        "name": "swfipn_entities_aum_entity_year",
        "keys": [("entity_id", ASCENDING), ("year", ASCENDING)],
        "options": {},
        "brd_refs": ["52", "Aggregates AUM chart"],
    },
    {
        "collection": "people",
        "name": "swfipn_people_name_entity_region",
        "keys": [
            ("name", ASCENDING),
            ("entity_name", ASCENDING),
            ("region", ASCENDING),
            ("updated_at", DESCENDING),
        ],
        "options": {"collation": Collation(locale="en", strength=2)},
        "brd_refs": ["52", "People search/list filters"],
    },
    {
        "collection": "transactions",
        "name": "swfipn_transactions_date_amount",
        "keys": [("closed_at", DESCENDING), ("amount_usd", DESCENDING)],
        "options": {},
        "brd_refs": ["52", "Transactions date/value sorting"],
    },
    {
        "collection": "transactions",
        "name": "swfipn_transactions_buyer_date",
        "keys": [("buyer_entity_id", ASCENDING), ("buyer_entity", ASCENDING), ("closed_at", DESCENDING)],
        "options": {"collation": Collation(locale="en", strength=2)},
        "brd_refs": ["52", "Active Allocators", "Buyer/acquirer rankings"],
    },
    {
        "collection": "transactions",
        "name": "swfipn_transactions_region_industry_date",
        "keys": [
            ("buyer_region", ASCENDING),
            ("industry", ASCENDING),
            ("investment_type", ASCENDING),
            ("closed_at", DESCENDING),
        ],
        "options": {},
        "brd_refs": ["52", "Deals filters", "Visualization filters"],
    },
    {
        "collection": "compass",
        "name": "swfipn_compass_status_due_region_type",
        "keys": [
            ("status", ASCENDING),
            ("due_at", ASCENDING),
            ("region", ASCENDING),
            ("type", ASCENDING),
            ("investment_type", ASCENDING),
        ],
        "options": {},
        "brd_refs": ["52", "Compass filters", "RFP due date"],
    },
    {
        "collection": "news",
        "name": "swfipn_news_status_published_topic",
        "keys": [("status", ASCENDING), ("published_at", DESCENDING), ("topic", ASCENDING)],
        "options": {},
        "brd_refs": ["52", "News feed", "Market Focus tags"],
    },
    {
        "collection": "reports",
        "name": "swfipn_reports_type_published",
        "keys": [("type", ASCENDING), ("published_at", DESCENDING)],
        "options": {},
        "brd_refs": ["52", "Reports list"],
    },
]


def main() -> int:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    uri = (
        os.environ.get("MONGODB_URI")
        or os.environ.get("SWFI_MONGODB_URI")
        or os.environ.get("SWFI_MONGO_URI")
        or os.environ.get("SWFI_ATLAS_URI")
        or ""
    ).strip()
    dry_run = os.environ.get("SWFIPN_DB_INDEX_DRY_RUN", "").lower() in {"1", "true", "yes"}
    explicit_apply = os.environ.get("SWFIPN_DB_INDEX_APPLY", "").lower() in {"1", "true", "yes"}
    apply_allowed = explicit_apply or (bool(uri) and not is_local_uri(uri))
    apply_mode = bool(uri) and not dry_run and apply_allowed
    database = (os.environ.get("SWFIPN_MONGO_DB") or parse_db_name(uri) or "swfi").strip()

    receipt = {
        "schema_version": "swfipn.mongo_indexes.v1",
        "generated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        "status": "dry_run" if not apply_mode else "unknown",
        "mode": "apply" if apply_mode else "dry_run",
        "database": database,
        "uri_present": bool(uri),
        "no_secret_values_written": True,
        "planned_indexes": [public_spec(spec) for spec in INDEXES],
        "created_or_verified": [],
        "failures": [],
        "finish_command": "MONGODB_URI='<write-uri>' npm run db:indexes",
    }

    if not apply_mode:
        receipt["status"] = "pass_dry_run"
        write(receipt)
        print(json.dumps({"status": receipt["status"], "receipt": str(OUTPUT), "planned": len(INDEXES)}, indent=2))
        return 0

    try:
        client = MongoClient(uri, serverSelectionTimeoutMS=10_000, connectTimeoutMS=10_000)
        client.admin.command("ping")
        db = client[database]
        for spec in INDEXES:
            opts = dict(spec.get("options") or {})
            collation = opts.pop("collation", None)
            if collation is not None:
                opts["collation"] = collation
            name = db[spec["collection"]].create_index(spec["keys"], name=spec["name"], background=True, **opts)
            receipt["created_or_verified"].append(
                {
                    "collection": spec["collection"],
                    "name": name,
                    "keys": [[key, direction_name(direction)] for key, direction in spec["keys"]],
                    "brd_refs": spec["brd_refs"],
                }
            )
    except Exception as exc:  # noqa: BLE001 - receipt must capture exact blocker class.
        receipt["status"] = "fail"
        receipt["failures"].append({"type": type(exc).__name__, "message": str(exc)[:500]})
        write(receipt)
        print(json.dumps({"status": receipt["status"], "receipt": str(OUTPUT), "failures": receipt["failures"]}, indent=2))
        return 1

    receipt["status"] = "pass"
    write(receipt)
    print(
        json.dumps(
            {
                "status": receipt["status"],
                "receipt": str(OUTPUT),
                "created_or_verified": len(receipt["created_or_verified"]),
                "database": database,
            },
            indent=2,
        )
    )
    return 0


def parse_db_name(uri: str) -> str:
    if not uri:
        return ""
    path = urlparse(uri).path.strip("/")
    return path.split("/")[0] if path else ""


def is_local_uri(uri: str) -> bool:
    try:
        host = urlparse(uri).hostname or ""
    except ValueError:
        return False
    return host in {"localhost", "127.0.0.1", "::1", "0.0.0.0"}


def public_spec(spec: dict) -> dict:
    return {
        "collection": spec["collection"],
        "name": spec["name"],
        "keys": [[key, direction_name(direction)] for key, direction in spec["keys"]],
        "brd_refs": spec["brd_refs"],
    }


def direction_name(direction: int) -> str:
    return "asc" if direction == ASCENDING else "desc"


def write(receipt: dict) -> None:
    OUTPUT.write_text(json.dumps(receipt, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    sys.exit(main())
