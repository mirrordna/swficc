#!/usr/bin/env python3
import importlib.util
import json
from pathlib import Path


module_path = Path(__file__).with_name("serve-static-with-headers.py")
spec = importlib.util.spec_from_file_location("swfipn_static_gateway", module_path)
gateway = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(gateway)

checks = {
    "acronym_expands_to_canonical": gateway.upstream_search_query_variants("HKIC")
    == ["HKIC", "Hong Kong Investment Corporation"],
    "canonical_hkic_stays_exact": gateway.upstream_search_query_variants("Hong Kong Investment Corporation")
    == ["Hong Kong Investment Corporation"],
    "canonical_adia_stays_exact": gateway.upstream_search_query_variants("Abu Dhabi Investment Authority")
    == ["Abu Dhabi Investment Authority"],
    "unknown_query_stays_literal": gateway.upstream_search_query_variants("Ontario Teachers")
    == ["Ontario Teachers"],
}

receipt = {"status": "pass" if all(checks.values()) else "fail", "checks": checks}
print(json.dumps(receipt, indent=2))
raise SystemExit(0 if receipt["status"] == "pass" else 1)
