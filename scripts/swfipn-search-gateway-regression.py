#!/usr/bin/env python3
import importlib.util
import inspect
import json
import time
from pathlib import Path


module_path = Path(__file__).with_name("serve-static-with-headers.py")
spec = importlib.util.spec_from_file_location("swfipn_static_gateway", module_path)
gateway = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(gateway)

cache = gateway.BoundedTTLCache(max_entries=2, ttl_seconds=1)
cache["first"] = {"stored_at": time.time(), "body": b"first"}
cache["second"] = {"stored_at": time.time(), "body": b"second"}
cache["third"] = {"stored_at": time.time(), "body": b"third"}
cache["expired"] = {"stored_at": time.time() - 2, "body": b"expired"}
short_cache = gateway.BoundedTTLCache(max_entries=1, ttl_seconds=60)
short_cache["short-lived"] = {"stored_at": time.time() - 0.2, "ttl_seconds": 0.1, "body": b"short-lived"}

canonical_hkic = {
    "name": "Hong Kong Investment Corporation",
    "source_url": "https://www.swfi.com/v1/entities/63502488d68aa29d9a0da8a5",
}

server = object.__new__(gateway.StaticProxyServer)
server.public_search_locks = [gateway.Lock() for _ in range(64)]
same_lock_coalesces = server.public_search_lock("same-query") is server.public_search_lock("same-query")

handler = object.__new__(gateway.StaticProxyHandler)
handler.server = object.__new__(gateway.StaticProxyServer)
handler.server.public_search_cache = gateway.BoundedTTLCache(max_entries=2, ttl_seconds=60)
handler.server.public_search_upstream_slots = gateway.BoundedSemaphore(1)
handler.server.public_search_upstream_slots.acquire()
original_wait = gateway.PUBLIC_SEARCH_QUEUE_WAIT_SECONDS
gateway.PUBLIC_SEARCH_QUEUE_WAIT_SECONDS = 0.01
try:
    busy_body, busy_cacheable, busy_state = handler.build_enhanced_public_search("capacity probe", 25, "capacity-probe")
finally:
    gateway.PUBLIC_SEARCH_QUEUE_WAIT_SECONDS = original_wait
    handler.server.public_search_upstream_slots.release()
busy_payload = json.loads(busy_body)

checks = {
    "acronym_resolves_to_one_canonical_upstream": gateway.upstream_search_query_variants("HKIC")
    == ["Hong Kong Investment Corporation"]
    and gateway.upstream_search_query_variants("ADIA") == ["Abu Dhabi Investment Authority"],
    "canonical_hkic_stays_exact": gateway.upstream_search_query_variants("Hong Kong Investment Corporation")
    == ["Hong Kong Investment Corporation"],
    "canonical_adia_stays_exact": gateway.upstream_search_query_variants("Abu Dhabi Investment Authority")
    == ["Abu Dhabi Investment Authority"],
    "unknown_query_stays_literal": gateway.upstream_search_query_variants("Ontario Teachers")
    == ["Ontario Teachers"],
    "cache_is_bounded": len(cache) == 2,
    "cache_evicts_oldest": cache.get("first") is None,
    "cache_keeps_recent": cache.get("third", {}).get("body") == b"third",
    "cache_expires_stale": cache.get("expired") is None,
    "cache_honors_entry_ttl": short_cache.get("short-lived") is None,
    "identical_queries_share_lock": same_lock_coalesces,
    "canonical_exact_result_is_fast_path_eligible": gateway.has_exact_canonical_search_result(
        "HKIC", [canonical_hkic]
    ),
    "fuzzy_result_is_not_fast_path_eligible": not gateway.has_exact_canonical_search_result(
        "Hong Kong Investment", [canonical_hkic]
    ),
    "noncanonical_source_is_not_fast_path_eligible": not gateway.has_exact_canonical_search_result(
        "HKIC", [{**canonical_hkic, "source_url": "https://example.com/entities/hkic"}]
    ),
    "background_cleanup_cannot_mutate_cached_results": not hasattr(handler, "finish_enhanced_public_search")
    and not hasattr(handler, "enrichment_job_is_current")
    and list(inspect.signature(handler.finish_stable_primary_cleanup).parameters) == ["executor", "futures"],
    "capacity_exhaustion_fails_closed": busy_state == "BUSY"
    and busy_cacheable is False
    and busy_payload.get("fact") is False
    and busy_payload.get("data", {}).get("reason") == "search_capacity_exhausted",
}

receipt = {"status": "pass" if all(checks.values()) else "fail", "checks": checks}
print(json.dumps(receipt, indent=2))
raise SystemExit(0 if receipt["status"] == "pass" else 1)
