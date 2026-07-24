#!/usr/bin/env python3
from __future__ import annotations

import hashlib
import ipaddress
import json
import os
import re
import socket
import sys
from pathlib import Path
from urllib.parse import parse_qsl, unquote, urlsplit


POLICY_SCHEMA = "swfipn.mongo_source_policy.v1"


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


def canonical_digest(value: object) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def normalize_host(value: str) -> str:
    decoded = unquote(value).strip().strip("[]").rstrip(".").lower()
    if any(character in decoded for character in "/\\%") or not decoded:
        return ""
    try:
        return decoded.encode("idna").decode("ascii")
    except UnicodeError:
        return ""


def unsafe_address(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> bool:
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return not address.is_global or any((
        address.is_loopback,
        address.is_private,
        address.is_link_local,
        address.is_multicast,
        address.is_reserved,
        address.is_unspecified,
    ))


def unsafe_textual_host(host: str) -> bool:
    if not host or "." not in host:
        return True
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    if host in {"host.docker.internal", "gateway.docker.internal"}:
        return True
    try:
        return unsafe_address(ipaddress.ip_address(host))
    except ValueError:
        # Reject ambiguous all-numeric forms before DNS resolution.
        return bool(re.fullmatch(r"[0-9.]+", host))


def normalized_ip(value: str) -> str:
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return str(address)


def parse_mongo_uri(uri: str) -> tuple[str, list[str], dict[str, list[str]]]:
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        return "", [], {}
    parsed = urlsplit(uri)
    scheme = parsed.scheme.lower()
    authority = parsed.netloc.rsplit("@", 1)[-1]
    if not authority:
        return "", [], {}
    hosts: list[str] = []
    for item in authority.split(","):
        item = item.strip()
        if item.startswith("["):
            closing = item.find("]")
            raw_host = item[1:closing] if closing > 0 else ""
        else:
            raw_host = item.rsplit(":", 1)[0] if item.count(":") == 1 else item
        host = normalize_host(raw_host)
        if not host:
            return "", [], {}
        hosts.append(host)
    if scheme == "mongodb+srv" and (len(hosts) != 1 or ":" in authority):
        return "", [], {}
    options: dict[str, list[str]] = {}
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        options.setdefault(key.lower(), []).append(value.lower())
    return scheme, sorted(set(hosts)), options


def tls_is_secure(scheme: str, options: dict[str, list[str]]) -> bool:
    insecure_flags = (
        "tlsinsecure",
        "tlsallowinvalidcertificates",
        "tlsallowinvalidhostnames",
    )
    if any(value == "true" for key in insecure_flags for value in options.get(key, [])):
        return False
    tls_values = options.get("tls", []) + options.get("ssl", [])
    if any(value != "true" for value in tls_values):
        return False
    return scheme == "mongodb+srv" or bool(tls_values)


class EffectiveResolver:
    def __init__(self, fixture_path: Path | None):
        self.fixture = None
        if fixture_path is not None:
            if os.environ.get("SWFIPN_BACKEND_ENV_VERIFY_TEST_MODE") != "1":
                raise ValueError("fixture_not_allowed")
            self.fixture = json.loads(fixture_path.read_text(encoding="utf-8"))

    @property
    def mode(self) -> str:
        return "fixture" if self.fixture is not None else "live"

    def srv_targets(self, host: str) -> list[str]:
        if self.fixture is not None:
            raw_targets = self.fixture.get("srv", {}).get(host, [])
            targets = [normalize_host(item) for item in raw_targets]
        else:
            import dns.resolver

            answer = dns.resolver.resolve(
                f"_mongodb._tcp.{host}",
                "SRV",
                lifetime=10.0,
            )
            targets = [normalize_host(str(record.target)) for record in answer]
        if not targets or any(not target for target in targets):
            raise ValueError("srv_resolution_failed")
        return sorted(set(targets))

    def addresses(self, host: str) -> list[str]:
        if self.fixture is not None:
            raw_addresses = self.fixture.get("addresses", {}).get(host, [])
        else:
            raw_addresses = [
                item[4][0]
                for item in socket.getaddrinfo(host, None, type=socket.SOCK_STREAM)
            ]
        if not raw_addresses:
            raise ValueError("address_resolution_failed")
        return sorted({normalized_ip(item) for item in raw_addresses})


def fail_receipt(failure: str) -> int:
    print(json.dumps({
        "schema_version": "swfipn.backend_env_verification.v2",
        "status": "fail",
        "no_secret_values_written": True,
        "checks": {},
        "failures": [failure],
    }, sort_keys=True))
    return 1


def main() -> int:
    if len(sys.argv) not in {4, 5}:
        return fail_receipt("usage")

    env_path = Path(sys.argv[1])
    policy_path = Path(sys.argv[2])
    expected_policy_sha256 = sys.argv[3].lower()
    fixture_path = Path(sys.argv[4]) if len(sys.argv) == 5 else None
    if not re.fullmatch(r"[0-9a-f]{64}", expected_policy_sha256):
        return fail_receipt("invalid_expected_policy_digest")

    try:
        values = read_dotenv(env_path)
        policy_bytes = policy_path.read_bytes()
        policy = json.loads(policy_bytes)
        if not isinstance(policy, dict):
            raise ValueError("invalid_policy_shape")
        policy_sha256 = hashlib.sha256(policy_bytes).hexdigest()
        resolver = EffectiveResolver(fixture_path)
    except (OSError, UnicodeError, ValueError, json.JSONDecodeError):
        return fail_receipt("configuration_read_failed")

    try:
        scheme, uri_hosts, options = parse_mongo_uri(values.get("SWFI_MONGO_URI", ""))
    except ValueError:
        scheme, uri_hosts, options = "", [], {}
    configured_hosts = sorted({
        host
        for item in values.get("SWFI_MONGO_ALLOWED_HOSTS", "").split(",")
        if (host := normalize_host(item))
    })
    raw_policy_uri_hosts = policy.get("allowed_uri_hosts", [])
    raw_policy_srv_hosts = policy.get("allowed_srv_hosts", [])
    raw_policy_ips = policy.get("allowed_resolved_ips", [])
    policy_shape_valid = all(
        isinstance(items, list) and all(isinstance(item, str) for item in items)
        for items in (raw_policy_uri_hosts, raw_policy_srv_hosts, raw_policy_ips)
    )
    policy_uri_hosts = sorted({
        host
        for item in raw_policy_uri_hosts
        if policy_shape_valid and (host := normalize_host(item))
    })
    policy_srv_hosts = sorted({
        host
        for item in raw_policy_srv_hosts
        if policy_shape_valid and (host := normalize_host(item))
    })
    try:
        policy_ips = sorted({
            normalized_ip(item)
            for item in raw_policy_ips
            if policy_shape_valid
        })
    except ValueError:
        policy_ips = []

    policy_entries_valid = (
        policy.get("schema_version") == POLICY_SCHEMA
        and policy_shape_valid
        and bool(policy_uri_hosts)
        and bool(policy_ips)
        and all(not unsafe_textual_host(host) for host in policy_uri_hosts + policy_srv_hosts)
        and all(not unsafe_address(ipaddress.ip_address(item)) for item in policy_ips)
    )

    srv_targets: list[str] = []
    effective_ips: list[str] = []
    resolution_ok = bool(uri_hosts)
    try:
        if scheme == "mongodb+srv" and uri_hosts:
            srv_targets = resolver.srv_targets(uri_hosts[0])
            destination_hosts = srv_targets
        else:
            destination_hosts = uri_hosts
        for host in destination_hosts:
            effective_ips.extend(resolver.addresses(host))
        effective_ips = sorted(set(effective_ips))
    except Exception:
        # DNS libraries expose several resolver-specific exception families.
        # The verifier must fail closed without echoing a queried hostname.
        resolution_ok = False
        effective_ips = []

    checks = {
        "fact_source_is_mongo": values.get("SWFI2_FACT_SOURCE") == "mongo",
        "mongo_database_is_swfi": values.get("SWFI_MONGO_DB") == "swfi",
        "mongo_uri_is_valid": bool(scheme) and bool(uri_hosts),
        "mongo_tls_is_strict": tls_is_secure(scheme, options),
        "policy_schema_and_entries_valid": policy_entries_valid,
        "policy_digest_matches_pinned_value": policy_sha256 == expected_policy_sha256,
        "mongo_hosts_match_env_allowlist": (
            bool(configured_hosts)
            and bool(uri_hosts)
            and set(uri_hosts).issubset(configured_hosts)
            and set(configured_hosts).issubset(policy_uri_hosts)
        ),
        "mongo_hosts_match_pinned_policy": bool(uri_hosts) and set(uri_hosts).issubset(policy_uri_hosts),
        "srv_targets_match_pinned_policy": (
            scheme != "mongodb+srv"
            or (bool(srv_targets) and set(srv_targets).issubset(policy_srv_hosts))
        ),
        "effective_destinations_resolved": resolution_ok and bool(effective_ips),
        "effective_destinations_are_global": (
            bool(effective_ips)
            and all(not unsafe_address(ipaddress.ip_address(item)) for item in effective_ips)
        ),
        "effective_destinations_match_pinned_policy": (
            bool(effective_ips) and set(effective_ips).issubset(policy_ips)
        ),
    }
    failures = [name for name, ok in checks.items() if not ok]
    source_identity = {
        "scheme": scheme,
        "uri_hosts": uri_hosts,
        "srv_targets": srv_targets,
        "effective_ips": effective_ips,
        "database": values.get("SWFI_MONGO_DB", ""),
    }
    receipt = {
        "schema_version": "swfipn.backend_env_verification.v2",
        "status": "pass" if not failures else "fail",
        "no_secret_values_written": True,
        "resolver_mode": resolver.mode,
        "policy_sha256": policy_sha256,
        "configured_allowlist_sha256": canonical_digest(configured_hosts),
        "source_identity_sha256": canonical_digest(source_identity),
        "effective_destinations_sha256": canonical_digest(effective_ips),
        "counts": {
            "uri_hosts": len(uri_hosts),
            "srv_targets": len(srv_targets),
            "effective_destinations": len(effective_ips),
        },
        "checks": checks,
        "failures": failures,
    }
    print(json.dumps(receipt, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
