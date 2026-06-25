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
  "/transactions/detail/?id=6a300360f573546e66a087b5",
  "/mandates/",
  "/mandates/detail/?id=6a054a79fc240d9d3ab4e22c",
  "/people/",
  "/people/detail/?id=65f194e86967a79fee4f5856",
  "/reports/",
  "/intelligence/",
  "/research/detail/?legacy=109243",
  "/allocators/",
  "/comparisons/",
  "/about/",
  "/solutions/",
  "/contact/",
  "/search/?q=Real%20Estate",
]);
const allowedExternalHosts = new Set([
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
  return /https?:\/\/(?:www\.|cms\.)?swfi\.com\/(?:v1\/|\?p=)/i.test(String(value || ""));
}

function isCanonicalSwfiHandoffUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname === "/" && /^\?p=\d+/i.test(parsed.search)) return true;
    if (parsed.pathname === "/v1/signin/" || parsed.pathname === "/v1/signin") {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect) return true;
      try {
        const redirectUrl = new URL(redirect, originUrl.origin);
        return redirectUrl.hostname === originUrl.hostname;
      } catch {
        return redirect.startsWith("/swficc/");
      }
    }
    return /^\/v1\/(entities|people|transactions|compass|news)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function allowedExternal(route, href) {
  try {
    const parsed = new URL(href);
    if (isCanonicalSwfiHandoffUrl(href)) return true;
    if (!allowedExternalHosts.has(parsed.hostname)) return false;
    return ["/about/", "/solutions/", "/contact/"].includes(route);
  } catch {
    return false;
  }
}

async function inspectRoute(browser, route) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  const failedRequests = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (["error", "warning"].includes(message.type())) errors.push(`${message.type()}: ${message.text()}`);
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.includes("/cdn-cgi/rum")) failedRequests.push(url);
  });

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
    const response = await page.goto(result.url, { waitUntil: "networkidle", timeout: 90_000 });
    result.status = response?.status() || 0;
    await page.waitForTimeout(1000);
    const snapshot = await page.evaluate(() => {
      const anchors = [...document.querySelectorAll("a[href]")].map((anchor) => ({
        text: (anchor.textContent || anchor.getAttribute("aria-label") || "").trim().replace(/\s+/g, " ").slice(0, 80),
        href: anchor.href,
        raw: anchor.getAttribute("href") || "",
        target: anchor.getAttribute("target") || "",
        record: anchor.getAttribute("data-record-link") || "",
        sourceHref: anchor.getAttribute("data-source-href") || "",
        sourceState: anchor.getAttribute("data-source-state") || "",
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
      return rawRecord && !approvedHandoff;
    });
    result.raw_source_attrs = snapshot.anchors.filter((anchor) => isRawSwfiRecordUrl(anchor.sourceHref) && !isCanonicalSwfiHandoffUrl(anchor.sourceHref));
    result.blank_target_legacy_anchors = snapshot.anchors.filter((anchor) => anchor.target === "_blank" && (isRawSwfiRecordUrl(anchor.href) || isRawSwfiRecordUrl(anchor.raw) || /swfi\.com/i.test(anchor.href)));
    result.forbidden_text = forbiddenUserText.filter((text) => snapshot.bodyText?.includes(text));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
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
  const browser = await chromium.launch({ headless: true });
  const results = [];
  try {
    for (const route of routes) {
      results.push(await inspectRoute(browser, route));
    }
  } finally {
    await browser.close().catch(() => {});
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
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
