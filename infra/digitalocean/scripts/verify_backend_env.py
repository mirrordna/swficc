#!/usr/bin/env python3
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlsplit


def read_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("export "):
            line = line[7:].lstrip()
        match = re.match(r"^([A-Za-z_][A-Za-z0-9_]*)=(.*)$", line)
        if not match:
            continue
        value = match.group(2).strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            value = value[1:-1]
        values[match.group(1)] = value
    return values


def remote_mongo_uri(uri: str) -> bool:
    if not uri or not uri.startswith(("mongodb://", "mongodb+srv://")):
        return False
    parsed = urlsplit(uri)
    authority = parsed.netloc.rsplit("@", 1)[-1].lower()
    if not authority:
        return False
    forbidden = {"localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"}
    hosts = [item.rsplit(":", 1)[0].strip("[]") for item in authority.split(",")]
    return bool(hosts) and all(host and host not in forbidden for host in hosts)


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "fail", "failure": "usage", "no_secret_values_written": True}))
        return 2

    values = read_dotenv(Path(sys.argv[1]))
    checks = {
        "fact_source_is_mongo": values.get("SWFI2_FACT_SOURCE") == "mongo",
        "mongo_database_is_swfi": values.get("SWFI_MONGO_DB") == "swfi",
        "mongo_uri_is_present_and_remote": remote_mongo_uri(values.get("SWFI_MONGO_URI", "")),
    }
    failures = [name for name, ok in checks.items() if not ok]
    receipt = {
        "schema_version": "swfipn.backend_env_verification.v1",
        "status": "pass" if not failures else "fail",
        "no_secret_values_written": True,
        "checks": checks,
        "failures": failures,
    }
    print(json.dumps(receipt, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
