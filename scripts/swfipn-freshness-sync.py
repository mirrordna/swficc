#!/usr/bin/env python3
"""Run a configured SWFI source freshness sync on an interval and write receipts.

This script deliberately does not know SWFI credentials or invent data. Production
must provide either SWFIPN_SYNC_COMMAND or SWFIPN_SYNC_URL.
"""

from __future__ import annotations

import json
import os
import subprocess
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def env_int(name: str, default: int) -> int:
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def run_command(command: str) -> dict[str, Any]:
    started = time.time()
    result = subprocess.run(
        command,
        shell=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        timeout=env_int("SWFIPN_SYNC_COMMAND_TIMEOUT_SECONDS", 900),
        check=False,
    )
    return {
        "mode": "command",
        "command": command,
        "exit_code": result.returncode,
        "ok": result.returncode == 0,
        "duration_seconds": round(time.time() - started, 3),
        "stdout_tail": result.stdout[-4000:],
        "stderr_tail": result.stderr[-4000:],
    }


def call_url(url: str) -> dict[str, Any]:
    method = os.environ.get("SWFIPN_SYNC_METHOD", "POST").upper()
    token = os.environ.get("SWFIPN_SYNC_BEARER_TOKEN", "")
    started = time.time()
    request = urllib.request.Request(url, method=method)
    request.add_header("Accept", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(request, timeout=env_int("SWFIPN_SYNC_URL_TIMEOUT_SECONDS", 900)) as response:
            body = response.read(100_000).decode("utf-8", errors="replace")
            return {
                "mode": "url",
                "url": url,
                "method": method,
                "status": response.status,
                "ok": 200 <= response.status < 300,
                "duration_seconds": round(time.time() - started, 3),
                "body_tail": body[-4000:],
            }
    except urllib.error.HTTPError as error:
        body = error.read(100_000).decode("utf-8", errors="replace")
        return {
            "mode": "url",
            "url": url,
            "method": method,
            "status": error.code,
            "ok": False,
            "duration_seconds": round(time.time() - started, 3),
            "body_tail": body[-4000:],
        }
    except Exception as error:
        return {
            "mode": "url",
            "url": url,
            "method": method,
            "status": 0,
            "ok": False,
            "duration_seconds": round(time.time() - started, 3),
            "error": f"{type(error).__name__}: {error}",
        }


def check_freshness(url: str) -> dict[str, Any]:
    if not url:
        return {"configured": False, "ok": None}
    request = urllib.request.Request(url, method="GET")
    request.add_header("Accept", "application/json")
    try:
        with urllib.request.urlopen(request, timeout=env_int("SWFIPN_FRESHNESS_TIMEOUT_SECONDS", 30)) as response:
            body = response.read(100_000).decode("utf-8", errors="replace")
            payload: Any
            try:
                payload = json.loads(body)
            except json.JSONDecodeError:
                payload = {"raw_tail": body[-4000:]}
            return {"configured": True, "url": url, "status": response.status, "ok": 200 <= response.status < 300, "payload": payload}
    except Exception as error:
        return {"configured": True, "url": url, "status": 0, "ok": False, "error": f"{type(error).__name__}: {error}"}


def write_receipt(receipt: dict[str, Any]) -> Path:
    receipt_dir = Path(os.environ.get("SWFIPN_SYNC_RECEIPT_DIR", "/var/lib/swfipn/freshness"))
    receipt_dir.mkdir(parents=True, exist_ok=True)
    stamp = receipt["finished_at"].replace(":", "").replace("+", "Z")
    path = receipt_dir / f"swfipn-freshness-{stamp}.json"
    latest = receipt_dir / "latest.json"
    data = json.dumps(receipt, indent=2, sort_keys=True) + "\n"
    path.write_text(data)
    latest.write_text(data)
    return latest


def run_once() -> dict[str, Any]:
    command = os.environ.get("SWFIPN_SYNC_COMMAND", "").strip()
    url = os.environ.get("SWFIPN_SYNC_URL", "").strip()
    started_at = utc_now()
    if command:
        sync = run_command(command)
    elif url:
        sync = call_url(url)
    else:
        sync = {
            "mode": "not_configured",
            "ok": False,
            "error": "Set SWFIPN_SYNC_COMMAND or SWFIPN_SYNC_URL in production.",
        }
    freshness = check_freshness(os.environ.get("SWFIPN_FRESHNESS_URL", "").strip())
    receipt = {
        "schema_version": "swfipn.freshness_sync.v1",
        "started_at": started_at,
        "finished_at": utc_now(),
        "status": "ok" if sync.get("ok") and freshness.get("ok") is not False else "fail",
        "sync": sync,
        "freshness": freshness,
    }
    latest = write_receipt(receipt)
    print(json.dumps({"status": receipt["status"], "receipt": str(latest)}, sort_keys=True), flush=True)
    return receipt


def main() -> int:
    interval = env_int("SWFIPN_SYNC_INTERVAL_SECONDS", 900)
    once = os.environ.get("SWFIPN_SYNC_ONCE", "").lower() in {"1", "true", "yes"}
    while True:
        receipt = run_once()
        if once:
            return 0 if receipt["status"] == "ok" else 1
        time.sleep(interval)


if __name__ == "__main__":
    raise SystemExit(main())
