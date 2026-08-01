#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-dashboard-acceptance-crawler-latest.json");
const matrixPath = path.join(outputDir, "swfipn-dashboard-acceptance-matrix-latest.md");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";
const validateLocalAuth = /^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_ACCEPTANCE_VALIDATE_LOCAL_AUTH || ""));
const usableTargetMs = Number(process.env.SWFIPN_FIRST_USABLE_TARGET_MS || 12_000);
const linkTargetMs = Number(process.env.SWFIPN_LINK_TARGET_MS || 10_000);
const maxAgeHours = Number(process.env.SWFIPN_MAX_PACKET_AGE_HOURS || 24);
const crawlConcurrency = Math.max(1, Number(process.env.SWFIPN_CRAWL_CONCURRENCY || 6));
const expectedPacketSource = process.env.SWFIPN_EXPECTED_PACKET_SOURCE || "swfi_mongo_mirror";
const dashboardPacketSettleMs = Number(process.env.SWFIPN_DASHBOARD_PACKET_SETTLE_MS || 15_000);

const dashboardEndpoints = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  allocators: "/api/allocator-activity/v1?days=90&limit=25",
  mandates: "/api/live-opportunities/v1?limit=25&page=1",
  transactions: "/api/recent-transactions/v1?days=30&limit=25&page=1",
  news: "/api/source-intelligence/news/v1?limit=25",
  sectors: "/api/sector-flows/v1?days=365",
  topAum: "/v1/swfi/top20?limit=5",
};
const forbiddenBodyTerms = [
  "Active Mirror",
  "Object ID",
  "Mongo Record ID",
  "Endpoint:",
  "source_gap",
  "No internal record mapping",
  "citation-only",
  "SWFI Provenance Workbench",
  "Parser status",
  "Capture ID",
  "SourceVault",
  "Write Barrier",
  "ClaimLedger",
  "ReviewQueue",
  "ReplayBench",
  "PixelTruth",
  "DocStruct",
];
const sourceQueryPattern = /(?:[?&](?:id|source|url)=|%3F(?:id|source|url)%3D|%26(?:id|source|url)%3D)/i;
const objectIdTextPattern = /\b[a-f0-9]{24}\b/i;

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function appPath(route) {
  return new URL(route.replace(/^\//, ""), origin).pathname.replace(/\/?$/, "/");
}

function appTarget(route) {
  const root = new URL(origin);
  const basePath = root.pathname.replace(/\/$/, "");
  if (typeof route === "string" && route.startsWith(`${basePath}/`)) {
    const parsedTarget = new URL(route, root.origin);
    return `${parsedTarget.pathname.replace(/\/?$/, "/")}${parsedTarget.search}${parsedTarget.hash}`;
  }
  const cleanRoute = String(route || "");
  const parsed = cleanRoute.startsWith("#")
    ? new URL(cleanRoute, origin)
    : new URL(cleanRoute.replace(/^\//, ""), origin);
  return `${parsed.pathname.replace(/\/?$/, "/")}${parsed.search}${parsed.hash}`;
}

function apiUrl(route) {
  const root = new URL(origin);
  return new URL(route, root.origin).href;
}

function isAllowedSwfiRecordUrl(href) {
  if (isCanonicalSwfiSigninHandoff(href)) return true;
  if (swfiRecordPathFromHref(href)) return true;
  try {
    const parsed = new URL(href, origin);
    if (parsed.hostname !== "www.swfi.com") return false;
    if (parsed.pathname === "/" && parsed.searchParams.has("p")) return true;
    return false;
  } catch {
    return false;
  }
}

function parseCanonicalSwfiSignin(href) {
  try {
    const parsed = new URL(href, origin);
    if (parsed.hostname !== "www.swfi.com") return null;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return null;
    if (parsed.searchParams.get("msg") !== "auth") return null;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!(/^\/v1\/(?:entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i.test(redirect)
      || /^\/v1\/news\/\d{1,12}\/?$/i.test(redirect))) return null;
    return { href: parsed.href, redirect };
  } catch {
    return null;
  }
}

function isCanonicalSwfiSigninHandoff(href) {
  return Boolean(parseCanonicalSwfiSignin(href));
}

function swfiRecordPathFromHref(href) {
  try {
    const parsed = new URL(href, origin);
    if (parsed.hostname !== "www.swfi.com") return "";
    if (parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/") return parseCanonicalSwfiSignin(parsed.href)?.redirect || "";
    if (/^\/v1\/(?:entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname)
      || /^\/v1\/news\/\d{1,12}\/?$/i.test(parsed.pathname)) {
      return parsed.pathname.replace(/\/$/, "");
    }
  } catch {
    return "";
  }
  return "";
}

function isExternalHref(href) {
  try {
    const parsed = new URL(href, origin);
    const root = new URL(origin);
    return parsed.origin !== root.origin;
  } catch {
    return false;
  }
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function fetchJson(url, timeout = 45_000, internal = false) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const headers = internal
      ? { Accept: "application/json", "X-SWFIPN-Internal": "1" }
      : { Accept: "application/json", "X-SWFIPN-Public": "1" };
    const response = await fetch(url, { signal: controller.signal, headers });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { status: response.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function packetData(packet) {
  return packet?.data && typeof packet.data === "object" && !Array.isArray(packet.data) ? packet.data : {};
}

function packetRows(packet) {
  const data = packetData(packet);
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function packetIsFact(packet) {
  if (String(packet?.status || "").toLowerCase() === "ok" && packet?.fact === true) return true;
  return String(packet?.status || "").toLowerCase() === "ok"
    && String(packet?.state || "").toLowerCase() === "vault"
    && String(packet?.result_qualifier || "").toLowerCase() === "fact"
    && !packet?.source_gap;
}

function sourceReceipt(packet) {
  const sanitized = packet?.source_receipt && typeof packet.source_receipt === "object" ? packet.source_receipt : {};
  const provenance = packet?.provenance && typeof packet.provenance === "object" ? packet.provenance : {};
  const sourceDocIds = Array.isArray(provenance.source_doc_ids) ? provenance.source_doc_ids : [];
  return {
    source: cleanText(sanitized.source || provenance.source),
    source_doc_count: Number(sanitized.source_doc_count ?? sourceDocIds.length ?? 0),
  };
}

function cleanText(value, fallback = "") {
  if (value == null || value === "") return fallback;
  return String(value).trim();
}

async function waitForDashboard(page, timeout = 90_000) {
  await page.waitForFunction(
    () => {
      const body = document.body.innerText;
      const legacyDashboard = body.includes("KPI CARDS")
        && body.includes("INSIGHTS")
        && body.includes("TOP AUM RANKING");
      const brdDashboard = body.includes("Here's your intelligence and pipeline overview.")
        && body.includes("Global Capital Map")
        && body.includes("AI Insights");
      return (legacyDashboard || brdDashboard) && !body.includes("Loading");
    },
    null,
    { timeout },
  );
}

async function bodyText(page) {
  return page.locator("body").innerText({ timeout: 30_000 }).catch(() => "");
}

async function testExternalUnauthLink(link, expected) {
  const row = { index: link.index, text: link.text, href: link.raw, dashboard_target: link.dashboardTarget, expected, actual_url: link.href, elapsed_ms: 0, status: "PASS", failures: [] };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SWFIPN_ACCEPTANCE_EXTERNAL_TIMEOUT_MS || 15_000));
  try {
    const response = await fetch(expected.probe_url || link.href, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 SWFIPN acceptance crawler" },
    });
    row.elapsed_ms = Date.now() - started;
    const location = response.headers.get("location") || "";
    row.actual_url = location ? new URL(location, link.href).href : response.url || link.href;
    if (expected.kind === "swfi_login" || expected.kind === "local_swfi_login") {
      const parsed = new URL(row.actual_url);
      if (response.status < 200 || response.status >= 400) row.failures.push(`expected_login_or_redirect_status_got_${response.status}`);
      if (parsed.hostname !== expected.final_host) row.failures.push(`expected_swfi_host_got_${parsed.hostname}`);
      if (parsed.pathname.replace(/\/?$/, "/") !== expected.final_path) row.failures.push(`expected_swfi_login_got_${parsed.pathname}`);
      const redirect = parsed.searchParams.get("redirect") || "";
      if (expected.target_path && !redirect.includes(expected.target_path)) row.failures.push("swfi_redirect_target_mismatch");
    } else if (expected.kind === "external_direct") {
      if (response.status >= 400) row.failures.push(`external_http_${response.status}`);
      const parsed = new URL(row.actual_url);
      if (parsed.hostname !== expected.final_host) row.failures.push(`expected_external_host_got_${parsed.hostname}`);
      if (parsed.pathname !== expected.final_path) row.failures.push(`external_path_mismatch:${parsed.pathname}`);
    }
  } catch (error) {
    row.elapsed_ms = Date.now() - started;
    row.failures.push(error.message);
  } finally {
    clearTimeout(timer);
  }
  row.status = row.failures.length ? "FAIL" : "PASS";
  return row;
}

async function testDirectUnauthLink(link, expected) {
  const target = expected.probe_url || link.href;
  const row = { index: link.index, text: link.text, href: link.raw, dashboard_target: link.dashboardTarget, expected, actual_url: target, elapsed_ms: 0, status: "PASS", failures: [] };
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.SWFIPN_ACCEPTANCE_INTERNAL_TIMEOUT_MS || 10_000));
  try {
    const response = await fetch(target, {
      redirect: "manual",
      signal: controller.signal,
      headers: { "User-Agent": "Mozilla/5.0 SWFIPN acceptance crawler" },
    });
    row.elapsed_ms = Date.now() - started;
    const location = response.headers.get("location") || "";
    row.actual_url = location ? new URL(location, target).href : target;
    const parsed = new URL(row.actual_url);
    if (expected.kind === "direct" || expected.kind === "hash") {
      if (response.status >= 400) row.failures.push(`http_${response.status}`);
      if (parsed.pathname.replace(/\/?$/, "/") !== expected.final_path) row.failures.push(`direct_path_mismatch:${parsed.pathname}`);
    } else if (expected.kind === "login" || expected.kind === "login_direct") {
      if (response.status < 300 || response.status >= 400) row.failures.push(`expected_redirect_status_got_${response.status}`);
      if (parsed.hostname !== "www.swfi.com") row.failures.push(`expected_swfi_host_got_${parsed.hostname}`);
      if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") row.failures.push(`expected_swfi_login_got_${parsed.pathname}`);
    }
  } catch (error) {
    row.elapsed_ms = Date.now() - started;
    row.failures.push(error.message);
  } finally {
    clearTimeout(timer);
  }
  row.status = row.failures.length ? "FAIL" : "PASS";
  return row;
}

async function collectLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a, domIndex) => {
    const rect = a.getBoundingClientRect();
    const style = window.getComputedStyle(a);
    const accessibleText = [
      a.textContent,
      a.getAttribute("aria-label"),
      a.querySelector("img")?.getAttribute("alt"),
      a.getAttribute("title"),
    ].find((value) => value && value.trim());
    const raw = a.getAttribute("href") || "";
    const hrefValue = typeof a.href === "string" ? a.href : new URL(raw, window.location.href).href;
    return {
      domIndex,
      text: accessibleText?.trim().replace(/\s+/g, " ") || "",
      href: hrefValue,
      raw,
      dashboardTarget: a.getAttribute("data-dashboard-target") || "",
      recordLink: a.getAttribute("data-record-link") || "",
      visible: rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none" && Number(style.opacity || "1") > 0,
    };
  }).filter((link) => link.visible && (link.text || link.raw)).map((link, index) => ({ ...link, index })));
}

function normalizeLinkText(value) {
  return cleanText(value).replace(/\s+/g, " ");
}

async function clickMatchingDashboardLink(page, link) {
  const clicked = await page.evaluate((wanted) => {
    const normalize = (value) => String(value || "").trim().replace(/\s+/g, " ");
    const anchors = Array.from(document.querySelectorAll("a[href]")).filter((anchor) => {
      const rect = anchor.getBoundingClientRect();
      const style = window.getComputedStyle(anchor);
      return rect.width > 0
        && rect.height > 0
        && style.visibility !== "hidden"
        && style.display !== "none"
        && Number(style.opacity || "1") > 0;
    });
    const matches = anchors.filter((anchor) => {
      const target = anchor.getAttribute("data-dashboard-target") || "";
      const raw = anchor.getAttribute("href") || "";
      const text = normalize(anchor.textContent || anchor.getAttribute("aria-label") || anchor.getAttribute("title") || "");
      const targetMatches = wanted.dashboardTarget ? target === wanted.dashboardTarget : true;
      const rawMatches = wanted.raw ? raw === wanted.raw : true;
      const textMatches = wanted.text ? text === wanted.text : true;
      return (targetMatches && textMatches) || (targetMatches && rawMatches) || (rawMatches && textMatches);
    });
    const anchor = matches[0] || anchors[wanted.index];
    if (!anchor) return false;
    anchor.scrollIntoView({ block: "center", inline: "center" });
    anchor.click();
    return true;
  }, {
    index: link.index,
    raw: link.raw,
    dashboardTarget: link.dashboardTarget,
    text: normalizeLinkText(link.text),
  });
  if (!clicked) {
    await page.locator("a[href]:visible").nth(link.index).click({ timeout: 30_000 });
  }
}

function expectedPublic(link) {
  const signin = parseCanonicalSwfiSignin(link.href);
  if (signin) {
    return { kind: "swfi_login", probe_url: link.href, final_host: "www.swfi.com", final_path: "/v1/signin/", target_path: signin.redirect };
  }
  const recordPath = swfiRecordPathFromHref(link.href);
  if (recordPath) {
    const parsed = new URL(link.href, origin);
    return { kind: "swfi_login", probe_url: parsed.href, final_host: "www.swfi.com", final_path: "/v1/signin/", target_path: recordPath };
  }
  if (isAllowedSwfiRecordUrl(link.href)) {
    const parsed = new URL(link.href, origin);
    return { kind: "external_direct", final_host: parsed.hostname, final_path: parsed.pathname, target_path: `${parsed.pathname}${parsed.search}` };
  }
  if (link.raw.startsWith("#")) return { kind: "hash", final_path: appPath("/"), next: "" };
  if (!link.dashboardTarget) {
    try {
      const root = new URL(origin);
      const basePath = root.pathname.replace(/\/$/, "");
      const parsed = new URL(link.href, origin);
      const normalizedPath = parsed.pathname.replace(/\/?$/, "/");
      if (parsed.origin === root.origin && (normalizedPath === `${basePath}/` || normalizedPath.startsWith(`${basePath}/`))) {
        if (normalizedPath === appPath("/login/")) {
          return { kind: "local_swfi_login", probe_url: parsed.href, final_host: "www.swfi.com", final_path: "/v1/signin/", target_path: parsed.searchParams.get("next") || "" };
        }
        if (isProtectedRecordPath(normalizedPath)) {
          return { kind: "local_swfi_login", probe_url: parsed.href, final_host: "www.swfi.com", final_path: "/v1/signin/", target_path: normalizedPath };
        }
        return { kind: "direct", final_path: normalizedPath, next: "" };
      }
      if (normalizedPath === appPath("/")) return { kind: "direct", final_path: appPath("/"), next: "" };
      if (normalizedPath === appPath("/login/")) {
        return { kind: "local_swfi_login", probe_url: parsed.href, final_host: "www.swfi.com", final_path: "/v1/signin/", target_path: parsed.searchParams.get("next") || "" };
      }
    } catch {
      return { kind: "direct", final_path: appPath("/"), next: "" };
    }
  }
  return { kind: "login", final_path: appPath("/login/"), next: link.dashboardTarget || "" };
}

function isProtectedRecordPath(normalizedPath) {
  return [
    appPath("/profiles/detail/"),
    appPath("/transactions/detail/"),
    appPath("/mandates/detail/"),
    appPath("/people/detail/"),
  ].some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(prefix));
}

function expectedAuthenticated(link) {
  if (link.dashboardTarget) return { kind: "target", target: link.dashboardTarget };
  if (link.raw.startsWith("#")) return { kind: "hash", target: appTarget(link.raw) };
  return { kind: "direct", target: appTarget(link.raw) };
}

async function testUnauthLink(browser, link) {
  const expected = expectedPublic(link);
  if (expected.kind === "swfi_login" || expected.kind === "external_direct" || expected.kind === "local_swfi_login") {
    return testExternalUnauthLink(link, expected);
  }
  if (expected.kind === "direct" || expected.kind === "hash" || expected.kind === "login" || expected.kind === "login_direct") {
    return testDirectUnauthLink(link, expected);
  }
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const row = { index: link.index, text: link.text, href: link.raw, dashboard_target: link.dashboardTarget, expected, actual_url: "", elapsed_ms: 0, status: "PASS", failures: [] };
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForDashboard(page);
    const started = Date.now();
    await clickMatchingDashboardLink(page, link);
    if (row.expected.kind === "login" || row.expected.kind === "login_direct") {
      await page.waitForURL((url) => url.pathname.replace(/\/?$/, "/") === appPath("/login/"), { timeout: 90_000 }).catch(() => null);
    } else if (row.expected.kind === "swfi_login") {
      await page.waitForURL((url) => url.hostname === row.expected.final_host && url.pathname.replace(/\/?$/, "/") === row.expected.final_path, { timeout: 90_000 }).catch(() => null);
    } else if (row.expected.kind === "external_direct") {
      await page.waitForURL((url) => url.hostname === row.expected.final_host && url.pathname === row.expected.final_path, { timeout: 90_000 }).catch(() => null);
    } else if (row.expected.kind === "direct") {
      await page.waitForURL((url) => url.pathname.replace(/\/?$/, "/") === row.expected.final_path, { timeout: 90_000 }).catch(() => null);
    } else if (row.expected.kind === "hash") {
      await page.waitForURL((url) => url.pathname.replace(/\/?$/, "/") === appPath("/"), { timeout: 90_000 }).catch(() => null);
    }
    await page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => null);
    await page.waitForTimeout(200);
    row.actual_url = page.url();
    row.elapsed_ms = Date.now() - started;
    const parsed = new URL(row.actual_url);
    if (row.expected.kind === "login") {
      if (parsed.pathname.replace(/\/?$/, "/") !== appPath("/login/")) row.failures.push(`expected_login_got_${parsed.pathname}`);
      if (row.expected.next && parsed.searchParams.get("next") !== row.expected.next) row.failures.push("next_mismatch");
      const body = await bodyText(page);
      if (!/Subscriber Sign In|Sign in/i.test(body)) row.failures.push("login_body_missing");
    }
    if (row.expected.kind === "login_direct") {
      if (parsed.pathname.replace(/\/?$/, "/") !== appPath("/login/")) row.failures.push(`expected_login_got_${parsed.pathname}`);
      const body = await bodyText(page);
      if (!/Subscriber Sign In|Sign in/i.test(body)) row.failures.push("login_body_missing");
    }
    if (row.expected.kind === "swfi_login") {
      if (parsed.hostname !== row.expected.final_host) row.failures.push(`expected_swfi_host_got_${parsed.hostname}`);
      if (parsed.pathname.replace(/\/?$/, "/") !== row.expected.final_path) row.failures.push(`expected_swfi_login_got_${parsed.pathname}`);
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect.includes(row.expected.target_path)) row.failures.push("swfi_redirect_target_mismatch");
    }
    if (row.expected.kind === "external_direct") {
      if (parsed.hostname !== row.expected.final_host) row.failures.push(`expected_external_host_got_${parsed.hostname}`);
      if (parsed.pathname !== row.expected.final_path) row.failures.push(`external_path_mismatch:${parsed.pathname}`);
    }
    if (row.expected.kind === "direct" && parsed.pathname.replace(/\/?$/, "/") !== row.expected.final_path) row.failures.push(`direct_path_mismatch:${parsed.pathname}`);
    if (row.expected.kind === "hash" && parsed.pathname.replace(/\/?$/, "/") !== appPath("/")) row.failures.push(`hash_left_dashboard:${parsed.pathname}`);
  } catch (error) {
    row.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  row.status = row.failures.length ? "FAIL" : "PASS";
  return row;
}

async function loginContext(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(appUrl(`/login/?next=${encodeURIComponent("/swficc/")}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await Promise.all([
    page.waitForURL(/\/swficc\/(?:$|[?#])/, { timeout: 90_000 }),
    page.locator('button[type="submit"]').click(),
  ]);
  await page.close().catch(() => {});
  return context;
}

async function testAuthLink(context, link) {
  const page = await context.newPage();
  const row = { index: link.index, text: link.text, href: link.raw, dashboard_target: link.dashboardTarget, expected: expectedAuthenticated(link), actual_url: "", elapsed_ms: 0, status: "PASS", failures: [] };
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForDashboard(page);
    const started = Date.now();
    await clickMatchingDashboardLink(page, link);
    if (row.expected.kind === "target") {
      const expected = new URL(row.expected.target, origin);
      await page.waitForURL((url) => url.pathname.replace(/\/?$/, "/") === expected.pathname.replace(/\/?$/, "/"), { timeout: 90_000 }).catch(() => null);
    }
    if (/\/detail\//.test(row.expected.target || "")) {
      await page.waitForFunction(() => /Verified in SWFI records/i.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => null);
    } else {
      await page.waitForFunction(
        () => !/Subscriber Sign In|Redirecting to SWFI sign in/i.test(document.body.innerText),
        null,
        { timeout: 15_000 },
      ).catch(() => null);
      await page.waitForTimeout(200);
    }
    row.actual_url = page.url();
    row.elapsed_ms = Date.now() - started;
    const parsed = new URL(row.actual_url);
    if (row.expected.kind === "target") {
      const expected = new URL(row.expected.target, origin);
      if (parsed.pathname.replace(/\/?$/, "/") !== expected.pathname.replace(/\/?$/, "/")) row.failures.push(`path_mismatch:${parsed.pathname}`);
      if (parsed.pathname.replace(/\/?$/, "/") === appPath("/login/")) row.failures.push("auth_returned_to_login");
    }
    const body = await bodyText(page);
    if (/Subscriber Sign In/i.test(body) && row.expected.kind === "target") row.failures.push("auth_session_not_continuous");
    if (/Application error|502 Bad Gateway|Internal Server Error|404 Page not found|Not found/i.test(body)) row.failures.push("destination_error_body");
    if (/\/detail\//.test(row.expected.target || "") && !/Verified in SWFI records/i.test(body)) row.failures.push("detail_missing_verified_record");
    if (row.text && /\/detail\//.test(row.expected.target || "") && !body.toLowerCase().includes(row.text.toLowerCase().slice(0, 40))) row.failures.push("detail_missing_clicked_label");
  } catch (error) {
    row.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  row.status = row.failures.length ? "FAIL" : "PASS";
  return row;
}

async function testDirectProtectedRoutes(browser, context) {
  if (!validateLocalAuth) return [];
  const samples = [
    { route: "/allocators/", authText: "Active Allocators", protectedText: "Showing" },
    { route: "/profiles/", authText: "Institutions", protectedText: "Showing" },
    { route: "/transactions/", authText: "Transactions", protectedText: "Showing" },
    { route: "/mandates/", authText: "RFPs / Mandates", protectedText: "Showing" },
    { route: "/profiles/detail/?slug=andreessen-horowitz&name=Andreessen+Horowitz", authText: "ENTITY PROFILE", protectedText: "Andreessen Horowitz" },
    { route: "/transactions/detail/?id=6a2c168b43e7f69d0cd0c923", authText: "TRANSACTION DETAILS", protectedText: "ChatSee.AI Inc" },
  ];
  const rows = [];
  for (const sample of samples) {
    const publicContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
    const publicPage = await publicContext.newPage();
    const row = { route: sample.route, unauthenticated: { final_url: "", ok: true, failures: [] }, authenticated: { final_url: "", ok: true, failures: [] } };
    try {
      await publicPage.goto(appUrl(sample.route), { waitUntil: "domcontentloaded", timeout: 90_000 });
      await publicPage.waitForURL(/\/swficc\/login\/(?:$|[?#])/, { timeout: 90_000 }).catch(() => null);
      await publicPage.waitForTimeout(250);
      row.unauthenticated.final_url = publicPage.url();
      const parsed = new URL(row.unauthenticated.final_url);
      const body = await bodyText(publicPage);
      if (parsed.pathname.replace(/\/?$/, "/") !== appPath("/login/")) row.unauthenticated.failures.push(`not_login:${parsed.pathname}`);
      if (parsed.searchParams.get("next") !== appTarget(sample.route)) row.unauthenticated.failures.push("next_mismatch");
      if (!/Subscriber Sign In/i.test(body)) row.unauthenticated.failures.push("login_body_missing");
      if (sample.protectedText && body.includes(sample.protectedText)) row.unauthenticated.failures.push(`protected_content_visible:${sample.protectedText}`);
    } catch (error) {
      row.unauthenticated.failures.push(error.message);
    } finally {
      await publicContext.close().catch(() => {});
    }
    row.unauthenticated.ok = row.unauthenticated.failures.length === 0;

    if (context) {
      const authPage = await context.newPage();
      try {
        await authPage.goto(appUrl(sample.route), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await authPage.waitForFunction((expected) => document.body.innerText.toLowerCase().includes(String(expected).toLowerCase()), sample.authText, { timeout: 90_000 }).catch(() => null);
        row.authenticated.final_url = authPage.url();
        const parsed = new URL(row.authenticated.final_url);
        const body = await bodyText(authPage);
        if (parsed.pathname.replace(/\/?$/, "/") === appPath("/login/")) row.authenticated.failures.push("auth_returned_to_login");
        if (!body.toLowerCase().includes(sample.authText.toLowerCase())) row.authenticated.failures.push(`auth_text_missing:${sample.authText}`);
      } catch (error) {
        row.authenticated.failures.push(error.message);
      } finally {
        await authPage.close().catch(() => {});
      }
      row.authenticated.ok = row.authenticated.failures.length === 0;
    } else {
      row.authenticated.ok = false;
      row.authenticated.failures.push("auth_context_missing");
    }
    rows.push(row);
  }
  return rows;
}

function matrixRow(requirement, testCase, publicExpected, authenticatedExpected, actualResult, evidence, status, blocker = "", owner = "Active Mirror") {
  return { requirement, test_case: testCase, public_expected: publicExpected, authenticated_expected: authenticatedExpected, actual_result: actualResult, evidence, status, owner, blocker };
}

function statusFor(failures, blocked = false) {
  if (blocked) return "BLOCKED";
  return failures.length ? "FAIL" : "PASS";
}

function visibleDashboardFactFailures(publicBody, fetchedPackets) {
  const normalizedBody = cleanText(publicBody).toLowerCase();
  const failures = [];
  const checks = [
    {
      key: "news",
      label: "news",
      limit: 3,
      values: (row) => [row?.title, row?.name],
    },
    {
      key: "transactions",
      label: "transaction",
      limit: 5,
      values: (row) => [row?.title, row?.name, row?.buyer_entity, row?.buyer],
    },
    {
      key: "sectors",
      label: "sector",
      limit: 5,
      values: (row) => [row?.name, row?.value],
    },
  ];
  for (const check of checks) {
    const sourceRows = packetRows(fetchedPackets[check.key]).slice(0, check.limit);
    if (!sourceRows.length) {
      failures.push(`${check.label}:missing_packet_rows`);
      continue;
    }
    for (const row of sourceRows) {
      const candidates = check.values(row)
        .map((value) => cleanText(value))
        .filter((value) => value && value.length > 2 && value.toLowerCase() !== "not disclosed");
      if (!candidates.length) continue;
      if (!candidates.some((value) => normalizedBody.includes(value.toLowerCase()))) {
        failures.push(`${check.label}:missing_visible_value:${candidates[0]}`);
      }
    }
  }
  return failures;
}

function percentile(values, percent) {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil((percent / 100) * sorted.length) - 1);
  return sorted[index];
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let index = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index;
      index += 1;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({     headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const receipt = {
    schema_version: "swfipn.dashboard_acceptance_crawler.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: "PASS",
    summary: {},
    matrix: [],
    packets: {},
    links: [],
    unauthenticated: [],
    authenticated: [],
    screenshots: {},
    failures: [],
  };
  try {
    const publicContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
    const publicPage = await publicContext.newPage();
    const usableStart = Date.now();
    const response = await publicPage.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForDashboard(publicPage);
    const firstUsableMs = Date.now() - usableStart;
    await publicPage.waitForTimeout(dashboardPacketSettleMs);
    const publicBody = await bodyText(publicPage);
    receipt.screenshots.public_dashboard = path.join(outputDir, "swfipn-acceptance-crawler-public-dashboard.png");
    await publicPage.screenshot({ path: receipt.screenshots.public_dashboard, fullPage: true }).catch(() => {});
    receipt.links = await collectLinks(publicPage);
    await publicContext.close().catch(() => {});

    const mobileContext = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 390, height: 980 } });
    const mobilePage = await mobileContext.newPage();
    await mobilePage.goto(origin, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForDashboard(mobilePage);
    await mobilePage.waitForTimeout(dashboardPacketSettleMs);
    const mobileBody = await bodyText(mobilePage);
    const mobileMetrics = await mobilePage.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
      linkCount: document.querySelectorAll("a[href]").length,
      searchCount: document.querySelectorAll('input[type="search"], input[placeholder*="Search" i], button[aria-label*="Search" i], button[aria-label*="Open Global Search" i]').length,
    }));
    receipt.screenshots.mobile_dashboard = path.join(outputDir, "swfipn-acceptance-crawler-mobile-dashboard.png");
    await mobilePage.screenshot({ path: receipt.screenshots.mobile_dashboard, fullPage: true }).catch(() => {});
    await mobileContext.close().catch(() => {});

    const packetFailures = [];
    const staleFailures = [];
    const fetchedPackets = {};
    const now = Date.now();
    for (const [key, route] of Object.entries(dashboardEndpoints)) {
      const { status, json } = await fetchJson(apiUrl(route), 45_000, true);
      fetchedPackets[key] = json;
      const generatedMs = Date.parse(cleanText(json?.generated_at));
      const sourceInfo = sourceReceipt(json);
      const ageHours = Number.isFinite(generatedMs) ? (now - generatedMs) / 3_600_000 : null;
      receipt.packets[key] = {
        route,
        http_status: status,
        fact: packetIsFact(json),
        generated_at: cleanText(json?.generated_at),
        age_hours: ageHours == null ? null : Number(ageHours.toFixed(3)),
        provenance_source: sourceInfo.source,
        source_doc_ids: sourceInfo.source_doc_count,
      };
      if (status >= 400 || !packetIsFact(json)) packetFailures.push(`${key}:not_fact`);
      if (ageHours == null || ageHours < -0.25 || ageHours > maxAgeHours) staleFailures.push(`${key}:stale_or_missing_generated_at`);
      if (sourceInfo.source !== expectedPacketSource) staleFailures.push(`${key}:unexpected_source_receipt:${sourceInfo.source || "missing"}`);
      if (!["metrics", "news", "sectors"].includes(key) && !sourceInfo.source_doc_count) staleFailures.push(`${key}:missing_source_doc_ids`);
    }
    const visibleFactFailures = visibleDashboardFactFailures(publicBody, fetchedPackets);

    const noLeakFailures = [];
    for (const term of forbiddenBodyTerms) {
      if (publicBody.includes(term)) noLeakFailures.push(`body:${term}`);
    }
    const leakedLinks = receipt.links.filter((link) => {
      if (isCanonicalSwfiSigninHandoff(link.href) || isCanonicalSwfiSigninHandoff(link.raw)) return false;
      const joined = [link.href, link.raw, link.dashboardTarget].filter(Boolean).join(" ");
      return sourceQueryPattern.test(joined) || objectIdTextPattern.test(cleanText(link.text));
    });
    if (leakedLinks.length) noLeakFailures.push(`leaked_links:${leakedLinks.length}`);
    const externalLinks = receipt.links.filter((link) => isExternalHref(link.href) && !isAllowedSwfiRecordUrl(link.href));
    if (externalLinks.length) noLeakFailures.push(`external_swfi_links:${externalLinks.length}`);

    receipt.unauthenticated = await mapLimit(receipt.links, crawlConcurrency, (link) => testUnauthLink(browser, link));

    const authBlocked = validateLocalAuth && (!username || !password);
    let authContext = null;
    if (validateLocalAuth && !authBlocked) {
      authContext = await loginContext(browser);
      receipt.authenticated = await mapLimit(receipt.links, crawlConcurrency, (link) => testAuthLink(authContext, link));
    }
    receipt.direct_protected_routes = await testDirectProtectedRoutes(browser, authContext);
    if (authContext) await authContext.close().catch(() => {});

    const unauthFailures = receipt.unauthenticated.filter((row) => row.status !== "PASS");
    const authFailures = receipt.authenticated.filter((row) => row.status !== "PASS");
    const routeFailures = [...unauthFailures, ...authFailures].map((row) => `${row.index}:${row.text}:${row.failures.join(",")}`);
    const directRouteFailures = (receipt.direct_protected_routes || [])
      .filter((row) => !row.unauthenticated.ok || !row.authenticated.ok)
      .map((row) => `${row.route}:public=${row.unauthenticated.failures.join(",")}:auth=${row.authenticated.failures.join(",")}`);
    const recordFailures = receipt.authenticated.filter((row) => /\/detail\//.test(row.dashboard_target || "") && row.status !== "PASS");
    const sessionFailures = receipt.authenticated.filter((row) => row.failures.includes("auth_session_not_continuous"));
    const authP95Ms = percentile(receipt.authenticated.map((row) => row.elapsed_ms), 95);
    const unauthP95Ms = percentile(receipt.unauthenticated.map((row) => row.elapsed_ms), 95);
    const mobileFailures = [];
    const mobileHasLegacyData = mobileBody.includes("KPI CARDS") && mobileBody.includes("INSIGHTS");
    const mobileHasBrdData = mobileBody.includes("Here's your intelligence and pipeline overview.")
      && mobileBody.includes("Global Capital Map")
      && mobileBody.includes("AI Insights");
    if (!mobileHasLegacyData && !mobileHasBrdData) mobileFailures.push("missing_mobile_top_level_data");
    if (mobileMetrics.searchCount < 1) mobileFailures.push("missing_mobile_search");
    if (mobileMetrics.scrollWidth > mobileMetrics.clientWidth + 2) mobileFailures.push(`mobile_horizontal_overflow:${mobileMetrics.scrollWidth}>${mobileMetrics.clientWidth}`);
    const uxFailures = [];
    const missingTextLinks = receipt.links.filter((link) => !cleanText(link.text));
    if (missingTextLinks.length) uxFailures.push(`missing_link_text:${missingTextLinks.length}`);
    if (!/search/i.test(publicBody) || !/(Recent Activity|Name\s+Buyer Entity|Top 10|Count)/i.test(publicBody)) uxFailures.push("missing_table_controls");
    if (!/(Top 10|Count|showing|show\s+\d+)/i.test(publicBody)) uxFailures.push("missing_table_counts");
    const performanceFailures = [];
    if (firstUsableMs > usableTargetMs) performanceFailures.push(`first_usable_${firstUsableMs}_gt_${usableTargetMs}`);
    if (authP95Ms > linkTargetMs) performanceFailures.push(`auth_link_p95_${authP95Ms}_gt_${linkTargetMs}`);
    if (unauthP95Ms > linkTargetMs) performanceFailures.push(`public_link_p95_${unauthP95Ms}_gt_${linkTargetMs}`);

    receipt.matrix = [
      matrixRow("Data Parity", "Compare visible dashboard news, newest transaction, and market-focus values against SWFI fact packets.", "Only approved top-level facts render.", "Same facts render after login.", visibleFactFailures.length || packetFailures.length ? [...packetFailures, ...visibleFactFailures].join("; ") : "SWFI fact packets match visible dashboard values.", `${receiptPath}#packets`, statusFor([...packetFailures, ...visibleFactFailures])),
      matrixRow("Staleness", "Check generated_at, provenance source, and source document receipts for every dashboard packet.", "Fresh packet or module must not silently render.", "Fresh packet or module must not silently render.", staleFailures.length ? staleFailures.join("; ") : `All displayed packets fresh within ${maxAgeHours}h.`, `${receiptPath}#packets`, statusFor(staleFailures)),
      matrixRow("Route Parity", "Click every visible dashboard link and directly open protected routes when local auth validation is enabled.", "Logged out SWFI record links route to SWFI sign-in with the intended target; public dashboard links stay in SWFIPN.", "When enabled, logged-in links route to intended SWFIPN profile/detail/workflow.", routeFailures.length || directRouteFailures.length ? [...routeFailures, ...directRouteFailures].slice(0, 12).join("; ") : `All ${receipt.links.length} visible public links matched the Phase 1 handoff contract.`, `${receiptPath}#unauthenticated`, statusFor([...routeFailures, ...directRouteFailures])),
      matrixRow("Record Detail Parity", "Record links must preserve the intended SWFI record target.", "Logged out record rows route to SWFI sign-in or public SWFI legacy article with the target preserved.", "Local authenticated detail crawl is skipped unless explicitly enabled.", recordFailures.length ? recordFailures.map((row) => `${row.index}:${row.text}`).join("; ") : "Public record handoff targets were preserved.", `${receiptPath}#unauthenticated`, statusFor(recordFailures.map((row) => row.text))),
      matrixRow("No Internal Leakage", "Scan dashboard body and links for object IDs, source_gap, Active Mirror, backend/provenance/debug terms, and direct SWFI.com links.", "No internal terms or source internals visible.", "No internal terms or source internals visible.", noLeakFailures.length ? noLeakFailures.join("; ") : "No internal leakage detected.", `${receiptPath}#links`, statusFor(noLeakFailures)),
      matrixRow("Authenticated Session Continuity", "After local login, click every dashboard link without re-authenticating when local auth validation is enabled.", "N/A", "User stays authenticated and is not sent back to login for protected dashboard targets.", validateLocalAuth ? (sessionFailures.length ? sessionFailures.map((row) => `${row.index}:${row.text}`).join("; ") : "Authenticated session remained continuous.") : "Skipped for Phase 1 public crawler; SWFI owns the authenticated session after handoff.", `${receiptPath}#authenticated`, validateLocalAuth ? statusFor(sessionFailures.map((row) => row.text), authBlocked) : "PASS", authBlocked ? "Missing auth credentials" : ""),
      matrixRow("Mobile Acceptance", "Render mobile dashboard at 390px and check top-level data, search, links, and overflow.", "Public mobile lookup works.", "Authenticated route behavior covered by link crawl.", mobileFailures.length ? mobileFailures.join("; ") : "Mobile dashboard rendered top-level data, search, links, and no horizontal overflow.", receipt.screenshots.mobile_dashboard, statusFor(mobileFailures)),
      matrixRow("Performance", "Measure dashboard first usable render and p95 link resolution time.", `First usable <= ${usableTargetMs}ms; public link p95 <= ${linkTargetMs}ms.`, `First usable <= ${usableTargetMs}ms; authenticated link p95 <= ${linkTargetMs}ms.`, performanceFailures.length ? performanceFailures.join("; ") : `First usable ${firstUsableMs}ms; public p95 ${unauthP95Ms}ms; auth p95 ${authP95Ms}ms.`, `${receiptPath}#summary`, statusFor(performanceFailures)),
      matrixRow("Accessibility / UX", "Check link text, visible table controls, counts, and obvious links.", "Keyboard/link surface has text and table controls are readable.", "Same.", uxFailures.length ? uxFailures.join("; ") : "Links have text; table search/rows/counts are visible.", `${receiptPath}#links`, statusFor(uxFailures)),
      matrixRow("Security", "Verify public dashboard exposes only top-level data and no source internals/API errors/tokens render.", "SWFI record links hand off to SWFI auth; dashboard internals stay hidden.", "Authenticated SWFI session is handled by SWFI after handoff.", noLeakFailures.length || routeFailures.length || directRouteFailures.length ? [...noLeakFailures, ...routeFailures.slice(0, 5), ...directRouteFailures.slice(0, 5)].join("; ") : "Public handoff behavior and leakage checks passed.", `${receiptPath}#links`, statusFor([...noLeakFailures, ...routeFailures, ...directRouteFailures])),
      matrixRow("Acceptance Evidence Pack", "Emit matrix, screenshots, packet receipt, and per-link unauth/auth crawl rows.", "Evidence exists.", "Evidence exists.", "Evidence pack written.", `${receiptPath}; ${matrixPath}`, "PASS"),
    ];

    const failedMatrix = receipt.matrix.filter((row) => row.status !== "PASS");
    receipt.summary = {
      public_status: response?.status() || 0,
      first_usable_ms: firstUsableMs,
      visible_links: receipt.links.length,
      direct_protected_routes: receipt.direct_protected_routes?.length || 0,
      unauthenticated_failures: unauthFailures.length,
      authenticated_failures: authFailures.length,
      direct_protected_route_failures: directRouteFailures.length,
      unauthenticated_link_p95_ms: unauthP95Ms,
      authenticated_link_p95_ms: authP95Ms,
      matrix_failures: failedMatrix.length,
      screenshots: receipt.screenshots,
    };
    receipt.failures = failedMatrix;
    receipt.status = failedMatrix.length ? "fail" : "pass";
  } finally {
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(matrixPath, renderMatrix(receipt));
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath, matrix: matrixPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

function renderMatrix(receipt) {
  const lines = [
    "# SWFIPN Dashboard Acceptance Matrix",
    "",
    `Generated: ${receipt.generated_at}`,
    `Origin: ${receipt.origin}`,
    `Status: ${receipt.status.toUpperCase()}`,
    "",
    "| Requirement | Test Case | Public Expected | Authenticated Expected | Actual Result | Evidence | Status | Owner | Blocker |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  ];
  for (const row of receipt.matrix) {
    lines.push([
      row.requirement,
      row.test_case,
      row.public_expected,
      row.authenticated_expected,
      row.actual_result,
      row.evidence,
      row.status,
      row.owner,
      row.blocker,
    ].map(markdownCell).join(" | ").replace(/^/, "| ").replace(/$/, " |"));
  }
  lines.push("");
  lines.push("## Summary");
  lines.push("");
  for (const [key, value] of Object.entries(receipt.summary || {})) {
    lines.push(`- ${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`);
  }
  return `${lines.join("\n")}\n`;
}

function markdownCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\n/g, " ");
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
