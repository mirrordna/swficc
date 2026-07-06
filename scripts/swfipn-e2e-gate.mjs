#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-e2e-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const gateLevel = process.env.SWFIPN_E2E_LEVEL || process.env.SWFIPN_TRUTH_AUDIT_LEVEL || "full";
const validateLocalAuth = /^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_E2E_VALIDATE_LOCAL_AUTH || ""));
const username = loadSecret("SWFIPN_AUTH_TEST_USERNAME", "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"]).trim();
const password = loadSecret("SWFIPN_AUTH_TEST_PASSWORD", "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"], false);
const LINK_CHECK_TIMEOUT_MS = Number(process.env.SWFIPN_LINK_CHECK_TIMEOUT_MS || 35_000);
const PROFILE_LINK_CHECK_TIMEOUT_MS = Number(process.env.SWFIPN_PROFILE_LINK_CHECK_TIMEOUT_MS || (gateLevel === "smoke" ? 35_000 : 95_000));
const ROUTE_CHECK_TIMEOUT_MS = Number(process.env.SWFIPN_ROUTE_CHECK_TIMEOUT_MS || (gateLevel === "smoke" ? 90_000 : 220_000));
const SIMPLE_CHECK_TIMEOUT_MS = Number(process.env.SWFIPN_SIMPLE_CHECK_TIMEOUT_MS || (gateLevel === "smoke" ? 90_000 : 180_000));
const CONTROL_CHECK_TIMEOUT_MS = Number(process.env.SWFIPN_CONTROL_CHECK_TIMEOUT_MS || (gateLevel === "smoke" ? 30_000 : 180_000));
const SMOKE_ROUTE_SET = new Set(["/", "/profiles/", "/people/", "/transactions/", "/mandates/", "/research/", "/search/"]);
const SMOKE_DETAIL_IDS = new Set(["profile_andreessen", "transaction_chatsee", "mandate_adia", "research_legacy_isif", "source_transaction"]);
const SMOKE_SEARCH_IDS = new Set(["real_estate"]);
const SMOKE_CONTROL_ROUTES = new Set(["/profiles/", "/transactions/", "/mandates/", "/search/?q=Real%20Estate"]);
const CLIENT_FORBIDDEN_VISIBLE = [
  "Endpoint:",
  "Source-backed fact",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Mongo Record ID",
  "Runtime Source",
  "SWFIPN source detail",
  "Source packet:",
  "SWFI LOGO",
  "Sidebar",
  "SWFI Provenance Workbench",
  "Parser status",
  "Capture ID",
  "SourceVault",
  "Write Barrier",
  "ClaimLedger",
  "ReviewQueue",
  "ReplayBench",
  "Proposal-only evidence rail",
];

const CORE_ROUTES = [
  {
    route: "/",
    ready: "TOTAL AUM ENGAGED",
    allowSourceGap: false,
    waitMs: 150_000,
    requiredAnchors: [
      { text: "Top Investors", raw: "/swficc/allocators/" },
      { text: "Fundraising", raw: "/swficc/mandates/" },
      { text: "Market Activity", raw: "/swficc/transactions/" },
      { text: "News", raw: "/swficc/intelligence/" },
    ],
  },
  { route: "/profiles/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 90_000 },
  { route: "/people/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 90_000 },
  { route: "/deals/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 90_000 },
  { route: "/comparisons/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 180_000 },
  { route: "/transactions/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 90_000, deadlineMs: 180_000 },
  { route: "/mandates/", ready: "Showing 25 of", allowSourceGap: false, waitMs: 90_000 },
  { route: "/reports/", ready: "Reports Intelligence", allowSourceGap: false },
  { route: "/intelligence/", ready: "Showing 5 of", allowSourceGap: false, waitMs: 180_000 },
  { route: "/research/", ready: "Showing", allowSourceGap: false, waitMs: 180_000 },
  { route: "/search/", ready: "Awaiting search", allowSourceGap: false, waitMs: 90_000 },
  { route: "/provenance/", ready: "Record Links", allowSourceGap: false, waitMs: 90_000 },
];

const SEARCH_CASES = [
  { id: "real_estate", url: "/search/?q=Real%20Estate", required: ["Real Estate", "Showing"] },
  { id: "prem", url: "/search/?q=Prem", required: ["Prem", "Showing"] },
];

function selectedCoreRoutes() {
  return gateLevel === "smoke" ? CORE_ROUTES.filter((item) => SMOKE_ROUTE_SET.has(item.route)) : CORE_ROUTES;
}

function selectedDetailCases() {
  return gateLevel === "smoke" ? DETAIL_CASES.filter((item) => SMOKE_DETAIL_IDS.has(item.id)) : DETAIL_CASES;
}

function selectedSearchCases() {
  return gateLevel === "smoke" ? SEARCH_CASES.filter((item) => SMOKE_SEARCH_IDS.has(item.id)) : SEARCH_CASES;
}

function selectedControlRoutes() {
  const routes = ["/profiles/", "/deals/", "/comparisons/", "/transactions/", "/mandates/", "/search/?q=Real%20Estate"];
  return gateLevel === "smoke" ? routes.filter((route) => SMOKE_CONTROL_ROUTES.has(route)) : routes;
}

const DETAIL_CASES = [
  {
    id: "profile_andreessen",
    url: "/profiles/detail/?slug=andreessen-horowitz&id=5bb7bec0ca00a5212c486ec2&name=Andreessen+Horowitz",
    required: ["ENTITY PROFILE", "Andreessen Horowitz", "Verified in SWFI records"],
    allowSourceGap: true,
  },
  {
    id: "transaction_chatsee",
    url: "/transactions/detail/?id=6a2c168b43e7f69d0cd0c923&title=ChatSee.AI+Inc",
    required: ["TRANSACTION DETAILS", "Transaction Details", "Buyer Entities", "Industry / Category", "SWFI Page", "ChatSee.AI Inc", "True Ventures", "Verified in SWFI records"],
    forbidden: ["Additional Mapped Fields"],
    allowSourceGap: false,
  },
  {
    id: "transaction_kinetitec",
    url: "/transactions/detail/?id=6a2bfcbd2c60bdfbf8489788&title=KinetiTec",
    required: ["TRANSACTION DETAILS", "Transaction Details", "Buyer Entities", "Investment Type", "SWFI Page", "KinetiTec", "Boomerang Ventures", "Verified in SWFI records"],
    forbidden: ["Additional Mapped Fields"],
    allowSourceGap: false,
  },
  {
    id: "mandate_adia",
    url: "/mandates/detail/?id=68b6f675576df8efb3fdb766&title=ADIA+Hones+in+on+US+Private+Equity+and+Pacing+for+2025",
    required: ["COMPASS / RFP DETAIL", "RFP / Mandate Details", "Institution", "Summary", "SWFI Page", "ADIA Hones in on US Private Equity", "Verified in SWFI records"],
    allowSourceGap: false,
  },
  {
    id: "person_srinivasan",
    url: "/people/detail/?id=6a3117c8596879824a782b67&name=Srinivasan+Kesavan",
    required: ["PERSON DETAIL", "Person Details", "SWFI Page", "Srinivasan Kesavan", "Verified in SWFI records"],
    allowSourceGap: false,
  },
  {
    id: "source_transaction",
    url: "/source/",
    required: ["RECORD LINK", "Search records"],
    allowSourceGap: false,
  },
  {
    id: "research_legacy_isif",
    url: "/research/detail/?legacy=109264",
    required: [
      "RESEARCH / NEWS DETAIL",
      "Ireland Strategic Investment Fund Reveals 4 Local Housing Investment Commitments",
      "Article Details",
      "Article / Report Body",
      "Download Source Data",
      "Verified in SWFI records",
      "SWFI Page",
    ],
    allowSourceGap: false,
  },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function envList(name, fallback) {
  const raw = String(process.env[name] || "");
  if (!raw) return fallback;
  const parsed = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return parsed.length ? parsed : fallback;
}

function keychainLookup(services) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_AUTH_USE_KEYCHAIN || "1"))) return "";
  for (const account of envList("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"])) {
    for (const service of services) {
      try {
        const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        if (value) return value;
      } catch {
        // Try the next configured account/service pair.
      }
    }
  }
  return "";
}

function loadSecret(envName, serviceEnvName, defaultServices, strip = true) {
  const direct = process.env[envName] || "";
  if (direct) return strip ? direct.trim() : direct;
  const value = keychainLookup(envList(serviceEnvName, defaultServices));
  return strip ? value.trim() : value.replace(/\n$/, "");
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function urlFor(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function apiUrl(route) {
  const root = new URL(origin);
  return new URL(route.replace(/^\//, ""), `${root.origin}/`).href;
}

function appTargetPath(route) {
  const parsed = route.startsWith("/swficc/")
    ? new URL(route, new URL(origin).origin)
    : new URL(route.replace(/^\//, ""), origin);
  const path = parsed.pathname === new URL(origin).pathname.replace(/\/$/, "") ? `${parsed.pathname}/` : parsed.pathname.replace(/\/?$/, "/");
  return `${path}${parsed.search}${parsed.hash}`;
}

function routeNeedsAuth(route) {
  return validateLocalAuth && route !== "/";
}

function sameAppUrl(href) {
  try {
    const parsed = new URL(href);
    const root = new URL(origin);
    const basePath = root.pathname.replace(/\/$/, "");
    return parsed.origin === root.origin && parsed.pathname.startsWith(basePath);
  } catch {
    return false;
  }
}

function isAllowedSwfiRecordUrl(href) {
  try {
    const parsed = new URL(href);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (isAllowedSwfiCorePlatformPath(parsed)) return true;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    if ((parsed.searchParams.get("msg") || "") !== "auth") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return false;
    return isAllowedSwfiCorePlatformPath(new URL(redirect, "https://www.swfi.com"));
  } catch {
    return false;
  }
}

function isAllowedSwfiCorePlatformPath(parsed) {
  if (parsed.pathname === "/" && parsed.searchParams.has("p")) return true;
  return /^\/v1\/(?:entities|people|transactions|compass|news|reports)\//.test(parsed.pathname);
}

function swfiSigninHandoffUrl(value, expectedTarget) {
  try {
    const parsed = new URL(String(value || ""), new URL(origin).origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    if ((parsed.searchParams.get("msg") || "") !== "auth") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return false;
    const redirectUrl = new URL(redirect, new URL(origin).origin);
    const expectedUrl = new URL(expectedTarget, new URL(origin).origin);
    return redirectUrl.origin === expectedUrl.origin
      && redirectUrl.pathname.replace(/\/?$/, "/") === expectedUrl.pathname.replace(/\/?$/, "/")
      && redirectUrl.search === expectedUrl.search;
  } catch {
    return false;
  }
}

function protectedSwficcDetailTarget(value) {
  try {
    const parsed = new URL(value, origin);
    return [
      "/profiles/detail/",
      "/transactions/detail/",
      "/mandates/detail/",
      "/people/detail/",
    ].some((route) => parsed.pathname.includes(route));
  } catch {
    return false;
  }
}

async function handoffRequestOk(targetHref, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(targetHref, { redirect: "manual", signal: controller.signal });
    const location = response.headers.get("location") || "";
    return {
      ok: response.status >= 300 && response.status < 400 && swfiSigninHandoffUrl(location, targetHref),
      status: response.status,
      location,
    };
  } finally {
    clearTimeout(timer);
  }
}

function appRoute(href) {
  if (!sameAppUrl(href)) return "";
  const parsed = new URL(href);
  const root = new URL(origin);
  const basePath = root.pathname.replace(/\/$/, "");
  let route = parsed.pathname.slice(basePath.length) || "/";
  if (!route.startsWith("/")) route = `/${route}`;
  if (route !== "/" && !route.endsWith("/")) route = `${route}/`;
  return route;
}

function appTarget(link) {
  if (!link.dashboardTarget) return link.href;
  try {
    return new URL(link.dashboardTarget, origin).href;
  } catch {
    return link.href;
  }
}

function linkTargetsRoute(link, expectedRaw) {
  const target = appTarget(link);
  if (!sameAppUrl(target)) return false;
  try {
    const parsed = new URL(target);
    return parsed.pathname === expectedRaw.replace(/\/$/, "") || parsed.pathname === expectedRaw;
  } catch {
    return false;
  }
}

function isGlobalCurrentNav(route, link) {
  if (link.raw === "/swficc/" && route === "/") return true;
  const navTexts = new Set(["Dashboard", "Institutions", "People", "Deals", "Comparisons", "Transactions", "RFPs", "Reports", "Intelligence", "Research", "Search", "Source", "Provenance", "JD Profile"]);
  return navTexts.has(link.text) && appRoute(appTarget(link)) === route;
}

function isAllowedSameRouteFilter(route, link) {
  const parsed = new URL(link.href);
  const targetRoute = appRoute(link.href);
  return targetRoute === route && (parsed.searchParams.has("filter") || parsed.searchParams.has("q") || parsed.hash);
}

function isDataLink(link) {
  const href = appTarget(link) || "";
  const text = link.text || "";
  return href.includes("/detail/")
    || href.includes("/source/?url=")
    || isAllowedSwfiRecordUrl(href)
    || link.sourceHref
    || (!link.dashboardTarget && /SWFIPN source detail|SWFI source|SWFI.com source/i.test(text));
}

function summarizeBody(body) {
  return body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 28);
}

function logProgress(message) {
  console.error(`[swfipn-e2e] ${message}`);
}

function timeoutFailure(label, timeoutMs) {
  return new Error(`${label} timed out after ${timeoutMs}ms`);
}

async function withDeadline(label, timeoutMs, work, fallback) {
  let timer;
  try {
    return await Promise.race([
      work(),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(timeoutFailure(label, timeoutMs)), timeoutMs);
      }),
    ]);
  } catch (error) {
    const result = fallback(error);
    result.ok = false;
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function waitForRequired(page, required, timeout = 60_000) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    if (required.every((text) => lower.includes(text.toLowerCase()))) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function waitForHydratedBody(page, required, timeout = 60_000, allowSourceGap = false) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const hasRequired = required.every((text) => lower.includes(text.toLowerCase()));
    const hasLoading = /\bLoading\b/.test(body);
    const hasSourceGap = /Source gap/.test(body);
    if (hasRequired && !hasLoading && (allowSourceGap || !hasSourceGap)) {
      await page.waitForTimeout(900);
      const stableBody = await page.locator("body").innerText().catch(() => body);
      const stableLower = stableBody.toLowerCase();
      const stableRequired = required.every((text) => stableLower.includes(text.toLowerCase()));
      const stableLoading = /\bLoading\b/.test(stableBody);
      const stableSourceGap = /Source gap/.test(stableBody);
      if (stableRequired && !stableLoading && (allowSourceGap || !stableSourceGap)) return stableBody;
    }
    await page.waitForTimeout(1_000);
  }
  return body;
}

async function loginContext(browser) {
  if (!username || !password) throw new Error("missing_auth_test_credentials");
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(urlFor(`/login/?next=${encodeURIComponent(appTargetPath("/profiles/"))}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/swficc\/profiles\/(?:$|[?#])/, { timeout: 90_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    const session = await context.request.get(apiUrl("/api/session/status/v1"), { timeout: 30_000 });
    if (session.status() !== 200) failures.push(`session_status_${session.status()}`);
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  if (failures.length) {
    await context.close().catch(() => {});
    throw new Error(`auth_context_failed:${failures.join("|")}`);
  }
  return context;
}

async function inspectRoute(browser, authContext, spec) {
  const owner = routeNeedsAuth(spec.route) ? authContext : browser;
  const page = await owner.newPage({ viewport: { width: 1366, height: 900 } });
  const apiFailures = [];
  page.on("requestfailed", (request) => {
    if (request.url().includes("/api/") || request.url().includes("/v1/swfi")) {
      apiFailures.push({ url: request.url(), error: request.failure()?.errorText || "" });
    }
  });
  const result = {
    id: `route:${spec.route}`,
    route: spec.route,
    url: urlFor(spec.route),
    ok: true,
    failures: [],
    source_gap_count: 0,
    loading_count: 0,
    visible_links: 0,
    data_links: 0,
    data_links_checked: 0,
    body_first: [],
    bad_links: [],
    checked_links: [],
    api_failures: apiFailures,
  };
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await waitForHydratedBody(page, [spec.ready], spec.waitMs || 120_000, spec.allowSourceGap);
    await page.waitForTimeout(1_000);
    const snapshot = await page.evaluate(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const bodyText = document.body.innerText;
      return {
        body: bodyText,
        links: Array.from(document.querySelectorAll("a[href]"))
          .filter(visible)
          .map((a) => ({
            text: (a.innerText || a.textContent || "").trim().replace(/\s+/g, " "),
            href: new URL(a.getAttribute("href") || "", document.baseURI).href,
            raw: a.getAttribute("href") || "",
            sourceHref: a.getAttribute("data-source-state") || "",
            dashboardTarget: a.getAttribute("data-dashboard-target") || "",
            recordLink: a.getAttribute("data-record-link") || "",
          })),
      };
    });
    result.body_first = summarizeBody(snapshot.body || body);
    for (const forbidden of CLIENT_FORBIDDEN_VISIBLE) {
      if ((snapshot.body || body).includes(forbidden)) result.failures.push(`forbidden_visible_text:${forbidden}`);
    }
    result.source_gap_count = (snapshot.body.match(/Source gap/g) || []).length;
    result.loading_count = (snapshot.body.match(/Loading/g) || []).length;
    result.visible_links = snapshot.links.length;
    for (const anchor of spec.requiredAnchors || []) {
      const found = snapshot.links.some((link) => link.text.includes(anchor.text) && linkTargetsRoute(link, anchor.raw));
      if (!found) result.failures.push(`missing_required_anchor:${anchor.text}:${anchor.raw}`);
    }
    const badLinks = [];
    const dataLinks = [];
    for (const link of snapshot.links) {
      if (!sameAppUrl(link.href)) {
        if (isAllowedSwfiRecordUrl(link.href)) {
          if (isDataLink(link)) dataLinks.push(link);
          continue;
        }
        badLinks.push({ ...link, failure: "external_visible_link" });
        continue;
      }
      const targetRoute = appRoute(appTarget(link));
      if (isGlobalCurrentNav(spec.route, link) || isAllowedSameRouteFilter(spec.route, link)) continue;
      if (targetRoute === spec.route && isDataLink(link)) {
        badLinks.push({ ...link, failure: "data_link_loops_to_same_route" });
      }
      if (isDataLink(link)) dataLinks.push(link);
    }
    result.data_links = dataLinks.length;
    result.bad_links = badLinks.slice(0, 20);
    if (badLinks.length) result.failures.push(`bad_visible_links_${badLinks.length}`);
    if (result.loading_count) result.failures.push(`loading_count_${result.loading_count}`);
    if (!spec.allowSourceGap && result.source_gap_count) result.failures.push(`source_gap_count_${result.source_gap_count}`);

    const maxLinks = gateLevel === "smoke" ? (spec.route === "/" ? 4 : 2) : (spec.route === "/" ? 8 : 5);
    const seenTargets = new Set();
    const checkLinks = dataLinks
      .filter((link) => sameAppUrl(appTarget(link)))
      .filter((link) => {
        const target = appTarget(link);
        if (seenTargets.has(target)) return false;
        seenTargets.add(target);
        return true;
      })
      .slice(0, maxLinks);
    result.data_links_checked = checkLinks.length;
    for (const link of checkLinks) {
      const targetHref = appTarget(link);
      const linkResult = { text: link.text, href: targetHref, ok: true, failures: [] };
      const linkPage = await authContext.newPage({ viewport: { width: 1280, height: 800 } });
      try {
        const linkTimeout = targetHref.includes("/profiles/detail/") ? PROFILE_LINK_CHECK_TIMEOUT_MS : LINK_CHECK_TIMEOUT_MS;
        const linkResponse = await linkPage.goto(targetHref, { waitUntil: "domcontentloaded", timeout: linkTimeout });
        if (!linkResponse || linkResponse.status() >= 400) linkResult.failures.push(`http_${linkResponse?.status() || "missing"}`);
        const isSourceRoute = appRoute(targetHref) === "/source/";
        const requiredText = isSourceRoute ? ["Record Link"] : ["Verified in SWFI records"];
        const linkBody = await waitForHydratedBody(linkPage, requiredText, linkTimeout, targetHref.includes("/profiles/detail/"));
        if (/404:|This page could not be found/i.test(linkBody)) linkResult.failures.push("404_body");
        if (!isSourceRoute && !/Verified in SWFI records/i.test(linkBody)) linkResult.failures.push("missing_verified_record");
        if (isSourceRoute && !/Record Link/i.test(linkBody)) linkResult.failures.push("missing_record_link");
      } catch (error) {
        linkResult.failures.push(error.message);
      } finally {
        await linkPage.close().catch(() => {});
      }
      linkResult.ok = linkResult.failures.length === 0;
      result.checked_links.push(linkResult);
      if (!linkResult.ok) result.failures.push(`data_link_failed:${link.text}:${linkResult.failures.join("|")}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function inspectSimple(context, item, prefix) {
  const result = { id: `${prefix}:${item.id}`, url: urlFor(item.url), ok: true, failures: [], source_gap_count: 0, body_first: [], links: [] };
  const page = await context.newPage({ viewport: { width: 1280, height: 800 } });
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await waitForRequired(page, item.required, 70_000);
    result.body_first = summarizeBody(body);
    for (const forbidden of CLIENT_FORBIDDEN_VISIBLE) {
      if (body.includes(forbidden)) result.failures.push(`forbidden_visible_text:${forbidden}`);
    }
    result.source_gap_count = (body.match(/Source gap/g) || []).length;
    for (const required of item.required) {
      if (!body.toLowerCase().includes(required.toLowerCase())) result.failures.push(`missing:${required}`);
    }
    result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
      text: anchor.textContent?.trim().replace(/\s+/g, " ") || "",
      href: anchor.getAttribute("href") || "",
    })));
    for (const requiredLink of item.requiredLinks || []) {
      if (!result.links.some((link) => link.href.includes(requiredLink))) result.failures.push(`missing_link:${requiredLink}`);
    }
    for (const forbidden of item.forbidden || []) {
      if (body.toLowerCase().includes(forbidden.toLowerCase())) result.failures.push(`forbidden:${forbidden}`);
    }
    if (!item.allowSourceGap && result.source_gap_count) result.failures.push(`source_gap_count_${result.source_gap_count}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function inspectControls(context, route) {
  const page = await context.newPage({ viewport: { width: 1366, height: 900 } });
  const result = { id: `controls:${route}`, route, ok: true, failures: [], before: "", afterSort: "", afterRows: "" };
  try {
    await page.goto(urlFor(route), { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForFunction(() => /Showing [0-9,]+ of [0-9,]+/.test(document.body.innerText), null, { timeout: CONTROL_CHECK_TIMEOUT_MS });
    const dataTab = page.getByRole("button", { name: /^Data$/ });
    if (await dataTab.count()) {
      await dataTab.first().click({ timeout: 10_000 }).catch(() => {});
      await page.waitForTimeout(500);
    }
    result.before = await page.evaluate(() => (document.body.innerText.match(/Showing [^\n]+/) || [""])[0]);
    const sort = page.locator("thead th button:visible").first();
    if (await sort.count()) {
      await sort.click({ timeout: 10_000 });
      await page.waitForTimeout(400);
      result.afterSort = await sort.innerText();
      if (!/\b(asc|desc)\b/i.test(result.afterSort)) result.failures.push("sort_did_not_toggle");
    } else {
      result.failures.push("missing_sort_button");
    }
    const selectIndex = await page.evaluate(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const selects = Array.from(document.querySelectorAll("select")).filter(visible);
      return selects.findIndex((select) => {
        const values = Array.from(select.querySelectorAll("option")).map((option) => option.value || option.textContent?.trim() || "");
        return values.includes("5") && values.includes("25");
      });
    });
    if (selectIndex < 0) {
      result.failures.push("missing_row_limit_select");
    } else {
      await page.locator("select:visible").nth(selectIndex).selectOption("10", { timeout: 10_000 });
      await page.waitForFunction(() => document.body.innerText.includes("Showing 10 of"), null, { timeout: CONTROL_CHECK_TIMEOUT_MS });
      result.afterRows = await page.evaluate(() => (document.body.innerText.match(/Showing [^\n]+/) || [""])[0]);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function runLimited(items, limit, fn, labelFor) {
  const results = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      const label = labelFor ? labelFor(items[index]) : `check:${index + 1}`;
      logProgress(`start ${label}`);
      results[index] = await fn(items[index]);
      logProgress(`done ${label} ${results[index]?.ok ? "ok" : "fail"}`);
    }
  });
  await Promise.all(workers);
  return results;
}

function routeTimeoutResult(spec, error) {
  return {
    id: `route:${spec.route}`,
    route: spec.route,
    url: urlFor(spec.route),
    ok: false,
    failures: [error.message],
    source_gap_count: 0,
    loading_count: 0,
    visible_links: 0,
    data_links: 0,
    data_links_checked: 0,
    body_first: [],
    bad_links: [],
    api_failures: [],
  };
}

function simpleTimeoutResult(item, prefix, error) {
  return {
    id: `${prefix}:${item.id}`,
    url: urlFor(item.url),
    ok: false,
    failures: [error.message],
    source_gap_count: 0,
    body_first: [],
  };
}

function controlsTimeoutResult(route, error) {
  return {
    id: `controls:${route}`,
    route,
    ok: false,
    failures: [error.message],
    before: "",
    afterSort: "",
    afterRows: "",
  };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const coreRoutes = selectedCoreRoutes();
  const detailCases = selectedDetailCases();
  const searchCases = selectedSearchCases();
  const controlRoutes = selectedControlRoutes();
  const launchOptions = {
    headless: true,
    args: [
      "--disable-gpu",
      ...(resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : []),
    ],
  };
  async function runWithContext(id, callback) {
    const browser = await chromium.launch({ channel: "chrome", ...launchOptions });
    let context = null;
    try {
      context = validateLocalAuth
        ? await loginContext(browser)
        : await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1366, height: 900 } });
      return await callback(browser, context);
    } catch (error) {
      return { id, ok: false, failures: [error.message] };
    } finally {
      if (context) await context.close().catch(() => {});
      await browser.close().catch(() => {});
    }
  }
  const checks = [];
  if (validateLocalAuth) {
    checks.push({ id: "auth_context_per_check", ok: true, skipped: false, failures: [] });
  } else {
    checks.push({ id: "auth_context_swfi_handoff_public", ok: true, skipped: true, failures: [], reason: "Public acceptance uses SWFI sign-in handoff for protected record pages; no custom dashboard auth is required." });
  }
  checks.push(...await runLimited(
    coreRoutes,
    1,
    (spec) => withDeadline(
      `route:${spec.route}`,
      spec.deadlineMs || ROUTE_CHECK_TIMEOUT_MS,
      () => runWithContext(`route:${spec.route}`, (browser, context) => inspectRoute(browser, context, spec)),
      (error) => routeTimeoutResult(spec, error),
    ),
    (spec) => `route:${spec.route}`,
  ));
  checks.push(...await runLimited(
    detailCases,
    1,
    (item) => withDeadline(
      `detail:${item.id}`,
      item.deadlineMs || SIMPLE_CHECK_TIMEOUT_MS,
      () => runWithContext(`detail:${item.id}`, (_browser, context) => inspectSimple(context, item, "detail")),
      (error) => simpleTimeoutResult(item, "detail", error),
    ),
    (item) => `detail:${item.id}`,
  ));
  checks.push(...await runLimited(
    searchCases,
    1,
    (item) => withDeadline(
      `search:${item.id}`,
      item.deadlineMs || SIMPLE_CHECK_TIMEOUT_MS,
      () => runWithContext(`search:${item.id}`, (_browser, context) => inspectSimple(context, item, "search")),
      (error) => simpleTimeoutResult(item, "search", error),
    ),
    (item) => `search:${item.id}`,
  ));
  checks.push(...await runLimited(
    controlRoutes,
    1,
    (route) => withDeadline(
      `controls:${route}`,
      CONTROL_CHECK_TIMEOUT_MS,
      () => runWithContext(`controls:${route}`, (_browser, context) => inspectControls(context, route)),
      (error) => controlsTimeoutResult(route, error),
    ),
    (route) => `controls:${route}`,
  ));

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    id: check.id,
    route: check.route,
    url: check.url,
    failures: check.failures,
    body_first: check.body_first,
    bad_links: check.bad_links,
  }));
  const receipt = {
    schema_version: "swfipn.e2e_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    level: gateLevel,
    status: failures.length ? "fail" : "pass",
    summary: {
      checks: checks.length,
      routes: coreRoutes.length,
      available_routes: CORE_ROUTES.length,
      details: detailCases.length,
      available_details: DETAIL_CASES.length,
      searches: searchCases.length,
      available_searches: SEARCH_CASES.length,
      controls: controlRoutes.length,
      available_controls: 6,
      failures: failures.length,
    },
    checks,
    failures,
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
