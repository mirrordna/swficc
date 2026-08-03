#!/usr/bin/env python3
import importlib.util
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


module_path = Path(__file__).with_name("serve-static-with-headers.py")
spec = importlib.util.spec_from_file_location("swfipn_static_gateway", module_path)
gateway = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(gateway)
gateway.PUBLIC_SEARCH_PRIMARY_CACHE_TTL_SECONDS = 2

os.environ["SWFIPN_AUTH_USE_KEYCHAIN"] = "0"
counter_lock = threading.Lock()
upstream_counts = {"public": 0, "source": 0}


class MockBackendHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        parsed = urllib.parse.urlparse(self.path)
        query = (urllib.parse.parse_qs(parsed.query).get("q") or [""])[0]
        lane = "public" if parsed.path == "/api/v1/public/search" else "source"
        with counter_lock:
            upstream_counts[lane] += 1
        time.sleep(0.1 if lane == "public" else 0.8)
        is_adia = "abu dhabi" in query.casefold()
        record = {
            "name": "Abu Dhabi Investment Authority" if is_adia else "Hong Kong Investment Corporation",
            "slug": "abu-dhabi-investment-authority" if is_adia else "hong-kong-investment-corporation",
            "type": "Sovereign Wealth Fund",
            "country": "United Arab Emirates" if is_adia else "Hong Kong",
            "source_url": "https://www.swfi.com/v1/entities/598cdaa50124e9fd2d05ae3d" if is_adia else "https://www.swfi.com/v1/entities/63502488d68aa29d9a0da8a5",
        }
        if lane == "source" and is_adia:
            body = json.dumps({"status": "unavailable", "fact": False, "data": {"rows": []}}).encode("utf-8")
            self.send_response(503)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        records = [record]
        if not is_adia and lane == "public":
            records.extend({
                "name": f"Hong Kong Investment Corporation Portfolio {index:02d}",
                "type": "Company",
                "country": "Hong Kong",
                "source_url": f"https://www.swfi.com/v1/entities/mock-public-{index:02d}",
            } for index in range(1, 25))
        if not is_adia and lane == "source":
            records.append({
                "name": "Hong Kong Investment Corporation Source Alpha",
                "type": "Sovereign Wealth Fund",
                "country": "Hong Kong",
                "source_url": "https://www.swfi.com/v1/entities/mock-source-alpha",
            })
        data = {"results": records, "query": query}
        if lane == "source":
            data["rows"] = records
        body = json.dumps({
            "status": "ok",
            "fact": True,
            "generated_at": "2026-08-02T12:00:00Z" if lane == "public" else "2026-08-02T12:00:01Z",
            "data": data,
        }).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


def request(origin, query="Hong Kong Investment Corporation"):
    target = f"{origin}/api/v1/public/search?{urllib.parse.urlencode({'q': query, 'limit': 25})}"
    started = time.monotonic()
    with urllib.request.urlopen(target, timeout=10) as response:
        return (
            response.headers.get("X-SWFIPN-Proxy-Cache"),
            json.loads(response.read()),
            time.monotonic() - started,
            response.headers.get("Cache-Control"),
        )


mock = ThreadingHTTPServer(("127.0.0.1", 0), MockBackendHandler)
mock_thread = threading.Thread(target=mock.serve_forever, daemon=True)
mock_thread.start()

proxy = gateway.StaticProxyServer(
    ("127.0.0.1", 0),
    gateway.StaticProxyHandler,
    Path(__file__).parent.parent / "out",
    f"http://127.0.0.1:{mock.server_port}",
    5,
    "",
)
proxy_thread = threading.Thread(target=proxy.serve_forever, daemon=True)
proxy_thread.start()
origin = f"http://127.0.0.1:{proxy.server_port}"

try:
    with ThreadPoolExecutor(max_workers=10) as executor:
        responses = list(executor.map(lambda _index: request(origin), range(10)))
    counts_after_cold = dict(upstream_counts)
    deadline = time.monotonic() + 3
    warm_state = ""
    warm_payload = {}
    while time.monotonic() < deadline:
        warm_state, warm_payload, _warm_seconds, warm_cache_control = request(origin)
        if warm_state == "HIT":
            break
        time.sleep(0.05)
    counts_after_exact = dict(upstream_counts)
    fuzzy_state, fuzzy_payload, fuzzy_seconds, _fuzzy_cache_control = request(origin, "Hong Kong Investment")
    gateway.PUBLIC_SEARCH_PRIMARY_CACHE_TTL_SECONDS = 0.2
    request(origin, "Abu Dhabi Investment")
    time.sleep(0.85)
    partial_state, partial_payload, _partial_seconds, partial_cache_control = request(origin, "Abu Dhabi Investment")
    counts_after_partial = dict(upstream_counts)
    time.sleep(0.5)
    retried_state, _retried_payload, _retried_seconds, retried_cache_control = request(origin, "Abu Dhabi Investment")
    time.sleep(0.1)
    checks = {
        "known_aliases_use_one_canonical_upstream_query": gateway.upstream_search_query_variants("ADIA")
        == ["Abu Dhabi Investment Authority"]
        and gateway.upstream_search_query_variants("HKIC") == ["Hong Kong Investment Corporation"],
        "all_requests_source_backed": all(payload.get("fact") is True for _, payload, _seconds, _cache_control in responses),
        "all_requests_canonical": all(
            payload.get("data", {}).get("results", [{}])[0].get("name") == "Hong Kong Investment Corporation"
            for _, payload, _seconds, _cache_control in responses
        ),
        "single_cold_fanout": counts_after_cold == {"public": 1, "source": 1},
        "stable_primary_precedes_source_cleanup": min(
            (seconds for state, _payload, seconds, _cache_control in responses if state == "MISS_PRIMARY_STABLE"),
            default=float("inf"),
        ) < 0.7,
        "stable_primary_state_is_explicit": sum(
            state == "MISS_PRIMARY_STABLE" for state, _payload, _seconds, _cache_control in responses
        ) == 1
        and all(
            state in {"MISS_PRIMARY_STABLE", "PRIMARY_PENDING"}
            for state, _payload, _seconds, _cache_control in responses
        ),
        "stable_primary_is_never_shared_cacheable": all(
            str(cache_control).startswith("no-store") for _state, _payload, _seconds, cache_control in responses
        ),
        "stable_primary_payload_is_immutable_public_snapshot": all(
            payload.get("data", {}).get("enrichment") == "stable_primary"
            and payload.get("data", {}).get("evidence_lanes") == {"public": True, "source_entity": False}
            for _state, payload, _seconds, _cache_control in responses
        ),
        "warm_request_is_hit": warm_state == "HIT",
        "warm_response_is_never_shared_cacheable": str(warm_cache_control).startswith("no-store"),
        "warm_request_avoids_upstream": counts_after_exact == counts_after_cold,
        "warm_payload_source_backed": warm_payload.get("fact") is True,
        "warm_payload_is_completed_enrichment": warm_payload.get("data", {}).get("enrichment") == "complete"
        and warm_payload.get("data", {}).get("evidence_lanes") == {"public": True, "source_entity": True}
        and warm_payload.get("data", {}).get("source_freshness", {}).get("complete") is True
        and warm_payload.get("data", {}).get("source_freshness", {}).get("atomic_snapshot") is False,
        "cold_responses_remain_immutable": len({
            json.dumps(payload, sort_keys=True) for _state, payload, _seconds, _cache_control in responses
        }) == 1,
        "fuzzy_query_waits_for_full_enrichment": fuzzy_state == "MISS"
        and fuzzy_seconds >= 0.7
        and fuzzy_payload.get("data", {}).get("enrichment") == "complete",
        "failed_source_retries_without_duplicate_public": counts_after_partial == {"public": 3, "source": 4},
        "failed_enrichment_is_explicitly_partial": partial_state == "MISS_PARTIAL"
        and str(partial_cache_control).startswith("no-store")
        and partial_payload.get("data", {}).get("enrichment") == "partial"
        and partial_payload.get("data", {}).get("evidence_lanes") == {"public": True, "source_entity": False},
        "partial_result_retries_after_short_ttl": retried_state == "MISS_PARTIAL"
        and str(retried_cache_control).startswith("no-store")
        and upstream_counts == {"public": 3, "source": 5},
    }
    receipt = {
        "status": "pass" if all(checks.values()) else "fail",
        "checks": checks,
        "cold_cache_states": sorted(state for state, _payload, _seconds, _cache_control in responses),
        "cold_max_seconds": round(max(seconds for _state, _payload, seconds, _cache_control in responses), 3),
        "fuzzy_seconds": round(fuzzy_seconds, 3),
        "partial_state": partial_state,
        "retried_state": retried_state,
        "upstream_counts": upstream_counts,
    }
    print(json.dumps(receipt, indent=2))
    raise SystemExit(0 if receipt["status"] == "pass" else 1)
finally:
    proxy.shutdown()
    proxy.server_close()
    mock.shutdown()
    mock.server_close()
