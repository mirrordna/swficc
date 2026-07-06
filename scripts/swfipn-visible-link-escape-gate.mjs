#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-visible-link-escape-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const originUrl = new URL(origin);
const routes = envList("SWFIPN_LINK_ESCAPE_ROUTES", [
  "/",
  "/profiles/",
  "/profiles/detail/?id=5e5713b876fb1e43b1bb71eb",
  "/transactions/",
  "/deals/",
  "/transactions/detail/?id=6a300360f573546e66a087b5",
  "/mandates/",
  "/mandates/detail/?id=6a054a79fc240d9d3ab4e22c",
  "/people/",
  "/people/detail/?id=65f194e86967a79fee4f5856",
  "/reports/",
  "/intelligence/",
  "/research/",
  "/research/detail/?legacy=109243",
  "/allocators/",
  "/comparisons/",
  "/about/",
  "/about-us/overview/",
  "/about-us/our-team/",
  "/solutions/",
  "/demo/",
  "/contact/",
  "/newsletter-subscription/",
  "/privacy-policy/",
  "/terms-of-use/",
  "/cookie-policy/",
  "/accessibility/",
  "/provenance/",
  "/source/",
  "/search/?q=Real%20Estate",
]);
const allowedExternalHosts = new Set([
  "gwc.events",
  "twitter.com",
  "www.linkedin.com",
  "www.facebook.com",
]);
const forbiddenUserText = [
  "Active Mirror",
  "source_gap",
  "Source gap",
  "backend_http_",
  "ObjectId",
  "undefined",
  "null",
  "legacy profile",
  "external profile",
  "No internal record mapping",
  "citation-only",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function envList(name, fallback) {
  const items = String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function appUrl(route) {
  return new URL(String(route).replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function isRawSwfiRecordUrl(value) {
  // Bare auth entry (law 2026-07-06) is not a record URL.
  if (isSwfiAuthEntryHref(value)) return false;
  return /https?:\/\/(?:www\.|cms\.)?swfi\.com\/(?:v1\/|\?p=)/i.test(String(value || ""));
}

// The bare SWFI sign-in page (no redirect param) is the platform's auth
// entry — approved everywhere (source-of-truth rule; minutes C/G).
function isSwfiAuthEntryHref(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    return !parsed.searchParams.get("redirect");
  } catch {
    return false;
  }
}

function isAllowedSwfiLegacyArticleUrl(value) {
  try {
    const parsed = new URL(String(value || ""), originUrl.origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
    return /^\d+$/.test(parsed.searchParams.get("p") || "");
  } catch {
    return false;
  }
}

function isCanonicalSwfiHandoffUrl(value) {
  try {
    const parsed = new URL(String(value || ""), originUrl.origin);
    if (parsed.hostname !== "www.swfi.com") return false;
    if (parsed.pathname === "/v1/signin/" || parsed.pathname === "/v1/signin") {
      if (parsed.searchParams.get("msg") !== "auth") return false;
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect || !redirect.startsWith("/") || /^https?:\/\//i.test(redirect)) return false;
      const redirectUrl = new URL(redirect, "https://www.swfi.com");
      return /^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i.test(redirectUrl.pathname);
    }
  } catch {
    return false;
  }
  return false;
}

function allowedExternal(route, href) {
  try {
    const parsed = new URL(href);
    if (isCanonicalSwfiHandoffUrl(href)) return true;
    if (isAllowedSwfiLegacyArticleUrl(href)) return true;
    if (isSwfiAuthEntryHref(href)) return true;
    if (!allowedExternalHosts.has(parsed.hostname)) return false;
    return true;
  } catch {
    return false;
  }
}

async function inspectRoute(browser, route) {
  const errors = [];
  const failedRequests = [];
  let page;
  const result = {
    route,
    url: appUrl(route),
    status: 0,
    body_chars: 0,
    blank: false,
    external_links: [],
    raw_record_anchors: [],
    raw_source_attrs: [],
    errors: [],
    failed_requests: [],
    failures: [],
  };

  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => {
      if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
    });
    page.on("requestfailed", (request) => {
      const url = request.url();
      if (!url.includes("/cdn-cgi/rum")) failedRequests.push(url);
    });

    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    result.status = response?.status() || 0;
    if (/\/(?:profiles|transactions|mandates|people|reports|research)\/detail\/\?/i.test(route)) {
      await page.waitForFunction(() => {
        const text = document.body?.innerText || "";
        return /Verified in SWFI records|Source record on file|Report Details|Transaction Details|RFP \/ Mandate Details|Person Details|Entity Details|Article Details/i.test(text);
      }, null, { timeout: 60_000 }).catch(() => null);
    }
    await page.waitForFunction(() => (document.body?.innerText || "").trim().length > 120, null, { timeout: 10_000 }).catch(() => null);
    await page.waitForTimeout(500);
    result.final_url = page.url();
    if (isCanonicalSwfiHandoffUrl(result.final_url) && /\/(?:profiles|transactions|mandates|people)\/detail\/\?/i.test(route)) {
      result.auth_handoff = true;
      result.body_chars = 0;
      result.blank = false;
      result.external_links = [];
      result.canonical_swfi_handoff_anchors = [{ text: "SWFI sign-in handoff", href: result.final_url, raw: result.final_url }];
      result.raw_record_anchors = [];
      result.raw_source_attrs = [];
      result.blank_target_legacy_anchors = [];
      result.forbidden_text = [];
      result.ok = true;
      return result;
    }
    const snapshot = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll("a[href]")].map((anchor) => ({
        text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80),
        href: anchor.href,
        raw: anchor.getAttribute("href") || "",
        target: anchor.getAttribute("target") || "",
        record: anchor.getAttribute("data-record-link") || "",
        sourceHref: anchor.getAttribute("data-source-href") || "",
        sourceUrl: anchor.getAttribute("data-source-url") || "",
        sourceState: anchor.getAttribute("data-source-state") || "",
        title: anchor.getAttribute("title") || "",
        ariaLabel: anchor.getAttribute("aria-label") || "",
        outerHTML: anchor.outerHTML.slice(0, 1000),
      }));
      const text = document.body?.innerText || "";
      return { anchors, bodyChars: text.length, bodyText: text, blank: text.trim().length < 250 };
    });
    result.body_chars = snapshot.bodyChars;
    result.blank = snapshot.blank;
    result.external_links = snapshot.anchors.filter((anchor) => {
      try {
        const parsed = new URL(anchor.href);
        return parsed.protocol.startsWith("http") && parsed.origin !== originUrl.origin;
      } catch {
        return false;
      }
    });
    result.canonical_swfi_handoff_anchors = snapshot.anchors.filter((anchor) => isCanonicalSwfiHandoffUrl(anchor.href) || isCanonicalSwfiHandoffUrl(anchor.raw));
    result.raw_record_anchors = snapshot.anchors.filter((anchor) => {
      const rawRecord = isRawSwfiRecordUrl(anchor.href) || isRawSwfiRecordUrl(anchor.raw);
      const approvedHandoff = isCanonicalSwfiHandoffUrl(anchor.href) || isCanonicalSwfiHandoffUrl(anchor.raw);
      const approvedLegacyArticle = isAllowedSwfiLegacyArticleUrl(anchor.href) || isAllowedSwfiLegacyArticleUrl(anchor.raw);
      return rawRecord && !approvedHandoff && !approvedLegacyArticle;
    });
    result.raw_source_attrs = snapshot.anchors.filter((anchor) => {
      const attrText = [anchor.sourceHref, anchor.sourceUrl, anchor.title, anchor.ariaLabel].join(" ");
      return isRawSwfiRecordUrl(attrText) || /(?:source_gap|schema_version|ObjectId|Backend ID|Active Mirror|No internal record mapping|citation-only)/i.test(attrText);
    });
    result.blank_target_legacy_anchors = snapshot.anchors.filter((anchor) => anchor.target === "_blank" && (isRawSwfiRecordUrl(anchor.href) || isRawSwfiRecordUrl(anchor.raw) || /swfi\.com/i.test(anchor.href)));
    result.forbidden_text = forbiddenUserText.filter((text) => snapshot.bodyText?.includes(text));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    if (page) await page.close().catch(() => {});
  }

  result.errors = errors;
  result.failed_requests = failedRequests;
  if (result.status >= 400 || !result.status) result.failures.push(`http_${result.status || "missing"}`);
  if (result.blank) result.failures.push("blank_page");
  const unapprovedExternal = result.external_links.filter((link) => !allowedExternal(route, link.href));
  if (unapprovedExternal.length) result.failures.push(`unapproved_external_links:${unapprovedExternal.length}`);
  if (result.raw_record_anchors.length) result.failures.push(`raw_swfi_record_anchors:${result.raw_record_anchors.length}`);
  if (result.raw_source_attrs.length) result.failures.push(`raw_swfi_source_attrs:${result.raw_source_attrs.length}`);
  if (result.blank_target_legacy_anchors?.length) result.failures.push(`blank_target_legacy_anchors:${result.blank_target_legacy_anchors.length}`);
  if (result.forbidden_text?.length) result.failures.push(`forbidden_user_text:${result.forbidden_text.join("|")}`);
  if (result.errors.length) result.failures.push(`console_or_page_errors:${result.errors.length}`);
  if (result.failed_requests.length) result.failures.push(`failed_requests:${result.failed_requests.length}`);
  result.ok = result.failures.length === 0;
  result.external_links = result.external_links.slice(0, 10);
  result.raw_record_anchors = result.raw_record_anchors.slice(0, 10);
  result.raw_source_attrs = result.raw_source_attrs.slice(0, 10);
  result.blank_target_legacy_anchors = (result.blank_target_legacy_anchors || []).slice(0, 10);
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const results = [];
  for (const route of routes) {
    console.error(`[link-escape] inspecting ${route}`);
    const browser = await chromium.launch({ headless: true, timeout: 30_000 });
    try {
      results.push(await inspectRoute(browser, route));
    } catch (error) {
      results.push({
        route,
        url: appUrl(route),
        status: 0,
        body_chars: 0,
        blank: true,
        external_links: [],
        canonical_swfi_handoff_anchors: [],
        raw_record_anchors: [],
        raw_source_attrs: [],
        blank_target_legacy_anchors: [],
        forbidden_text: [],
        errors: [],
        failed_requests: [],
        failures: [error.message],
        ok: false,
      });
    } finally {
      await browser.close().catch(() => {});
    }
  }
  const failures = results.flatMap((result) => result.ok ? [] : result.failures.map((failure) => ({ route: result.route, failure })));
  const receipt = {
    schema_version: "swfipn.visible_link_escape_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: results.map((result) => ({
      route: result.route,
      status: result.status,
      external_links: result.external_links.length,
      canonical_swfi_handoff_anchors: result.canonical_swfi_handoff_anchors?.length || 0,
      raw_record_anchors: result.raw_record_anchors.length,
      raw_source_attrs: result.raw_source_attrs.length,
      blank_target_legacy_anchors: result.blank_target_legacy_anchors?.length || 0,
      forbidden_text: result.forbidden_text || [],
      blank: result.blank,
      ok: result.ok,
    })),
    results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    failures,
    receipt: receiptPath,
  }, null, 2));
  if (failures.length) process.exit(1);
  process.exit(0);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
