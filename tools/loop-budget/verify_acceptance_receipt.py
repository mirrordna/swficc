#!/usr/bin/env python3
"""Verify a SWFIPN acceptance receipt and its content-addressed inputs."""

from __future__ import annotations

import argparse
import hashlib
import json
import tempfile
from pathlib import Path
from typing import Any


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def contained_path(repo: Path, relative: str) -> Path:
    candidate = (repo / relative).resolve()
    if not candidate.is_relative_to(repo):
        raise ValueError(f"receipt input escapes repository: {relative}")
    return candidate


def load_json_bytes(path: Path) -> tuple[dict[str, Any], bytes]:
    payload = path.read_bytes()
    body = json.loads(payload)
    if not isinstance(body, dict):
        raise ValueError("aggregate receipt is not a JSON object")
    return body, payload


def expected_sidecar_sha(path: Path) -> str:
    sidecar = path.with_suffix(path.suffix + ".sha256")
    fields = sidecar.read_text(encoding="utf-8").strip().split()
    if len(fields) != 2 or fields[1] != path.name:
        raise ValueError(f"invalid aggregate sidecar: {sidecar}")
    return fields[0]


def verify(repo: Path, receipt_path: Path) -> dict[str, Any]:
    failures: list[str] = []
    body: dict[str, Any] = {}
    aggregate_sha256 = ""
    try:
        body, payload = load_json_bytes(receipt_path)
        aggregate_sha256 = sha256_bytes(payload)
        if expected_sidecar_sha(receipt_path) != aggregate_sha256:
            failures.append("aggregate_sidecar_sha256_mismatch")
    except Exception as exc:
        return {
            "schema_version": "swfipn.acceptance_receipt_verification.v1",
            "evidence_class": "CONTENT_INTEGRITY_ONLY_NOT_ACCEPTANCE",
            "status": "INTEGRITY_FAIL",
            "receipt": str(receipt_path),
            "failures": [f"aggregate_unreadable:{exc}"],
        }

    if body.get("schema_version") != "swfipn.acceptance_lock.v3":
        failures.append(f"unsupported_aggregate_schema:{body.get('schema_version') or 'missing'}")
    required = body.get("required_receipts")
    if not isinstance(required, list):
        failures.append("required_receipts_missing_or_invalid")
        required = []

    child_results = []
    manifest_lines = []
    seen_paths = set()
    for item in required:
        if not isinstance(item, dict):
            failures.append("required_receipt_entry_not_object")
            continue
        relative = str(item.get("path") or "")
        if relative in seen_paths:
            failures.append(f"duplicate_child_path:{relative}")
        seen_paths.add(relative)
        recorded_sha256 = str(item.get("sha256") or "")
        manifest_lines.append(f"{relative}\0{recorded_sha256 or 'missing'}")
        child = {"path": relative, "recorded_sha256": recorded_sha256, "status": "fail"}
        try:
            path = contained_path(repo, relative)
            payload = path.read_bytes()
            current_sha256 = sha256_bytes(payload)
            child.update(
                {
                    "current_sha256": current_sha256,
                    "byte_count": len(payload),
                    "status": "pass"
                    if current_sha256 == recorded_sha256 and len(payload) == item.get("byte_count")
                    else "fail",
                }
            )
            if current_sha256 != recorded_sha256:
                failures.append(f"child_sha256_mismatch:{relative}")
            if len(payload) != item.get("byte_count"):
                failures.append(f"child_byte_count_mismatch:{relative}")
        except Exception as exc:
            child["error"] = str(exc)
            failures.append(f"child_unreadable:{relative}:{exc}")
        child_results.append(child)

    manifest_sha256 = sha256_bytes("\n".join(manifest_lines).encode("utf-8"))
    if manifest_sha256 != body.get("input_receipt_manifest_sha256"):
        failures.append("input_receipt_manifest_sha256_mismatch")

    return {
        "schema_version": "swfipn.acceptance_receipt_verification.v1",
        "evidence_class": "CONTENT_INTEGRITY_ONLY_NOT_ACCEPTANCE",
        "status": "INTEGRITY_FAIL" if failures else "INTEGRITY_PASS",
        "receipt": str(receipt_path),
        "aggregate_verdict": body.get("final_verdict") or body.get("status") or "unknown",
        "aggregate_sha256": aggregate_sha256,
        "input_receipt_manifest_sha256": manifest_sha256,
        "children": child_results,
        "failures": failures,
        "boundaries": [
            "SHA-256 detects content drift but does not authenticate the producer.",
            "This verifier does not establish product, source-data, stakeholder, or deployment acceptance.",
        ],
    }


def self_test() -> None:
    with tempfile.TemporaryDirectory() as raw:
        repo = Path(raw).resolve()
        child = repo / "child.json"
        child_payload = b'{"schema_version":"swfipn.fixture.v1","status":"pass"}\n'
        child.write_bytes(child_payload)
        child_sha256 = sha256_bytes(child_payload)
        manifest_sha256 = sha256_bytes(f"child.json\0{child_sha256}".encode("utf-8"))
        receipt = repo / "acceptance.json"
        body = {
            "schema_version": "swfipn.acceptance_lock.v3",
            "input_receipt_manifest_sha256": manifest_sha256,
            "required_receipts": [
                {"path": "child.json", "sha256": child_sha256, "byte_count": len(child_payload)}
            ],
        }
        receipt_payload = (json.dumps(body, sort_keys=True) + "\n").encode("utf-8")
        receipt.write_bytes(receipt_payload)
        receipt.with_suffix(".json.sha256").write_text(
            f"{sha256_bytes(receipt_payload)}  acceptance.json\n",
            encoding="utf-8",
        )
        assert verify(repo, receipt)["status"] == "INTEGRITY_PASS"
        child.write_bytes(child_payload.replace(b'"pass"', b'"fail"'))
        tampered = verify(repo, receipt)
        assert tampered["status"] == "INTEGRITY_FAIL"
        assert "child_sha256_mismatch:child.json" in tampered["failures"]
        try:
            contained_path(repo, "../escaped.json")
        except ValueError:
            pass
        else:
            raise AssertionError("receipt verifier accepted a path escape")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", type=Path, default=Path("."))
    parser.add_argument("--receipt", type=Path)
    parser.add_argument("--self-test", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    if args.self_test:
        self_test()
        print(json.dumps({"status": "INTEGRITY_PASS", "self_test": True}))
        return 0
    if args.receipt is None:
        raise ValueError("--receipt is required unless --self-test is used")
    repo = args.repo.resolve()
    receipt = args.receipt if args.receipt.is_absolute() else (repo / args.receipt)
    result = verify(repo, receipt.resolve())
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0 if result["status"] == "INTEGRITY_PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
