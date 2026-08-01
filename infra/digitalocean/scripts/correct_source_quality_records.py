#!/usr/bin/env python3
"""Apply a bounded, reversible SWFI source-quality correction on DigitalOcean.

The script never accepts a Mongo URI on the command line. It reads the same
SWFI_MONGO_URI and SWFI_MONGO_DB environment variables as the production
backend, checks an exact pre-state hash, and applies all writes transactionally.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from bson import ObjectId
from pymongo import MongoClient


CORRECTION_ID = "swfi-source-quality-20260801-v1"
AUTHORIZATION_ID = "SWFI_SOURCE_QUALITY_20260801"

JOSHUA_PERSON_ID = ObjectId("655d37741e6cc7e013cc6011")
RAYMOND_PERSON_ID = ObjectId("655d37411e6cc7e013cc600e")
JOSHUA_HISTORY_ID = ObjectId("655d378373585eb21e01fa8f")
ADIA_FIXED_INCOME_HISTORY_ID = ObjectId("686e3f5fe463a43491cb3d5c")
ADIA_BOARD_HISTORY_ID = ObjectId("686e402ae463a43491cb3d62")
HKIC_ENTITY_ID = ObjectId("63502488d68aa29d9a0da8a5")
ADIA_ENTITY_ID = ObjectId("598cdaa50124e9fd2d05a79b")
KHALIFA_PERSON_ID = ObjectId("5b2b56eb40bc077d5786c074")

SOURCE_EVIDENCE = {
    "joshua_chang": [
        "https://hkust.edu.hk/news/hkust-unicorn-day-brings-together-global-innovation-and-entrepreneurship-leaders",
        "https://kpmg.com/cn/en/events/2026/03/kpmg-asset-management-summit.html",
    ],
    "adia_khalifa": [
        "https://www.adia.ae/en/pr/2018/investment-committee/index.html",
        "https://www.adia.ae/en/pr/2024/pdf/adia-annual-review-2024-investment-committee.pdf",
    ],
    "adia_board_affiliations": [
        "https://www.adib.com/en/pages/about_adib_boardofdirectors.aspx",
    ],
}

PEOPLE_FIELDS = (
    "firstName",
    "middleName",
    "lastName",
    "updatedAt",
    "sourceCorrection",
)
HISTORY_FIELDS = (
    "active",
    "role",
    "title",
    "startedAt",
    "endedAt",
    "peopleID",
    "entityID",
    "insertedAt",
    "updatedAt",
    "retractedAt",
    "sourceCorrection",
)


def utc_now() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


def json_value(value: Any) -> Any:
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        suffix = "Z" if value.tzinfo is None else ""
        return value.isoformat() + suffix
    if isinstance(value, dict):
        return {key: json_value(item) for key, item in sorted(value.items())}
    if isinstance(value, list):
        return [json_value(item) for item in value]
    return value


def selected_document(document: dict[str, Any] | None, fields: tuple[str, ...]) -> dict[str, Any]:
    if document is None:
        return {"missing": True}
    selected: dict[str, Any] = {"_id": str(document["_id"])}
    selected["present_fields"] = [field for field in fields if field in document]
    for field in fields:
        if field in document:
            selected[field] = json_value(document[field])
    return selected


def snapshot_state(db: Any, *, session: Any = None) -> dict[str, Any]:
    people = db["people"]
    history = db["peopleHistory"]
    return {
        "schema_version": "swfi.source_quality_state.v1",
        "people": [
            selected_document(people.find_one({"_id": person_id}, session=session), PEOPLE_FIELDS)
            for person_id in (JOSHUA_PERSON_ID, RAYMOND_PERSON_ID)
        ],
        "peopleHistory": [
            selected_document(history.find_one({"_id": history_id}, session=session), HISTORY_FIELDS)
            for history_id in (
                JOSHUA_HISTORY_ID,
                ADIA_FIXED_INCOME_HISTORY_ID,
                ADIA_BOARD_HISTORY_ID,
            )
        ],
    }


def canonical_bytes(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")


def state_sha256(state: dict[str, Any]) -> str:
    return hashlib.sha256(canonical_bytes(state)).hexdigest()


def connect() -> tuple[MongoClient, Any]:
    uri = os.environ.get("SWFI_MONGO_URI", "").strip()
    db_name = os.environ.get("SWFI_MONGO_DB", "").strip()
    if not uri or not db_name:
        raise RuntimeError("SWFI_MONGO_URI and SWFI_MONGO_DB are required in the process environment")
    timeout_ms = int(os.environ.get("SWFI_MONGO_TIMEOUT_MS", "5000"))
    client = MongoClient(uri, serverSelectionTimeoutMS=timeout_ms)
    client.admin.command("ping")
    return client, client[db_name]


def correction_metadata(now: datetime, *, reason: str, evidence: list[str], scope: str) -> dict[str, Any]:
    return {
        "correction_id": CORRECTION_ID,
        "corrected_at": now,
        "reason": reason,
        "scope": scope,
        "evidence": evidence,
    }


def require_update(result: Any, label: str) -> dict[str, Any]:
    if result.matched_count != 1 or result.modified_count != 1:
        raise RuntimeError(
            f"{label} refused: expected matched_count=1 and modified_count=1, "
            f"got matched_count={result.matched_count} modified_count={result.modified_count}"
        )
    return {"label": label, "matched_count": result.matched_count, "modified_count": result.modified_count}


def apply_correction(db: Any, session: Any, now: datetime) -> list[dict[str, Any]]:
    people = db["people"]
    history = db["peopleHistory"]
    results = []

    results.append(
        require_update(
            people.update_one(
                {
                    "_id": JOSHUA_PERSON_ID,
                    "firstName": "Joshua",
                    "lastName": "Chang2",
                    "sourceCorrection": {"$exists": False},
                },
                {
                    "$set": {
                        "lastName": "Chang",
                        "updatedAt": now,
                        "sourceCorrection": correction_metadata(
                            now,
                            reason="remove trailing numeric import artifact from surname",
                            evidence=SOURCE_EVIDENCE["joshua_chang"],
                            scope="name spelling only",
                        ),
                    }
                },
                session=session,
            ),
            "joshua_name",
        )
    )
    results.append(
        require_update(
            history.update_one(
                {
                    "_id": JOSHUA_HISTORY_ID,
                    "peopleID": JOSHUA_PERSON_ID,
                    "entityID": HKIC_ENTITY_ID,
                    "title": "Employee",
                    "active": True,
                    "sourceCorrection": {"$exists": False},
                },
                {
                    "$set": {
                        "title": "Senior Director (Investment)",
                        "updatedAt": now,
                        "sourceCorrection": correction_metadata(
                            now,
                            reason="replace generic import title with independently corroborated current title",
                            evidence=SOURCE_EVIDENCE["joshua_chang"],
                            scope="HKIC current job title",
                        ),
                    }
                },
                session=session,
            ),
            "joshua_hkic_title",
        )
    )
    results.append(
        require_update(
            people.update_one(
                {
                    "_id": RAYMOND_PERSON_ID,
                    "firstName": "Raymond",
                    "lastName": "Cheng 1",
                    "sourceCorrection": {"$exists": False},
                },
                {
                    "$set": {
                        "lastName": "Cheng",
                        "updatedAt": now,
                        "sourceCorrection": correction_metadata(
                            now,
                            reason="remove trailing numeric import artifact from surname",
                            evidence=["https://www.swfi.com/v1/people/655d37411e6cc7e013cc600e"],
                            scope="display-name normalization only; identity and employment claim remain unverified",
                        ),
                    }
                },
                session=session,
            ),
            "raymond_name_only",
        )
    )

    for history_id, title, evidence, label in (
        (
            ADIA_FIXED_INCOME_HISTORY_ID,
            "Executive Director, Fixed Income ",
            SOURCE_EVIDENCE["adia_khalifa"],
            "retract_adia_fixed_income_edge",
        ),
        (
            ADIA_BOARD_HISTORY_ID,
            "Chairman, Egypt & Hong Kong Limited",
            SOURCE_EVIDENCE["adia_board_affiliations"],
            "retract_adia_merged_board_edge",
        ),
    ):
        results.append(
            require_update(
                history.update_one(
                    {
                        "_id": history_id,
                        "peopleID": KHALIFA_PERSON_ID,
                        "entityID": ADIA_ENTITY_ID,
                        "title": title,
                        "active": True,
                        "startedAt": datetime(1970, 1, 1),
                        "sourceCorrection": {"$exists": False},
                    },
                    {
                        "$set": {
                            "active": False,
                            "updatedAt": now,
                            "retractedAt": now,
                            "sourceCorrection": correction_metadata(
                                now,
                                reason=(
                                    "retract source-linking conflict with ADIA's own investment-committee record"
                                    if history_id == ADIA_FIXED_INCOME_HISTORY_ID
                                    else "retract merged title that combines two affiliations under the wrong entity edge"
                                ),
                                evidence=evidence,
                                scope="relationship retraction; no replacement edge created",
                            ),
                        }
                    },
                    session=session,
                ),
                label,
            )
        )
    return results


def rollback_correction(db: Any, session: Any) -> list[dict[str, Any]]:
    people = db["people"]
    history = db["peopleHistory"]
    results = []
    results.append(
        require_update(
            people.update_one(
                {"_id": JOSHUA_PERSON_ID, "lastName": "Chang", "sourceCorrection.correction_id": CORRECTION_ID},
                {"$set": {"lastName": "Chang2"}, "$unset": {"updatedAt": "", "sourceCorrection": ""}},
                session=session,
            ),
            "rollback_joshua_name",
        )
    )
    results.append(
        require_update(
            people.update_one(
                {"_id": RAYMOND_PERSON_ID, "lastName": "Cheng", "sourceCorrection.correction_id": CORRECTION_ID},
                {
                    "$set": {"lastName": "Cheng 1", "updatedAt": datetime(2026, 6, 22, 4, 9, 50, 765000)},
                    "$unset": {"sourceCorrection": ""},
                },
                session=session,
            ),
            "rollback_raymond_name",
        )
    )
    results.append(
        require_update(
            history.update_one(
                {
                    "_id": JOSHUA_HISTORY_ID,
                    "title": "Senior Director (Investment)",
                    "sourceCorrection.correction_id": CORRECTION_ID,
                },
                {"$set": {"title": "Employee"}, "$unset": {"updatedAt": "", "sourceCorrection": ""}},
                session=session,
            ),
            "rollback_joshua_title",
        )
    )
    for history_id, label in (
        (ADIA_FIXED_INCOME_HISTORY_ID, "rollback_adia_fixed_income_edge"),
        (ADIA_BOARD_HISTORY_ID, "rollback_adia_merged_board_edge"),
    ):
        results.append(
            require_update(
                history.update_one(
                    {"_id": history_id, "active": False, "sourceCorrection.correction_id": CORRECTION_ID},
                    {
                        "$set": {"active": True},
                        "$unset": {"updatedAt": "", "retractedAt": "", "sourceCorrection": ""},
                    },
                    session=session,
                ),
                label,
            )
        )
    return results


def desired_state_checks(state: dict[str, Any]) -> dict[str, bool]:
    people = {row.get("_id"): row for row in state["people"]}
    history = {row.get("_id"): row for row in state["peopleHistory"]}
    return {
        "joshua_name_corrected": people[str(JOSHUA_PERSON_ID)].get("lastName") == "Chang",
        "raymond_name_normalized_only": people[str(RAYMOND_PERSON_ID)].get("lastName") == "Cheng",
        "joshua_title_corrected": history[str(JOSHUA_HISTORY_ID)].get("title") == "Senior Director (Investment)",
        "adia_fixed_income_edge_retracted": history[str(ADIA_FIXED_INCOME_HISTORY_ID)].get("active") is False,
        "adia_merged_board_edge_retracted": history[str(ADIA_BOARD_HISTORY_ID)].get("active") is False,
    }


def write_receipt(path: Path, receipt: dict[str, Any]) -> str:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = json.dumps(json_value(receipt), indent=2, sort_keys=True, ensure_ascii=True) + "\n"
    with path.open("x", encoding="utf-8") as handle:
        handle.write(payload)
        handle.flush()
        os.fsync(handle.fileno())
    return hashlib.sha256(payload.encode("utf-8")).hexdigest()


def preflight_receipt_path(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists():
        raise RuntimeError(f"receipt already exists: {path}")
    probe = path.with_name(f".{path.name}.write-probe-{os.getpid()}")
    try:
        with probe.open("x", encoding="utf-8") as handle:
            handle.write("receipt-path-preflight\n")
            handle.flush()
            os.fsync(handle.fileno())
    finally:
        probe.unlink(missing_ok=True)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("mode", choices=("snapshot", "apply", "verify", "rollback"))
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--expected-state-sha256", default="")
    parser.add_argument("--evidence-manifest-sha256", default="")
    parser.add_argument("--authorization-id", default="")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    preflight_receipt_path(args.out)
    client, db = connect()
    checked_at = utc_now()
    before = snapshot_state(db)
    before_sha = state_sha256(before)
    receipt: dict[str, Any] = {
        "schema_version": "swfi.source_quality_correction_receipt.v1",
        "correction_id": CORRECTION_ID,
        "mode": args.mode,
        "checked_at": checked_at,
        "status": "unknown",
        "before_state_sha256": before_sha,
        "before": before,
        "evidence_manifest_sha256": args.evidence_manifest_sha256 or None,
        "boundaries": [
            "No service restart, deployment, cache flush, schema migration, or record deletion.",
            "Raymond Cheng employment and title are not independently verified; only the numeric surname artifact is removed.",
            "The two malformed ADIA edges are retracted, not replaced with inferred relationships.",
            "This correction does not establish global source parity outside the five pinned records.",
        ],
    }

    if args.mode == "snapshot":
        receipt["status"] = "pass"
    elif args.mode == "verify":
        checks = desired_state_checks(before)
        receipt["checks"] = checks
        receipt["status"] = "pass" if all(checks.values()) else "fail"
    else:
        if args.authorization_id != AUTHORIZATION_ID:
            raise RuntimeError("authorization id mismatch")
        if not args.expected_state_sha256 or args.expected_state_sha256 != before_sha:
            raise RuntimeError(
                f"state hash mismatch: expected={args.expected_state_sha256 or '<missing>'} actual={before_sha}"
            )
        if args.mode == "apply" and not args.evidence_manifest_sha256:
            raise RuntimeError("apply requires --evidence-manifest-sha256")

        with client.start_session() as session:
            with session.start_transaction():
                operations = (
                    apply_correction(db, session, checked_at)
                    if args.mode == "apply"
                    else rollback_correction(db, session)
                )
                after = snapshot_state(db, session=session)
                checks = desired_state_checks(after)
                expected = all(checks.values()) if args.mode == "apply" else not any(checks.values())
                if not expected:
                    raise RuntimeError(f"post-state verification failed inside transaction: {checks}")

        committed = snapshot_state(db)
        committed_sha = state_sha256(committed)
        if committed_sha != state_sha256(after):
            raise RuntimeError("committed state does not match transaction post-state")
        receipt.update(
            {
                "status": "pass",
                "operations": operations,
                "checks": checks,
                "after_state_sha256": committed_sha,
                "after": committed,
            }
        )

    receipt_sha = write_receipt(args.out, receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(args.out), "receipt_sha256": receipt_sha}))
    return 0 if receipt["status"] == "pass" else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(json.dumps({"status": "fail", "error": str(exc)}), file=sys.stderr)
        raise SystemExit(1)
