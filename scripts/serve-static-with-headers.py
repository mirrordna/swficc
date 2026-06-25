#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import json
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


def public_api_body(path, body):
    normalized_path = path
    if normalized_path == "/swficc":
        normalized_path = "/"
    elif normalized_path.startswith("/swficc/"):
        normalized_path = normalized_path.removeprefix("/swficc")
    if not normalized_path.startswith(PUBLIC_JSON_PATH_PREFIXES):
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
        if self.is_session_status_path(parsed.path):
            self.session_status()
            return
        if self.requires_record_auth(parsed.path) and not self.current_session():
            self.redirect(self.swfi_signin_location(parsed, default_next=self.current_swficc_target(parsed)))
            return
        if location := self.source_mirror_redirect(parsed):
            self.redirect(location)
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
        if self.is_session_status_path(parsed.path):
            self.session_status(head=True)
            return
        if self.requires_record_auth(parsed.path) and not self.current_session():
            self.redirect(self.swfi_signin_location(parsed, default_next=self.current_swficc_target(parsed)), head=True)
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
        self.not_found()

    def should_proxy_backend(self, path):
        return path in {"/health", "/healthz"} or path.startswith("/api/") or path.startswith("/v1/")

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

    def is_session_status_path(self, path):
        return False

    def requires_record_auth(self, path):
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
        host = self.public_host()
        next_path = safe_swficc_path_from_url(params.get("next", [""])[0], allowed_host=host, fallback=default_next)
        return_url = urllib.parse.urlunsplit((self.public_scheme(), host, next_path, "", ""))
        query = urllib.parse.urlencode({"msg": "auth", "redirect": return_url})
        return f"https://www.swfi.com/v1/signin/?{query}"

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
            body = {"authenticated": True, "pending": False, "entitlements": ["dashboard"], "dashboard_access": True}
            self.send_json(HTTPStatus.OK, body, head=head)
            return
        body = {"authenticated": False, "pending": False, "entitlements": [], "dashboard_access": False}
        self.send_json(HTTPStatus.UNAUTHORIZED, body, head=head)

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

    def proxy_backend(self, parsed, head=False):
        backend = self.server.backend.rstrip("/")
        backend_path = parsed.path
        if backend_path == "/swficc":
            backend_path = "/"
        elif backend_path.startswith("/swficc/"):
            backend_path = backend_path.removeprefix("/swficc")
        target = f"{backend}{backend_path}"
        if parsed.query:
            target = f"{target}?{parsed.query}"
        try:
            request = urllib.request.Request(target, method="HEAD" if head else "GET")
            internal_receipt_request = str(
                self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or ""
            ).lower() in {"1", "true", "yes"}
            request.add_header("Accept", self.headers.get("Accept", "application/json"))
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
            if self.server.backend_token:
                request.add_header("Authorization", f"Bearer {self.server.backend_token}")
            with urllib.request.urlopen(request, timeout=self.server.backend_timeout) as response:
                raw_body = b"" if head else response.read()
                body = raw_body if internal_receipt_request else public_api_body(parsed.path, raw_body)
                self.send_response(response.status)
                self.copy_backend_headers(response.headers, len(body))
                self.end_headers()
                if not head:
                    self.write_body(body)
        except urllib.error.HTTPError as exc:
            raw_body = b"" if head else exc.read()
            body = raw_body if str(self.headers.get("X-SWFIPN-Internal") or self.headers.get("X-SWFI-Internal") or "").lower() in {"1", "true", "yes"} else public_api_body(parsed.path, raw_body)
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
