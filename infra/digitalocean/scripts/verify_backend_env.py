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


POLICY_SCHEMA = "swfipn.mongo_source_policy.v3"
RECEIPT_SCHEMA = "swfipn.backend_env_verification.v4"
DEFAULT_MONGO_PORT = 27017
POLICY_KEYS = {
    "schema_version",
    "connection_mode",
    "allowed_direct_endpoint",
    "allowed_resolved_ips",
    "runtime_dns_pin",
    "required_options",
}
TOPOLOGY_OPTIONS = {
    "loadbalanced",
    "replicaset",
    "srvmaxhosts",
    "srvservicename",
}


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
    if not host:
        return True
    try:
        ipaddress.ip_address(host)
        return True
    except ValueError:
        pass
    if "." not in host:
        return True
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    if host in {"host.docker.internal", "gateway.docker.internal"}:
        return True
    if bool(re.fullmatch(r"[0-9.]+", host)) or len(host) > 253:
        return True
    return any(
        not re.fullmatch(r"[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?", label)
        for label in host.split(".")
    )


def normalized_ip(value: str) -> str:
    address = ipaddress.ip_address(value)
    if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped:
        address = address.ipv4_mapped
    return str(address)


def valid_port(value: object) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and 1 <= value <= 65535


def parse_port(value: str | None, default: int = DEFAULT_MONGO_PORT) -> int:
    if value is None:
        return default
    if not re.fullmatch(r"[0-9]+", value):
        raise ValueError("invalid_port")
    port = int(value)
    if not valid_port(port):
        raise ValueError("invalid_port")
    return port


def parse_direct_endpoint(item: str) -> tuple[str, int]:
    item = item.strip()
    if item.startswith("["):
        closing = item.find("]")
        if closing <= 0:
            raise ValueError("invalid_ipv6_endpoint")
        raw_host = item[1:closing]
        remainder = item[closing + 1:]
        if remainder and not remainder.startswith(":"):
            raise ValueError("invalid_ipv6_endpoint")
        raw_port = remainder[1:] if remainder else None
    else:
        if item.count(":") > 1:
            raise ValueError("unbracketed_ipv6_endpoint")
        if ":" in item:
            raw_host, raw_port = item.rsplit(":", 1)
        else:
            raw_host, raw_port = item, None
    host = normalize_host(raw_host)
    if not host:
        raise ValueError("invalid_host")
    return host, parse_port(raw_port)


def normalized_options(raw_options: dict[str, list[str]]) -> dict[str, list[str]]:
    return {
        key: sorted(values)
        for key, values in sorted(raw_options.items())
    }


def parse_mongo_uri(
    uri: str,
) -> tuple[str, list[tuple[str, int]], str, dict[str, list[str]], bool]:
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        return "", [], "", {}, False
    parsed = urlsplit(uri)
    scheme = parsed.scheme.lower()
    authority = parsed.netloc.rsplit("@", 1)[-1]
    if not authority or parsed.fragment:
        return "", [], "", {}, False
    options: dict[str, list[str]] = {}
    canonical_separators = ";" not in parsed.query
    for key, value in parse_qsl(parsed.query, keep_blank_values=True, separator="&"):
        options.setdefault(key.lower(), []).append(value.lower())
    options = normalized_options(options)
    database = unquote(parsed.path).strip("/")
    if "/" in database:
        database = ""
    if scheme != "mongodb":
        return scheme, [], database, options, canonical_separators
    direct_endpoints = sorted({parse_direct_endpoint(item) for item in authority.split(",")})
    return scheme, direct_endpoints, database, options, canonical_separators


def tls_is_secure(options: dict[str, list[str]]) -> bool:
    insecure_flags = (
        "tlsinsecure",
        "tlsallowinvalidcertificates",
        "tlsallowinvalidhostnames",
        "tlsdisablecertificaterevocationcheck",
        "tlsdisableocspendpointcheck",
    )
    if any(value == "true" for key in insecure_flags for value in options.get(key, [])):
        return False
    if options.get("ssl"):
        return False
    return options.get("tls") == ["true"]


def parse_policy_endpoint(policy: dict[str, object]) -> tuple[str, int]:
    item = policy.get("allowed_direct_endpoint")
    if not isinstance(item, dict) or set(item) != {"host", "port"}:
        raise ValueError("invalid_policy_endpoint")
    raw_host = item["host"] if isinstance(item["host"], str) else ""
    host = normalize_host(raw_host)
    port = item["port"]
    if not host or raw_host != host or not valid_port(port):
        raise ValueError("invalid_policy_endpoint")
    return host, port


def parse_policy_ips(policy: dict[str, object]) -> list[str]:
    raw_items = policy.get("allowed_resolved_ips")
    if not isinstance(raw_items, list) or any(not isinstance(item, str) for item in raw_items):
        raise ValueError("invalid_policy_ips")
    normalized = [normalized_ip(item) for item in raw_items]
    if normalized != raw_items or len(normalized) != len(set(normalized)):
        raise ValueError("invalid_policy_ips")
    return sorted(normalized)


def parse_runtime_pin(policy: dict[str, object]) -> tuple[str, str]:
    item = policy.get("runtime_dns_pin")
    if not isinstance(item, dict) or set(item) != {"host", "ip"}:
        raise ValueError("invalid_runtime_pin")
    raw_host = item["host"] if isinstance(item["host"], str) else ""
    raw_ip = item["ip"] if isinstance(item["ip"], str) else ""
    host = normalize_host(raw_host)
    ip = normalized_ip(raw_ip) if raw_ip else ""
    if not host or not ip or raw_host != host or raw_ip != ip:
        raise ValueError("invalid_runtime_pin")
    return host, ip


def parse_policy_options(policy: dict[str, object]) -> dict[str, list[str]]:
    raw_options = policy.get("required_options")
    if not isinstance(raw_options, dict):
        raise ValueError("invalid_policy_options")
    options: dict[str, list[str]] = {}
    for key, values in raw_options.items():
        if (
            not isinstance(key, str)
            or key != key.lower()
            or not isinstance(values, list)
            or not values
            or any(not isinstance(value, str) or value != value.lower() for value in values)
        ):
            raise ValueError("invalid_policy_options")
        options[key] = sorted(values)
    return normalized_options(options)


class EffectiveResolver:
    def __init__(self, fixture_path: Path | None):
        self.fixture = None
        if fixture_path is not None:
            if os.environ.get("SWFIPN_BACKEND_ENV_VERIFY_TEST_MODE") != "1":
                raise ValueError("fixture_not_allowed")
            fixture = json.loads(fixture_path.read_text(encoding="utf-8"))
            if not isinstance(fixture, dict):
                raise ValueError("invalid_fixture")
            self.fixture = fixture

    @property
    def mode(self) -> str:
        return "fixture" if self.fixture is not None else "live"

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


def endpoint_json(endpoints: list[tuple[str, int]]) -> list[list[object]]:
    return [[host_or_ip, port] for host_or_ip, port in endpoints]


def fail_receipt(failure: str) -> int:
    print(json.dumps({
        "schema_version": RECEIPT_SCHEMA,
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
        scheme, direct_endpoints, uri_database, options, canonical_separators = parse_mongo_uri(
            values.get("SWFI_MONGO_URI", "")
        )
    except ValueError:
        scheme, direct_endpoints, uri_database, options, canonical_separators = "", [], "", {}, False

    configured_hosts = sorted({
        host
        for item in values.get("SWFI_MONGO_ALLOWED_HOSTS", "").split(",")
        if (host := normalize_host(item))
    })
    try:
        policy_direct_endpoint = parse_policy_endpoint(policy)
        policy_resolved_ips = parse_policy_ips(policy)
        runtime_pin = parse_runtime_pin(policy)
        policy_options = parse_policy_options(policy)
        policy_shape_valid = set(policy) == POLICY_KEYS
    except (TypeError, ValueError):
        policy_direct_endpoint = ("", 0)
        policy_resolved_ips = []
        runtime_pin = ("", "")
        policy_options = {}
        policy_shape_valid = False

    policy_host, policy_port = policy_direct_endpoint
    pin_host, pin_ip = runtime_pin
    policy_entries_valid = (
        policy.get("schema_version") == POLICY_SCHEMA
        and policy.get("connection_mode") == "direct_single_endpoint"
        and policy_shape_valid
        and not unsafe_textual_host(policy_host)
        and bool(policy_resolved_ips)
        and all(not unsafe_address(ipaddress.ip_address(ip)) for ip in policy_resolved_ips)
        and pin_host == policy_host
        and pin_ip in policy_resolved_ips
        and policy_options.get("tls") == ["true"]
        and policy_options.get("directconnection") == ["true"]
        and not any(key in policy_options for key in TOPOLOGY_OPTIONS)
    )

    effective_ips: list[str] = []
    resolution_ok = len(direct_endpoints) == 1
    if resolution_ok:
        try:
            effective_ips = resolver.addresses(direct_endpoints[0][0])
        except Exception:
            resolution_ok = False
            effective_ips = []
    effective_endpoints = [(ip, direct_endpoints[0][1]) for ip in effective_ips] if direct_endpoints else []

    checks = {
        "fact_source_is_mongo": values.get("SWFI2_FACT_SOURCE") == "mongo",
        "mongo_database_is_swfi": (
            values.get("SWFI_MONGO_DB") == "swfi"
            and uri_database == "swfi"
        ),
        "mongo_uri_is_direct_single_endpoint": (
            scheme == "mongodb"
            and len(direct_endpoints) == 1
        ),
        "mongo_option_separators_are_canonical": canonical_separators,
        "mongo_tls_is_strict": tls_is_secure(options),
        "mongo_topology_discovery_is_disabled": (
            options.get("directconnection") == ["true"]
            and not any(key in options for key in TOPOLOGY_OPTIONS)
        ),
        "mongo_options_match_pinned_policy": (
            bool(policy_options)
            and options == policy_options
        ),
        "policy_schema_and_entries_valid": policy_entries_valid,
        "policy_digest_matches_pinned_value": policy_sha256 == expected_policy_sha256,
        "mongo_hosts_match_env_allowlist": (
            len(configured_hosts) == 1
            and bool(direct_endpoints)
            and configured_hosts == [direct_endpoints[0][0]]
            and configured_hosts == [policy_host]
        ),
        "mongo_uri_endpoint_matches_pinned_policy": (
            direct_endpoints == [policy_direct_endpoint]
        ),
        "effective_destinations_resolved": resolution_ok and bool(effective_ips),
        "effective_destinations_are_global": (
            bool(effective_ips)
            and all(not unsafe_address(ipaddress.ip_address(ip)) for ip in effective_ips)
        ),
        "effective_destinations_match_pinned_policy": (
            bool(effective_ips)
            and set(effective_ips).issubset(policy_resolved_ips)
        ),
        "runtime_dns_pin_matches_verified_destination": (
            pin_host == policy_host
            and pin_ip in effective_ips
        ),
    }
    failures = [name for name, ok in checks.items() if not ok]
    runtime_pin_identity = [pin_host, pin_ip, policy_port]
    source_identity = {
        "scheme": scheme,
        "connection_mode": policy.get("connection_mode", ""),
        "direct_endpoints": endpoint_json(direct_endpoints),
        "effective_endpoints": endpoint_json(effective_endpoints),
        "runtime_dns_pin_sha256": canonical_digest(runtime_pin_identity),
        "database": uri_database,
        "options_sha256": canonical_digest(options),
    }
    receipt = {
        "schema_version": RECEIPT_SCHEMA,
        "status": "pass" if not failures else "fail",
        "no_secret_values_written": True,
        "resolver_mode": resolver.mode,
        "connection_mode": "direct_single_endpoint",
        "policy_sha256": policy_sha256,
        "configured_allowlist_sha256": canonical_digest(configured_hosts),
        "source_identity_sha256": canonical_digest(source_identity),
        "effective_destinations_sha256": canonical_digest(endpoint_json(effective_endpoints)),
        "runtime_dns_pin_sha256": canonical_digest(runtime_pin_identity),
        "options_sha256": canonical_digest(options),
        "required_options_sha256": canonical_digest(policy_options),
        "counts": {
            "direct_endpoints": len(direct_endpoints),
            "effective_destinations": len(effective_endpoints),
        },
        "checks": checks,
        "failures": failures,
    }
    print(json.dumps(receipt, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
