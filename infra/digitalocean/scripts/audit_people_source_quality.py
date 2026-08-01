#!/usr/bin/env python3
"""Audit current SWFI people edges against the production people-search API."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen

from bson import ObjectId
from pymongo import MongoClient


ENTITY_CASES = (
    ("Abu Dhabi Investment Authority", ObjectId("598cdaa50124e9fd2d05a79b")),
    ("Hong Kong Investment Corporation", ObjectId("63502488d68aa29d9a0da8a5")),
)
PEOPLE_SOURCE_PATH = re.compile(r"^/v1/people/([a-f0-9]{24})/?$", re.IGNORECASE)
TRUSTED_PEOPLE_SOURCE_HOSTS = {"swfi.com", "www.swfi.com"}


def source_person_id(row: dict[str, Any]) -> str:
    source_url = str(row.get("source_url") or "").strip()
    parsed = urlparse(source_url)
    match = PEOPLE_SOURCE_PATH.fullmatch(parsed.path)
    trusted_origin = (
        parsed.scheme.casefold() == "https"
        and (parsed.hostname or "").casefold() in TRUSTED_PEOPLE_SOURCE_HOSTS
        and parsed.username is None
        and parsed.password is None
        and parsed.port in (None, 443)
    )
    if not trusted_origin or not match:
        raise RuntimeError(f"invalid or missing public people source URL: {source_url or '<missing>'}")
    return match.group(1).lower()


def is_current(history: dict[str, Any]) -> bool:
    active = history.get("active")
    active_label = str(active).strip().casefold()
    explicitly_inactive = active is False or active_label in {"false", "0", "inactive"}
    return not explicitly_inactive and not history.get("endedAt")


def edge_key(history: dict[str, Any]) -> tuple[str, ...]:
    return (
        str(history.get("peopleID")),
        str(history.get("entityID")),
        str(history.get("role") or "").strip().casefold(),
        str(history.get("title") or "").strip().casefold(),
        str(history.get("startedAt")),
    )


def sha256_ids(values: list[str]) -> str:
    return hashlib.sha256("\n".join(values).encode("ascii")).hexdigest()


def fetch_api_rows(origin: str, token: str, query: str) -> tuple[list[dict[str, Any]], int]:
    rows: list[dict[str, Any]] = []
    page = 1
    while True:
        url = origin.rstrip("/") + "/api/people/search/v1?" + urlencode({"q": query, "limit": 50, "page": page})
        request = Request(url, headers={"Authorization": f"Bearer {token}", "Accept": "application/json"})
        with urlopen(request, timeout=20) as response:
            packet = json.load(response)
        data = packet.get("data") or {}
        page_rows = data.get("rows") or []
        if not isinstance(page_rows, list):
            raise RuntimeError(f"people API returned non-list rows for {query}")
        rows.extend(page_rows)
        if not data.get("has_more"):
            return rows, page
        page += 1
        if page > 10:
            raise RuntimeError(f"people API pagination guard exceeded for {query}")


def audit_entity(db: Any, api_origin: str, token: str, entity_name: str, entity_id: ObjectId) -> dict[str, Any]:
    current = [row for row in db["peopleHistory"].find({"entityID": entity_id}) if is_current(row)]
    by_person: dict[str, list[str]] = defaultdict(list)
    by_edge: dict[tuple[str, ...], list[str]] = defaultdict(list)
    for history in current:
        person_id = str(history.get("peopleID"))
        by_person[person_id].append(str(history["_id"]))
        by_edge[edge_key(history)].append(str(history["_id"]))

    mongo_ids = sorted(by_person)
    people = {
        str(person["_id"]): person
        for person in db["people"].find({"_id": {"$in": [ObjectId(value) for value in mongo_ids]}})
    }
    malformed_names = []
    for person_id, person in people.items():
        fields = {field: str(person.get(field) or "").strip() for field in ("firstName", "middleName", "lastName")}
        if any(re.search(r"\d", value) for value in fields.values()):
            malformed_names.append({"people_id": person_id, **fields})

    api_rows, api_pages = fetch_api_rows(api_origin, token, entity_name)
    api_ids = sorted({source_person_id(row) for row in api_rows})
    return {
        "entity": entity_name,
        "entity_id": str(entity_id),
        "mongo_current_edge_count": len(current),
        "mongo_unique_people_count": len(mongo_ids),
        "api_row_count": len(api_rows),
        "api_unique_people_count": len(api_ids),
        "mongo_api_exact_id_set_match": mongo_ids == api_ids,
        "mongo_people_id_set_sha256": sha256_ids(mongo_ids),
        "api_people_id_set_sha256": sha256_ids(api_ids),
        "api_identity_witness": "validated source_url /v1/people/<24-hex-id>",
        "api_pages": api_pages,
        "exact_duplicate_current_edges": [ids for ids in by_edge.values() if len(ids) > 1],
        "multiple_current_roles": [
            {"people_id": person_id, "history_ids": ids}
            for person_id, ids in by_person.items()
            if len(ids) > 1
        ],
        "malformed_current_names": malformed_names,
    }


def entity_passes(check: dict[str, Any]) -> bool:
    count = check["mongo_current_edge_count"]
    return (
        check["mongo_api_exact_id_set_match"]
        and count
        == check["mongo_unique_people_count"]
        == check["api_row_count"]
        == check["api_unique_people_count"]
        and not check["exact_duplicate_current_edges"]
        and not check["multiple_current_roles"]
        and not check["malformed_current_names"]
    )


def write_receipt(path: Path, value: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(value, indent=2, sort_keys=True) + "\n"
    with path.open("x", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def self_test() -> None:
    assert source_person_id({"source_url": "https://www.swfi.com/v1/people/655d37741e6cc7e013cc6011"}) == "655d37741e6cc7e013cc6011"
    for untrusted_url in (
        "https://example.com/person/655d37741e6cc7e013cc6011",
        "https://example.com/v1/people/655d37741e6cc7e013cc6011",
        "http://www.swfi.com/v1/people/655d37741e6cc7e013cc6011",
        "https://www.swfi.com.evil.test/v1/people/655d37741e6cc7e013cc6011",
    ):
        try:
            source_person_id({"source_url": untrusted_url})
        except RuntimeError:
            pass
        else:
            raise AssertionError(f"untrusted source URL was accepted: {untrusted_url}")
    assert is_current({"active": True, "endedAt": None})
    assert not is_current({"active": False, "endedAt": None})
    assert not is_current({"active": True, "endedAt": datetime(2026, 1, 1)})
    left = {"peopleID": "p", "entityID": "e", "role": " Job ", "title": " CIO ", "startedAt": 1}
    right = {"peopleID": "p", "entityID": "e", "role": "job", "title": "cio", "startedAt": 1}
    assert edge_key(left) == edge_key(right)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        print(json.dumps({"status": "pass", "self_test": True}))
        return 0
    if args.out is None:
        raise RuntimeError("--out is required unless --self-test is used")

    uri = os.environ.get("SWFI_MONGO_URI", "").strip()
    db_name = os.environ.get("SWFI_MONGO_DB", "").strip()
    token = os.environ.get("SWFI2_API_TOKEN", "").strip()
    api_origin = os.environ.get("SWFI2_INTERNAL_API_ORIGIN", "http://127.0.0.1:8362").strip()
    if not uri or not db_name or not token:
        raise RuntimeError("SWFI_MONGO_URI, SWFI_MONGO_DB, and SWFI2_API_TOKEN are required")

    client = MongoClient(uri, serverSelectionTimeoutMS=int(os.environ.get("SWFI_MONGO_TIMEOUT_MS", "5000")))
    client.admin.command("ping")
    db = client[db_name]
    checks = [audit_entity(db, api_origin, token, name, entity_id) for name, entity_id in ENTITY_CASES]
    status = "pass" if all(entity_passes(check) for check in checks) else "fail"
    receipt = {
        "schema_version": "swfi.people_hardening_audit.v2",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "status": status,
        "source_access": "direct production Mongo read-only identity plus production backend API",
        "checks": checks,
        "checked_scope": [
            "ADIA and HKIC current peopleHistory edges",
            "all paginated API people IDs",
            "exact ID-set parity",
            "exact duplicate edge classification",
            "multiple current role classification",
            "numeric artifacts in current people names",
        ],
        "bad_news": [
            "External biographical correctness is not established by database/API parity.",
            "This audit covers ADIA and HKIC only, not the full people collection.",
        ],
        "unchecked_scope": ["all entities", "stakeholder acceptance", "global release acceptance"],
    }
    receipt_sha = write_receipt(args.out, receipt)
    print(json.dumps({"status": status, "receipt": str(args.out), "receipt_sha256": receipt_sha}))
    return 0 if status == "pass" else 1


if __name__ == "__main__":
    raise SystemExit(main())
