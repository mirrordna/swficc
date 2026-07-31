#!/usr/bin/env python3
import argparse
import base64
import datetime
import hashlib
import hmac
import json
import math
import mimetypes
import os
import posixpath
import re
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler
from pathlib import Path


SECURITY_HEADERS = {
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' https://cloudflareinsights.com https://static.cloudflareinsights.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}

HOP_BY_HOP = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailers",
    "transfer-encoding",
    "upgrade",
}

SESSION_COOKIE_NAME = "__swfipn_session"
SESSION_TTL_SECONDS = int(os.environ.get("SWFIPN_AUTH_SESSION_TTL_SECONDS", str(12 * 60 * 60)))
PUBLIC_JSON_PATH_PREFIXES = ("/api/", "/v1/")
PUBLIC_SEARCH_CACHE_TTL_SECONDS = int(os.environ.get("SWFIPN_PUBLIC_SEARCH_CACHE_TTL_SECONDS", "300"))
SEARCH_QUERY_SYNONYMS = {
    "adia": ["Abu Dhabi Investment Authority"],
    "adq": ["Abu Dhabi Developmental Holding Company"],
    "cic": ["China Investment Corporation"],
    "gpfg": ["Government Pension Fund Global"],
    "gpif": ["Government Pension Investment Fund Japan"],
    "hkic": ["Hong Kong Investment Corporation"],
    "pif": ["Public Investment Fund"],
    "qia": ["Qatar Investment Authority"],
    "safe": ["State Administration of Foreign Exchange"],
}
SHORT_SEARCH_QUERY_MAX = 3
PUBLIC_RESTRICTED_KEYS = {
    "_id",
    "id",
    "schema_version",
    "doctrine_id",
    "state",
    "result_qualifier",
    "source_gap",
    "source_gap_reason",
    "source_filter",
    "source_contract",
    "source_receipt",
    "source_doc_count",
    "source_links",
    "provenance",
    "truth_state",
    "source_collection",
    "source_record_id",
    "entity_id",
    "institution_id",
    "buyer_entity_id",
    "seller_entity_id",
    "deal_ids",
    "aum_source_record_id",
    "source_doc_id",
    "source_doc_ids",
}


def b64url(data):
    return base64.urlsafe_b64encode(data).decode("ascii").rstrip("=")


def b64url_decode(value):
    padding = "=" * (-len(value) % 4)
    return base64.urlsafe_b64decode(f"{value}{padding}".encode("ascii"))


def safe_equal(left, right):
    return hmac.compare_digest(str(left or "").encode("utf-8"), str(right or "").encode("utf-8"))


def escape_html(value):
    return str(value or "").replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&#039;")


def sanitized_display_name(value):
    text = re.sub(r"[\r\n\t]+", " ", str(value or ""))
    text = re.sub(r"\s+", " ", text).strip()
    text = re.sub(r"[<>]", "", text)
    if "@" in text:
        return ""
    return text[:60]


def search_text(value):
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9]+", " ", str(value or "").lower().replace("&", " and "))).strip()


def search_query_variants(query):
    clean = str(query or "").strip()
    if not clean:
        return []
    seen = set()
    variants = []
    normalized = search_text(clean)
    reverse_aliases = [
        alias.upper() if re.fullmatch(r"\w{2,12}", alias) else alias
        for alias, canonical_names in SEARCH_QUERY_SYNONYMS.items()
        if any(search_text(name) == normalized for name in canonical_names)
    ]
    for value in [clean, *SEARCH_QUERY_SYNONYMS.get(normalized, []), *reverse_aliases]:
        variant = str(value or "").strip()
        key = search_text(variant)
        if not variant or key in seen:
            continue
        seen.add(key)
        variants.append(variant)
    return variants[:3]


def is_canonical_search_query(query):
    normalized = search_text(query)
    return any(
        search_text(canonical_name) == normalized
        for canonical_names in SEARCH_QUERY_SYNONYMS.values()
        for canonical_name in canonical_names
    )


def upstream_search_query_variants(query):
    clean = str(query or "").strip()
    return [clean] if clean and is_canonical_search_query(clean) else search_query_variants(clean)


def is_natural_language_intent_query(query):
    """Route supported natural-language intents to the category-aware Next app.

    The server-rendered fallback is intentionally limited to literal entity search;
    it cannot execute the source-specific query plans used by the dashboard app.
    """
    clean = search_text(query)
    if not clean:
        return False

    region = bool(re.search(
        r"\b(?:middle east(?:ern)?|mena|gcc|emea|europe(?:an)?|eu|apac|asia(?:n)?|africa(?:n)?|north america(?:n)?|latin america(?:n)?|latam|americas|australia(?:n)?(?: and pacific)?|pacific|oceania)\b",
        clean,
    ))
    entity = bool(re.search(
        r"\b(?:sovereign wealth funds?|swfs?|sovereign investors?|(?:public |private )?(?:pension funds?|pension plans?|retirement systems?)|superannuation (?:funds?|schemes?)|super funds?|central banks?|family offices?|endowments?(?: plans?)?|foundations?|insurance companies|insurers?|asset managers?|investment consultants?)\b",
        clean,
    ))
    theme = bool(re.search(
        r"\b(?:ai|artificial intelligence|machine learning|generative ai|cyber(?:security)?|semiconductors?|chips?|biotech|biotechnology|renewables?|renewable energy|healthcare|health care|life sciences?|real estate|property|infrastructure|agriculture|agritech|software|information technology|technology|tech|financials?|financial services|energy|industrials?)\b",
        clean,
    ))
    investment_action = bool(re.search(
        r"\b(?:invest(?:ing|ed|ments?)?|deals?|transactions?|allocat(?:ing|ed) to|deploy(?:ing|ed) (?:capital )?(?:in|into)|exposure to|back(?:ing|ed)|commit(?:ting|ted) to)\b",
        clean,
    ))
    active = bool(
        re.search(r"\b(?:top|most) active (?:institutional )?(?:investors?|allocators?|lps?|asset owners?)\b", clean)
        or re.search(r"\bactive (?:investors?|allocators?|lps?|asset owners?)\b", clean)
        or re.search(r"\b(?:top|most) active (?:sovereign|pension|retirement|superannuation|family|endowment|foundation|insurance|asset|investment)\b", clean)
        or re.search(r"\bactively (?:deploying|allocating|committing) capital\b", clean)
        or re.search(r"\bmaking new manager commitments\b", clean)
    )
    if active:
        return True
    if region and re.search(r"\b(?:rfps?|requests? for proposals?|mandates?|opportunities|manager searches?|investment searches?|open searches?|active searches?)\b", clean):
        return True
    if entity and theme and investment_action and not region:
        return True
    return bool(region and entity and not investment_action)


def search_record_key(row):
    source = str(row.get("source_url") or row.get("swfi_url") or row.get("url") or row.get("profile_url") or "").strip()
    if source:
        return search_text(source)
    record_id = str(row.get("entity_id") or row.get("person_id") or row.get("transaction_id") or row.get("compass_id") or row.get("source_record_id") or row.get("id") or "").strip()
    if record_id:
        return search_text(record_id)
    return search_text("|".join(str(row.get(key) or "") for key in ("name", "title", "institution", "country", "type")))


def dedupe_search_rows(rows):
    seen = set()
    deduped = []
    for row in rows:
        if not isinstance(row, dict):
            continue
        key = search_record_key(row)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return deduped


def acronym_for_name(value):
    stop_words = {"and", "of", "the", "for", "in", "group", "company", "corporation", "corp", "limited", "ltd", "llc", "plc"}
    return "".join(part[:1].upper() for part in search_text(value).split() if part and part not in stop_words)


def token_starts_with(value, query):
    return any(part.startswith(query) for part in search_text(value).split())


def numeric_sort_value(value):
    text = str(value or "").strip()
    if not text or re.search(r"not disclosed|unavailable", text, re.I):
        return None
    compact = re.sub(r"\b(usd|us\$|aum|deals?|rows?|source matches?)\b", "", text, flags=re.I).strip()
    unit_match = re.search(r"(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMBT])\b", compact, re.I)
    if unit_match:
        unit = unit_match.group(2).upper()
        multiplier = {"K": 1_000, "M": 1_000_000, "B": 1_000_000_000, "T": 1_000_000_000_000}.get(unit, 1)
        return float(unit_match.group(1).replace(",", "")) * multiplier
    numeric_match = re.search(r"-?[0-9][0-9,]*(?:\.[0-9]+)?", compact)
    if not numeric_match:
        return None
    try:
        return float(numeric_match.group(0).replace(",", ""))
    except ValueError:
        return None


def business_hierarchy_score(type_text):
    value = search_text(type_text)
    if "sovereign wealth fund" in value:
        return 900
    if re.search(r"public pension|pension fund|pension", value):
        return 780
    if re.search(r"government fund|investment authority", value):
        return 680
    if "central bank" in value:
        return 560
    if "development bank" in value:
        return 500
    if re.search(r"state owned enterprise|state-owned enterprise", value):
        return 380
    if re.search(r"asset manager|fund manager|advisor", value):
        return 260
    if re.search(r"insurance|bank", value):
        return 160
    if "government" in value:
        return 120
    return 0


def business_name_score(name):
    value = search_text(name)
    if "investment authority" in value:
        return 300
    if "developmental holding" in value:
        return 220
    if "public investment fund" in value:
        return 160
    if "pension fund" in value:
        return 80
    if "investment council" in value:
        return 50
    return 0


def capital_scale_score(row):
    value = numeric_sort_value(row.get("aum") or row.get("assets") or row.get("managed_assets") or row.get("amount") or row.get("capital") or "")
    if not value or value <= 0:
        return 0
    return min(240, round(math.log10(value + 1) * 18))


def search_relevance_score(row, query):
    clean = search_text(query)
    if not clean:
        return 0
    name = search_text(row.get("name") or row.get("title") or row.get("institution") or row.get("buyer_entity") or "")
    slug = search_text(str(row.get("slug") or "").replace("-", " "))
    type_text = search_text(row.get("type") or row.get("entity_type") or row.get("asset_class_or_strategy") or row.get("strategy") or "")
    country = search_text(row.get("country") or "")
    region = search_text(row.get("region") or "")
    all_text = search_text(" ".join(str(value) for value in row.values() if isinstance(value, str)))
    terms = [term for term in clean.split() if term]
    short_query = len(clean) <= SHORT_SEARCH_QUERY_MAX
    alias_targets = [search_text(target) for target in search_query_variants(query)[1:]]

    base_score = 0
    if name == clean:
        base_score += 3000
    if slug == clean:
        base_score += 2600
    if any(target and name == target for target in alias_targets):
        base_score += 2800
    if short_query and acronym_for_name(name) == clean.upper():
        base_score += 2400
    if short_query and token_starts_with(name, clean):
        base_score += 700
    if not short_query and name.startswith(clean):
        base_score += 1000
    if not short_query and clean in name:
        base_score += 620
    if terms and all(term in name for term in terms):
        base_score += 700
    if not short_query and terms and all(term in all_text for term in terms):
        base_score += 240
    if clean in country or clean in region:
        base_score += 120

    if base_score <= 0:
        return 0
    return base_score + business_hierarchy_score(type_text) + business_name_score(name) + capital_scale_score(row)


def rank_search_rows(rows, query):
    if not str(query or "").strip():
        return rows
    ranked = []
    for index, row in enumerate(rows):
        score = search_relevance_score(row, query)
        if score > 0:
            ranked.append((score, index, row))
    ranked.sort(key=lambda item: (-item[0], item[1]))
    return [row for _score, _index, row in ranked]


def is_legacy_article_url(value):
    text = str(value or "").strip()
    if not text:
        return False
    try:
        parsed = urllib.parse.urlparse(text)
        host = (parsed.hostname or "").lower()
        query = urllib.parse.parse_qs(parsed.query)
        if not query.get("p"):
            return False
        return host in {"cms.swfi.com", "www.swfi.com", "swfi.com", "www.swfinstitute.org", "swfinstitute.org"}
    except Exception:
        return bool(re.search(r"https?://(?:cms\.swfi\.com|(?:www\.)?swfi\.com|(?:www\.)?swfinstitute\.org)/\?p=\d+", text, re.I))


def legacy_article_id(value):
    text = str(value or "").strip()
    if not text:
        return ""
    try:
        parsed = urllib.parse.urlparse(text)
        return (urllib.parse.parse_qs(parsed.query).get("p") or [""])[0]
    except Exception:
        match = re.search(r"[?&]p=(\d+)", text)
        return match.group(1) if match else ""


def is_canonical_swfi_record_url(value):
    text = str(value or "").strip()
    try:
        parsed = urllib.parse.urlparse(text)
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return host in {"www.swfi.com", "swfi.com"} and bool(
        re.fullmatch(r"/v1/(entities|people|transactions|compass)/[a-fA-F0-9]{24}", parsed.path)
    )


def is_internal_source_value(key, value):
    if str(key).lower() != "source":
        return False
    return bool(re.search(r"\b(mongo|backend|mirror|sourcevault|active mirror|production|api)\b", str(value or ""), re.I))


def swfi_record_url(kind, value):
    text = str(value or "").strip()
    if not re.fullmatch(r"[a-fA-F0-9]{24}", text):
        return ""
    return f"https://www.swfi.com/v1/{kind}/{text}"


def enrich_public_links(value):
    clean = dict(value)
    entity_id = clean.get("entity_id") or clean.get("institution_id")
    if entity_id and not clean.get("source_url") and not clean.get("swfi_url"):
        clean["source_url"] = swfi_record_url("entities", entity_id)
        clean["swfi_url"] = clean["source_url"]
    if clean.get("institution_id") and not clean.get("institution_url"):
        clean["institution_url"] = swfi_record_url("entities", clean.get("institution_id"))
    if clean.get("buyer_entity_id") and not clean.get("buyer_entity_url"):
        clean["buyer_entity_url"] = swfi_record_url("entities", clean.get("buyer_entity_id"))
    if clean.get("seller_entity_id") and not clean.get("seller_entity_url"):
        clean["seller_entity_url"] = swfi_record_url("entities", clean.get("seller_entity_id"))
    if clean.get("source_record_id") and not clean.get("source_url"):
        if clean.get("deadline") or clean.get("due_at") or clean.get("asset_class_or_strategy"):
            clean["source_url"] = swfi_record_url("compass", clean.get("source_record_id"))
        else:
            clean["source_url"] = swfi_record_url("transactions", clean.get("source_record_id"))
        clean["swfi_url"] = clean.get("swfi_url") or clean["source_url"]
    return clean


def sanitized_public_value(value):
    if isinstance(value, list):
        return [item for item in (sanitized_public_value(child) for child in value) if item != "" and item is not None]
    if not isinstance(value, dict):
        if is_legacy_article_url(value):
            return ""
        if re.search(r"\b(swfi_mongo_mirror|source_gap|source_gap_reason|Active Mirror)\b", str(value or ""), re.I):
            return ""
        return value

    clean = {}
    for key, child in enrich_public_links(value).items():
        key_text = str(key)
        lowered = key_text.lower()
        if lowered == "legacy_post_id" and str(child or "").strip().isdigit():
            clean["legacy_post"] = str(child).strip()
            continue
        if lowered in {"url", "source_url", "swfi_url", "href"} and is_legacy_article_url(child):
            legacy = legacy_article_id(child)
            if legacy:
                clean.setdefault("legacy_post", legacy)
            continue
        if lowered in PUBLIC_RESTRICTED_KEYS or lowered.startswith("_"):
            continue
        if lowered.endswith("_id") or lowered.endswith("_ids"):
            continue
        if is_internal_source_value(key_text, child):
            continue
        if lowered in {"url", "source_url", "swfi_url", "href"} and child and not is_canonical_swfi_record_url(child) and re.search(r"swfi(?:nstitute)?\.org|swfi\.com", str(child), re.I):
            continue
        sanitized = sanitized_public_value(child)
        if (sanitized == "" or sanitized is None) and lowered in {"url", "source_url", "swfi_url", "href", "source"}:
            continue
        clean[key_text] = sanitized
    return clean


def sanitized_public_packet(packet):
    if not isinstance(packet, dict) or "data" not in packet:
        return sanitized_public_value(packet)
    status = str(packet.get("status") or "").lower()
    qualifier = str(packet.get("result_qualifier") or "").lower()
    gap = bool(packet.get("source_gap") or packet.get("source_gap_reason"))
    fact_flag = packet.get("fact") is True
    fact = status == "ok" and (qualifier == "fact" or fact_flag) and not gap
    return {
        "status": "ok" if fact else "unavailable",
        "fact": fact,
        "generated_at": packet.get("generated_at"),
        "data": sanitized_public_value(packet.get("data") or {}),
    }


def public_api_body(path, body, content_type="application/json"):
    normalized_path = path
    if normalized_path == "/swficc":
        normalized_path = "/"
    elif normalized_path.startswith("/swficc/"):
        normalized_path = normalized_path.removeprefix("/swficc")
    if not normalized_path.startswith(PUBLIC_JSON_PATH_PREFIXES) or "json" not in content_type.lower():
        return body
    try:
        packet = json.loads(body.decode("utf-8") or "null")
    except Exception:
        return body
    return json.dumps(sanitized_public_packet(packet), separators=(",", ":")).encode("utf-8")


def safe_next_path(value, fallback="/swficc/"):
    raw = str(value or "").strip()
    if not raw:
        return fallback
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError:
        return fallback
    path = parsed.path or fallback
    if parsed.scheme or parsed.netloc:
        return fallback
    if path == "/swficc":
        path = "/swficc/"
    if not path.startswith("/swficc/"):
        return fallback
    return urllib.parse.urlunsplit(("", "", path, parsed.query, parsed.fragment))


def safe_swficc_path_from_url(value, allowed_host="", fallback="/swficc/"):
    raw = str(value or "").strip()
    if not raw:
        return fallback
    try:
        parsed = urllib.parse.urlsplit(raw)
    except ValueError:
        return fallback
    if parsed.scheme or parsed.netloc:
        host = str(allowed_host or "").split(":", 1)[0].lower()
        target_host = str(parsed.hostname or "").lower()
        if not host or target_host != host:
            return fallback
    path = parsed.path or fallback
    if path == "/swficc":
        path = "/swficc/"
    if not path.startswith("/swficc/"):
        return fallback
    return urllib.parse.urlunsplit(("", "", path, parsed.query, parsed.fragment))


def parse_cookies(header):
    cookies = {}
    for part in str(header or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        cookies[key.strip()] = urllib.parse.unquote(value.strip())
    return cookies


def cookie_values(header, name):
    values = []
    for part in str(header or "").split(";"):
        if "=" not in part:
            continue
        key, value = part.split("=", 1)
        if key.strip() == name:
            values.append(urllib.parse.unquote(value.strip()))
    return values


def auth_login_html(next_path="/swficc/", error=""):
    safe_next = safe_next_path(next_path)
    error_html = f'<div class="error">{escape_html(error)}</div>' if error else ""
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SWFI Subscriber Sign In</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f2f4f6; color: #1b2733; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f2f4f6; }}
    main {{ width: min(92vw, 420px); border: 1px solid #dce3ea; background: #fff; padding: 28px; border-radius: 8px; box-shadow: 0 24px 70px rgba(17,49,79,.12); }}
    .brand {{ color: #11314f; text-decoration: none; display: inline-block; margin-bottom: 22px; }}
    .brand strong {{ display: block; font-size: 22px; letter-spacing: .05em; }}
    .brand span {{ display: block; color: #7a8a9b; font-size: 9px; letter-spacing: .06em; }}
    h1 {{ color: #11314f; font-size: 21px; letter-spacing: 0; margin: 0 0 8px; }}
    p {{ color: #41566b; margin: 0 0 22px; font-size: 13px; line-height: 1.5; }}
    label {{ display: block; color: #41566b; font-size: 12px; font-weight: 700; margin: 14px 0 7px; }}
    input {{ width: 100%; box-sizing: border-box; border: 1px solid #c7d2dd; background: #f7f9fa; color: #1b2733; border-radius: 6px; padding: 11px 12px; font-size: 15px; outline-color: #5c9bd6; }}
    button {{ width: 100%; margin-top: 18px; border: 0; border-radius: 6px; padding: 12px 14px; background: #11314f; color: white; font-weight: 800; font-size: 14px; cursor: pointer; }}
    .error {{ color: #8a1f14; background: #fff1ef; border: 1px solid #f2b8b0; border-radius: 6px; padding: 10px 12px; margin-bottom: 14px; font-size: 13px; }}
    .back {{ display: inline-block; margin-top: 14px; color: #16538c; font-size: 12.5px; text-decoration: underline; }}
    .back + .back {{ margin-left: 12px; }}
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/swficc/"><strong>SWFI</strong><span>SOVEREIGN WEALTH FUND INSTITUTE</span></a>
    <h1>Subscriber Sign In</h1>
    <p>Subscriber access is required to open this SWFI platform record.</p>
    {error_html}
    <form method="post" action="/swficc/login/">
      <input type="hidden" name="next" value="{escape_html(safe_next)}" />
      <label for="username">Username</label>
      <input id="username" name="username" autocomplete="username" autocapitalize="none" autocorrect="off" spellcheck="false" autofocus required />
      <label for="password">Password</label>
      <input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="none" autocorrect="off" spellcheck="false" required />
      <button type="submit">Sign in</button>
    </form>
    <a class="back" href="/swficc/">Back to dashboard</a>
    <a class="back" href="/swficc/logout/">Reset session</a>
  </main>
</body>
</html>"""


def auth_bridge_html(message, next_path="/swficc/"):
    safe_next = safe_next_path(next_path)
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>SWFI Sign In</title>
  <style>
    :root {{ color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f2f4f6; color: #1b2733; }}
    body {{ min-height: 100vh; margin: 0; display: grid; place-items: center; background: #f2f4f6; }}
    main {{ width: min(92vw, 420px); border: 1px solid #dce3ea; background: #fff; padding: 28px; border-radius: 8px; box-shadow: 0 24px 70px rgba(17,49,79,.12); }}
    .brand {{ color: #11314f; text-decoration: none; display: inline-block; margin-bottom: 22px; }}
    .brand strong {{ display: block; font-size: 22px; letter-spacing: .05em; }}
    .brand span {{ display: block; color: #7a8a9b; font-size: 9px; letter-spacing: .06em; }}
    h1 {{ color: #11314f; font-size: 21px; letter-spacing: 0; margin: 0 0 8px; }}
    p {{ color: #41566b; margin: 0 0 18px; font-size: 13px; line-height: 1.5; }}
    a {{ color: #16538c; font-size: 13px; text-decoration: underline; }}
  </style>
</head>
<body>
  <main>
    <a class="brand" href="/swficc/"><strong>SWFI</strong><span>SOVEREIGN WEALTH FUND INSTITUTE</span></a>
    <h1>Sign in could not be completed</h1>
    <p>{escape_html(message)}</p>
    <a href="{escape_html(safe_next)}">Return</a>
  </main>
</body>
</html>"""


class StaticProxyHandler(BaseHTTPRequestHandler):
    server_version = "swfipn-static"

    def do_GET(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/":
            self.redirect("/swficc/")
            return
        if self.is_origin_ready_path(parsed.path):
            if not self.origin_ready_allowed():
                self.not_found()
                return
            self.origin_ready()
            return
        if self.is_login_path(parsed.path):
            self.redirect(self.swfi_signin_location(parsed))
            return
        if self.is_logout_path(parsed.path):
            self.logout()
            return
        if self.is_auth_bridge_path(parsed.path):
            self.handle_swfi_session_bridge(parsed)
            return
        if self.is_session_status_path(parsed.path):
            self.session_status()
            return
        if self.requires_record_auth(parsed.path) and not self.current_session():
            record_target = self.swfi_record_redirect_target(parsed)
            self.redirect(self.swfi_signin_location(parsed, default_next=record_target or self.current_swficc_target(parsed)))
            return
        if location := self.source_mirror_redirect(parsed):
            self.redirect(location)
            return
        if self.is_search_results_path(parsed):
            self.serve_search_results(parsed)
            return
        if self.should_proxy_backend(parsed.path):
            self.proxy_backend(parsed)
            return
        self.serve_static(parsed)

    def do_HEAD(self):
        parsed = urllib.parse.urlsplit(self.path)
        if parsed.path == "/":
            self.redirect("/swficc/", head=True)
            return
        if self.is_origin_ready_path(parsed.path):
            if not self.origin_ready_allowed():
                self.not_found(head=True)
                return
            self.origin_ready(head=True)
            return
        if self.is_login_path(parsed.path):
            self.redirect(self.swfi_signin_location(parsed), head=True)
            return
        if self.is_logout_path(parsed.path):
            self.logout(head=True)
            return
        if self.is_auth_bridge_path(parsed.path):
            self.not_found(head=True)
            return
        if self.is_session_status_path(parsed.path):
            self.session_status(head=True)
            return
        if self.requires_record_auth(parsed.path) and not self.current_session():
            record_target = self.swfi_record_redirect_target(parsed)
            self.redirect(self.swfi_signin_location(parsed, default_next=record_target or self.current_swficc_target(parsed)), head=True)
            return
        if location := self.source_mirror_redirect(parsed):
            self.redirect(location, head=True)
            return
        if self.should_proxy_backend(parsed.path):
            self.proxy_backend(parsed, head=True)
            return
        self.serve_static(parsed, head=True)

    def do_POST(self):
        parsed = urllib.parse.urlsplit(self.path)
        if self.is_login_path(parsed.path):
            self.redirect(self.swfi_signin_location(parsed))
            return
        if self.should_proxy_internal_backend_post(parsed.path):
            self.proxy_backend(parsed, method="POST")
            return
        if self.should_proxy_caller_auth_backend(parsed.path):
            self.proxy_backend(parsed, method="POST")
            return
        self.not_found()

    def do_PATCH(self):
        parsed = urllib.parse.urlsplit(self.path)
        if self.should_proxy_caller_auth_backend(parsed.path):
            self.proxy_backend(parsed, method="PATCH")
            return
        self.not_found()

    def do_DELETE(self):
        parsed = urllib.parse.urlsplit(self.path)
        if self.should_proxy_caller_auth_backend(parsed.path):
            self.proxy_backend(parsed, method="DELETE")
            return
        self.not_found()

    def should_proxy_backend(self, path):
        return path in {"/health", "/healthz", "/docs"} or path.startswith("/api/") or path.startswith("/v1/")

    def should_proxy_caller_auth_backend(self, path):
        return (
            path == "/v1/admin/api-keys"
            or path.startswith("/v1/admin/api-keys/")
            or path.startswith("/v1/admin/organizations")
            or path.startswith("/v1/admin/users")
            or path.startswith("/v1/admin/content-items")
            or path == "/v1/admin/permissions"
            or path == "/api/v1/saved-searches"
            or path.startswith("/api/v1/saved-searches/")
            or path == "/api/v1/alerts"
            or path.startswith("/api/v1/alerts/")
        )

    def should_proxy_internal_backend_post(self, path):
        return path in {"/api/source-data/detail-batch-verify/v1"}

    def is_origin_ready_path(self, path):
        return path in {"/__origin/ready", "/swficc/__origin/ready"}

    def origin_ready_allowed(self):
        if os.environ.get("SWFIPN_PUBLIC_READY", "").strip().lower() in {"1", "true", "yes", "on"}:
            return True
        client = str(self.client_address[0] if self.client_address else "")
        return client in {"127.0.0.1", "::1"} or client.startswith("::ffff:127.")

    def is_login_path(self, path):
        return path in {"/login", "/login/", "/swficc/login", "/swficc/login/"}

    def is_logout_path(self, path):
        return path in {"/logout", "/logout/", "/swficc/logout", "/swficc/logout/"}

    def is_auth_bridge_path(self, path):
        return path in {"/auth/bridge", "/auth/bridge/", "/swficc/auth/bridge", "/swficc/auth/bridge/"}

    def is_session_status_path(self, path):
        return path in {"/api/session/status/v1", "/swficc/api/session/status/v1"}

    def requires_record_auth(self, path):
        if os.environ.get("SWFIPN_REQUIRE_RECORD_AUTH", "").strip().lower() not in {"1", "true", "yes", "on"}:
            return False
        normalized = path
        if normalized == "/swficc":
            normalized = "/"
        elif normalized.startswith("/swficc/"):
            normalized = normalized.removeprefix("/swficc")
        normalized = normalized if normalized.endswith("/") else f"{normalized}/"
        protected_prefixes = (
            "/profiles/detail/",
            "/transactions/detail/",
            "/people/detail/",
            "/mandates/detail/",
        )
        return any(normalized.startswith(prefix) for prefix in protected_prefixes)

    def origin_ready(self, head=False):
        failures = []
        marker_path = self.server.root / "swficc-release.json"
        marker = {}
        if not marker_path.exists():
            failures.append("missing_release_marker")
        else:
            try:
                marker = json.loads(marker_path.read_text())
            except Exception as exc:
                failures.append(f"unreadable_release_marker:{exc}")
        if marker and marker.get("schema_version") != "swfipn.release_marker.v1":
            failures.append(f"bad_release_marker_schema:{marker.get('schema_version')}")
        if marker and not marker.get("asset_version"):
            failures.append("missing_asset_version")

        backend = self.backend_health()
        if not backend.get("ok"):
            failures.append(f"backend_unhealthy:{backend.get('failure', 'unknown')}")

        body = {
            "status": "ok" if not failures else "fail",
            "release_marker": {
                "asset_version": marker.get("asset_version", ""),
                "generated_at": marker.get("generated_at", ""),
                "git_sha": marker.get("git_sha", ""),
                "git_dirty": bool(marker.get("git_dirty", False)),
            },
            "backend": backend,
            "failures": failures,
        }
        self.send_json(HTTPStatus.OK if not failures else HTTPStatus.SERVICE_UNAVAILABLE, body, head=head)

    def backend_health(self):
        target = f"{self.server.backend.rstrip('/')}/health"
        try:
            request = urllib.request.Request(target, headers={"Accept": "application/json", "Connection": "close"})
            with urllib.request.urlopen(request, timeout=min(5, self.server.backend_timeout)) as response:
                return {"ok": response.status < 400, "status": response.status}
        except Exception as exc:
            return {"ok": False, "status": 0, "failure": str(exc)}

    def current_swficc_target(self, parsed):
        path = parsed.path
        if path == "/swficc":
            path = "/swficc/"
        if not path.startswith("/swficc/"):
            path = "/swficc/"
        return urllib.parse.urlunsplit(("", "", path, parsed.query, parsed.fragment))

    def swfi_signin_location(self, parsed, default_next="/swficc/"):
        params = urllib.parse.parse_qs(parsed.query)
        if self.server.bridge_login_enabled:
            next_candidate = params.get("next", [""])[0] or self.current_swficc_target(parsed)
            if not next_candidate or self.is_login_path(parsed.path):
                next_candidate = params.get("next", [""])[0] or default_next
            next_path = safe_swficc_path_from_url(next_candidate, allowed_host=self.public_host(), fallback="/swficc/")
            bridge_path = f"/swficc/auth/bridge/?{urllib.parse.urlencode({'next': next_path})}"
            bridge_url = urllib.parse.urlunsplit((self.public_scheme(), self.public_host(), bridge_path, "", ""))
            query = urllib.parse.urlencode({"msg": "auth", "redirect": bridge_url})
            return f"https://www.swfi.com/v1/signin/?{query}"
        record_target = self.swfi_record_target_from_value(params.get("next", [""])[0]) or self.swfi_record_target_from_value(default_next)
        if record_target:
            query = urllib.parse.urlencode({"msg": "auth", "redirect": record_target})
            return f"https://www.swfi.com/v1/signin/?{query}"
        host = self.public_host()
        next_path = safe_swficc_path_from_url(params.get("next", [""])[0], allowed_host=host, fallback=default_next)
        return_url = urllib.parse.urlunsplit((self.public_scheme(), host, next_path, "", ""))
        query = urllib.parse.urlencode({"msg": "auth", "redirect": return_url})
        return f"https://www.swfi.com/v1/signin/?{query}"

    def swfi_record_target_from_value(self, value):
        raw = str(value or "").strip()
        if not raw:
            return ""
        if re.fullmatch(r"/v1/(entities|people|transactions|compass)/[a-fA-F0-9]{24}", raw):
            return raw
        try:
            return self.swfi_record_redirect_target(urllib.parse.urlsplit(raw))
        except Exception:
            return ""

    def swfi_record_redirect_target(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        for key in ("source", "swfi_url", "url"):
            target = self.swfi_record_target_from_url((params.get(key) or [""])[0])
            if target:
                return target
        normalized = parsed.path
        if normalized == "/swficc":
            normalized = "/"
        elif normalized.startswith("/swficc/"):
            normalized = normalized.removeprefix("/swficc")
        normalized = normalized if normalized.endswith("/") else f"{normalized}/"
        detail_sections = {
            "/profiles/detail/": "entities",
            "/transactions/detail/": "transactions",
            "/people/detail/": "people",
            "/mandates/detail/": "compass",
        }
        section = detail_sections.get(normalized)
        if not section:
            return ""
        record_id = (params.get("id") or [""])[0]
        if re.fullmatch(r"[a-fA-F0-9]{24}", record_id):
            return f"/v1/{section}/{record_id}"
        if section == "entities":
            return self.lookup_entity_record_target(params)
        return ""

    def swfi_record_target_from_url(self, value):
        raw = str(value or "").strip()
        if not raw:
            return ""
        try:
            parsed = urllib.parse.urlsplit(raw)
        except ValueError:
            return ""
        host = (parsed.hostname or "").lower()
        if host not in {"www.swfi.com", "swfi.com"}:
            return ""
        match = re.fullmatch(r"/v1/(entities|people|transactions|compass)/([a-fA-F0-9]{24})", parsed.path)
        if not match:
            return ""
        return f"/v1/{match.group(1)}/{match.group(2)}"

    def lookup_entity_record_target(self, params):
        name = (params.get("name") or [""])[0].strip()
        slug = (params.get("slug") or [""])[0].strip()
        query = name or slug.replace("-", " ")
        if not query:
            return ""
        endpoint = f"{self.server.backend.rstrip('/')}/api/source-data/search/v1?{urllib.parse.urlencode({'collection': 'entities', 'q': query, 'limit': '8', 'page': '1'})}"
        try:
            request = urllib.request.Request(endpoint, headers={
                "Accept": "application/json",
                "Connection": "close",
                "X-SWFIPN-Public": "1",
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
            })
            if self.server.backend_token:
                request.add_header("Authorization", f"Bearer {self.server.backend_token}")
            with urllib.request.urlopen(request, timeout=min(8, self.server.backend_timeout)) as response:
                packet = json.loads(response.read().decode("utf-8"))
        except Exception:
            return ""
        data = packet.get("data") if isinstance(packet, dict) else {}
        rows = []
        if isinstance(data, dict):
            rows = data.get("rows") or data.get("results") or []
        if not isinstance(rows, list):
            return ""
        expected_slug = slug.lower()
        expected_name = name.casefold()
        for row in rows:
            if not isinstance(row, dict):
                continue
            row_slug = str(row.get("slug") or row.get("profile_slug") or "").lower()
            row_name = str(row.get("name") or row.get("institution") or "").casefold()
            if expected_slug and row_slug and row_slug != expected_slug:
                continue
            if expected_name and row_name and row_name != expected_name:
                continue
            target = self.swfi_record_target_from_url(str(row.get("source_url") or row.get("swfi_url") or ""))
            if target:
                return target
        for row in rows:
            if isinstance(row, dict):
                target = self.swfi_record_target_from_url(str(row.get("source_url") or row.get("swfi_url") or ""))
                if target:
                    return target
        return ""

    def public_scheme(self):
        forwarded = str(self.headers.get("X-Forwarded-Proto", "")).split(",", 1)[0].strip().lower()
        if forwarded in {"http", "https"}:
            return forwarded
        if "swfipn.activemirror.ai" in str(self.headers.get("Host", "")):
            return "https"
        return "http"

    def public_host(self):
        forwarded = str(self.headers.get("X-Forwarded-Host", "")).split(",", 1)[0].strip()
        return forwarded or str(self.headers.get("Host", "")).strip() or "swfipn.activemirror.ai"

    def serve_login(self, parsed, head=False, status=HTTPStatus.OK, error=""):
        params = urllib.parse.parse_qs(parsed.query)
        next_path = safe_next_path(params.get("next", [""])[0])
        self.send_html(status, auth_login_html(next_path, error), head=head)

    def handle_login(self):
        try:
            size = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            size = 0
        if size > 50_000:
            self.send_html(HTTPStatus.REQUEST_ENTITY_TOO_LARGE, auth_login_html(error="Sign in could not be completed."))
            return
        raw_body = self.rfile.read(size).decode("utf-8", errors="replace")
        form = urllib.parse.parse_qs(raw_body)
        next_path = safe_next_path(form.get("next", [""])[0])
        username = form.get("username", [""])[0].strip()
        password = form.get("password", [""])[0].strip()
        if not self.server.auth_enabled:
            self.send_html(HTTPStatus.SERVICE_UNAVAILABLE, auth_login_html(next_path, "Subscriber sign in is temporarily unavailable."))
            return
        if not safe_equal(username.casefold(), self.server.auth_username.casefold()) or not safe_equal(password, self.server.auth_password):
            self.send_html(HTTPStatus.UNAUTHORIZED, auth_login_html(next_path, "Invalid subscriber credentials."))
            return
        self.redirect_with_session(next_path, username)

    def session_status(self, head=False):
        session = self.current_session()
        if session:
            body = {
                "authenticated": True,
                "pending": False,
                "entitlements": ["dashboard"],
                "dashboard_access": True,
                "auth_source": session.get("source") or "local_session",
                "display_name": self.session_display_name(session),
            }
            self.send_json(HTTPStatus.OK, body, head=head)
            return
        body = {"authenticated": False, "pending": False, "entitlements": [], "dashboard_access": False}
        self.send_json(HTTPStatus.OK, body, head=head)

    def handle_swfi_session_bridge(self, parsed):
        params = urllib.parse.parse_qs(parsed.query)
        next_path = safe_swficc_path_from_url(params.get("next", [""])[0], allowed_host=self.public_host(), fallback="/swficc/")
        assertion = (
            params.get("assertion", [""])[0]
            or params.get("swfi_assertion", [""])[0]
            or params.get("token", [""])[0]
        )
        if not self.server.bridge_enabled:
            self.send_html(
                HTTPStatus.SERVICE_UNAVAILABLE,
                auth_bridge_html("The SWFI session bridge is not configured on this runtime.", next_path),
            )
            return
        payload, failure = self.bridge_assertion_payload(assertion)
        if failure:
            self.send_html(
                HTTPStatus.UNAUTHORIZED,
                auth_bridge_html("The SWFI sign-in response could not be verified.", next_path),
            )
            return
        user_id = self.bridge_user_id(payload)
        if not user_id:
            self.send_html(
                HTTPStatus.UNAUTHORIZED,
                auth_bridge_html("The SWFI sign-in response did not include a verified user.", next_path),
            )
            return
        self.redirect_with_bridge_session(next_path, payload)

    def logout(self, head=False):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", "/swficc/")
        self.send_security_headers()
        self.send_header("Set-Cookie", self.session_cookie("", max_age=0))
        self.send_header("Set-Cookie", self.session_cookie("", max_age=0, path="/swficc"))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def current_session(self):
        tokens = cookie_values(self.headers.get("Cookie"), SESSION_COOKIE_NAME)
        if not tokens or not self.server.auth_secret:
            return None
        for token in reversed(tokens):
            session = self.session_from_token(token)
            if session:
                return session
        return None

    def session_from_token(self, token):
        try:
            payload_part, signature = token.rsplit(".", 1)
            expected = self.sign_payload(payload_part)
            if not safe_equal(signature, expected):
                return None
            payload = json.loads(b64url_decode(payload_part).decode("utf-8"))
            if int(payload.get("exp", 0)) < int(time.time()):
                return None
            return payload
        except Exception:
            return None

    def bridge_assertion_payload(self, assertion):
        raw = str(assertion or "").strip()
        if not raw:
            return None, "missing_assertion"
        try:
            parts = raw.split(".")
            if len(parts) == 2:
                signed_part, signature = parts
                payload_part = signed_part
            elif len(parts) == 3:
                header_part, payload_part, signature = parts
                signed_part = f"{header_part}.{payload_part}"
            else:
                return None, "bad_assertion_format"
            digest = hmac.new(self.server.bridge_secret.encode("utf-8"), signed_part.encode("utf-8"), hashlib.sha256).digest()
            if not safe_equal(signature, b64url(digest)):
                return None, "bad_assertion_signature"
            payload = json.loads(b64url_decode(payload_part).decode("utf-8"))
            if not isinstance(payload, dict):
                return None, "bad_assertion_payload"
            now = int(time.time())
            exp = int(payload.get("exp", 0) or 0)
            iat = int(payload.get("iat", now) or now)
            if exp < now:
                return None, "assertion_expired"
            if iat > now + 300:
                return None, "assertion_iat_in_future"
            issuer = str(payload.get("iss") or "").strip()
            if self.server.bridge_issuer and issuer != self.server.bridge_issuer:
                return None, "bad_assertion_issuer"
            expected_audience = self.server.bridge_audience or self.public_host()
            audience = payload.get("aud")
            audiences = audience if isinstance(audience, list) else [audience]
            if expected_audience and expected_audience not in [str(item or "").strip() for item in audiences]:
                return None, "bad_assertion_audience"
            return payload, ""
        except Exception:
            return None, "bad_assertion"

    def bridge_user_id(self, payload):
        if not isinstance(payload, dict):
            return ""
        for key in ("sub", "email", "user_id"):
            candidate = str(payload.get(key) or "").strip()
            if candidate and len(candidate) <= 128 and re.fullmatch(r"[A-Za-z0-9_.:@-]+", candidate):
                return candidate
        return ""

    def bridge_display_name(self, payload):
        if not isinstance(payload, dict):
            return ""
        first = sanitized_display_name(payload.get("given_name") or payload.get("first_name"))
        last = sanitized_display_name(payload.get("family_name") or payload.get("last_name"))
        for candidate in (
            payload.get("display_name"),
            payload.get("name"),
            payload.get("full_name"),
            f"{first} {last}".strip(),
            first,
        ):
            display = sanitized_display_name(candidate)
            if display:
                return display
        return ""

    def session_display_name(self, session):
        if not isinstance(session, dict):
            return ""
        display = sanitized_display_name(session.get("display_name"))
        if display:
            return display
        if session.get("source") == "local_session":
            return sanitized_display_name(session.get("u"))
        return ""

    def bridge_roles(self, payload):
        roles = payload.get("roles") if isinstance(payload, dict) else []
        if isinstance(roles, str):
            roles = [roles]
        if not isinstance(roles, list):
            return []
        clean_roles = []
        for role in roles:
            normalized = str(role or "").strip().lower().replace("-", "_").replace(" ", "_")
            if normalized in {"super_admin", "admin", "editor", "viewer"} and normalized not in clean_roles:
                clean_roles.append(normalized)
        return clean_roles

    def bridge_admin_role(self, session):
        roles = self.bridge_roles(session)
        for role in ("super_admin", "admin", "editor", "viewer"):
            if role in roles:
                return role
        return ""

    def redirect_with_session(self, location, username):
        now = int(time.time())
        payload = {"u": username, "iat": now, "exp": now + SESSION_TTL_SECONDS}
        payload_part = b64url(json.dumps(payload, separators=(",", ":")).encode("utf-8"))
        token = f"{payload_part}.{self.sign_payload(payload_part)}"
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", safe_next_path(location))
        self.send_security_headers()
        self.send_header("Set-Cookie", self.session_cookie(token, max_age=SESSION_TTL_SECONDS))
        self.send_header("Set-Cookie", self.session_cookie("", max_age=0, path="/swficc"))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def redirect_with_bridge_session(self, location, payload):
        now = int(time.time())
        ttl = min(SESSION_TTL_SECONDS, max(1, int(payload.get("exp", now + SESSION_TTL_SECONDS)) - now))
        user_id = self.bridge_user_id(payload)
        session_payload = {
            "u": user_id,
            "sub": str(payload.get("sub") or user_id).strip()[:128],
            "email": str(payload.get("email") or "").strip()[:128],
            "display_name": self.bridge_display_name(payload),
            "roles": self.bridge_roles(payload),
            "source": "swfi_session_bridge",
            "iat": now,
            "exp": now + ttl,
        }
        payload_part = b64url(json.dumps(session_payload, separators=(",", ":")).encode("utf-8"))
        token = f"{payload_part}.{self.sign_payload(payload_part)}"
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", safe_next_path(location))
        self.send_security_headers()
        self.send_header("Set-Cookie", self.session_cookie(token, max_age=ttl))
        self.send_header("Set-Cookie", self.session_cookie("", max_age=0, path="/swficc"))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def sign_payload(self, payload_part):
        digest = hmac.new(self.server.auth_secret.encode("utf-8"), payload_part.encode("utf-8"), hashlib.sha256).digest()
        return b64url(digest)

    def session_cookie(self, value, max_age, path="/"):
        secure = str(self.headers.get("X-Forwarded-Proto", "")).lower() == "https" or "swfipn.activemirror.ai" in str(self.headers.get("Host", ""))
        suffix = "; Secure" if secure else ""
        return f"{SESSION_COOKIE_NAME}={urllib.parse.quote(value)}; Path={path}; HttpOnly; SameSite=Strict; Max-Age={int(max_age)}{suffix}"

    def send_html(self, status, body, head=False):
        encoded = body.encode("utf-8")
        self.send_response(status)
        self.send_security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if not head:
            self.write_body(encoded)

    def send_json(self, status, body, head=False):
        encoded = json.dumps(body, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        if not head:
            self.write_body(encoded)

    def source_mirror_redirect(self, parsed):
        accept = str(self.headers.get("Accept") or "").lower()
        if self.headers.get("X-API-Key") or "application/json" in accept:
            return None
        if parsed.path.rstrip("/") in {"/v1/entities/aggregates", "/swficc/v1/entities/aggregates"}:
            return None
        parts = [part for part in parsed.path.split("/") if part]
        if parts and parts[0] == "swficc":
            parts = parts[1:]
        if len(parts) < 3 or parts[0] != "v1":
            return None
        section, record_id = parts[1], parts[2]
        route_by_section = {
            "entities": "/swficc/profiles/detail/",
            "transactions": "/swficc/transactions/detail/",
            "compass": "/swficc/mandates/detail/",
            "people": "/swficc/people/detail/",
            "news": "/swficc/research/detail/",
        }
        if section not in route_by_section:
            return None
        if section in {"entities", "news"}:
            valid_record_id = re.fullmatch(r"[A-Za-z0-9_-]{1,80}", record_id)
        else:
            valid_record_id = re.fullmatch(r"[a-fA-F0-9]{24}", record_id)
        if not valid_record_id:
            return None
        source = f"https://www.swfi.com/v1/{section}/{urllib.parse.quote(record_id)}"
        query = urllib.parse.urlencode({"legacy" if section == "news" else "id": record_id, "source": source})
        return f"{route_by_section[section]}?{query}"

    def redirect(self, location, head=False):
        self.send_response(HTTPStatus.FOUND)
        self.send_header("Location", location)
        self.send_security_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def proxy_backend(self, parsed, head=False, method=None):
        backend = self.server.backend.rstrip("/")
        backend_path = parsed.path
        if backend_path == "/swficc":
            backend_path = "/"
        elif backend_path.startswith("/swficc/"):
            backend_path = backend_path.removeprefix("/swficc")
        backend_path, backend_query = self.backend_source_data_alias(backend_path, parsed.query)
        target = f"{backend}{backend_path}"
        if backend_query:
            target = f"{target}?{backend_query}"
        try:
            request_method = method or ("HEAD" if head else "GET")
            if self.should_serve_enhanced_public_search(request_method, backend_path):
                self.serve_enhanced_public_search(backend_query, head=head)
                return
            cache_key = self.public_search_cache_key(request_method, backend_path, backend_query)
            if cache_key and not head:
                cached = self.server.public_search_cache.get(cache_key)
                if cached and time.time() - cached["stored_at"] <= PUBLIC_SEARCH_CACHE_TTL_SECONDS:
                    body = cached["body"]
                    self.send_response(HTTPStatus.OK)
                    self.send_security_headers()
                    self.send_header("Content-Type", "application/json; charset=utf-8")
                    self.send_header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300")
                    self.send_header("X-SWFIPN-Proxy-Cache", "HIT")
                    self.send_header("Content-Length", str(len(body)))
                    self.end_headers()
                    self.write_body(body)
                    return
            request_body = None
            if request_method in {"POST", "PUT", "PATCH"}:
                content_length = int(self.headers.get("Content-Length") or 0)
                request_body = self.rfile.read(content_length) if content_length > 0 else b""
            request = urllib.request.Request(target, data=request_body, method=request_method)
            internal_receipt_request = str(
                self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or ""
            ).lower() in {"1", "true", "yes"}
            api_product_request = backend_path == "/docs" or backend_path.startswith("/v1/")
            caller_auth_request = (
                backend_path == "/v1/admin/api-keys"
                or backend_path.startswith("/v1/admin/api-keys/")
                or backend_path.startswith("/v1/admin/organizations")
                or backend_path.startswith("/v1/admin/users")
                or backend_path.startswith("/v1/admin/content-items")
                or backend_path == "/v1/admin/permissions"
                or backend_path == "/api/v1/saved-searches"
                or backend_path.startswith("/api/v1/saved-searches/")
                or backend_path == "/api/v1/alerts"
                or backend_path.startswith("/api/v1/alerts/")
            )
            request.add_header("Accept", self.headers.get("Accept", "application/json"))
            if content_type := str(self.headers.get("Content-Type") or "").strip():
                request.add_header("Content-Type", content_type)
            if api_key := str(self.headers.get("X-API-Key") or "").strip():
                request.add_header("X-API-Key", api_key)
            if webhook_test := str(self.headers.get("X-SWFIPN-Webhook-Test") or "").strip():
                request.add_header("X-SWFIPN-Webhook-Test", webhook_test)
            bridge_session = self.current_session() if caller_auth_request else None
            if caller_auth_request and bridge_session and bridge_session.get("source") == "swfi_session_bridge":
                if self.server.backend_token:
                    request.add_header("Authorization", f"Bearer {self.server.backend_token}")
                user_id = self.bridge_user_id(bridge_session)
                if user_id:
                    request.add_header("X-SWFI-User-Id", user_id)
                    request.add_header("X-SWFI-Admin-User", user_id)
                if admin_role := self.bridge_admin_role(bridge_session):
                    request.add_header("X-SWFI-Admin-Role", admin_role)
                request.add_header("X-SWFI-Auth-Source", "swfi_session_bridge")
            elif caller_auth_request:
                if authorization := str(self.headers.get("Authorization") or "").strip():
                    request.add_header("Authorization", authorization)
                if swfi_user := str(self.headers.get("X-SWFI-User-Id") or "").strip():
                    request.add_header("X-SWFI-User-Id", swfi_user)
                if swfipn_user := str(self.headers.get("X-SWFIPN-User") or "").strip():
                    request.add_header("X-SWFIPN-User", swfipn_user)
                if admin_role := str(self.headers.get("X-SWFI-Admin-Role") or "").strip():
                    request.add_header("X-SWFI-Admin-Role", admin_role)
                if admin_user := str(self.headers.get("X-SWFI-Admin-User") or "").strip():
                    request.add_header("X-SWFI-Admin-User", admin_user)
            if internal_receipt_request:
                request.add_header("X-SWFIPN-Internal", "1")
            else:
                request.add_header("X-SWFIPN-Public", "1")
            request.add_header("Accept-Language", self.headers.get("Accept-Language", "en-US,en;q=0.9"))
            request.add_header("Connection", "close")
            request.add_header(
                "User-Agent",
                self.headers.get(
                    "User-Agent",
                    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
                ),
            )
            if self.server.backend_token and not caller_auth_request:
                request.add_header("Authorization", f"Bearer {self.server.backend_token}")
            with urllib.request.urlopen(request, timeout=self.server.backend_timeout) as response:
                raw_body = b"" if head else response.read()
                body = raw_body if internal_receipt_request or api_product_request else public_api_body(
                    parsed.path,
                    raw_body,
                    response.headers.get("Content-Type", ""),
                )
                self.send_response(response.status)
                self.copy_backend_headers(response.headers, len(body))
                if cache_key and response.status == 200 and not internal_receipt_request and not api_product_request:
                    self.server.public_search_cache[cache_key] = {"stored_at": time.time(), "body": body}
                    self.send_header("X-SWFIPN-Proxy-Cache", "MISS")
                self.end_headers()
                if not head:
                    self.write_body(body)
        except urllib.error.HTTPError as exc:
            raw_body = b"" if head else exc.read()
            api_product_request = backend_path == "/docs" or backend_path.startswith("/v1/")
            body = raw_body if api_product_request or str(self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or "").lower() in {"1", "true", "yes"} else public_api_body(
                parsed.path,
                raw_body,
                exc.headers.get("Content-Type", ""),
            )
            self.send_response(exc.code)
            self.copy_backend_headers(exc.headers, len(body))
            self.end_headers()
            if not head:
                self.write_body(body)
        except Exception:
            body = json.dumps({
                "status": "unavailable",
                "fact": False,
                "data": {"rows": [], "count": 0},
            }, separators=(",", ":")).encode("utf-8")
            self.send_response(HTTPStatus.OK)
            self.send_security_headers()
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Cache-Control", "no-store")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            if not head:
                self.write_body(body)

    def should_serve_enhanced_public_search(self, request_method, backend_path):
        if request_method != "GET" or backend_path != "/api/v1/public/search":
            return False
        return str(self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or "").lower() not in {"1", "true", "yes"}

    def serve_enhanced_public_search(self, backend_query, head=False):
        params = urllib.parse.parse_qs(backend_query or "", keep_blank_values=False)
        query = (params.get("q") or [""])[0].strip()[:120]
        limit = (params.get("limit") or ["25"])[0].strip() or "25"
        try:
            safe_limit = max(1, min(50, int(limit)))
        except ValueError:
            safe_limit = 25
        cache_key = f"enhanced-public-search:{query.casefold()}:{safe_limit}"
        cacheable = False
        if not query:
            body = json.dumps({
                "status": "ok",
                "fact": True,
                "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                "data": {"results": [], "query": "", "count": 0},
            }, separators=(",", ":")).encode("utf-8")
        else:
            cached = self.server.public_search_cache.get(cache_key)
            if cached and time.time() - cached["stored_at"] <= PUBLIC_SEARCH_CACHE_TTL_SECONDS:
                body = cached["body"]
                cacheable = True
            else:
                search_rows = []
                upstream_fact = False
                # Acronyms need canonical expansion, but expanding an already exact
                # institution name back to its acronym adds noisy and slower work.
                variants = upstream_search_query_variants(query)
                requests = [("public", variant) for variant in variants] + [("source", variant) for variant in variants]

                def fetch_search_packet(request):
                    kind, variant = request
                    if kind == "public":
                        return kind, self.public_search_packet(variant, limit=str(safe_limit))
                    return kind, self.source_entity_search_packet(variant, limit=str(safe_limit))

                with ThreadPoolExecutor(max_workers=min(6, len(requests))) as executor:
                    packets = list(executor.map(fetch_search_packet, requests))
                for kind, packet in packets:
                    upstream_fact = upstream_fact or packet.get("fact") is True
                    if kind == "public":
                        search_rows.extend(self.rows_from_public_search_packet(packet))
                    else:
                        search_rows.extend(self.rows_from_source_data_packet(packet))
                ranked = rank_search_rows(dedupe_search_rows(search_rows), query)[:safe_limit]
                body = json.dumps({
                    "status": "ok" if upstream_fact else "unavailable",
                    "fact": upstream_fact,
                    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
                    "data": {
                        "results": ranked,
                        "query": query,
                        "count": len(ranked),
                        "count_basis": "ranked_public_plus_entity_variants",
                    },
                }, separators=(",", ":")).encode("utf-8")
                cacheable = upstream_fact
                if cacheable:
                    self.server.public_search_cache[cache_key] = {"stored_at": time.time(), "body": body}
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300" if cacheable else "no-store")
        self.send_header("X-SWFIPN-Search-Render", "enhanced")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.write_body(body)

    def public_search_cache_key(self, request_method, backend_path, backend_query):
        if request_method != "GET" or backend_path != "/api/v1/public/search":
            return ""
        if str(self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or "").lower() in {"1", "true", "yes"}:
            return ""
        params = urllib.parse.parse_qs(backend_query or "", keep_blank_values=False)
        query = (params.get("q") or [""])[0].strip()[:120]
        limit = (params.get("limit") or ["25"])[0].strip() or "25"
        if not query:
            return ""
        return f"public-search:{query.casefold()}:{limit}"

    def is_search_results_path(self, parsed):
        # The Next search page is the single detailed-results surface. The legacy
        # server-rendered fallback only queried institutions, so an uncategorized
        # "View all results" request silently discarded transactions, people,
        # opportunities, and news even when the initial search modal showed them.
        # Keep every query/category on the category-aware page instead.
        return False

    def serve_search_results(self, parsed, head=False):
        query = (urllib.parse.parse_qs(parsed.query).get("q") or [""])[0].strip()[:120]
        rows = self.search_result_rows(query, limit="25")
        body = self.search_results_html(query, rows).encode("utf-8")
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300")
        self.send_header("X-SWFIPN-Search-Render", "server")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.write_body(body)

    def search_result_rows(self, query, limit="25"):
        rows = []
        for variant in search_query_variants(query):
            packet = self.public_search_packet(variant, limit=limit)
            rows.extend(self.rows_from_public_search_packet(packet))
        return rank_search_rows(dedupe_search_rows(rows), query)[:int(str(limit or "25"))]

    def rows_from_public_search_packet(self, packet):
        if not isinstance(packet, dict) or packet.get("fact") is not True:
            return []
        data = packet.get("data") if isinstance(packet.get("data"), dict) else {}
        results = data.get("results") if isinstance(data.get("results"), list) else []
        return [item for item in results if isinstance(item, dict)]

    def rows_from_source_data_packet(self, packet):
        if not isinstance(packet, dict) or packet.get("fact") is not True:
            return []
        data = packet.get("data") if isinstance(packet.get("data"), dict) else {}
        results = data.get("rows") if isinstance(data.get("rows"), list) else data.get("results")
        if not isinstance(results, list):
            return []
        return [item for item in results if isinstance(item, dict)]

    def public_search_packet(self, query, limit="25"):
        cache_key = f"public-search:{query.casefold()}:{limit}"
        cached = self.server.public_search_cache.get(cache_key)
        if cached and time.time() - cached["stored_at"] <= PUBLIC_SEARCH_CACHE_TTL_SECONDS:
            try:
                return json.loads(cached["body"].decode("utf-8") or "{}")
            except Exception:
                pass
        backend = self.server.backend.rstrip("/")
        target = f"{backend}/api/v1/public/search?{urllib.parse.urlencode({'q': query, 'limit': limit})}"
        request = urllib.request.Request(target, method="GET")
        request.add_header("Accept", "application/json")
        request.add_header("X-SWFIPN-Public", "1")
        request.add_header("Connection", "close")
        if self.server.backend_token:
            request.add_header("Authorization", f"Bearer {self.server.backend_token}")
        try:
            with urllib.request.urlopen(request, timeout=self.server.backend_timeout) as response:
                raw_body = response.read()
                body = public_api_body("/api/v1/public/search", raw_body)
                if response.status == 200:
                    self.server.public_search_cache[cache_key] = {"stored_at": time.time(), "body": body}
                return json.loads(body.decode("utf-8") or "{}")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            return {"status": "blocked", "fact": False, "data": {"results": []}}

    def source_entity_search_packet(self, query, limit="25"):
        cache_key = f"entity-search:{query.casefold()}:{limit}"
        cached = self.server.public_search_cache.get(cache_key)
        if cached and time.time() - cached["stored_at"] <= PUBLIC_SEARCH_CACHE_TTL_SECONDS:
            try:
                return json.loads(cached["body"].decode("utf-8") or "{}")
            except Exception:
                pass
        backend = self.server.backend.rstrip("/")
        target = f"{backend}/api/source-data/search/v1?{urllib.parse.urlencode({'collection': 'entities', 'q': query, 'limit': limit, 'page': '1'})}"
        request = urllib.request.Request(target, method="GET")
        request.add_header("Accept", "application/json")
        request.add_header("X-SWFIPN-Public", "1")
        request.add_header("Connection", "close")
        if self.server.backend_token:
            request.add_header("Authorization", f"Bearer {self.server.backend_token}")
        try:
            with urllib.request.urlopen(request, timeout=self.server.backend_timeout) as response:
                raw_body = response.read()
                body = public_api_body("/api/source-data/search/v1", raw_body)
                if response.status == 200:
                    self.server.public_search_cache[cache_key] = {"stored_at": time.time(), "body": body}
                return json.loads(body.decode("utf-8") or "{}")
        except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError):
            return {"status": "blocked", "fact": False, "data": {"rows": []}}

    def search_results_html(self, query, rows):
        row_html = []
        for row in rows[:25]:
            name = escape_html(row.get("name") or "Not disclosed")
            source = str(row.get("source_url") or row.get("swfi_url") or row.get("url") or "")
            detail = escape_html(" / ".join(str(part) for part in [row.get("type") or "", row.get("country") or row.get("region") or "", row.get("aum") or row.get("assets") or ""] if str(part or "").strip()))
            href = escape_html(self.swficc_record_href_from_source(source) or "/swficc/profiles/")
            row_html.append(f"""
              <tr data-relevance="{len(row_html)}">
                <td>Institution</td>
                <td><a href="{href}">{name}</a></td>
                <td>SWFI</td>
                <td>{detail or "Not disclosed"}</td>
                <td><a href="{href}">Open</a></td>
              </tr>""")
        if not row_html:
            row_html.append(
                '<tr><td colspan="5" class="empty">'
                "No matching SWFI records were returned for this query. "
                "Try another institution, person, strategy, country, region, sector, or entity type."
                "</td></tr>"
            )
        count = len(rows)
        return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>SWFI Search</title>
  <style>
    body{{margin:0;background:#f2f4f6;color:#1b2733;font-family:Arial,Helvetica,sans-serif}}
    header{{background:#a61c20;color:#fff;border-bottom:1px solid #7e1417}}
    .bar{{max-width:1188px;margin:0 auto;min-height:80px;display:flex;align-items:center;gap:24px;padding:0 22px}}
    .brand{{color:#fff;text-decoration:none;font-weight:800;font-size:28px}}
    .sub{{font-size:11px;display:block;letter-spacing:.04em}}
    .searchbar{{background:#fff;padding:8px 22px;border-top:1px solid rgba(255,255,255,.18)}}
    form{{max-width:1188px;margin:0 auto;display:flex;height:36px;align-items:center;border:1px solid #c8d1e5;background:#f8f9fa;padding:0 12px;color:#22272f}}
    input{{flex:1;border:0;background:transparent;outline:0;color:#41566b;font-size:13px}}
    main{{max-width:1188px;margin:0 auto;padding:20px 22px 30px;display:grid;gap:16px}}
    section{{background:#fff;border:1px solid #dce3ea;border-radius:4px;padding:16px}}
    h1{{margin:0;color:#11314f;font-size:19px}}
    p{{margin:4px 0 0;color:#7a8a9b;font-size:12px}}
    .count{{border:1px solid #dce3ea;padding:8px 12px;font-size:12px;color:#41566b}}
    .top{{display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap}}
    table{{width:100%;border-collapse:collapse;background:#fff;font-size:13px}}
    th{{background:#f7f9fb;color:#5b6a78;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em}}
    th,td{{border-bottom:1px solid #edf1f5;padding:9px 12px;vertical-align:top}}
    th button{{width:100%;border:0;background:transparent;padding:0;text-align:left;color:inherit;font:inherit;font-weight:700;cursor:pointer}}
    a{{color:#16538c;text-decoration:underline;font-weight:600}}
    .tablebar{{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;border:1px solid #dce3ea;border-bottom:0;background:#fbfcfd;padding:8px 12px;color:#41566b;font-size:12px}}
    .tablebar select{{border:1px solid #dce3ea;background:#fff;padding:4px 8px}}
    .empty{{text-align:center;color:#6b7a89;padding:32px}}
  </style>
</head>
<body>
  <header>
    <div class="bar"><a class="brand" href="/swficc/">SWFI<span class="sub">SOVEREIGN WEALTH FUND INSTITUTE</span></a></div>
    <div class="searchbar"><form action="/swficc/search/" method="get"><strong>Smart Search&nbsp;-&nbsp;</strong><input name="q" type="search" value="{escape_html(query)}" placeholder="Institution, Person, Strategy"></form></div>
  </header>
  <main>
    <section class="top"><div><h1>Smart Search</h1><p>Results are ranked for institutional relevance. Select any row to continue.</p></div><div class="count">Showing {count:,} of {count:,}</div></section>
    <div class="tablebar"><div id="search-count">Showing {min(count, 25):,} of {count:,}</div><label><strong>Rows</strong> <select id="row-limit"><option>5</option><option>10</option><option selected>25</option><option>50</option><option>100</option></select></label></div>
    <table><thead><tr><th><button type="button" data-sort-key="0">Type</button></th><th><button type="button" data-sort-key="1">Result</button></th><th><button type="button" data-sort-key="2">Source</button></th><th><button type="button" data-sort-key="3">Detail</button></th><th>Record</th></tr></thead><tbody>{''.join(row_html)}</tbody></table>
  </main>
  <script>
    (() => {{
      const tbody = document.querySelector("tbody");
      const count = document.getElementById("search-count");
      const limit = document.getElementById("row-limit");
      const buttons = Array.from(document.querySelectorAll("thead button[data-sort-key]"));
      const total = {count};
      let rows = Array.from(tbody.querySelectorAll("tr"));
      let sortKey = "";
      let sortDir = "asc";
      function setCount() {{
        const visible = rows.filter((row) => row.style.display !== "none").length;
        count.textContent = `Showing ${{visible.toLocaleString("en-US")}} of ${{total.toLocaleString("en-US")}}`;
      }}
      function applyLimit() {{
        const max = Number(limit.value || 25);
        rows.forEach((row, index) => {{ row.style.display = index < max ? "" : "none"; }});
        setCount();
      }}
      function sortRows(key) {{
        sortDir = sortKey === key && sortDir === "asc" ? "desc" : "asc";
        sortKey = key;
        rows.sort((left, right) => {{
          const l = (left.children[Number(key)]?.innerText || "").trim();
          const r = (right.children[Number(key)]?.innerText || "").trim();
          return l.localeCompare(r, undefined, {{ numeric: true, sensitivity: "base" }}) * (sortDir === "asc" ? 1 : -1);
        }});
        rows.forEach((row) => tbody.appendChild(row));
        buttons.forEach((button) => {{
          const base = button.textContent.replace(/\\s+(asc|desc)$/i, "");
          button.textContent = button.dataset.sortKey === key ? `${{base}} ${{sortDir}}` : base;
        }});
        applyLimit();
      }}
      buttons.forEach((button) => button.addEventListener("click", () => sortRows(button.dataset.sortKey || "0")));
      limit.addEventListener("change", applyLimit);
      applyLimit();
    }})();
  </script>
</body>
</html>"""

    def swficc_record_href_from_source(self, source):
        raw = str(source or "").strip()
        if not raw:
            return ""
        try:
            parsed = urllib.parse.urlsplit(raw)
        except ValueError:
            return ""
        host = (parsed.hostname or "").lower()
        if host not in {"www.swfi.com", "swfi.com", "cms.swfi.com"}:
            return ""
        match = re.fullmatch(r"/v1/(entities|people|transactions|compass)/([a-fA-F0-9]{24})", parsed.path.rstrip("/"))
        if not match:
            legacy = urllib.parse.parse_qs(parsed.query).get("p", [""])[0]
            if legacy.isdigit():
                return f"/swficc/research/detail/?{urllib.parse.urlencode({'legacy': legacy})}"
            return ""
        route_by_section = {
            "entities": "/v1/entities/",
            "people": "/v1/people/",
            "transactions": "/v1/transactions/",
            "compass": "/v1/compass/",
        }
        redirect = f"{route_by_section[match.group(1)]}{match.group(2)}"
        return f"https://www.swfi.com/v1/signin/?{urllib.parse.urlencode({'msg': 'auth', 'redirect': redirect})}"

    def backend_source_data_alias(self, backend_path, query):
        if backend_path != "/api/source-data/search/v1":
            return backend_path, query
        params = urllib.parse.parse_qs(query, keep_blank_values=True)
        collection = str((params.get("collection") or [""])[0]).strip().lower()
        alias_path = {
            "transaction": "/api/transactions/v1",
            "transactions": "/api/transactions/v1",
            "deal": "/api/transactions/v1",
            "deals": "/api/transactions/v1",
            "rfp": "/api/live-opportunities/v1",
            "rfps": "/api/live-opportunities/v1",
            "mandate": "/api/live-opportunities/v1",
            "mandates": "/api/live-opportunities/v1",
            "opportunity": "/api/live-opportunities/v1",
            "opportunities": "/api/live-opportunities/v1",
            "news": "/api/source-intelligence/news/v1",
            "intelligence": "/api/source-intelligence/news/v1",
            "research": "/api/source-intelligence/news/v1",
            "allocator": "/api/allocator-activity/v1",
            "allocators": "/api/allocator-activity/v1",
            "active_allocators": "/api/allocator-activity/v1",
        }.get(collection)
        if not alias_path:
            return backend_path, query
        params.pop("collection", None)
        if alias_path == "/api/allocator-activity/v1":
            params.setdefault("days", ["90"])
            params.setdefault("sort", ["deal_count"])
            params.setdefault("direction", ["desc"])
        return alias_path, urllib.parse.urlencode(params, doseq=True)

    def write_body(self, body):
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            return

    def copy_backend_headers(self, headers, length):
        self.send_security_headers()
        for key, value in headers.items():
            lower = key.lower()
            if lower in HOP_BY_HOP or lower in {"content-length", "server", "date"}:
                continue
            if lower in {name.lower() for name in SECURITY_HEADERS}:
                continue
            self.send_header(key, value)
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(length))

    def serve_static(self, parsed, head=False):
        file_path = self.static_path(parsed.path)
        if file_path is None:
            self.not_found(head=head)
            return
        content_type = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
        data = b"" if head else file_path.read_bytes()
        size = file_path.stat().st_size if head else len(data)
        self.send_response(HTTPStatus.OK)
        self.send_security_headers()
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(size))
        if self.is_versioned_static_asset(parsed.path, file_path):
            self.send_header("Cache-Control", "public, max-age=31536000, immutable")
        elif self.is_static_html_shell(file_path):
            self.send_header("Cache-Control", "public, max-age=60, s-maxage=300, stale-while-revalidate=300")
        else:
            self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        self.end_headers()
        if not head:
            self.wfile.write(data)

    def is_versioned_static_asset(self, request_path, file_path):
        normalized = posixpath.normpath(urllib.parse.unquote(request_path))
        if normalized == "/swficc":
            normalized = "/"
        elif normalized.startswith("/swficc/"):
            normalized = normalized.removeprefix("/swficc")
        return normalized.startswith("/_next/static/") and file_path.name != "index.html"

    def is_static_html_shell(self, file_path):
        return file_path.suffix.lower() == ".html"

    def static_path(self, request_path):
        unquoted = urllib.parse.unquote(request_path)
        normalized = posixpath.normpath(unquoted)
        if unquoted.endswith("/"):
            normalized = f"{normalized}/"
        if normalized == "/swficc":
            normalized = "/"
        elif normalized.startswith("/swficc/"):
            normalized = normalized.removeprefix("/swficc")
        relative = normalized.lstrip("/")
        candidate = (self.server.root / relative).resolve()
        try:
            candidate.relative_to(self.server.root)
        except ValueError:
            return None
        if candidate.is_dir():
            candidate = candidate / "index.html"
        elif not candidate.exists() and not relative.endswith("/"):
            index_candidate = candidate / "index.html"
            if index_candidate.exists():
                candidate = index_candidate
        if candidate.exists() and candidate.is_file():
            return candidate
        return None

    def not_found(self, head=False):
        body = b"Not found"
        self.send_response(HTTPStatus.NOT_FOUND)
        self.send_security_headers()
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        if not head:
            self.wfile.write(body)

    def send_security_headers(self):
        for key, value in SECURITY_HEADERS.items():
            self.send_header(key, value)

    def log_message(self, fmt, *args):
        sys.stderr.write("%s - - [%s] %s\n" % (self.address_string(), self.log_date_time_string(), fmt % args))


class StaticProxyServer(ThreadingHTTPServer):
    daemon_threads = True
    block_on_close = False

    def __init__(self, server_address, handler_class, root, backend, backend_timeout, backend_token):
        super().__init__(server_address, handler_class)
        self.root = Path(root).resolve()
        self.backend = backend
        self.backend_timeout = backend_timeout
        self.backend_token = backend_token
        self.public_search_cache = {}
        self.auth_username = load_secret(
            "SWFIPN_AUTH_USERNAME",
            "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE",
            ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"],
        ).strip()
        self.auth_password = load_secret(
            "SWFIPN_AUTH_PASSWORD",
            "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE",
            ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"],
            strip=False,
        )
        self.auth_secret = load_secret(
            "SWFIPN_AUTH_SESSION_SECRET",
            "SWFIPN_AUTH_SESSION_SECRET_KEYCHAIN_SERVICE",
            ["SWFIPN_AUTH_SESSION_SECRET", "SWFI_SESSION_SECRET"],
            strip=False,
        )
        self.auth_enabled = bool(self.auth_username and self.auth_password and self.auth_secret)
        self.bridge_secret = load_secret(
            "SWFIPN_SWFI_SESSION_BRIDGE_SECRET",
            "SWFIPN_SWFI_SESSION_BRIDGE_SECRET_KEYCHAIN_SERVICE",
            ["SWFIPN_SWFI_SESSION_BRIDGE_SECRET", "swfipn-swfi-session-bridge-secret"],
            strip=False,
        )
        self.bridge_issuer = os.environ.get("SWFIPN_SWFI_SESSION_BRIDGE_ISSUER", "swfi.com").strip()
        self.bridge_audience = os.environ.get("SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE", "").strip()
        self.bridge_enabled = bool(self.bridge_secret and self.auth_secret)
        self.bridge_login_enabled = self.bridge_enabled and os.environ.get(
            "SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED",
            "",
        ).strip().lower() in {"1", "true", "yes", "on"}


def env_list(name, default):
    raw = os.environ.get(name, "")
    if not raw:
        return default
    return [item.strip() for item in raw.split(",") if item.strip()]


def keychain_lookup(services):
    if os.environ.get("SWFIPN_AUTH_USE_KEYCHAIN", "1").strip().lower() not in {"1", "true", "yes", "on"}:
        return ""
    accounts = env_list("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"])
    for account in accounts:
        for service in services:
            try:
                result = subprocess.run(
                    ["security", "find-generic-password", "-a", account, "-s", service, "-w"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
            except Exception:
                continue
            if result.returncode == 0 and result.stdout:
                return result.stdout
    return ""


def load_secret(env_name, service_env_name, default_services, strip=True):
    direct = os.environ.get(env_name, "")
    if direct:
        return direct.strip() if strip else direct
    services = env_list(service_env_name, default_services)
    value = keychain_lookup(services)
    return value.strip() if strip else value.rstrip("\n")


def load_backend_token():
    direct = os.environ.get("SWFIPN_BACKEND_TOKEN", "").strip() or os.environ.get("SWFI2_API_TOKEN", "").strip()
    if direct:
        return direct
    if os.environ.get("SWFIPN_BACKEND_TOKEN_USE_KEYCHAIN", "1").strip().lower() not in {"1", "true", "yes", "on"}:
        return ""
    accounts = env_list("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"])
    services = ["SWFI2_API_TOKEN", "swfi2-api-token"]
    for account in accounts:
        for service in services:
            try:
                result = subprocess.run(
                    ["security", "find-generic-password", "-a", account, "-s", service, "-w"],
                    capture_output=True,
                    text=True,
                    timeout=5,
                    check=False,
                )
            except Exception:
                continue
            if result.returncode == 0 and result.stdout.strip():
                return result.stdout.strip()
    return ""


def main():
    parser = argparse.ArgumentParser(description="Serve SWFI static export with security headers and backend proxy.")
    parser.add_argument("--host", default=os.environ.get("SWFIPN_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("SWFIPN_PORT", "8351")))
    parser.add_argument("--root", default=os.environ.get("SWFIPN_ROOT", "out"))
    parser.add_argument("--backend", default=os.environ.get("SWFIPN_BACKEND", "http://127.0.0.1:8362"))
    parser.add_argument("--backend-timeout", type=float, default=float(os.environ.get("SWFIPN_BACKEND_TIMEOUT", "60")))
    args = parser.parse_args()

    root = Path(args.root).resolve()
    if not root.exists():
        raise SystemExit(f"static root does not exist: {root}")

    server = StaticProxyServer((args.host, args.port), StaticProxyHandler, root, args.backend, args.backend_timeout, load_backend_token())
    print(f"serving {root} on http://{args.host}:{args.port}; proxy backend {args.backend}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
