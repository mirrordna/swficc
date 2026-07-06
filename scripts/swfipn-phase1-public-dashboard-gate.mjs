#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-phase1-public-dashboard-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const backendRepo = process.env.SWFI2_BACKEND_REPO || "/Users/mirror-pro/repos/SWFI2.0-final";
const minRecordLinks = Number(process.env.SWFIPN_PHASE1_MIN_RECORD_LINKS || 8);

const requiredDashboardText = [
  "Total AUM Engaged",
  "Institution Intelligence Overview",
  "Top Active Investors",
  "Recent Activity",
  "Investment Trends by Sector",
  "Recently Fundraising Institutions",
];

const forbiddenVisible = [
  "Active Mirror",
  "Object ID",
  "Object _id",
  "Mongo Record ID",
  "Backend ID",
  "Endpoint:",
  "source_gap",
  "source_gap_reason",
  "result_qualifier",
  "schema_version",
  "Subscriber Sign In",
  "Dashboard Sign In",
  "Watchlist",
  "Watchlists",
  "Saved Lists",
  "Saved View",
  "Alerts",
  "Viewed",
  "Entitlements",
  "dashboard_access",
  "service token",
  "SWFIPN_BACKEND",
  "SWFI2_API_TOKEN",
];

const forbiddenNetwork = [
  "mongodb://",
  "mongodb+srv://",
  "MONGODB_URI",
  "SWFI_MONGO_URI",
  "SWFI2_API_TOKEN",
  "SWFIPN_BACKEND_TOKEN",
];

const writePatterns = [
  "insert_one",
  "insert_many",
  "update_one",
  "update_many",
  "replace_one",
  "delete_one",
  "delete_many",
  "bulk_write",
  "drop(",
  "create_index",
  "find_one_and_update",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route = "/") {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function rootUrl(pathname) {
  const root = new URL(origin);
  return new URL(pathname, root.origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, backendRepo]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function listFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (![".git", "__pycache__", ".venv", "node_modules"].includes(entry.name)) listFiles(full, acc);
    } else {
      acc.push(full);
    }
  }
  return acc;
}

function runtimeWriteScan() {
  const srcDir = path.join(backendRepo, "src");
  const result = { backend_repo: backendRepo, checked: fs.existsSync(srcDir), failures: [], matches: [] };
  if (!result.checked) {
    result.failures.push(`backend_src_missing:${srcDir}`);
    return result;
  }
  for (const file of listFiles(srcDir)) {
    if (!/\.(py|js|ts|tsx)$/.test(file)) continue;
    const text = fs.readFileSync(file, "utf8");
    for (const pattern of writePatterns) {
      const index = text.indexOf(pattern);
      if (index >= 0) {
        const line = text.slice(0, index).split("\n").length;
        result.matches.push({ file: path.relative(backendRepo, file), line, pattern });
      }
    }
  }
  if (result.matches.length) result.failures.push(`runtime_write_patterns:${result.matches.length}`);
  return result;
}

async function requestNoCustomAuth(context) {
  const result = {
    id: "no_custom_dashboard_auth_endpoint",
    ok: true,
    failures: [],
    login_status: 0,
    login_location: "",
    next_login_status: 0,
    next_login_location: "",
    unsafe_login_status: 0,
    unsafe_login_location: "",
    session_status: 0,
    session_body: "",
  };
  const login = await context.request.get(appUrl("/login/"), { maxRedirects: 0, timeout: 30_000 }).catch((error) => ({ error }));
  if (login?.error) {
    result.failures.push(`login_request_failed:${login.error.message}`);
  } else {
    result.login_status = login.status();
    result.login_location = login.headers().location || "";
    const loginBody = await login.text().catch(() => "");
    if (/Subscriber Sign In|<form[^>]+action=["']\/swficc\/login/i.test(loginBody)) result.failures.push("local_login_form_rendered");
    if (result.login_status >= 300 && result.login_status < 400 && !/^https:\/\/www\.swfi\.com\/v1\/signin\/?/i.test(result.login_location)) {
      result.failures.push(`login_redirect_not_swfi:${result.login_location || "missing"}`);
    }
    validateSwfiSigninBridge(result, result.login_location, "/swficc/", "default_login");
  }
  const nextLogin = await context.request.get(appUrl("/login/?next=%2Fswficc%2Fprofiles%2F"), { maxRedirects: 0, timeout: 30_000 }).catch((error) => ({ error }));
  if (nextLogin?.error) {
    result.failures.push(`next_login_request_failed:${nextLogin.error.message}`);
  } else {
    result.next_login_status = nextLogin.status();
    result.next_login_location = nextLogin.headers().location || "";
    validateSwfiSigninBridge(result, result.next_login_location, "/swficc/profiles/", "next_login");
  }
  const unsafeLogin = await context.request.get(appUrl("/login/?next=https%3A%2F%2Fevil.com%2F"), { maxRedirects: 0, timeout: 30_000 }).catch((error) => ({ error }));
  if (unsafeLogin?.error) {
    result.failures.push(`unsafe_login_request_failed:${unsafeLogin.error.message}`);
  } else {
    result.unsafe_login_status = unsafeLogin.status();
    result.unsafe_login_location = unsafeLogin.headers().location || "";
    validateSwfiSigninBridge(result, result.unsafe_login_location, "/swficc/", "unsafe_login");
    if (/evil\.com/i.test(result.unsafe_login_location)) result.failures.push("unsafe_login_open_redirect");
  }
  const session = await context.request.get(rootUrl("/api/session/status/v1"), { maxRedirects: 0, timeout: 30_000 }).catch((error) => ({ error }));
  if (!session?.error) {
    result.session_status = session.status();
    result.session_body = (await session.text().catch(() => "")).slice(0, 400);
    if (result.session_status === 200) {
      const body = safeJson(result.session_body);
      if (body.authenticated !== false) result.failures.push("custom_session_status_authenticated_without_bridge");
    }
  }
  result.ok = result.failures.length === 0;
  return result;
}

function safeJson(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function validateSwfiSigninBridge(result, location, expectedPath, label) {
  if (!/^https:\/\/www\.swfi\.com\/v1\/signin\/?/i.test(location || "")) {
    result.failures.push(`${label}_not_swfi_signin:${location || "missing"}`);
    return;
  }
  let parsed;
  try {
    parsed = new URL(location);
  } catch {
    result.failures.push(`${label}_invalid_location:${location || "missing"}`);
    return;
  }
  const redirect = parsed.searchParams.get("redirect") || "";
  const msg = parsed.searchParams.get("msg") || "";
  if (msg !== "auth") result.failures.push(`${label}_missing_auth_msg`);
  if (!redirect) {
    result.failures.push(`${label}_missing_return_redirect`);
    return;
  }
  let redirectUrl;
  try {
    redirectUrl = new URL(redirect);
  } catch {
    result.failures.push(`${label}_invalid_return_redirect:${redirect}`);
    return;
  }
  const expectedOrigin = new URL(origin).origin;
  if (redirectUrl.origin !== expectedOrigin) result.failures.push(`${label}_wrong_return_origin:${redirectUrl.origin}`);
  if (redirectUrl.pathname.replace(/\/?$/, "/") !== expectedPath) {
    result.failures.push(`${label}_wrong_return_path:${redirectUrl.pathname}`);
  }
}

function internalRecordKind(href) {
  try {
    const parsed = new URL(href);
    if (parsed.pathname.includes("/swficc/profiles/detail/")) return "entity";
    if (parsed.pathname.includes("/swficc/transactions/detail/")) return "transaction";
    if (parsed.pathname.includes("/swficc/mandates/detail/")) return "compass";
    if (parsed.pathname.includes("/swficc/people/detail/")) return "person";
  } catch {
    return "";
  }
  return "";
}

function swfiRecordKind(href) {
  try {
    const parsed = new URL(href);
    if (!parsed.hostname.endsWith("swfi.com")) return "";
    if (parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/") {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect || /^https?:\/\//i.test(redirect)) return "";
      const target = new URL(redirect, "https://www.swfi.com");
      return swfiRecordKind(target.href);
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1Index = parts.indexOf("v1");
    const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
    const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
    if (section === "entities" && id) return "entity";
    if (section === "transactions" && id) return "transaction";
    if (section === "compass" && id) return "compass";
    if ((section === "people" || section === "person") && id) return "person";
    if (parsed.searchParams.get("p")) return "legacy";
  } catch {
    return "";
  }
  return "";
}

async function swfiUnauthRedirectCheck(browser, href, label, kind) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const result = { label, kind, href, ok: true, failures: [], final_url: "", body_excerpt: "" };
  try {
    const response = await context.request.get(href, { timeout: 45_000 });
    const body = await response.text().catch(() => "");
    result.final_url = response.url();
    const final = new URL(result.final_url);
    if (response.status() >= 400) result.failures.push(`http_${response.status()}`);
    if (!final.hostname.endsWith("swfi.com")) result.failures.push(`not_swfi_destination:${result.final_url}`);
    if (!(/\/v1\/signin\/?$/i.test(final.pathname) || final.pathname === new URL(href).pathname)) result.failures.push(`not_swfi_signin_or_record:${result.final_url}`);
    const redirect = final.searchParams.get("redirect") || "";
    const requested = new URL(href);
    const expectedPath = /\/v1\/signin\/?$/i.test(requested.pathname)
      ? requested.searchParams.get("redirect") || ""
      : requested.pathname;
    if (/\/v1\/signin\/?$/i.test(final.pathname) && kind !== "legacy" && redirect && expectedPath && !redirect.includes(expectedPath)) result.failures.push(`wrong_swfi_redirect:${redirect}`);
    result.body_excerpt = body.slice(0, 500);
    if (/\/v1\/signin\/?$/i.test(final.pathname) && !/sign\s*in|login|email|password/i.test(body)) result.failures.push("signin_body_not_detected");
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function browserContract() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const result = {
    id: "browser_phase1_contract",
    ok: true,
    failures: [],
    final_url: "",
    title: "",
    screenshot: path.join(outputDir, "swfipn-phase1-dashboard.png"),
    requests: [],
    forbidden_network_hits: [],
    visible_hits: [],
    record_links: [],
    link_counts: {},
    storage: { localStorage: 0, sessionStorage: 0 },
    unauth_redirect_checks: [],
  };
  try {
    page.on("request", (request) => {
      result.requests.push(request.url());
      for (const pattern of forbiddenNetwork) {
        if (request.url().includes(pattern)) result.forbidden_network_hits.push({ pattern, url: request.url() });
      }
    });
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForLoadState("networkidle", { timeout: 180_000 }).catch(() => null);
    await page.waitForTimeout(3000);
    result.final_url = page.url();
    result.title = await page.title().catch(() => "");
    const body = await page.locator("body").innerText({ timeout: 30_000 });
    const lowerBody = body.toLowerCase();
    for (const pattern of forbiddenVisible) {
      if (lowerBody.includes(pattern.toLowerCase())) result.visible_hits.push(pattern);
    }
    result.storage = await page.evaluate(() => ({
      localStorage: window.localStorage.length,
      sessionStorage: window.sessionStorage.length,
    }));
    const anchors = await page.$$eval("a", (nodes) => nodes.map((node) => ({
      text: (node.textContent || "").trim().replace(/\s+/g, " "),
      href: node.href,
      record: node.getAttribute("data-record-link") || "",
      sourceHref: node.getAttribute("data-source-href") || "",
    })));
    const canonicalRecordLinks = anchors
      .filter((anchor) => anchor.record === "true")
      .map((anchor) => ({ ...anchor, kind: swfiRecordKind(anchor.href) }))
      .filter((anchor) => anchor.kind);
    const internalMirrorRecordLinks = anchors
      .filter((anchor) => anchor.record === "true")
      .map((anchor) => ({ ...anchor, kind: internalRecordKind(anchor.href) }))
      .filter((anchor) => anchor.kind);
    result.record_links = canonicalRecordLinks.slice(0, 50);
    result.internal_mirror_record_links = internalMirrorRecordLinks.slice(0, 50);
    result.link_counts = canonicalRecordLinks.reduce((acc, link) => {
      acc[link.kind] = (acc[link.kind] || 0) + 1;
      return acc;
    }, {});
    if (!/\/swficc\/?$/.test(new URL(result.final_url).pathname)) result.failures.push(`dashboard_not_public_root:${result.final_url}`);
    const normalizedBody = body.toLowerCase();
    const missingSections = requiredDashboardText.filter((text) => !normalizedBody.includes(text.toLowerCase()));
    result.dashboard_sections = requiredDashboardText.map((text) => ({ text, present: !missingSections.includes(text) }));
    if (missingSections.length) result.failures.push(`dashboard_core_sections_missing:${missingSections.join("|")}`);
    if (result.visible_hits.length) result.failures.push(`visible_forbidden_terms:${result.visible_hits.join(",")}`);
    if (result.forbidden_network_hits.length) result.failures.push(`forbidden_network_hits:${result.forbidden_network_hits.length}`);
    if (result.storage.localStorage !== 0 || result.storage.sessionStorage !== 0) result.failures.push("browser_storage_used");
    const nonCanonicalRecordLinks = anchors.filter((anchor) => anchor.record === "true" && !swfiRecordKind(anchor.href));
    if (internalMirrorRecordLinks.length) result.failures.push(`internal_mirror_record_links:${internalMirrorRecordLinks.length}`);
    if (nonCanonicalRecordLinks.length) result.failures.push(`non_canonical_record_links:${nonCanonicalRecordLinks.length}`);
    if (canonicalRecordLinks.length < minRecordLinks) result.failures.push(`too_few_swfi_record_links:${canonicalRecordLinks.length}`);
    if (!result.link_counts.entity) result.failures.push("no_swfi_entity_links");
    if (!result.link_counts.transaction) result.failures.push("no_swfi_transaction_links");
    if (!result.link_counts.compass) result.failures.push("no_swfi_compass_links");
    const localLoginLinks = anchors.filter((anchor) => /\/swficc\/login\/?/i.test(anchor.href));
    result.local_login_links = localLoginLinks.length;
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => {});

    const samples = [
      canonicalRecordLinks.find((link) => link.kind === "entity"),
      canonicalRecordLinks.find((link) => link.kind === "transaction"),
      canonicalRecordLinks.find((link) => link.kind === "compass"),
    ].filter(Boolean);
    for (const sample of samples) {
      result.unauth_redirect_checks.push(await swfiUnauthRedirectCheck(browser, sample.href, sample.text || sample.kind, sample.kind));
    }
    const recordFailures = result.unauth_redirect_checks.flatMap((check) => check.ok ? [] : check.failures.map((failure) => `${check.label}:${failure}`));
    if (recordFailures.length) result.failures.push(`swfi_unauth_redirect_failures:${recordFailures.join("|")}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const runtime = runtimeWriteScan();
  const { chromium } = loadPlaywright();
  const authBrowser = await chromium.launch({ channel: "chrome", headless: true });
  const authContext = await authBrowser.newContext({ storageState: { cookies: [], origins: [] } });
  const auth = await requestNoCustomAuth(authContext);
  await authContext.close().catch(() => {});
  await authBrowser.close().catch(() => {});
  const browser = await browserContract();
  const failures = [
    ...runtime.failures.map((failure) => `runtime:${failure}`),
    ...auth.failures.map((failure) => `auth:${failure}`),
    ...browser.failures.map((failure) => `browser:${failure}`),
  ];
  const receipt = {
    schema_version: "swfipn.phase1_public_dashboard_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: {
      failures: failures.length,
      record_links: browser.record_links?.length || 0,
      link_counts: browser.link_counts || {},
      runtime_write_matches: runtime.matches?.length || 0,
      custom_auth_ok: auth.ok,
      browser_ok: browser.ok,
    },
    runtime,
    auth,
    browser,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
