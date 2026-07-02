#!/usr/bin/env node
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-kp-acceptance-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originUrl = new URL(origin);
const originHost = originUrl.hostname;
const shouldProxyBackend = process.env.SWFIPN_PROXY_BACKEND === "1"
  || (process.env.SWFIPN_PROXY_BACKEND !== "0" && ["localhost", "127.0.0.1", "::1"].includes(originHost));
const apiPattern = /api\/(source-data|source-intelligence|recent-transactions|live-opportunities|sector-flows|allocator-activity|swfi|transactions)|\/v1\/swfi\//;
const authMode = String(process.env.SWFIPN_KP_AUTH_MODE || "swfi-auth-handoff");
const validateLegacyAuth = authMode === "legacy-auth";
const username = loadSecret("SWFIPN_AUTH_TEST_USERNAME", "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"]).trim();
const password = loadSecret("SWFIPN_AUTH_TEST_PASSWORD", "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"], false);
const forbiddenVisible = [
  "Endpoint:",
  "Active Mirror",
  "Mongo Record ID",
  "Backend ID",
  "Backend identifier",
  "Backend identifiers",
  "Source-backed fact",
  "Source-backed",
  "source-backed",
  "Data source:",
  "BRD V1.3",
  "Glass Box",
  "Command Box",
  "deterministic",
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
const dashboardSectionLinks = [
  ["Active Allocators", "/allocators/"],
  ["Deals", "/transactions/"],
  ["RFPs", "/mandates/"],
  ["Deals & Transactions", "/deals/"],
];
const listRoutes = [
  { route: "/profiles/", ready: "Showing 25 of", detailPath: "/profiles/detail/" },
  { route: "/allocators/", ready: "Showing 25 of", detailPath: "/profiles/detail/" },
  { route: "/transactions/", ready: "Showing 25 of", detailPath: "/transactions/detail/" },
  { route: "/deals/", ready: "Showing 25 of", detailPath: "/transactions/detail/" },
  { route: "/mandates/", ready: "Showing 25 of", detailPath: "/mandates/detail/" },
  { route: "/research/", ready: "Showing 25 of", detailPath: "/research/detail/" },
];
const brandExpectedLinks = [
  ["About Us", "/about/"],
  ["Solutions", "/solutions/"],
  ["Demo", "/demo/"],
  ["Contact Us", "/contact/"],
  ["Sign In", "/login/"],
];
const brandPageRoutes = [
  {
    route: "/about/",
    source_url: "https://www.swfi.com/about-us/overview",
    required: ["About Us", "Who Are We?", "Sovereign Wealth Fund Institute", "Research & analysis of global capital"],
    source_required: [
      "SWFI® is a platform offering comprehensive research & analysis of global capital, investor intelligence, money flows, and transparency.",
      "The Sovereign Wealth Fund Institute® (SWFI®) has been on the forefront of global wealth trends since 2008.",
      "The Sovereign Wealth Fund Institute was originally conceived in 2007 and was incorporated in 2008 by Michael Maduell.",
    ],
  },
  {
    route: "/solutions/",
    source_url: "https://www.swfi.com/solutions",
    required: ["Solutions", "Fundraising & Finding Buyers", "Due Diligence & KYC", "Investor Benchmarking"],
    source_required: [
      "Save time, money, and precious resources with a SWFI® subscription.",
      "Unearth scores of new institutional investors.",
      "Where does your firm rank? SWFI tracks, categorizes, and ranks investors, banks, and other entities by a wide range of measures including asset size and assets under management.",
      "The transaction database enables you the opportunity to search a global library of historical direct transactions and fund commitment data.",
    ],
  },
  {
    route: "/demo/",
    source_url: "https://www.swfi.com/demo",
    required: ["Demo", "Request a Demo", "First name", "Corporate email", "Be Part of the Elite SWFI Community"],
    source_required: [
      "You're one step closer to getting access to the Asset Owner Platform.",
      "Top 8 reasons people join SWFI",
      "Deep insights into active deals and fund commitments",
      "Analyze business opportunities, RFPs, and documents",
    ],
    compare_selects: ["businessType", "country"],
  },
  {
    route: "/contact/",
    source_url: "https://www.swfi.com/contact-us",
    required: ["Contact Us", "Corporate offices", "support@swfinstitute.org"],
    source_required: [
      "How did you find us?",
      "2300 West Sahara Avenue Suite 800",
      "One Cowboys Way Suite 270",
      "events@swfinstitute.org",
    ],
    compare_selects: ["country", "referral"],
  },
];
const recycledBrandPageText = [
  "SWFI Source References",
  "SWFI2 mirror record links",
  "Main Dashboard Area",
  "Historical Performance Dashboard",
  "Showing 5 of",
];
const expectedSwfiFaviconSha256 = "040db8dc915bdf05293df8fe03f9bdfddc971c9432bbe5debd9486281bf6660d";
const allocatorEndpoint = "/api/allocator-activity/v1?days=90&limit=25&page=1&sort=deal_count&direction=desc";
const allocatorWindowDays = 90;
const dayMs = 24 * 60 * 60 * 1000;

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function assetUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function apiUrl(route) {
  const root = new URL(origin);
  return new URL(route, root.origin).href;
}

function appPath(route) {
  const root = new URL(origin);
  const parsed = route.startsWith(root.pathname.replace(/\/$/, "") || "/")
    ? new URL(route, root.origin)
    : new URL(route.replace(/^\//, ""), origin);
  return parsed.pathname.replace(/\/?$/, "/");
}

function appTarget(route) {
  const root = new URL(origin);
  const parsed = route.startsWith(root.pathname.replace(/\/$/, "") || "/")
    ? new URL(route, root.origin)
    : new URL(route.replace(/^\//, ""), origin);
  const path = parsed.pathname === root.pathname.replace(/\/$/, "")
    ? `${parsed.pathname}/`
    : parsed.pathname.replace(/\/?$/, "/");
  return `${path}${parsed.search}${parsed.hash}`;
}

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
        // Try the next configured Keychain entry.
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

function sameApp(href) {
  try {
    const parsed = new URL(href);
    const root = new URL(origin);
    const basePath = root.pathname.replace(/\/$/, "");
    return parsed.origin === root.origin && parsed.pathname.startsWith(basePath || "/");
  } catch {
    return false;
  }
}

function sameAppRoute(href, route) {
  try {
    const parsed = new URL(href, origin);
    const root = new URL(origin);
    return parsed.origin === root.origin && parsed.pathname.replace(/\/?$/, "/") === appPath(route);
  } catch {
    return false;
  }
}

function loginHrefTargetsRoute(href, route) {
  try {
    const parsed = new URL(href);
    const root = new URL(origin);
    return parsed.origin === root.origin
      && parsed.pathname.replace(/\/?$/, "/") === appPath("/login/")
      && parsed.searchParams.get("next") === appTarget(route);
  } catch {
    return false;
  }
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
    const direct = redirectUrl.origin === expectedUrl.origin
      && redirectUrl.pathname.replace(/\/?$/, "/") === expectedUrl.pathname.replace(/\/?$/, "/")
      && redirectUrl.search === expectedUrl.search;
    if (direct) return true;
    const root = new URL(origin);
    const bridgePath = `${root.pathname.replace(/\/$/, "")}/auth/bridge/`;
    return redirectUrl.origin === root.origin
      && redirectUrl.pathname.replace(/\/?$/, "/") === bridgePath
      && (redirectUrl.searchParams.get("next") || "") === appTarget(expectedTarget);
  } catch {
    return false;
  }
}

function swfiSigninRedirectPath(value) {
  try {
    const parsed = new URL(String(value || ""), new URL(origin).origin);
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

function swfiRecordHandoffKind(value) {
  const pathname = swfiSigninRedirectPath(value);
  if (/^\/v1\/entities\/[a-f0-9]{24}\/$/i.test(pathname)) return "entity";
  if (/^\/v1\/transactions\/[a-f0-9]{24}\/$/i.test(pathname)) return "transaction";
  if (/^\/v1\/compass\/[a-f0-9]{24}\/$/i.test(pathname)) return "mandate";
  if (/^\/v1\/people\/[a-f0-9]{24}\/$/i.test(pathname)) return "person";
  return "";
}

function isApprovedSwfiRecordHandoff(href, kind = "") {
  const detected = swfiRecordHandoffKind(href);
  return Boolean(detected && (!kind || detected === kind));
}

function isAllowedSwfiLegacyArticleUrl(value) {
  try {
    const parsed = new URL(String(value || ""), new URL(origin).origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
    return /^\d+$/.test(parsed.searchParams.get("p") || "");
  } catch {
    return false;
  }
}

function isApprovedSwfiPlatformHref(value) {
  return isApprovedSwfiRecordHandoff(value) || isAllowedSwfiLegacyArticleUrl(value);
}

function dashboardTargetMatchesRoute(target, route) {
  if (!target) return false;
  try {
    const parsed = new URL(target, origin);
    return `${parsed.pathname.replace(/\/?$/, "/")}${parsed.search}${parsed.hash}` === appTarget(route);
  } catch {
    return false;
  }
}

function dashboardLinkTargetsRoute(link, route) {
  return sameAppRoute(link.href, route)
    || (loginHrefTargetsRoute(link.href, route) && dashboardTargetMatchesRoute(link.dashboardTarget, route));
}

function dashboardHrefExposures(links) {
  const failures = [];
  const externalSwfi = links.filter((link) => (
    isExternalSwfiHref(link.href) || isExternalSwfiHref(link.raw) || isExternalSwfiHref(link.dashboardTarget)
  ) && !isApprovedSwfiPlatformHref(link.href) && !isApprovedSwfiPlatformHref(link.raw));
  if (externalSwfi.length) failures.push(`dashboard_external_swfi_links:${externalSwfi.slice(0, 8).map((link) => link.text || link.href).join("|")}`);
  const leakPattern = /(?:[?&]source=|%3Fsource%3D|%26source%3D|\/v1\/)/i;
  const leaked = links.filter((link) => {
    if (isApprovedSwfiPlatformHref(link.href) || isApprovedSwfiPlatformHref(link.raw)) return false;
    return leakPattern.test([link.href, link.raw, link.source, link.dashboardTarget].filter(Boolean).join(" "));
  });
  if (leaked.length) failures.push(`dashboard_exposes_source_urls:${leaked.slice(0, 8).map((link) => link.text || link.href).join("|")}`);
  return failures;
}

function isExternalSwfiHref(href) {
  return /^https?:\/\/(www\.)?swfi\.com/i.test(String(href || "")) && !isApprovedSwfiPlatformHref(href);
}

function isInternalMirrorRecordHref(href) {
  if (isApprovedSwfiPlatformHref(href)) return true;
  try {
    const parsed = new URL(href, origin);
    const root = new URL(origin);
    if (parsed.origin !== root.origin) return false;
    return [
      "/profiles/detail/",
      "/transactions/detail/",
      "/mandates/detail/",
      "/people/detail/",
      "/research/detail/",
    ].some((route) => parsed.pathname.includes(`${root.pathname.replace(/\/$/, "")}${route}`));
  } catch {
    return false;
  }
}

async function hydratedBody(page, required, timeout = 75_000) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    if (page.isClosed()) return body;
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    if (required.every((text) => lower.includes(text.toLowerCase())) && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750).catch(() => {});
  }
  return body;
}

function navLabelFailures(labels) {
  return labels.includes("Provenance") ? ["primary_nav_exposes_provenance"] : [];
}

async function visibleNavLabels(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("aside a, nav a")).map((a) => a.textContent?.trim().replace(/\s+/g, " ") || "").filter(Boolean));
}

function packetRows(packet) {
  const data = packet?.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data)) return data;
  return [];
}

function packetRecord(packet) {
  const data = packet?.data;
  if (data?.record && typeof data.record === "object") return data.record;
  const rows = packetRows(packet);
  return rows[0] && typeof rows[0] === "object" ? rows[0] : null;
}

function idFromSourceUrl(value) {
  try {
    const parsed = new URL(cleanText(value));
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("v1");
    if (marker >= 0 && parts.length > marker + 2) return parts[marker + 2];
    return parts.at(-1) || "";
  } catch {
    return "";
  }
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function dateValue(value) {
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function currentUtcDateMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function allocatorInRankOrder(current, next) {
  const currentDeals = numberValue(current.deal_count);
  const nextDeals = numberValue(next.deal_count);
  if (currentDeals !== nextDeals) return currentDeals >= nextDeals;
  const currentValue = numberValue(current.total_deal_value);
  const nextValue = numberValue(next.total_deal_value);
  if (currentValue !== nextValue) return currentValue >= nextValue;
  return dateValue(current.latest_transaction_date) >= dateValue(next.latest_transaction_date);
}

async function fetchJson(url, timeout = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text.slice(0, 500) };
    }
    return { response, json };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchBytes(url, timeout = 30_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, { signal: controller.signal });
    const bytes = Buffer.from(await response.arrayBuffer());
    return { response, bytes };
  } finally {
    clearTimeout(timer);
  }
}

function bodyFailures(body) {
  return forbiddenVisible.filter((text) => body.includes(text)).map((text) => `forbidden_visible:${text}`);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function brandLinkFailures(links, { dashboardGated = false } = {}) {
  const failures = [];
  for (const [label, route] of brandExpectedLinks) {
    const matches = links.filter((link) => link.text === label);
    if (!matches.length) {
      failures.push(`brand_nav_missing:${label}`);
      continue;
    }
    const valid = dashboardGated && route !== "/login/"
      ? matches.some((link) => loginHrefTargetsRoute(link.href, route) && dashboardTargetMatchesRoute(link.dashboardTarget, route))
      : matches.some((link) => sameAppRoute(link.href, route));
    if (!valid) {
      failures.push(`brand_nav_wrong_route:${label}:${matches.map((link) => link.href).join("|")}`);
    }
  }
  return failures;
}

async function dashboardCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await installApiProxy(page);
  const result = { id: "dashboard_kp_contract", ok: true, failures: [], links: [] };
  try {
    const response = await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await hydratedBody(page, ["SWFI", "SOVEREIGN WEALTH FUND INSTITUTE", "TOTAL AUM ENGAGED", "Top Active Investors", "Newest Data"]);
    result.failures.push(...bodyFailures(body));
    const brand = await page.evaluate(() => {
      const header = document.querySelector("header");
      const logo = document.querySelector('img[src*="logo"]');
      const logoText = header?.textContent?.replace(/\s+/g, " ").trim() || "";
      const background = header ? getComputedStyle(header).backgroundColor : "";
      const navTexts = Array.from(header?.querySelectorAll("nav a") || []).map((a) => a.textContent?.trim() || "");
      return { logoText, background, navTexts, logoAlt: logo?.getAttribute("alt") || "", logoSrc: logo?.getAttribute("src") || "" };
    });
    if (!brand.logoAlt.includes("SWFI") || !brand.logoSrc.includes("/swfi-assets/logo.svg")) {
      result.failures.push("brand_header_missing_swfi_logo_asset");
    }
    if (!/^rgb\((1[0-9]{2}|2[0-4][0-9]|25[0-5]),\s*[0-9]{1,2},\s*[0-9]{1,2}\)$/i.test(brand.background)) {
      result.failures.push(`brand_header_not_swfi_red:${brand.background}`);
    }
    result.failures.push(...navLabelFailures(await visibleNavLabels(page)));
    result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
      raw: a.getAttribute("href") || "",
      source: a.getAttribute("data-source-state") || "",
      dashboardTarget: a.getAttribute("data-dashboard-target") || "",
      recordLink: a.getAttribute("data-record-link") || "",
    })).filter((link) => link.text));
    result.failures.push(...dashboardHrefExposures(result.links));
    for (const [text, route] of dashboardSectionLinks) {
      const found = result.links.some((link) => link.text.includes(text) && dashboardLinkTargetsRoute(link, route));
      if (!found) result.failures.push(`missing_dedicated_section_link:${text}:${route}`);
    }
    const localSectionLinks = result.links.filter((link) => ["Top Investors", "Fundraising", "Market Activity", "News"].includes(link.text) && link.raw.startsWith("#"));
    if (localSectionLinks.length) result.failures.push(`dashboard_section_nav_uses_anchor:${localSectionLinks.map((link) => link.text).join(",")}`);
    const visibleExternal = result.links.filter((link) => isExternalSwfiHref(link.href));
    if (visibleExternal.length) result.failures.push(`external_swfi_links:${visibleExternal.length}`);
    const dataLinks = result.links.filter((link) => link.recordLink === "true" || isInternalMirrorRecordHref(link.href));
    if (dataLinks.length < 8) result.failures.push(`dashboard_data_links_${dataLinks.length}_lt_8`);
    const allocatorProfileLinks = result.links.filter((link) => isApprovedSwfiRecordHandoff(link.href, "entity") || (isInternalMirrorRecordHref(link.href) && link.href.includes("/profiles/detail/")));
    if (allocatorProfileLinks.length < 5) result.failures.push(`allocator_profile_links_${allocatorProfileLinks.length}_lt_5`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function loginContext(browser) {
  if (!username || !password) throw new Error("missing_auth_test_credentials");
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(appUrl(`/login/?next=${encodeURIComponent(appTarget("/profiles/"))}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
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

async function loginHandoffCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  await installApiProxy(context);
  const expectedTarget = appTarget("/profiles/");
  const result = {
    id: "swfi_auth_handoff_login",
    ok: true,
    status: 0,
    location: "",
    expected_target: expectedTarget,
    failures: [],
  };
  try {
    const response = await context.request.get(appUrl(`/login/?next=${encodeURIComponent(expectedTarget)}`), { maxRedirects: 0, timeout: 30_000 });
    result.status = response.status();
    result.location = response.headers().location || "";
    if (![302, 303, 307, 308].includes(result.status)) result.failures.push(`login_not_redirect:${result.status}`);
    if (!swfiSigninHandoffUrl(result.location, expectedTarget)) {
      result.failures.push(`login_not_swfi_signin_handoff:${result.location || "missing"}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function listRouteCheck(context, spec) {
  const page = await context.newPage();
  const result = { id: `list:${spec.route}`, route: spec.route, ok: true, failures: [], first_mirror_record_link: null };
  try {
    const response = await page.goto(appUrl(spec.route), { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await hydratedBody(page, [spec.ready, "Updated from SWFI"]);
    result.failures.push(...bodyFailures(body));
    result.failures.push(...navLabelFailures(await visibleNavLabels(page)));
    const pageLinks = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
    })).filter((link) => link.text));
    result.failures.push(...brandLinkFailures(pageLinks));
    const link = await page.evaluate(({ detailPath }) => {
      const anchors = Array.from(document.querySelectorAll("a[href]"));
      const found = anchors.find((a) => {
        if (a.href.includes("www.swfi.com/v1/signin/")) return true;
        if (!a.href.includes(detailPath)) return false;
        try {
          const parsed = new URL(a.href);
          return parsed.pathname.includes(detailPath);
        } catch {
          return false;
        }
      });
      return found ? { text: found.textContent?.trim().replace(/\s+/g, " ") || "", href: found.href, source: found.getAttribute("data-source-state") || "" } : null;
    }, { detailPath: spec.detailPath });
    if (!link) {
      result.failures.push(`missing_internal_mirror_record_link:${spec.detailPath}`);
    } else {
      result.first_mirror_record_link = link;
      if (!isInternalMirrorRecordHref(link.href)) result.failures.push(`invalid_record_link:${link.href}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function brandPageCheck(browser, spec) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await installApiProxy(page);
  const result = { id: `brand:${spec.route}`, route: spec.route, source_url: spec.source_url, ok: true, failures: [] };
  try {
    const response = await page.goto(appUrl(spec.route), { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    if (response?.request().redirectedFrom()) result.failures.push("unexpected_redirect");
    const expectedPath = appPath(spec.route);
    const finalPath = new URL(page.url()).pathname.replace(/\/?$/, "/");
    if (finalPath !== expectedPath) result.failures.push(`wrong_final_path:${finalPath}`);
    const body = await hydratedBody(page, spec.required, 60_000);
    result.failures.push(...bodyFailures(body));
    result.failures.push(...navLabelFailures(await visibleNavLabels(page)));
    for (const text of spec.source_required || []) {
      if (!body.includes(text)) result.failures.push(`missing_source_text:${text.slice(0, 80)}`);
    }
    for (const text of recycledBrandPageText) {
      if (body.includes(text)) result.failures.push(`brand_page_recycled_content:${text}`);
    }
    const pageLinks = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
    })).filter((link) => link.text));
    result.failures.push(...brandLinkFailures(pageLinks));
    result.source_parity = await sourceParityCheck(browser, page, spec);
    result.failures.push(...result.source_parity.failures);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function sourceParityCheck(browser, internalPage, spec) {
  const result = { ok: true, failures: [], final_source_url: "", select_counts: {} };
  if (!spec.source_url) return result;
  const sourcePage = await browser.newPage({ viewport: { width: 1440, height: 1200 } });
  await installApiProxy(sourcePage);
  try {
    const response = await sourcePage.goto(spec.source_url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`source_http_${response?.status() || "missing"}`);
    result.final_source_url = sourcePage.url();
    const sourceBody = await hydratedBody(sourcePage, spec.source_required || spec.required, 45_000);
    if (sourceBody.includes("404 Page not found")) result.failures.push("source_route_404");
    for (const text of spec.source_required || []) {
      if (!sourceBody.includes(text)) result.failures.push(`source_missing_expected_text:${text.slice(0, 80)}`);
    }
    const internalOptions = await selectOptionsByName(internalPage);
    const sourceOptions = await selectOptionsByName(sourcePage);
    for (const name of spec.compare_selects || []) {
      const internal = internalOptions[name] || [];
      const source = sourceOptions[name] || [];
      result.select_counts[name] = { source: source.length, internal: internal.length };
      if (source.length === 0) {
        result.failures.push(`source_select_missing:${name}`);
      } else if (internal.length !== source.length) {
        result.failures.push(`select_count_mismatch:${name}:source_${source.length}:internal_${internal.length}`);
      } else if (JSON.stringify(internal) !== JSON.stringify(source)) {
        result.failures.push(`select_options_mismatch:${name}`);
      }
    }
  } catch (error) {
    result.failures.push(`source_parity_error:${error.message}`);
  } finally {
    await sourcePage.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function selectOptionsByName(page) {
  return page.evaluate(() => Object.fromEntries(Array.from(document.querySelectorAll("select")).map((select) => {
    const name = select.getAttribute("name") || select.getAttribute("id") || "unnamed";
    const options = Array.from(select.options)
      .map((option) => option.textContent?.trim().replace(/\s+/g, " ") || "")
      .filter((text) => text && text !== "Select");
    return [name, options];
  })));
}

async function brandClickNavigationCheck(browser) {
  const result = { id: "brand_header_clicks_open_public_pages", ok: true, failures: [], links: [] };
  for (const [label, route] of brandExpectedLinks.filter(([label]) => label !== "Sign In")) {
    const context = await browser.newContext({
      storageState: { cookies: [], origins: [] },
      viewport: { width: 1440, height: 1000 },
    });
    await installApiProxy(context);
    const page = await context.newPage();
    try {
      const response = await page.goto(appUrl("/about/"), { waitUntil: "domcontentloaded", timeout: 45_000 });
      if (!response || response.status() >= 400) result.failures.push(`${label}:brand_start_http_${response?.status() || "missing"}`);
      await hydratedBody(page, ["About Us", "Who Are We?"], 60_000);
      const row = { label, expected_route: appPath(route), target_href: "", final_url: "", body_excerpt: "" };
      const navLink = page.locator("header nav a").filter({ hasText: new RegExp(`^${escapeRegExp(label)}$`) }).first();
      row.target_href = await navLink.getAttribute("href", { timeout: 15_000 }) || "";
      await Promise.all([
        page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {}),
        navLink.click({ timeout: 15_000 }),
      ]);
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => {});
      row.final_url = page.url();
      row.body_excerpt = (await page.locator("body").innerText({ timeout: 20_000 }).catch(() => "")).slice(0, 300).replace(/\s+/g, " ");
      if (!sameAppRoute(row.target_href, route)) result.failures.push(`${label}:target_not_public_route:${row.target_href || "missing"}`);
      if (!sameAppRoute(row.final_url, route)) result.failures.push(`${label}:not_public_route:${row.final_url}`);
      if (/Subscriber Sign In/i.test(row.body_excerpt)) result.failures.push(`${label}:unexpected_login_page`);
      if (/Not found|404/i.test(row.body_excerpt)) result.failures.push(`${label}:public_page_404`);
      if (isExternalSwfiHref(row.final_url) || isExternalSwfiHref(row.target_href)) result.failures.push(`${label}:external_swfi_target`);
      result.links.push(row);
    } catch (error) {
      result.failures.push(`${label}:${error.message}`);
    } finally {
      await context.close().catch(() => {});
    }
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function faviconCheck() {
  const result = { id: "swfi_favicon", url: assetUrl("favicon.ico"), ok: true, failures: [], sha256: "" };
  try {
    const { response, bytes } = await fetchBytes(result.url, 30_000);
    if (!response || response.status >= 400) result.failures.push(`http_${response?.status || "missing"}`);
    result.sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
    if (result.sha256 !== expectedSwfiFaviconSha256) result.failures.push(`favicon_sha256_mismatch:${result.sha256}`);
    if (bytes.length < 10_000) result.failures.push(`favicon_too_small:${bytes.length}`);
  } catch (error) {
    result.failures.push(error.message);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function allocatorMethodologyCheck() {
  const result = {
    id: "active_allocator_methodology",
    endpoint: apiUrl(allocatorEndpoint),
    ok: true,
    failures: [],
    row_count: 0,
    cutoff: null,
    sampled_transactions: [],
  };
  try {
    const { response, json: packet } = await fetchJson(result.endpoint, 45_000);
    if (!response || response.status >= 400) result.failures.push(`http_${response?.status || "missing"}`);
    if (packet?.status !== "ok") result.failures.push(`packet_status_${packet?.status || "missing"}`);
    const rows = packetRows(packet);
    result.row_count = rows.length;
    if (rows.length < 5) result.failures.push(`allocator_rows_${rows.length}_lt_5`);
    const today = currentUtcDateMs();
    const cutoff = today - allocatorWindowDays * dayMs;
    result.cutoff = new Date(cutoff).toISOString().slice(0, 10);
    rows.forEach((row, index) => {
      const name = cleanText(row.name);
      const latest = dateValue(row.latest_transaction_date);
      const dealCount = numberValue(row.deal_count);
      const sourceUrls = Array.isArray(row.deal_source_urls) ? row.deal_source_urls.filter(Boolean) : [];
      const entityId = idFromSourceUrl(row.source_url || row.swfi_url);
      if (!name) result.failures.push(`allocator_${index}_missing_name`);
      if (/\bBDO\b/i.test(name)) result.failures.push(`allocator_historical_leak_bdo:${index}`);
      if (!entityId) result.failures.push(`allocator_${name || index}_missing_entity_source_url`);
      if (dealCount < 1) result.failures.push(`allocator_${name || index}_deal_count_${dealCount}_lt_1`);
      if (!sourceUrls.some((url) => /^https:\/\/www\.swfi\.com\/v1\/transactions\//i.test(cleanText(url)))) {
        result.failures.push(`allocator_${name || index}_missing_transaction_source_url`);
      }
      if (!Number.isFinite(latest)) {
        result.failures.push(`allocator_${name || index}_missing_latest_transaction_date`);
      } else {
        if (latest < cutoff) result.failures.push(`allocator_${name}_latest_${cleanText(row.latest_transaction_date)}_before_${result.cutoff}`);
        if (latest > today + dayMs) result.failures.push(`allocator_${name}_latest_${cleanText(row.latest_transaction_date)}_future`);
      }
      if (index < rows.length - 1 && !allocatorInRankOrder(row, rows[index + 1])) {
        result.failures.push(`allocator_sort_violation:${name || index}->${cleanText(rows[index + 1].name) || index + 1}`);
      }
    });
    const sampleRows = rows.slice(0, 3);
    for (const row of sampleRows) {
      const entityId = idFromSourceUrl(row.source_url || row.swfi_url);
      const dealIds = Array.isArray(row.deal_source_urls) ? row.deal_source_urls.map((url) => idFromSourceUrl(url)).filter(Boolean).slice(0, 2) : [];
      for (const dealId of dealIds) {
        const detailUrl = apiUrl(`/api/transactions/${encodeURIComponent(cleanText(dealId))}/v1`);
        const { response, json: detailPacket } = await fetchJson(detailUrl, 45_000);
        const sample = { allocator: cleanText(row.name), entity_id: entityId, deal_id: cleanText(dealId), ok: true, failures: [] };
        if (!response || response.status >= 400) sample.failures.push(`http_${response?.status || "missing"}`);
        if (detailPacket?.status !== "ok") sample.failures.push(`packet_status_${detailPacket?.status || "missing"}`);
        const record = packetRecord(detailPacket);
        const buyerIds = Array.isArray(record?.buyer_entities)
          ? record.buyer_entities.map((buyer) => idFromSourceUrl(buyer?.source_url || buyer?.swfi_url)).filter(Boolean)
          : [];
        const buyerNames = Array.isArray(record?.buyer_entities)
          ? record.buyer_entities.map((buyer) => cleanText(buyer?.name).toLowerCase()).filter(Boolean)
          : [];
        const completed = dateValue(record?.closed_at || record?.completed_at || record?.completedAt);
        if (entityId ? !buyerIds.includes(entityId) : !buyerNames.includes(cleanText(row.name).toLowerCase())) sample.failures.push("allocator_not_on_buyer_acquirer_side");
        if (!Number.isFinite(completed)) sample.failures.push("transaction_missing_completed_date");
        else if (completed < cutoff || completed > today + dayMs) sample.failures.push(`transaction_completed_date_outside_window:${cleanText(record?.closed_at || record?.completed_at || record?.completedAt)}`);
        sample.ok = sample.failures.length === 0;
        result.sampled_transactions.push(sample);
        result.failures.push(...sample.failures.map((failure) => `sample_${sample.allocator}_${sample.deal_id}:${failure}`));
      }
    }
  } catch (error) {
    result.failures.push(error.message);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function sourceReferenceCheck(browser) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await installApiProxy(page);
  const result = { id: "source_reference_buyer_safe", route: "/provenance/", ok: true, failures: [], links: [] };
  try {
    const response = await page.goto(appUrl("/provenance/"), { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const body = await hydratedBody(page, ["Source References", "corresponding SWFI record/profile page within /swficc where an internal record exists"], 60_000);
    result.failures.push(...bodyFailures(body));
    result.failures.push(...navLabelFailures(await visibleNavLabels(page)));
    result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
      raw: a.getAttribute("href") || "",
    })).filter((link) => link.text));
    result.failures.push(...brandLinkFailures(result.links));
    const visibleExternal = result.links.filter((link) => isExternalSwfiHref(link.href));
    if (visibleExternal.length) result.failures.push(`external_swfi_links:${visibleExternal.length}`);
    const internalActions = result.links.filter((link) => sameApp(link.href));
    if (internalActions.length < 3) result.failures.push(`source_reference_internal_actions_${internalActions.length}_lt_3`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function rideReachability() {
  const result = { id: "ride_reachability_advisory", ok: true, failures: [], status: null };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch("http://195.201.84.104:8888", { signal: controller.signal });
    result.status = response.status;
  } catch (error) {
    result.ok = false;
    result.failures.push(`ride_unreachable:${error.message}`);
  } finally {
    clearTimeout(timeout);
  }
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const launchOptions = {
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  };
  async function runWithBrowser(id, callback) {
    const browser = await chromium.launch(launchOptions);
    try {
      return await callback(browser);
    } catch (error) {
      return { id, ok: false, failures: [error.message] };
    } finally {
      await browser.close().catch(() => {});
    }
  }
  const checks = [];

  checks.push(await faviconCheck());
  checks.push(await allocatorMethodologyCheck());
  checks.push(await runWithBrowser("dashboard_kp_contract", dashboardCheck));
  checks.push(await runWithBrowser("brand_header_clicks_open_public_pages", brandClickNavigationCheck));
  for (const route of brandPageRoutes) {
    checks.push(await runWithBrowser(`brand:${route.route}`, (browser) => brandPageCheck(browser, route)));
  }
  if (validateLegacyAuth) {
    checks.push(await runWithBrowser("legacy_auth_list_routes", async (browser) => {
      const authContext = await loginContext(browser);
      const results = [];
      try {
        for (const route of listRoutes) results.push(await listRouteCheck(authContext, route));
      } finally {
        await authContext.close().catch(() => {});
      }
      const failures = results.filter((result) => !result.ok).flatMap((result) => result.failures.map((failure) => `${result.route}:${failure}`));
      return { id: "legacy_auth_list_routes", ok: failures.length === 0, failures, routes: results };
    }));
  } else {
    checks.push(await runWithBrowser("swfi_auth_handoff_login", loginHandoffCheck));
    for (const route of listRoutes) {
      checks.push(await runWithBrowser(`list:${route.route}`, async (browser) => {
        const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
        await installApiProxy(context);
        try {
          return await listRouteCheck(context, route);
        } finally {
          await context.close().catch(() => {});
        }
      }));
    }
  }
  checks.push(await runWithBrowser("source_reference_buyer_safe", sourceReferenceCheck));
  checks.push(await rideReachability());

  const hardFailures = checks.filter((check) => !check.ok && check.id !== "ride_reachability_advisory");
  const receipt = {
    schema_version: "swfipn.kp_acceptance_gate.v1",
    origin,
    auth_mode: authMode,
    generated_at: new Date().toISOString(),
    status: hardFailures.length ? "fail" : "pass",
    summary: {
      checks: checks.length,
      hard_failures: hardFailures.length,
      advisories: checks.filter((check) => !check.ok && check.id === "ride_reachability_advisory").length,
    },
    checks,
    failures: hardFailures.map((check) => ({ id: check.id, route: check.route, failures: check.failures })),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
  process.exit(0);
}

async function installApiProxy(target) {
  if (!shouldProxyBackend) return;
  await target.route("**/*", async (route) => {
    const request = route.request();
    const requestUrl = new URL(request.url());
    if (!apiPattern.test(request.url())) {
      await route.continue();
      return;
    }
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers: corsHeaders() });
      return;
    }
    const upstreamUrl = requestUrl.origin === originUrl.origin
      ? `${backendOrigin}${requestUrl.pathname}${requestUrl.search}`
      : request.url();
    try {
      const response = await route.fetch({ url: upstreamUrl, timeout: 120_000 });
      await route.fulfill({
        response,
        headers: { ...response.headers(), ...corsHeaders(), "cache-control": "no-store" },
      });
    } catch {
      await route.fulfill({
        status: 502,
        headers: { ...corsHeaders(), "content-type": "application/json" },
        body: JSON.stringify({ status: "unavailable", fact: false, data: { rows: [] } }),
      });
    }
  });
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "accept,content-type,x-swfipn-public",
  };
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
