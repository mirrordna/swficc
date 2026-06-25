#!/usr/bin/env python3
import os
import sys
import json
import urllib.request


host = os.environ.get("SWFIPN_HEALTHCHECK_HOST", "127.0.0.1")
port = os.environ.get("SWFIPN_PORT", "8353")
url = os.environ.get("SWFIPN_HEALTHCHECK_URL", f"http://{host}:{port}/__origin/ready")

required = [
    "Top AUM & Sector Activity",
    "Capital Flows",
    "AI Insights",
    "Pipeline Overview",
    "Top Active Allocators (Last 90 Days)",
    "Deal Intelligence",
    "Data source: SWFI records",
]

forbidden = [
    "Endpoint:",
    "Source-backed fact",
    "Source Record ID",
    "Truth State",
    "Result Qualifier",
    "Mongo Record ID",
    "Runtime Source",
    "SWFIPN source detail",
    "Source packet:",
    "SWFI LOGO",
    "Sidebar",
    "Application error",
    "Unhandled Runtime Error",
]


def main() -> int:
    try:
        with urllib.request.urlopen(url, timeout=4) as response:
            status = response.getcode()
            body = response.read(750_000).decode("utf-8", errors="replace")
    except Exception as exc:
        print(f"healthcheck fetch failed: {exc}", file=sys.stderr)
        return 1

    failures = []
    if status >= 400:
        failures.append(f"http_{status}")
    if url.endswith("/__origin/ready") or "/__origin/ready" in url:
        try:
            payload = json.loads(body)
        except Exception as exc:
            failures.append(f"invalid_ready_json:{exc}")
            payload = {}
        if payload.get("status") != "ok":
            failures.append("origin_not_ready:" + "|".join(payload.get("failures") or ["unknown"]))
        if failures:
            print("; ".join(failures), file=sys.stderr)
            return 1
        print("ok")
        return 0

    missing = [text for text in required if text not in body]
    if missing:
        failures.append("missing:" + "|".join(missing))
    leaked = [text for text in forbidden if text in body]
    if leaked:
        failures.append("forbidden:" + "|".join(leaked))

    if failures:
        print("; ".join(failures), file=sys.stderr)
        return 1
    print("ok")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
