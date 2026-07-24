#!/usr/bin/env python3
import json
import ipaddress
import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlsplit


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


def normalize_host(value: str) -> str:
    return unquote(value).strip().strip("[]").rstrip(".").lower()


def local_or_unsafe_host(host: str) -> bool:
    if not host or "." not in host or any(character in host for character in "/\\%"):
        return True
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    if host in {"host.docker.internal", "gateway.docker.internal"}:
        return True
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return bool(re.fullmatch(r"[0-9.]+", host))
    return any((
        address.is_loopback,
        address.is_private,
        address.is_link_local,
        address.is_multicast,
        address.is_reserved,
        address.is_unspecified,
    ))


def mongo_hosts(uri: str) -> list[str]:
    if not uri or not uri.startswith(("mongodb://", "mongodb+srv://")):
        return []
    parsed = urlsplit(uri)
    authority = parsed.netloc.rsplit("@", 1)[-1].lower()
    if not authority:
        return []
    hosts = []
    for item in authority.split(","):
        item = item.strip()
        if item.startswith("["):
            closing = item.find("]")
            raw_host = item[1:closing] if closing > 0 else ""
        else:
            raw_host = item.rsplit(":", 1)[0] if item.count(":") == 1 else item
        hosts.append(normalize_host(raw_host))
    return hosts


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"status": "fail", "failure": "usage", "no_secret_values_written": True}))
        return 2

    values = read_dotenv(Path(sys.argv[1]))
    hosts = mongo_hosts(values.get("SWFI_MONGO_URI", ""))
    allowed_hosts = {
        normalize_host(item)
        for item in values.get("SWFI_MONGO_ALLOWED_HOSTS", "").split(",")
        if normalize_host(item)
    }
    checks = {
        "fact_source_is_mongo": values.get("SWFI2_FACT_SOURCE") == "mongo",
        "mongo_database_is_swfi": values.get("SWFI_MONGO_DB") == "swfi",
        "mongo_uri_hosts_are_remote": bool(hosts) and all(not local_or_unsafe_host(host) for host in hosts),
        "mongo_hosts_match_explicit_allowlist": bool(allowed_hosts) and bool(hosts) and set(hosts).issubset(allowed_hosts),
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
