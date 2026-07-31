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
        time.sleep(0.2)
        record = {
            "name": "Hong Kong Investment Corporation",
            "slug": "hong-kong-investment-corporation",
            "type": "Sovereign Wealth Fund",
            "country": "Hong Kong",
            "source_url": "https://www.swfi.com/v1/entities/63502488d68aa29d9a0da8a5",
        }
        data = {"results": [record], "query": query}
        if lane == "source":
            data["rows"] = [record]
        body = json.dumps({"status": "ok", "fact": True, "data": data}).encode("utf-8")
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, _format, *_args):
        return


def request(origin):
    target = f"{origin}/api/v1/public/search?q=Hong%20Kong%20Investment%20Corporation&limit=25"
    with urllib.request.urlopen(target, timeout=10) as response:
        return response.headers.get("X-SWFIPN-Proxy-Cache"), json.loads(response.read())


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
    warm_state, warm_payload = request(origin)
    checks = {
        "all_requests_source_backed": all(payload.get("fact") is True for _, payload in responses),
        "all_requests_canonical": all(
            payload.get("data", {}).get("results", [{}])[0].get("name") == "Hong Kong Investment Corporation"
            for _, payload in responses
        ),
        "single_cold_fanout": counts_after_cold == {"public": 1, "source": 1},
        "coalesced_waiters_observed": any(state == "COALESCED" for state, _ in responses),
        "warm_request_is_hit": warm_state == "HIT",
        "warm_request_avoids_upstream": upstream_counts == counts_after_cold,
        "warm_payload_source_backed": warm_payload.get("fact") is True,
    }
    receipt = {
        "status": "pass" if all(checks.values()) else "fail",
        "checks": checks,
        "cold_cache_states": sorted(state for state, _ in responses),
        "upstream_counts": upstream_counts,
    }
    print(json.dumps(receipt, indent=2))
    raise SystemExit(0 if receipt["status"] == "pass" else 1)
finally:
    proxy.shutdown()
    proxy.server_close()
    mock.shutdown()
    mock.server_close()
