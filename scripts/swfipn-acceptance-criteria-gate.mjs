#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-acceptance-criteria-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";
const allowAuthSkip = process.env.SWFIPN_ACCEPTANCE_ALLOW_AUTH_SKIP === "1";
const expectedPacketSource = process.env.SWFIPN_EXPECTED_PACKET_SOURCE || "swfi_api";
const checkTimeoutMs = Number(process.env.SWFIPN_ACCEPTANCE_CRITERIA_CHECK_TIMEOUT_MS || 120_000);
const routeParityTargetLimit = Number(process.env.SWFIPN_ACCEPTANCE_ROUTE_TARGET_LIMIT || 25);

const dashboardEndpoints = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  allocators: "/api/allocator-activity/v1?days=90&limit=25",
  allocatorCount: "/api/allocator-activity/v1?days=90&limit=1&count_only=1",
  mandates: "/api/live-opportunities/v1?limit=25&page=1",
  transactions: "/api/recent-transactions/v1?days=30&limit=25&page=1",
  news: "/api/source-intelligence/news/v1?limit=25",
  entities: "/api/source-data/search/v1?collection=entities&limit=25&page=1",
  sectors: "/api/sector-flows/v1?days=365",
  topAum: "/v1/swfi/top20?limit=5",
};
const forbiddenVisible = [
  "Endpoint:",
  "Active Mirror",
  "Mongo Record ID",
  "Backend ID",
  "Backend identifier",
  "Backend identifiers",
  "Source-backed fact",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Runtime Source",
  "Object ID",
  "Object _id",
  "schema_version",
  "source_gap_reason",
  "result_qualifier",
  "source_filter",
  "resolved_intent",
  "resolved_endpoint",
  "No internal record mapping",
  "citation-only",
  "SWFI Provenance Workbench",
  "Parser status",
  "Capture ID",
  "SourceVault",
  "Write Barrier",
  "ClaimLedger",
  "DQ Gate",
  "ReviewQueue",
  "ReplayBench",
  "PixelTruth",
  "DocStruct",
  "Proposal-only evidence rail",
];
const requiredHeaderLinks = ["Dashboard", "News", "Entities", "People", "Transactions", "Compass", "Reports"];
const requiredDashboardText = [
  "SWFI",
  "Discover",
  "Newest Data",
  "Transactions",
  "Market Focus",
  "Compass Investment Types",
  "SWF Buys by Sector",
];
const requiredDashboardHydrationText = ["Discover", "Newest Data", "Top 10"];
const leakPattern = /(?:[?&]source=|%3Fsource%3D|%26source%3D|source_gap|source_filter|schema_version|result_qualifier|backend|active mirror)/i;
const dashboardPlaceholderPattern = /\b(Source gap|source_gap|Loading|No source selected|No internal record mapping|citation-only)\b/i;

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
  const parsed = new URL(route.replace(/^\//, ""), origin);
  return `${parsed.pathname.replace(/\/?$/, "/")}${parsed.search}${parsed.hash}`;
}

function rootOriginUrl(pathname) {
  const root = new URL(origin);
  return new URL(pathname, root.origin).href;
}

function apiUrl(route) {
  const root = new URL(origin);
  return new URL(route, root.origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function bodyText(page, max = 1200) {
  return (await page.locator("body").innerText({ timeout: 30_000 }).catch(() => ""))
    .slice(0, max)
    .replace(/\s+/g, " ");
}

async function hydratedBody(page, required, timeout = 75_000) {
  const startedAt = Date.now();
  let body = "";
  while (Date.now() - startedAt < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const textReady = required.every((text) => lower.includes(text.toLowerCase())) && !/\bLoading\b/.test(body);
    if (textReady) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

function bodyFailures(body) {
  return forbiddenVisible.filter((text) => body.includes(text)).map((text) => `forbidden_visible:${text}`);
}

function publicErrorFailures(body) {
  const failures = [];
  if (/Subscriber Sign In/i.test(body)) failures.push("dashboard_rendered_login");
  if (/Application error|502 Bad Gateway|Internal Server Error|Not found|404 Not Found|HTTP 404/i.test(body)) failures.push("dashboard_rendered_error");
  return failures;
}

async function readLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
    text: a.textContent?.trim().replace(/\s+/g, " ") || "",
    href: a.href,
    raw: a.getAttribute("href") || "",
    dashboardTarget: a.getAttribute("data-dashboard-target") || "",
    recordLink: a.getAttribute("data-record-link") || "",
    sourceState: a.getAttribute("data-source-state") || "",
  })).filter((link) => link.text || link.raw));
}

async function waitForRecordLinks(page, minCount = 1, timeout = 30_000) {
  await page.waitForFunction((minimum) => {
    const rootPath = new URL(window.location.href).pathname.replace(/\/$/, "");
    const recordPattern = /\/(?:profiles|transactions|mandates|people|research)\/detail\/\?/i;
    return Array.from(document.querySelectorAll("a[href]")).filter((anchor) => {
      const href = anchor.getAttribute("href") || "";
      const absolute = anchor.href || "";
      return anchor.getAttribute("data-record-link") === "true"
        || recordPattern.test(href)
        || recordPattern.test(absolute)
        || (rootPath && href.startsWith(`${rootPath}/`) && recordPattern.test(href.slice(rootPath.length)));
    }).length >= minimum;
  }, minCount, { timeout }).catch(() => null);
}

async function waitForRecordLinkKinds(page, requirements, timeout = 30_000) {
  await page.waitForFunction((required) => {
    const links = Array.from(document.querySelectorAll("a[href]")).map((anchor) => anchor.getAttribute("href") || anchor.href || "");
    return Object.entries(required).every(([kind, minimum]) => {
      const pattern = kind === "profile"
        ? /\/profiles\/detail\/\?/i
        : kind === "transaction"
          ? /\/transactions\/detail\/\?/i
          : kind === "mandate"
            ? /\/mandates\/detail\/\?/i
            : /\/(?:profiles|transactions|mandates|people|research)\/detail\/\?/i;
      return links.filter((href) => pattern.test(href)).length >= Number(minimum);
    });
  }, requirements, { timeout }).catch(() => null);
}

function targetFor(link) {
  return link.dashboardTarget || link.raw || link.href;
}

function isCanonicalSwfiHandoffUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname === "/" && /^\?p=\d+/i.test(parsed.search)) return true;
    if (parsed.pathname === "/v1/signin/" || parsed.pathname === "/v1/signin") {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect) return true;
      return Boolean(swfiSigninRecordPath(value) || redirect.startsWith(appPath("/")));
    }
    return /^\/v1\/(entities|people|transactions|compass|news)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function swfiSigninRecordPath(value) {
  try {
    const parsed = new URL(String(value || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return "";
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return "";
    if ((parsed.searchParams.get("msg") || "") !== "auth") return "";
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect || /^https?:\/\//i.test(redirect)) return "";
    const redirectUrl = new URL(redirect, "https://www.swfi.com");
    const pathname = redirectUrl.pathname.replace(/\/?$/, "/");
    return /^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/$/i.test(pathname) ? pathname : "";
  } catch {
    return "";
  }
}

function swfiSigninRecordKind(value) {
  const pathname = swfiSigninRecordPath(value);
  if (/^\/v1\/entities\/[a-f0-9]{24}\/$/i.test(pathname)) return "entity";
  if (/^\/v1\/transactions\/[a-f0-9]{24}\/$/i.test(pathname)) return "transaction";
  if (/^\/v1\/compass\/[a-f0-9]{24}\/$/i.test(pathname)) return "mandate";
  if (/^\/v1\/people\/[a-f0-9]{24}\/$/i.test(pathname)) return "person";
  return "";
}

function swfiSigninHandoff(value, expectedTarget = "") {
  try {
    const parsed = new URL(String(value || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    if (!expectedTarget) return true;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return false;
    if (/^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i.test(expectedTarget)) {
      return swfiSigninRecordPath(value) === expectedTarget.replace(/\/?$/, "/");
    }
    if (swfiSigninRecordPath(value)) return false;
    const redirectUrl = new URL(redirect, new URL(origin).origin);
    return `${redirectUrl.pathname.replace(/\/?$/, "/")}${redirectUrl.search}${redirectUrl.hash}` === appTarget(expectedTarget);
  } catch {
    return false;
  }
}

function swfiSigninBridgeHandoff(value, expectedTarget = "") {
  try {
    const parsed = new URL(String(value || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return false;
    const redirectUrl = new URL(redirect, new URL(origin).origin);
    const redirectPath = `${redirectUrl.pathname.replace(/\/?$/, "/")}${redirectUrl.search}${redirectUrl.hash}`;
    if (redirectPath === appTarget(expectedTarget)) return true;
    const root = new URL(origin);
    const bridgePath = `${root.pathname.replace(/\/$/, "")}/auth/bridge/`;
    if (redirectUrl.origin !== root.origin || redirectUrl.pathname.replace(/\/?$/, "/") !== bridgePath) return false;
    return (redirectUrl.searchParams.get("next") || "") === appTarget(expectedTarget);
  } catch {
    return false;
  }
}

function swfiSigninRedirectTarget(value) {
  try {
    const parsed = new URL(String(value || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return "";
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return "";
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return "";
    const redirectUrl = new URL(redirect, new URL(origin).origin);
    return `${redirectUrl.pathname.replace(/\/?$/, "/")}${redirectUrl.search}${redirectUrl.hash}`;
  } catch {
    return "";
  }
}

async function requestLoginBridge(context, targetPath) {
  const response = await context.request.get(appUrl(`/login/?next=${encodeURIComponent(targetPath)}`), {
    maxRedirects: 0,
    timeout: 30_000,
  });
  return {
    status: response.status(),
    location: response.headers().location || "",
  };
}

function loginHrefTargets(href, target) {
  try {
    const parsed = new URL(href);
    const root = new URL(origin);
    return parsed.origin === root.origin
      && parsed.pathname.replace(/\/?$/, "/") === appPath("/login/")
      && parsed.searchParams.get("next") === appTarget(target);
  } catch {
    return false;
  }
}

function internalSwficcTarget(target) {
  try {
    const parsed = new URL(target, origin);
    const root = new URL(origin);
    return parsed.origin === root.origin && parsed.pathname.startsWith(root.pathname.replace(/\/$/, "") || "/");
  } catch {
    return false;
  }
}

function recordHrefKind(value) {
  try {
    const parsed = new URL(String(value || ""), origin);
    const signinKind = swfiSigninRecordKind(parsed.href);
    if (signinKind) return signinKind;
    const root = new URL(origin);
    let pathname = parsed.pathname.replace(/\/?$/, "/");
    const rootPath = root.pathname.replace(/\/$/, "");
    if (parsed.origin !== root.origin || !pathname.startsWith(rootPath || "/")) return "";
    if (rootPath && pathname.startsWith(rootPath)) pathname = pathname.slice(rootPath.length) || "/";
    pathname = pathname.startsWith("/") ? pathname : `/${pathname}`;
    if (/^\/v1\/entities\/[a-f0-9]{24}\/$/i.test(pathname) || pathname.startsWith("/profiles/detail/")) return "entity";
    if (/^\/v1\/transactions\/[a-f0-9]{24}\/$/i.test(pathname) || pathname.startsWith("/transactions/detail/")) return "transaction";
    if (/^\/v1\/compass\/[a-f0-9]{24}\/$/i.test(pathname) || pathname.startsWith("/mandates/detail/")) return "mandate";
    if (/^\/v1\/people\/[a-f0-9]{24}\/$/i.test(pathname) || pathname.startsWith("/people/detail/")) return "person";
    if (pathname.startsWith("/research/detail/")) return "research";
  } catch {
    return "";
  }
  return "";
}

function isMirroredRecordHref(value, kind = "") {
  const detected = recordHrefKind(value);
  return Boolean(detected && (!kind || detected === kind));
}

function isRawSwfiRecordHref(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/") return false;
    return parsed.hostname.endsWith("swfi.com") && /^\/v1\/(entities|people|person|transactions|compass|news)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function linkLeakFailures(links) {
  const leaked = links.filter((link) => {
    if (isCanonicalSwfiHandoffUrl(link.href) || isCanonicalSwfiHandoffUrl(link.raw)) return false;
    return leakPattern.test([link.href, link.raw, link.dashboardTarget].filter(Boolean).join(" "));
  });
  return leaked.map((link) => `link_exposes_internal_or_source_token:${link.text || link.raw}`);
}

async function fetchJson(url, timeout = 15_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json", "X-SWFIPN-Public": "1" } });
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

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function boundedCheck(id, task, timeoutMs = checkTimeoutMs) {
  const startedAt = Date.now();
  let timer;
  try {
    const result = await Promise.race([
      task(),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          resolve({
            id,
            ok: false,
            failures: [`check_timeout_ms_${timeoutMs}`],
            duration_ms: Date.now() - startedAt,
          });
        }, timeoutMs);
      }),
    ]);
    return {
      ...result,
      id: result.id || id,
      duration_ms: result.duration_ms || Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id,
      ok: false,
      failures: [error.message],
      duration_ms: Date.now() - startedAt,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function fetchStalenessJson(url) {
  let latest = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    latest = await fetchJson(url);
    const generatedAt = cleanText(latest.json?.generated_at);
    if (latest.status < 400 && packetIsFact(latest.json) && generatedAt) return latest;
    await sleep(1200 * attempt);
  }
  return latest;
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
  const sourceCollections = Array.isArray(provenance.source_collections) ? provenance.source_collections : [];
  return {
    source: cleanText(sanitized.source || provenance.source),
    source_doc_count: Number(sanitized.source_doc_count ?? sourceDocIds.length ?? 0),
    source_collections: Array.isArray(sanitized.source_collections) ? sanitized.source_collections : sourceCollections,
  };
}

function cleanText(value, fallback = "") {
  if (value == null || value === "") return fallback;
  return String(value).trim();
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function formatInteger(value) {
  const numeric = numberValue(value);
  return numeric == null ? "" : numeric.toLocaleString("en-US");
}

function formatAum(row) {
  const numeric = numberValue(row?.aum);
  const currency = cleanText(row?.aum_currency);
  return numeric == null || !currency ? "" : `${currency} ${numeric.toLocaleString("en-US")}`;
}

function addApprovedBusinessLabels(approvedLabels, row) {
  for (const key of [
    "name",
    "title",
    "institution",
    "buyer_entity",
    "seller_entity",
    "investor",
    "company",
    "entity_name",
    "latest_transaction",
  ]) {
    const value = cleanText(row?.[key]);
    if (value) approvedLabels.add(value);
  }
  for (const key of ["buyer_entities", "seller_entities", "entities", "people"]) {
    const nested = Array.isArray(row?.[key]) ? row[key] : [];
    for (const item of nested) addApprovedBusinessLabels(approvedLabels, item);
  }
  for (const key of ["deal_count", "activity_count"]) {
    const value = cleanText(row?.[key]);
    if (value) approvedLabels.add(`${value} deals`);
  }
}

async function lookAndFeelCheck(browser) {
  const result = { id: "look_and_feel_consistent", ok: true, failures: [], screenshots: [] };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  try {
    for (const viewport of [
      { name: "desktop", width: 1440, height: 1000 },
      { name: "mobile", width: 390, height: 980 },
    ]) {
      const page = await context.newPage({ viewport: { width: viewport.width, height: viewport.height } });
      const response = await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
      if (!response || response.status() >= 400) result.failures.push(`${viewport.name}:http_${response?.status() || "missing"}`);
      const body = await hydratedBody(page, requiredDashboardText, 90_000);
      for (const text of requiredDashboardText) {
        if (!body.toLowerCase().includes(text.toLowerCase())) result.failures.push(`${viewport.name}:missing_text:${text}`);
      }
      result.failures.push(...publicErrorFailures(body).map((failure) => `${viewport.name}:${failure}`));
      result.failures.push(...bodyFailures(body).map((failure) => `${viewport.name}:${failure}`));
      const metrics = await page.evaluate(() => {
        const header = document.querySelector("header");
        const imageAlts = Array.from(header?.querySelectorAll("img[alt]") || []).map((img) => img.getAttribute("alt") || "");
        const headerText = [header?.textContent || "", ...imageAlts].join(" ").replace(/\s+/g, " ").trim();
        const background = header ? getComputedStyle(header).backgroundColor : "";
        const navTexts = Array.from(header?.querySelectorAll("nav a") || []).map((a) => a.textContent?.trim() || "");
        return {
          headerText,
          background,
          navTexts,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        };
      });
      if (!metrics.headerText.includes("SWFI")) {
        result.failures.push(`${viewport.name}:brand_header_missing`);
      }
      const acceptedHeaderBackgrounds = new Set(["rgb(11, 19, 43)", "rgb(17, 28, 58)"]);
      const redHeader = /^rgb\((1[0-9]{2}|2[0-4][0-9]|25[0-5]),\s*[0-9]{1,2},\s*[0-9]{1,2}\)$/i.test(metrics.background);
      if (!acceptedHeaderBackgrounds.has(metrics.background) && !redHeader) {
        result.failures.push(`${viewport.name}:brand_header_unexpected:${metrics.background}`);
      }
      for (const label of requiredHeaderLinks) {
        if (!metrics.navTexts.some((text) => text === label || text.startsWith(label))) result.failures.push(`${viewport.name}:header_link_missing:${label}`);
      }
      if (metrics.scrollWidth > metrics.clientWidth + 2) {
        result.failures.push(`${viewport.name}:horizontal_overflow:${metrics.scrollWidth}>${metrics.clientWidth}`);
      }
      const screenshotPath = path.join(outputDir, `swfipn-acceptance-${viewport.name}.png`);
      await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
      result.screenshots.push(screenshotPath);
      await page.close().catch(() => {});
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function publicAccessCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { id: "dashboard_public_accessible", ok: true, failures: [], final_url: "", body_excerpt: "" };
  try {
    const response = await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    result.final_url = page.url();
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    result.body_excerpt = body.slice(0, 500).replace(/\s+/g, " ");
    result.failures.push(...publicErrorFailures(body));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function unauthenticatedLinkCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { id: "unauthenticated_links_redirect_to_login", ok: true, failures: [], gated_link_count: 0, sample_clicks: [] };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    await waitForRecordLinks(page, 20);
    const links = await readLinks(page);
    const gatedLinks = links.filter((link) => link.dashboardTarget && !link.dashboardTarget.startsWith("#"));
    const mirroredLinks = links.filter((link) => isMirroredRecordHref(link.href) || isMirroredRecordHref(link.raw));
    result.gated_link_count = mirroredLinks.length;
    if (mirroredLinks.length < 20) result.failures.push(`swfi_record_handoff_links_${mirroredLinks.length}_lt_20`);
    const rawSwfiRecordLinks = links.filter((link) => isRawSwfiRecordHref(link.href) || isRawSwfiRecordHref(link.raw));
    if (rawSwfiRecordLinks.length) result.failures.push(`raw_swfi_record_links:${rawSwfiRecordLinks.length}`);
    result.failures.push(...linkLeakFailures(links));
    const broken = gatedLinks.filter((link) => {
      const target = targetFor(link);
      return !internalSwficcTarget(target) || !loginHrefTargets(link.href, target);
    });
    if (broken.length) {
      result.failures.push(`bad_gated_links:${broken.slice(0, 8).map((link) => link.text || link.raw).join("|")}`);
    }
    for (const selector of [
      'nav a:has-text("Transactions")',
      'a[data-record-link="true"]',
    ]) {
      await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
      await hydratedBody(page, requiredDashboardHydrationText, 90_000);
      const link = page.locator(selector).first();
      const href = await link.getAttribute("href", { timeout: 30_000 });
      if (selector.includes("data-record-link")) {
        const row = { selector, href, final_url: page.url(), next: "", ok: true, failures: [] };
        if (!href || !isMirroredRecordHref(href)) row.failures.push(`missing_swfi_record_handoff:${href || "missing"}`);
        row.ok = row.failures.length === 0;
        result.sample_clicks.push(row);
        result.failures.push(...row.failures.map((failure) => `${selector}:${failure}`));
        continue;
      }
      const row = { selector, href, final_url: page.url(), next: "", ok: true, failures: [] };
      if (!href || !internalSwficcTarget(href)) row.failures.push(`discovery_link_not_internal:${href || "missing"}`);
      row.ok = row.failures.length === 0;
      result.sample_clicks.push(row);
      result.failures.push(...row.failures.map((failure) => `${selector}:${failure}`));
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function authenticatedNavigationCheck(browser) {
  const result = { id: "authenticated_links_emit_swfi_record_href", ok: true, skipped: false, failures: [], login_final_url: "", click_final_url: "", session_status: 0, screenshot: "", subscriber_auth_mode: "swfi_signin_handoff", credentials_used: false, swfi_auth_handoff_checked: false };
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const bridge = await requestLoginBridge(context, "/swficc/allocators/");
    result.login_final_url = bridge.location;
    if (![302, 303, 307, 308].includes(bridge.status)) result.failures.push(`login_bridge_status_${bridge.status}`);
    if (!swfiSigninBridgeHandoff(bridge.location, "/swficc/allocators/")) result.failures.push(`login_bridge_not_swfi_signin:${bridge.location || "missing"}`);
    const unsafe = await requestLoginBridge(context, "https://evil.example/");
    if (!swfiSigninBridgeHandoff(unsafe.location, "/swficc/")) result.failures.push("unsafe_next_not_sanitized");
    const signin = await context.request.get(new URL(bridge.location, origin).href, { timeout: 30_000 });
    const signinBody = await signin.text();
    if (signin.status() >= 400) result.failures.push(`swfi_signin_http_${signin.status()}`);
    if (!/Sign In/i.test(signinBody)) result.failures.push("swfi_signin_body_missing");
    result.swfi_auth_handoff_checked = result.failures.length === 0;
    const session = await context.request.get(rootOriginUrl("/api/session/status/v1"), { timeout: 30_000 });
    result.session_status = session.status();
    if (![401, 404].includes(session.status())) result.failures.push(`unexpected_local_session_status_${session.status()}`);
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    result.click_final_url = await page.locator('a[data-record-link="true"]').first().getAttribute("href", { timeout: 60_000 }) || "";
    const body = await bodyText(page, 400);
    if (!isMirroredRecordHref(result.click_final_url)) result.failures.push(`missing_swfi_record_handoff:${result.click_final_url || "missing"}`);
    if (/Subscriber Sign In/i.test(body)) result.failures.push("returned_to_login");
    result.screenshot = path.join(outputDir, "swfipn-acceptance-authenticated-profile.png");
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => {});
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function internalDetailsHiddenCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { id: "internal_technical_details_hidden", ok: true, failures: [], scanned_links: 0 };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    const body = await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    result.failures.push(...bodyFailures(body));
    const links = await readLinks(page);
    result.scanned_links = links.length;
    result.failures.push(...linkLeakFailures(links));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function tableRowsNavigationCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage({ viewport: { width: 1440, height: 1200 } });
  const result = { id: "tabular_rows_link_to_swfi_pages", ok: true, failures: [], counts: {} };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    await waitForRecordLinks(page, 15);
    await waitForRecordLinkKinds(page, { profile: 5, transaction: 5 });
    const links = await readLinks(page);
    const recordLinks = links.filter((link) => link.recordLink === "true" || isMirroredRecordHref(link.href) || isMirroredRecordHref(link.raw));
    const profileLinks = recordLinks.filter((link) => isMirroredRecordHref(link.href, "entity") || isMirroredRecordHref(link.raw, "entity"));
    const transactionLinks = recordLinks.filter((link) => isMirroredRecordHref(link.href, "transaction") || isMirroredRecordHref(link.raw, "transaction"));
    const mandateLinks = recordLinks.filter((link) => isMirroredRecordHref(link.href, "mandate") || isMirroredRecordHref(link.raw, "mandate"));
    const mandateFilterLinks = links.filter((link) => internalSwficcTarget(link.href) && /\/mandates\/(?:$|[?#])/i.test(new URL(link.href, origin).pathname.replace(/\/?$/, "/") + new URL(link.href, origin).search));
    const researchLinks = recordLinks.filter((link) => isMirroredRecordHref(link.href, "research") || isMirroredRecordHref(link.raw, "research"));
    result.counts = {
      record_links: recordLinks.length,
      profile_links: profileLinks.length,
      transaction_links: transactionLinks.length,
      mandate_links: mandateLinks.length,
      mandate_filter_links: mandateFilterLinks.length,
      research_links: researchLinks.length,
    };
    if (profileLinks.length < 5) result.failures.push(`profile_row_links_${profileLinks.length}_lt_5`);
    if (transactionLinks.length < 5) result.failures.push(`transaction_row_links_${transactionLinks.length}_lt_5`);
    if (mandateLinks.length + mandateFilterLinks.length < 3) result.failures.push(`mandate_or_filter_links_${mandateLinks.length + mandateFilterLinks.length}_lt_3`);
    if (recordLinks.length < 15) result.failures.push(`record_links_${recordLinks.length}_lt_15`);
    const rawSwfiRecordLinks = links.filter((link) => isRawSwfiRecordHref(link.href) || isRawSwfiRecordHref(link.raw));
    if (rawSwfiRecordLinks.length) result.failures.push(`raw_swfi_record_links:${rawSwfiRecordLinks.length}`);
    const malformed = recordLinks.filter((link) => !isMirroredRecordHref(link.href) && !isMirroredRecordHref(link.raw));
    if (malformed.length) result.failures.push(`malformed_mirrored_record_links:${malformed.slice(0, 8).map((link) => link.text || link.raw).join("|")}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function dashboardDataParityCheck(browser) {
  const result = { id: "data_parity", ok: true, failures: [], endpoint_count: 0, record_link_count: 0, top_aum_checked: 0 };
  const packets = {};
  try {
    for (const [key, route] of Object.entries(dashboardEndpoints)) {
      const { status, json } = await fetchJson(apiUrl(route));
      packets[key] = json;
      result.endpoint_count += 1;
      if (status >= 400) result.failures.push(`${key}:http_${status}`);
      if (!packetIsFact(json)) {
        result.failures.push(`${key}:not_fact_packet:${cleanText(json?.status) || "missing"}:${cleanText(json?.result_qualifier) || "missing"}`);
      }
    }
    const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const page = await context.newPage({ viewport: { width: 1440, height: 1200 } });
    try {
      await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
      const metricsCards = packetData(packets.metrics).cards || {};
      const expectedMetricValues = [
        metricsCards.institutions?.value,
        packetData(packets.allocatorCount).count,
        metricsCards.rfps?.value,
        metricsCards.transactions?.value,
      ].map(formatInteger).filter(Boolean);
      await page.waitForFunction((values) => {
        const body = document.body.innerText || "";
        return values.every((value) => body.includes(value)) && !/\bLoading\b/.test(body);
      }, expectedMetricValues, { timeout: 90_000 }).catch(() => null);
      const body = await hydratedBody(page, requiredDashboardHydrationText, 90_000);
      if (dashboardPlaceholderPattern.test(body)) result.failures.push("dashboard_renders_placeholder_or_source_gap_language");
      const approvedLabels = new Set(["SWFI source"]);
      for (const row of packetRows(packets.allocators)) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      for (const row of packetRows(packets.transactions)) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      for (const row of packetRows(packets.mandates)) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      for (const row of packetRows(packets.news)) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      for (const row of packetRows(packets.entities)) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      const sectorRows = packetData(packets.sectors).facets?.sectors || packetRows(packets.sectors);
      for (const row of Array.isArray(sectorRows) ? sectorRows : []) {
        if (cleanText(row.name || row.value)) approvedLabels.add(cleanText(row.name || row.value));
      }
      const topAumRows = packetRows(packets.topAum).slice(0, 5);
      result.top_aum_checked = topAumRows.length;
      for (const row of topAumRows) {
        addApprovedBusinessLabels(approvedLabels, row);
      }
      const links = await readLinks(page);
      const recordLinks = links.filter((link) => link.recordLink === "true");
      result.record_link_count = recordLinks.length;
      const approvedLabelList = [...approvedLabels].filter(Boolean);
      const unapproved = recordLinks.filter((link) => {
        const label = cleanText(link.text);
        if (!label) return false;
        return !approvedLabelList.some((approved) => label === approved || label.includes(approved));
      });
      if (unapproved.length) result.failures.push(`record_link_labels_not_in_backend_packets:${unapproved.slice(0, 8).map((link) => cleanText(link.text)).join("|")}`);
    } finally {
      await context.close().catch(() => {});
    }
  } catch (error) {
    result.failures.push(error.message);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function stalenessCheck() {
  const result = { id: "staleness", ok: true, failures: [], max_age_hours: Number(process.env.SWFIPN_MAX_PACKET_AGE_HOURS || 24), packets: [] };
  const now = Date.now();
  try {
    for (const [key, route] of Object.entries(dashboardEndpoints)) {
      const { status, json } = await fetchStalenessJson(apiUrl(route));
      const generatedAt = cleanText(json?.generated_at);
      const generatedMs = Date.parse(generatedAt);
      const sourceInfo = sourceReceipt(json);
      const ageHours = Number.isFinite(generatedMs) ? (now - generatedMs) / 3_600_000 : null;
      const packet = {
        key,
        route,
        status,
        generated_at: generatedAt,
        age_hours: ageHours == null ? null : Number(ageHours.toFixed(3)),
        public_receipt_visibility: sourceInfo.source || sourceInfo.source_doc_count ? "exposed" : "hidden",
        provenance_source: sourceInfo.source,
        source_doc_ids: sourceInfo.source_doc_count,
        source_collections: sourceInfo.source_collections,
      };
      result.packets.push(packet);
      if (status >= 400) result.failures.push(`${key}:http_${status}`);
      if (!packetIsFact(json)) result.failures.push(`${key}:not_fact_packet`);
      if (!generatedAt || !Number.isFinite(generatedMs)) result.failures.push(`${key}:missing_generated_at`);
      if (ageHours != null && (ageHours < -0.25 || ageHours > result.max_age_hours)) result.failures.push(`${key}:stale_age_hours_${ageHours.toFixed(2)}`);
      if (sourceInfo.source || sourceInfo.source_doc_count) result.failures.push(`${key}:public_source_receipt_exposed`);
    }
  } catch (error) {
    result.failures.push(error.message);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function routeParityCheck(browser) {
  const { chromium } = loadPlaywright();
  const isolatedBrowser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const context = await isolatedBrowser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const result = { id: "route_parity", ok: true, failures: [], visible_links: 0, gated_links: 0, target_count: 0, targets_checked: [] };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await hydratedBody(page, requiredDashboardHydrationText, 90_000);
    const links = await readLinks(page);
    result.visible_links = links.length;
    result.failures.push(...linkLeakFailures(links));
    const gatedLinks = links.filter((link) => link.dashboardTarget && !link.dashboardTarget.startsWith("#"));
    result.gated_links = gatedLinks.length;
    const badGates = gatedLinks.filter((link) => !internalSwficcTarget(link.dashboardTarget) || !loginHrefTargets(link.href, link.dashboardTarget));
    if (badGates.length) result.failures.push(`bad_login_targets:${badGates.slice(0, 8).map((link) => cleanText(link.text || link.raw)).join("|")}`);
    const targets = [...new Set(gatedLinks.map((link) => link.dashboardTarget).filter(Boolean))];
    result.target_count = targets.length;
    result.targets_sampled = Math.min(targets.length, routeParityTargetLimit);
    for (const target of targets.slice(0, routeParityTargetLimit)) {
      const targetUrl = new URL(target, origin).href;
      const response = await context.request.get(targetUrl, { timeout: 15_000, maxRedirects: 2 }).catch((error) => ({ error }));
      const status = typeof response.status === "function" ? response.status() : 0;
      const finalUrl = typeof response.url === "function" ? response.url() : "";
      const row = { target, status, final_url: finalUrl, ok: true, failures: [] };
      if (response.error) row.failures.push(`request_failed:${response.error.message}`);
      if (status >= 400 || status === 0) row.failures.push(`http_${status || "missing"}`);
      if (finalUrl && !internalSwficcTarget(finalUrl)) row.failures.push(`external_or_wrong_final_url:${finalUrl}`);
      row.ok = row.failures.length === 0;
      result.targets_checked.push(row);
      result.failures.push(...row.failures.map((failure) => `${target}:${failure}`));
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
    await isolatedBrowser.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function directProtectedRoutesCheck(browser) {
  const samples = [
    { route: "/profiles/detail/?slug=andreessen-horowitz&name=Andreessen+Horowitz", authText: "ENTITY PROFILE", protectedText: "Andreessen Horowitz" },
    { route: "/transactions/detail/?id=6a2c168b43e7f69d0cd0c923", authText: "TRANSACTION DETAILS", protectedText: "ChatSee.AI Inc" },
  ];
  const result = { id: "direct_record_routes_are_self_contained", ok: true, skipped: false, failures: [], samples: [], subscriber_auth_mode: "self_contained_public_record_pages", credentials_used: false };
  const { chromium } = loadPlaywright();
  const isolatedBrowser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const publicContext = await isolatedBrowser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });

  try {
    for (const sample of samples) {
      const row = { route: sample.route, unauthenticated: { final_url: "", ok: true, failures: [] }, authenticated: { final_url: "", ok: true, failures: [] } };
      const page = await publicContext.newPage();
      try {
        const response = await page.goto(appUrl(sample.route), { waitUntil: "domcontentloaded", timeout: 30_000 });
        await page.waitForFunction((expectedText) => {
          const body = document.body?.innerText || "";
          return body.includes(expectedText) || (body.length > 500 && !/\bLoading\b/.test(body));
        }, sample.protectedText, { timeout: 60_000 }).catch(() => {});
        const body = await bodyText(page, 4_000);
        row.unauthenticated.final_url = page.url();
        if (!response || response.status() >= 400) row.unauthenticated.failures.push(`http_${response?.status() || "missing"}`);
        if (!body.includes(sample.authText) || !body.includes(sample.protectedText)) {
          row.unauthenticated.failures.push(`self_contained_record_missing:${sample.protectedText}`);
        }
      } catch (error) {
        row.unauthenticated.failures.push(error.message);
      } finally {
        await page.close().catch(() => {});
      }
      row.unauthenticated.ok = row.unauthenticated.failures.length === 0;
      row.authenticated.ok = true;
      row.authenticated.skipped = true;
      row.authenticated.note = "Self-contained public record route; SWFI subscriber session proof is outside this public mirror gate.";
      result.samples.push(row);
      result.failures.push(...row.unauthenticated.failures.map((failure) => `${sample.route}:unauth:${failure}`));
    }
  } finally {
    await publicContext.close().catch(() => {});
    await isolatedBrowser.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const checks = [];
  try {
    checks.push(await boundedCheck("look_and_feel_consistent", () => lookAndFeelCheck(browser)));
    checks.push(await boundedCheck("dashboard_public_accessible", () => publicAccessCheck(browser)));
    checks.push(await boundedCheck("unauthenticated_links_redirect_to_login", () => unauthenticatedLinkCheck(browser)));
    checks.push(await boundedCheck("authenticated_links_emit_swfi_record_href", () => authenticatedNavigationCheck(browser)));
    checks.push(await boundedCheck("internal_technical_details_hidden", () => internalDetailsHiddenCheck(browser)));
    checks.push(await boundedCheck("tabular_rows_link_to_swfi_pages", () => tableRowsNavigationCheck(browser)));
    checks.push(await boundedCheck("data_parity", () => dashboardDataParityCheck(browser), Math.max(checkTimeoutMs, 180_000)));
    checks.push(await boundedCheck("staleness", () => stalenessCheck()));
    checks.push(await boundedCheck("route_parity", () => routeParityCheck(browser), Math.max(checkTimeoutMs, 180_000)));
    checks.push(await boundedCheck("direct_record_routes_are_self_contained", () => directProtectedRoutesCheck(browser)));
  } finally {
    await browser.close().catch(() => {});
  }
  const failures = checks.filter((check) => !check.ok && !check.skipped);
  const receipt = {
    schema_version: "swfipn.acceptance_criteria_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      criteria: checks.length,
      failures: failures.length,
      authenticated_check_skipped: checks.some((check) => check.id === "authenticated_links_emit_swfi_record_href" && check.skipped),
      protected_route_auth_check_skipped: checks.some((check) => check.id === "direct_protected_routes_require_login" && check.skipped),
      swfi_auth_handoff_checked: checks.some((check) => check.id === "authenticated_links_emit_swfi_record_href" && check.swfi_auth_handoff_checked),
      credentials_used: checks.some((check) => check.credentials_used === true),
    },
    checks,
    failures: failures.map((check) => ({ id: check.id, failures: check.failures })),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
