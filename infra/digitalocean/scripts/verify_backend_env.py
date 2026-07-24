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


POLICY_SCHEMA = "swfipn.mongo_source_policy.v2"
DEFAULT_MONGO_PORT = 27017
DEFAULT_SRV_SERVICE = "mongodb"


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
        return unsafe_address(ipaddress.ip_address(host))
    except ValueError:
        pass
    if "." not in host:
        return True
    if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
        return True
    if host in {"host.docker.internal", "gateway.docker.internal"}:
        return True
    # Reject ambiguous all-numeric forms before DNS resolution.
    return bool(re.fullmatch(r"[0-9.]+", host))


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


def parse_mongo_uri(
    uri: str,
) -> tuple[str, list[str], list[tuple[str, int]], dict[str, list[str]], bool]:
    if not uri.startswith(("mongodb://", "mongodb+srv://")):
        return "", [], [], {}, False
    parsed = urlsplit(uri)
    scheme = parsed.scheme.lower()
    authority = parsed.netloc.rsplit("@", 1)[-1]
    if not authority:
        return "", [], [], {}, False
    options: dict[str, list[str]] = {}
    canonical_separators = ";" not in parsed.query
    for key, value in parse_qsl(parsed.query, keep_blank_values=True, separator="&"):
        options.setdefault(key.lower(), []).append(value.lower())

    if scheme == "mongodb+srv":
        if "," in authority or authority.startswith("[") or ":" in authority:
            return "", [], [], options, canonical_separators
        seed_host = normalize_host(authority)
        return (
            scheme,
            [seed_host] if seed_host else [],
            [],
            options,
            canonical_separators,
        )

    direct_endpoints = sorted({parse_direct_endpoint(item) for item in authority.split(",")})
    return scheme, [], direct_endpoints, options, canonical_separators


def tls_is_secure(scheme: str, options: dict[str, list[str]]) -> bool:
    insecure_flags = (
        "tlsinsecure",
        "tlsallowinvalidcertificates",
        "tlsallowinvalidhostnames",
        "tlsdisablecertificaterevocationcheck",
        "tlsdisableocspendpointcheck",
    )
    if any(value == "true" for key in insecure_flags for value in options.get(key, [])):
        return False
    tls_values = options.get("tls", []) + options.get("ssl", [])
    if any(value != "true" for value in tls_values):
        return False
    return scheme == "mongodb+srv" or bool(tls_values)


def srv_service_is_default(options: dict[str, list[str]]) -> bool:
    values = options.get("srvservicename", [])
    return not values or values == [DEFAULT_SRV_SERVICE]


def parse_policy_hosts(policy: dict[str, object], key: str) -> list[str]:
    raw_items = policy.get(key)
    if not isinstance(raw_items, list) or any(not isinstance(item, str) for item in raw_items):
        raise ValueError("invalid_policy_hosts")
    hosts = [normalize_host(item) for item in raw_items]
    if any(not host for host in hosts):
        raise ValueError("invalid_policy_hosts")
    return sorted(set(hosts))


def parse_policy_host_endpoints(policy: dict[str, object], key: str) -> list[tuple[str, int]]:
    raw_items = policy.get(key)
    if not isinstance(raw_items, list):
        raise ValueError("invalid_policy_endpoints")
    endpoints: list[tuple[str, int]] = []
    for item in raw_items:
        if not isinstance(item, dict) or set(item) != {"host", "port"}:
            raise ValueError("invalid_policy_endpoints")
        host = normalize_host(item["host"]) if isinstance(item["host"], str) else ""
        port = item["port"]
        if not host or not valid_port(port):
            raise ValueError("invalid_policy_endpoints")
        endpoints.append((host, port))
    return sorted(set(endpoints))


def parse_policy_resolved_endpoints(policy: dict[str, object]) -> list[tuple[str, int]]:
    raw_items = policy.get("allowed_resolved_endpoints")
    if not isinstance(raw_items, list):
        raise ValueError("invalid_policy_resolved_endpoints")
    endpoints: list[tuple[str, int]] = []
    for item in raw_items:
        if not isinstance(item, dict) or set(item) != {"ip", "port"}:
            raise ValueError("invalid_policy_resolved_endpoints")
        if not isinstance(item["ip"], str) or not valid_port(item["port"]):
            raise ValueError("invalid_policy_resolved_endpoints")
        endpoints.append((normalized_ip(item["ip"]), item["port"]))
    return sorted(set(endpoints))


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

    def srv_endpoints(self, seed_host: str, service_name: str) -> list[tuple[str, int]]:
        if self.fixture is not None:
            raw_endpoints = self.fixture.get("srv", {}).get(seed_host, [])
            endpoints = []
            for item in raw_endpoints:
                if not isinstance(item, dict):
                    raise ValueError("invalid_srv_fixture")
                host = normalize_host(item.get("host", ""))
                port = item.get("port")
                if not host or not valid_port(port):
                    raise ValueError("invalid_srv_fixture")
                endpoints.append((host, port))
        else:
            import dns.resolver

            answer = dns.resolver.resolve(
                f"_{service_name}._tcp.{seed_host}",
                "SRV",
                lifetime=10.0,
            )
            endpoints = [
                (normalize_host(str(record.target)), int(record.port))
                for record in answer
            ]
        if not endpoints or any(not host or not valid_port(port) for host, port in endpoints):
            raise ValueError("srv_resolution_failed")
        return sorted(set(endpoints))

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
        "schema_version": "swfipn.backend_env_verification.v3",
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
        scheme, seed_hosts, direct_endpoints, options, canonical_separators = parse_mongo_uri(
            values.get("SWFI_MONGO_URI", "")
        )
    except ValueError:
        scheme, seed_hosts, direct_endpoints, options, canonical_separators = "", [], [], {}, False

    configured_hosts = sorted({
        host
        for item in values.get("SWFI_MONGO_ALLOWED_HOSTS", "").split(",")
        if (host := normalize_host(item))
    })
    try:
        policy_seed_hosts = parse_policy_hosts(policy, "allowed_seed_hosts")
        policy_direct_endpoints = parse_policy_host_endpoints(policy, "allowed_direct_endpoints")
        policy_srv_endpoints = parse_policy_host_endpoints(policy, "allowed_srv_endpoints")
        policy_resolved_endpoints = parse_policy_resolved_endpoints(policy)
        policy_shape_valid = True
    except (TypeError, ValueError):
        policy_seed_hosts = []
        policy_direct_endpoints = []
        policy_srv_endpoints = []
        policy_resolved_endpoints = []
        policy_shape_valid = False

    policy_host_endpoints = policy_direct_endpoints + policy_srv_endpoints
    policy_entries_valid = (
        policy.get("schema_version") == POLICY_SCHEMA
        and policy_shape_valid
        and bool(policy_resolved_endpoints)
        and bool(policy_seed_hosts or policy_direct_endpoints)
        and all(not unsafe_textual_host(host) for host in policy_seed_hosts)
        and all(not unsafe_textual_host(host) for host, _ in policy_host_endpoints)
        and all(
            not unsafe_address(ipaddress.ip_address(ip))
            for ip, _ in policy_resolved_endpoints
        )
    )

    srv_service_name = (
        options.get("srvservicename", [DEFAULT_SRV_SERVICE])[0]
        if srv_service_is_default(options)
        else ""
    )
    srv_endpoints: list[tuple[str, int]] = []
    effective_endpoints: list[tuple[str, int]] = []
    resolution_ok = bool(seed_hosts or direct_endpoints)
    try:
        if scheme == "mongodb+srv" and seed_hosts and srv_service_name:
            srv_endpoints = resolver.srv_endpoints(seed_hosts[0], srv_service_name)
            connection_endpoints = srv_endpoints
        else:
            connection_endpoints = direct_endpoints
        for host, port in connection_endpoints:
            effective_endpoints.extend(
                (address, port)
                for address in resolver.addresses(host)
            )
        effective_endpoints = sorted(set(effective_endpoints))
    except Exception:
        # DNS libraries expose several resolver-specific exception families.
        # The verifier must fail closed without echoing a queried hostname.
        resolution_ok = False
        effective_endpoints = []

    uri_hosts = seed_hosts or sorted({host for host, _ in direct_endpoints})
    checks = {
        "fact_source_is_mongo": values.get("SWFI2_FACT_SOURCE") == "mongo",
        "mongo_database_is_swfi": values.get("SWFI_MONGO_DB") == "swfi",
        "mongo_uri_is_valid": bool(scheme) and bool(uri_hosts),
        "mongo_option_separators_are_canonical": canonical_separators,
        "mongo_tls_is_strict": tls_is_secure(scheme, options),
        "srv_service_name_is_default": srv_service_is_default(options),
        "policy_schema_and_entries_valid": policy_entries_valid,
        "policy_digest_matches_pinned_value": policy_sha256 == expected_policy_sha256,
        "mongo_hosts_match_env_allowlist": (
            bool(configured_hosts)
            and bool(uri_hosts)
            and set(uri_hosts).issubset(configured_hosts)
            and set(configured_hosts).issubset(
                set(policy_seed_hosts)
                | {host for host, _ in policy_direct_endpoints}
            )
        ),
        "mongo_uri_endpoints_match_pinned_policy": (
            set(seed_hosts).issubset(policy_seed_hosts)
            if scheme == "mongodb+srv"
            else bool(direct_endpoints) and set(direct_endpoints).issubset(policy_direct_endpoints)
        ),
        "srv_endpoints_match_pinned_policy": (
            scheme != "mongodb+srv"
            or (bool(srv_endpoints) and set(srv_endpoints).issubset(policy_srv_endpoints))
        ),
        "effective_destinations_resolved": resolution_ok and bool(effective_endpoints),
        "effective_destinations_are_global": (
            bool(effective_endpoints)
            and all(
                not unsafe_address(ipaddress.ip_address(ip))
                for ip, _ in effective_endpoints
            )
        ),
        "effective_destinations_match_pinned_policy": (
            bool(effective_endpoints)
            and set(effective_endpoints).issubset(policy_resolved_endpoints)
        ),
    }
    failures = [name for name, ok in checks.items() if not ok]
    source_identity = {
        "scheme": scheme,
        "seed_hosts": seed_hosts,
        "direct_endpoints": endpoint_json(direct_endpoints),
        "srv_service_name": srv_service_name,
        "srv_endpoints": endpoint_json(srv_endpoints),
        "effective_endpoints": endpoint_json(effective_endpoints),
        "database": values.get("SWFI_MONGO_DB", ""),
        "options_sha256": canonical_digest(options),
    }
    receipt = {
        "schema_version": "swfipn.backend_env_verification.v3",
        "status": "pass" if not failures else "fail",
        "no_secret_values_written": True,
        "resolver_mode": resolver.mode,
        "policy_sha256": policy_sha256,
        "configured_allowlist_sha256": canonical_digest(configured_hosts),
        "source_identity_sha256": canonical_digest(source_identity),
        "effective_destinations_sha256": canonical_digest(endpoint_json(effective_endpoints)),
        "options_sha256": canonical_digest(options),
        "counts": {
            "seed_hosts": len(seed_hosts),
            "direct_endpoints": len(direct_endpoints),
            "srv_endpoints": len(srv_endpoints),
            "effective_destinations": len(effective_endpoints),
        },
        "checks": checks,
        "failures": failures,
    }
    print(json.dumps(receipt, sort_keys=True))
    return 0 if not failures else 1


if __name__ == "__main__":
    raise SystemExit(main())
