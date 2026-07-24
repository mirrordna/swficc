#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-route-parity-full-latest.json");
const markdownPath = path.join(outputDir, "swfipn-route-parity-full-latest.md");
const screenshotDir = path.join(outputDir, "screenshots", "route-parity");

const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/");
const originUrl = new URL(origin);
const basePath = originUrl.pathname.replace(/\/$/, "");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || originUrl.origin).replace(/\/$/, "");
const serviceToken = String(process.env.SWFIPN_BACKEND_TOKEN || process.env.SWFI2_API_TOKEN || "").trim();

const MAX_LINKS = Number(process.env.SWFIPN_ROUTE_PARITY_MAX_LINKS || 500);
const MOBILE_SAMPLE = Number(process.env.SWFIPN_ROUTE_PARITY_MOBILE_SAMPLE || 0);
const PAGE_TIMEOUT_MS = 30_000;
const DETAIL_READY_TIMEOUT_MS = Number(process.env.SWFIPN_ROUTE_PARITY_DETAIL_READY_TIMEOUT_MS || 5_000);
const DETAIL_LINK_TIMEOUT_MS = Number(process.env.SWFIPN_ROUTE_PARITY_LINK_TIMEOUT_MS || 45_000);
const OVERALL_TIMEOUT_MS = Number(process.env.SWFIPN_ROUTE_PARITY_OVERALL_TIMEOUT_MS || 20 * 60 * 1000);
const VIEWPORT_DESKTOP = { width: 1440, height: 960 };
const VIEWPORT_MOBILE = { width: 375, height: 812 };

const GENERIC_HEADINGS = new Set([
  "person detail", "profile detail", "transaction detail",
  "mandate detail", "deal detail", "entity detail",
  "research detail", "report detail", "research / news detail",
  "compass / rfp detail", "compass detail", "rfp detail",
  "deal / transaction detail", "transaction / deal detail",
  "transaction details", "entity profile",
  "people detail", "investor detail", "allocator detail",
  "institution detail", "loading", "",
]);

const NON_LABEL_TEXTS = new Set([
  "source on file", "view", "details", "more", "see more",
  "read more", "learn more", "click here", "link", "open",
]);

const SEED_ROUTES = [
  "/",
  "/profiles/",
  "/people/",
  "/transactions/",
  "/deals/",
  "/allocators/",
  "/mandates/",
  "/reports/",
  "/intelligence/",
  "/research/",
  "/search/?q=Real%20Estate",
  "/comparisons/",
  "/about/",
  "/about-us/overview/",
  "/about-us/our-team/",
  "/solutions/",
  "/demo/",
  "/contact/",
];

const LEAKAGE_PATTERNS = [
  /\bActive Mirror\b/i,
  /\bObject\s*_?ID\b/i,
  /\bMongo(?:DB)?\b/i,
  /\bBackend ID\b/i,
  /\bEndpoint:/i,
  /\bschema_version\b/i,
  /\bsource_gap(?:_reason)?\b/i,
  /\bSource gap\b/i,
  /\bresult_qualifier\b/i,
  /\bsource_doc(?:_id|_ids|_count)?\b/i,
  /\bsource_collection\b/i,
  /\bservice token\b/i,
  /\bSWFIPN_BACKEND\b/i,
  /\bSWFI2_API_TOKEN\b/i,
  /\bNo internal record mapping\b/i,
  /\bcitation-only\b/i,
  /\bSourceVault\b/i,
  /\bWrite Barrier\b/i,
  /\bClaimLedger\b/i,
  /\bParser status\b/i,
  /\bCapture ID\b/i,
];

const DETAIL_KIND_MAP = {
  "/profiles/detail/": { kind: "profile", collection: "entities", apiTemplate: (id) => `/api/profiles/${id}/v1`, nameFields: ["name", "institution", "legal_name"] },
  "/transactions/detail/": { kind: "transaction", collection: "transactions", apiTemplate: (id) => `/api/transactions/${id}/v1`, nameFields: ["title", "name"] },
  "/mandates/detail/": { kind: "mandate", collection: "compass", apiTemplate: (id) => `/api/compass/${id}/v1`, nameFields: ["title", "name"] },
  "/people/detail/": { kind: "person", collection: "people", apiTemplate: (id) => `/api/people/${id}/v1`, nameFields: ["name", "title"] },
  "/research/detail/": { kind: "research", collection: "news", apiTemplate: null, nameFields: ["title", "name"] },
  "/reports/detail/": { kind: "report", collection: "reports", apiTemplate: null, nameFields: ["title", "name"] },
};

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function launchBrowser(chromium) {
  return chromium.launch({ channel: "chrome", headless: true, timeout: 30_000 });
}

async function fetchJson(url, timeoutMs = 45_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "SWFIPN-RouteParityGate/1.0",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}`, "X-SWFIPN-Internal": "1" } : {}),
      },
    });
    const text = await response.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 500) }; }
    return { status: response.status, json };
  } catch (error) {
    return { status: 0, json: null, error: error.message };
  } finally {
    clearTimeout(timeout);
  }
}

function sanitizeFilename(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "").slice(0, 80);
}

function classifyDetailPath(pathname) {
  const appPath = pathname.startsWith(basePath) ? pathname.slice(basePath.length) : pathname;
  for (const [prefix, config] of Object.entries(DETAIL_KIND_MAP)) {
    if (appPath.startsWith(prefix) || appPath.replace(/\/?$/, "/").startsWith(prefix)) return { ...config, detailPath: prefix };
  }
  return null;
}

function extractRecordId(url) {
  try {
    const parsed = new URL(url);
    const id = parsed.searchParams.get("id") || "";
    if (/^[a-f0-9]{24}$/i.test(id)) return id;
    return "";
  } catch { return ""; }
}

async function discoverAnchors(page) {
  return page.evaluate(({ basePath: bp, originHost }) => {
    return [...document.querySelectorAll("a[href]")].map((a, i) => {
      const rect = a.getBoundingClientRect();
      const style = window.getComputedStyle(a);
      const visible = rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden" && parseFloat(style.opacity) > 0;
      const text = (a.textContent || "").trim().replace(/\s+/g, " ").slice(0, 200);
      const href = a.href;
      const raw = a.getAttribute("href") || "";
      const sourceState = a.getAttribute("data-source-state") || "";
      let family = "unknown";
      let kind = "";
      try {
        const parsed = new URL(href);
        if (parsed.hostname === originHost && parsed.pathname.startsWith(bp || "/")) {
          const appPath = parsed.pathname.slice((bp || "").length) || "/";
          if (/^\/profiles\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "profile"; }
          else if (/^\/transactions\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "transaction"; }
          else if (/^\/mandates\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "mandate"; }
          else if (/^\/people\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "person"; }
          else if (/^\/research\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "research"; }
          else if (/^\/reports\/detail\/?/i.test(appPath)) { family = "internal_detail"; kind = "report"; }
          else family = "internal_section";
        } else if (["www.swfi.com", "swfi.com"].includes(parsed.hostname) && parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/" && parsed.searchParams.get("msg") === "auth") {
          family = "swfi_auth_handoff";
          const redirect = parsed.searchParams.get("redirect") || "";
          if (/^\/v1\/entities\//i.test(redirect)) kind = "profile";
          else if (/^\/v1\/people\//i.test(redirect)) kind = "person";
          else if (/^\/v1\/transactions\//i.test(redirect)) kind = "transaction";
          else if (/^\/v1\/compass\//i.test(redirect)) kind = "mandate";
        } else if (["mailto:", "tel:"].includes(parsed.protocol)) {
          family = "contact";
        } else {
          family = "external";
        }
      } catch { family = "invalid"; }
      return { domIndex: i, text, href, raw, visible, sourceState, family, kind };
    }).filter((a) => a.visible);
  }, { basePath, originHost: originUrl.hostname });
}

function leakageCheck(bodyText) {
  const failures = [];
  for (const pattern of LEAKAGE_PATTERNS) {
    const match = bodyText.match(pattern);
    if (match) failures.push(`visible_leakage:${match[0]}`);
  }
  const textWithoutUrls = bodyText.replace(/https?:\/\/\S+/g, "").replace(/[?&][a-z_]+=\S+/gi, "");
  const hexIds = textWithoutUrls.match(/\b[a-f0-9]{24}\b/gi) || [];
  if (hexIds.length > 0) failures.push(`object_id_as_label:${hexIds.slice(0, 3).join(",")}`);
  return [...new Set(failures)];
}

async function verifyRecordAgainstApi(detailUrl, renderedBodyText) {
  const result = { endpoint: null, api_status: null, api_name: null, match: null, failure: null };
  const config = classifyDetailPath(new URL(detailUrl).pathname);
  if (!config || !config.apiTemplate) return result;
  const id = extractRecordId(detailUrl);
  if (!id) return result;
  const apiEndpoint = `${backendOrigin}${config.apiTemplate(id)}`;
  result.endpoint = apiEndpoint;
  const { status, json } = await fetchJson(apiEndpoint, 15_000);
  result.api_status = status;
  if (status >= 400) { result.failure = `api_http_${status}`; return result; }
  const data = json?.data || {};
  const record = data.profile || data.record || data.person || data.transaction || data.mandate || data;
  let apiName = "";
  for (const field of config.nameFields) {
    const val = record?.[field];
    if (val && typeof val === "string" && val.trim()) { apiName = val.trim(); break; }
  }
  result.api_name = apiName;
  if (apiName && !renderedBodyText.toLowerCase().includes(apiName.toLowerCase().slice(0, 50))) {
    result.match = false;
    result.failure = `api_name_not_rendered:api="${apiName}"`;
  } else if (apiName) {
    result.match = true;
  }
  return result;
}

async function verifyDetailPage(page, link, viewport, screenshotCounter) {
  const finding = {
    status: "PASS",
    source_page: link.sourceRoute,
    click_label: link.text,
    expected_type: link.kind,
    expected_id: "",
    expected_source_url: "",
    actual_url: "",
    actual_record_name: "",
    reason: "",
    redirect_chain: [],
    screenshot: null,
    viewport,
    http_status: null,
    failures: [],
    api_verification: null,
    elapsed_ms: 0,
  };
  const started = Date.now();
  const redirectChain = [];
  const onResponse = (response) => {
    if (response.request().isNavigationRequest()) {
      redirectChain.push({ status: response.status(), url: response.url() });
    }
  };
  page.on("response", onResponse);
  try {
    const response = await page.goto(link.href, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
    finding.http_status = response?.status() || 0;
    finding.actual_url = page.url();
    finding.redirect_chain = redirectChain;

    if (finding.http_status >= 400) finding.failures.push(`http_${finding.http_status}`);

    const finalUrl = new URL(finding.actual_url);

    if (["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(finalUrl.hostname)) {
      const isAuthHandoff = finalUrl.pathname.replace(/\/?$/, "/") === "/v1/signin/" && finalUrl.searchParams.get("msg") === "auth";
      if (!isAuthHandoff) finding.failures.push(`redirect_to_swfi:${finding.actual_url}`);
    }

    const finalAppPath = finalUrl.pathname.replace(/\/?$/, "/");
    if (finalAppPath === `${basePath}/` && link.kind) {
      finding.failures.push("redirect_to_root");
    }
    for (const listRoute of ["/profiles/", "/people/", "/transactions/", "/mandates/", "/research/"]) {
      if (finalAppPath === `${basePath}${listRoute}` && link.detailPath?.startsWith(listRoute)) {
        finding.failures.push(`redirect_to_list:${listRoute}`);
      }
    }

    if (finding.actual_url.includes("/swficc/swficc/")) {
      finding.failures.push("double_base_path");
    }

    const genericSet = [...GENERIC_HEADINGS];
    await page.waitForFunction((generics) => {
      const body = document.body?.innerText || "";
      if (body.trim().length < 100 || /^\s*Loading/i.test(body.trim())) return false;
      const h1 = document.querySelector("h1");
      if (!h1) return body.trim().length > 200;
      const h1Text = (h1.textContent || "").trim().toLowerCase();
      if (generics.includes(h1Text)) return false;
      return true;
    }, genericSet, { timeout: DETAIL_READY_TIMEOUT_MS }).catch(() => null);

    const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    const h1Text = await page.locator("h1").first().innerText({ timeout: 5_000 }).catch(() => "");
    finding.actual_record_name = h1Text.trim().replace(/\s+/g, " ");

    const normalizedLabel = (link.text || "").trim().replace(/\s+/g, " ");
    const normalizedH1 = finding.actual_record_name;
    const isGenericLabel = NON_LABEL_TEXTS.has(normalizedLabel.toLowerCase());
    const isGenericH1 = GENERIC_HEADINGS.has(normalizedH1.toLowerCase());
    if (normalizedLabel && normalizedH1 && normalizedLabel.length > 2 && !isGenericLabel) {
      if (isGenericH1) {
        finding.failures.push(`heading_still_generic:rendered="${normalizedH1.slice(0, 60)}"`);
      } else {
        const labelSlice = normalizedLabel.toLowerCase().slice(0, 50);
        const h1Lower = normalizedH1.toLowerCase();
        const bodyLower = bodyText.toLowerCase();
        const labelMatch = h1Lower.includes(labelSlice) || labelSlice.includes(h1Lower.slice(0, 50)) || bodyLower.includes(labelSlice);
        if (!labelMatch) {
          finding.failures.push(`label_mismatch:clicked="${normalizedLabel.slice(0, 60)}"|rendered="${normalizedH1.slice(0, 60)}"`);
        }
      }
    }

    const leaks = leakageCheck(bodyText);
    for (const leak of leaks) finding.failures.push(leak);

    finding.expected_id = extractRecordId(finding.actual_url);
    const config = classifyDetailPath(finalUrl.pathname);
    if (config && finding.expected_id) {
      finding.expected_source_url = `https://www.swfi.com/v1/${config.collection}/${finding.expected_id}`;
    }

    const apiResult = await verifyRecordAgainstApi(finding.actual_url, bodyText);
    finding.api_verification = apiResult;
    if (apiResult.failure) finding.failures.push(apiResult.failure);

    if (finding.failures.length) {
      finding.status = "FAIL";
      finding.reason = finding.failures.join("; ");
      const screenshotFile = path.join(screenshotDir, `fail-${String(screenshotCounter.value++).padStart(3, "0")}-${sanitizeFilename(link.kind)}-${sanitizeFilename(finding.expected_id || link.text.slice(0, 20))}.png`);
      await page.screenshot({ path: screenshotFile, fullPage: true }).catch(() => null);
      finding.screenshot = screenshotFile;
    }
  } catch (error) {
    finding.status = "BLOCKED";
    finding.reason = error.message;
    finding.failures.push(`navigation_error:${error.message.slice(0, 200)}`);
    const screenshotFile = path.join(screenshotDir, `blocked-${String(screenshotCounter.value++).padStart(3, "0")}-${sanitizeFilename(link.kind)}.png`);
    await page.screenshot({ path: screenshotFile, fullPage: true }).catch(() => null);
    finding.screenshot = screenshotFile;
  } finally {
    page.off("response", onResponse);
  }
  finding.elapsed_ms = Date.now() - started;
  return finding;
}

function timeoutFinding(link, viewport, elapsedMs) {
  return {
    status: "BLOCKED",
    source_page: link.sourceRoute,
    click_label: link.text,
    expected_type: link.kind,
    expected_id: extractRecordId(link.href),
    expected_source_url: "",
    actual_url: link.href,
    actual_record_name: "",
    reason: `detail_link_timeout:${elapsedMs}ms`,
    redirect_chain: [],
    screenshot: null,
    viewport,
    http_status: null,
    failures: [`detail_link_timeout:${elapsedMs}ms`],
    api_verification: null,
    elapsed_ms: elapsedMs,
  };
}

async function verifyDetailPageWithWatchdog(page, link, viewport, screenshotCounter) {
  const started = Date.now();
  let timeout;
  const watchdog = new Promise((resolve) => {
    timeout = setTimeout(async () => {
      await page?.close?.().catch(() => {});
      resolve(timeoutFinding(link, viewport, Date.now() - started));
    }, DETAIL_LINK_TIMEOUT_MS);
  });
  try {
    return await Promise.race([
      verifyDetailPage(page, link, viewport, screenshotCounter),
      watchdog,
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function deduplicateRootCauses(findings) {
  const roots = new Map();
  for (const f of findings) {
    for (const failure of f.failures) {
      const root = failure
        .replace(/[a-f0-9]{24}/gi, "{id}")
        .replace(/https?:\/\/\S+/g, "{url}")
        .replace(/clicked="[^"]*"/g, 'clicked="{label}"')
        .replace(/rendered="[^"]*"/g, 'rendered="{label}"')
        .replace(/api="[^"]*"/g, 'api="{name}"');
      if (!roots.has(root)) roots.set(root, { count: 0, samples: [] });
      const entry = roots.get(root);
      entry.count += 1;
      if (entry.samples.length < 5) entry.samples.push({ url: f.actual_url || f.url, failure, label: f.click_label });
    }
  }
  return Object.fromEntries(roots);
}

async function exerciseInteractions(page) {
  const extra = [];
  try {
    const filterInput = page.locator('input[placeholder*="Filter"]').first();
    if (await filterInput.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await filterInput.fill("a");
      await page.waitForTimeout(500);
      const filtered = await discoverAnchors(page);
      extra.push(...filtered.filter((a) => a.family === "internal_detail" || a.family === "swfi_auth_handoff"));
      await filterInput.fill("");
      await page.waitForTimeout(300);
    }
  } catch { /* filter not available on this page */ }
  try {
    const nextBtn = page.locator('button:has-text("Next"):not([disabled])').first();
    if (await nextBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await nextBtn.click();
      await page.waitForTimeout(1_000);
      const paginated = await discoverAnchors(page);
      extra.push(...paginated.filter((a) => a.family === "internal_detail" || a.family === "swfi_auth_handoff"));
    }
  } catch { /* pagination not available */ }
  try {
    const sortBtn = page.locator("thead th button").first();
    if (await sortBtn.isVisible({ timeout: 2_000 }).catch(() => false)) {
      await sortBtn.click();
      await page.waitForTimeout(500);
      const sorted = await discoverAnchors(page);
      extra.push(...sorted.filter((a) => a.family === "internal_detail" || a.family === "swfi_auth_handoff"));
    }
  } catch { /* sorting not available */ }
  return extra;
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN Route Parity Gate",
    "",
    `**Generated**: ${receipt.generated_at}`,
    `**Status**: ${receipt.status}`,
    `**Origin**: ${receipt.origin}`,
    `**Links tested**: ${receipt.summary.links_tested}`,
    "",
    "## Summary",
    "",
    "| Metric | Value |",
    "|---|---|",
    `| Seed routes crawled | ${receipt.summary.seed_routes_crawled} |`,
    `| Detail links discovered | ${receipt.summary.detail_links_discovered} |`,
    `| Links tested | ${receipt.summary.links_tested} |`,
    `| PASS | ${receipt.summary.passed} |`,
    `| FAIL | ${receipt.summary.failed} |`,
    `| BLOCKED | ${receipt.summary.blocked} |`,
    `| Viewports | ${receipt.summary.viewports_tested.join(", ")} |`,
    `| Elapsed | ${receipt.summary.overall_elapsed_ms}ms |`,
    "",
  ];
  const rootCauses = Object.entries(receipt.deduplicated_root_causes || {});
  if (rootCauses.length) {
    lines.push("## Root Causes (deduplicated)", "", "| Root Cause | Count | Sample |", "|---|---|---|");
    for (const [root, entry] of rootCauses.slice(0, 20)) {
      lines.push(`| ${root} | ${entry.count} | ${(entry.samples[0]?.label || "").slice(0, 40)} |`);
    }
    lines.push("");
  }
  const failed = receipt.findings.filter((f) => f.status !== "PASS");
  if (failed.length) {
    lines.push("## Failed Findings (top 30)", "", "| # | Status | Label | Type | Failures |", "|---|---|---|---|---|");
    for (const [i, f] of failed.slice(0, 30).entries()) {
      lines.push(`| ${i + 1} | ${f.status} | ${(f.click_label || "").slice(0, 30)} | ${f.expected_type} | ${(f.reason || "").slice(0, 80)} |`);
    }
    lines.push("");
  }
  const screenshots = receipt.findings.filter((f) => f.screenshot).map((f) => f.screenshot);
  if (screenshots.length) {
    lines.push("## Screenshots", "");
    for (const s of screenshots.slice(0, 20)) lines.push(`- ${s}`);
    lines.push("");
  }
  if (!rootCauses.length && !failed.length) lines.push("All tested links resolve to the correct record.", "");
  return lines.join("\n") + "\n";
}

async function ensurePage(browser, viewport) {
  try {
    if (!browser?.isConnected?.()) return null;
    return await browser.newPage({ viewport });
  } catch {
    return null;
  }
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(screenshotDir, { recursive: true });
  const overallStart = Date.now();
  const { chromium } = loadPlaywright();
  let browser = await launchBrowser(chromium);
  const screenshotCounter = { value: 1 };
  const allFindings = [];
  const seedResults = [];
  const crawlQueue = [];
  const seenHrefs = new Set();

  let page;
  async function relaunchBrowser(viewport) {
    await page?.close?.().catch(() => {});
    await browser?.close?.().catch(() => {});
    page = null;
    browser = await launchBrowser(chromium);
    return ensurePage(browser, viewport);
  }

  async function ensureLivePage(viewport) {
    const livePage = await ensurePage(browser, viewport);
    if (livePage) return livePage;
    return relaunchBrowser(viewport);
  }

  try {
    // ── PHASE 1: Section crawl (desktop) ──
    console.error("[route-parity] Phase 1: Section crawl (desktop)");
    page = await browser.newPage({ viewport: VIEWPORT_DESKTOP });

    for (const route of SEED_ROUTES) {
      if (Date.now() - overallStart >= OVERALL_TIMEOUT_MS) break;
      console.error(`[route-parity] crawling ${route}`);
      const seedResult = { route, url: appUrl(route), status: 0, anchors_found: 0, detail_links: 0, leakage: [], failures: [] };
      try {
        const response = await page.goto(seedResult.url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
        seedResult.status = response?.status() || 0;
        await page.waitForFunction(() => {
          const body = document.body?.innerText || "";
          return body.trim().length > 100 && !/^\s*Loading/i.test(body.trim());
        }, null, { timeout: 15_000 }).catch(() => null);

        const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
        seedResult.leakage = leakageCheck(bodyText);

        let anchors = await discoverAnchors(page);
        seedResult.anchors_found = anchors.length;

        const extraAnchors = await exerciseInteractions(page, route);
        anchors = [...anchors, ...extraAnchors];

        const detailAnchors = anchors.filter((a) => a.family === "internal_detail" || a.family === "swfi_auth_handoff");
        seedResult.detail_links = detailAnchors.length;

        for (const anchor of detailAnchors) {
          const key = anchor.href;
          if (seenHrefs.has(key)) continue;
          seenHrefs.add(key);
          crawlQueue.push({ ...anchor, sourceRoute: route, detailPath: anchor.kind });
        }
      } catch (error) {
        seedResult.failures.push(error.message);
        page = await ensureLivePage(VIEWPORT_DESKTOP);
      }
      seedResults.push(seedResult);
    }

    // ── PHASE 2: Detail page verification (desktop) ──
    const totalToTest = Math.min(crawlQueue.length, MAX_LINKS);
    console.error(`[route-parity] Phase 2: Verifying ${totalToTest} detail links (desktop)`);
    const linksToTest = crawlQueue.slice(0, MAX_LINKS);
    for (let i = 0; i < linksToTest.length; i++) {
      if (Date.now() - overallStart >= OVERALL_TIMEOUT_MS) break;
      if (!page) page = await ensureLivePage(VIEWPORT_DESKTOP);
      if (!page) {
        allFindings.push({ status: "BLOCKED", source_page: linksToTest[i].sourceRoute, click_label: linksToTest[i].text, expected_type: linksToTest[i].kind, actual_url: linksToTest[i].href, reason: "browser_unrecoverable", failures: ["browser_unrecoverable"], redirect_chain: [], screenshot: null, viewport: "1440x960" });
        continue;
      }
      let finding = await verifyDetailPageWithWatchdog(page, linksToTest[i], "1440x960", screenshotCounter);
      if (finding.status === "BLOCKED" && /browser has been closed|Target page|ERR_ABORTED|browser_unrecoverable/i.test(finding.reason || "")) {
        await page.close().catch(() => {});
        page = await relaunchBrowser(VIEWPORT_DESKTOP);
        if (page) {
          const retryFinding = await verifyDetailPageWithWatchdog(page, linksToTest[i], "1440x960", screenshotCounter);
          retryFinding.retry_of = finding.reason;
          finding = retryFinding;
        }
      }
      allFindings.push(finding);
      if (finding.status === "BLOCKED") {
        await page.close().catch(() => {});
        page = await ensureLivePage(VIEWPORT_DESKTOP);
      }
      console.error(`[route-parity]   desktop: ${i + 1}/${totalToTest} ${finding.status}`);
      if ((i + 1) % 50 === 0) console.error(`[route-parity]   desktop: ${i + 1}/${totalToTest}`);
    }
    console.error(`[route-parity]   desktop: ${Math.min(linksToTest.length, totalToTest)}/${totalToTest}`);

    // ── PHASE 3: Mobile viewport verification ──
    const mobileSample = crawlQueue.slice(0, MOBILE_SAMPLE);
    if (mobileSample.length && Date.now() - overallStart < OVERALL_TIMEOUT_MS) {
      console.error(`[route-parity] Phase 3: Mobile verification (${mobileSample.length} links)`);
      if (page) await page.close().catch(() => {});
      page = await ensureLivePage(VIEWPORT_MOBILE);
      for (let i = 0; i < mobileSample.length; i++) {
        if (Date.now() - overallStart >= OVERALL_TIMEOUT_MS) break;
        if (!page) page = await ensureLivePage(VIEWPORT_MOBILE);
        if (!page) break;
        let finding = await verifyDetailPageWithWatchdog(page, mobileSample[i], "375x812", screenshotCounter);
        if (finding.status === "BLOCKED" && /browser has been closed|Target page|ERR_ABORTED|browser_unrecoverable/i.test(finding.reason || "")) {
          await page.close().catch(() => {});
          page = await relaunchBrowser(VIEWPORT_MOBILE);
          if (page) {
            const retryFinding = await verifyDetailPageWithWatchdog(page, mobileSample[i], "375x812", screenshotCounter);
            retryFinding.retry_of = finding.reason;
            finding = retryFinding;
          }
        }
        allFindings.push(finding);
        if (finding.status === "BLOCKED") {
          await page.close().catch(() => {});
          page = await ensureLivePage(VIEWPORT_MOBILE);
        }
      }
    }

    if (page) await page.close().catch(() => {});
  } finally {
    await browser.close().catch(() => {});
  }

  // ── PHASE 4: Output ──
  const failedFindings = allFindings.filter((f) => f.status !== "PASS");
  const expectedDesktopLinks = Math.min(crawlQueue.length, MAX_LINKS);
  const expectedTotalLinks = expectedDesktopLinks + Math.min(crawlQueue.length, MOBILE_SAMPLE);
  const incompleteFailures = [];
  if (expectedTotalLinks <= 0) {
    incompleteFailures.push("browser_route_parity_expected_count_missing:0");
  }
  if (allFindings.length < expectedTotalLinks) {
    incompleteFailures.push(`incomplete_visible_link_coverage:${allFindings.length}/${expectedTotalLinks}`);
  }
  const passCount = allFindings.filter((f) => f.status === "PASS").length;
  const failCount = allFindings.filter((f) => f.status === "FAIL").length;
  const blockedCount = allFindings.filter((f) => f.status === "BLOCKED").length;
  const rootCauses = deduplicateRootCauses(failedFindings);

  const receipt = {
    schema_version: "swfipn.route_parity_gate.v1",
    generated_at: new Date().toISOString(),
    site: origin,
    origin,
    backend_origin: backendOrigin,
    status: failedFindings.length || incompleteFailures.length ? "fail" : "pass",
    summary: {
      seed_routes_crawled: seedResults.length,
      detail_links_discovered: crawlQueue.length,
      links_tested: allFindings.length,
      expected_links_to_test: expectedTotalLinks,
      incomplete_failures: incompleteFailures,
      viewports_tested: ["1440x960", "375x812"],
      passed: passCount,
      failed: failCount,
      blocked: blockedCount,
      root_causes: Object.keys(rootCauses),
      overall_elapsed_ms: Date.now() - overallStart,
    },
    deduplicated_root_causes: incompleteFailures.length
      ? { ...rootCauses, [incompleteFailures[0]]: { count: 1, samples: [] } }
      : rootCauses,
    seed_route_results: seedResults,
    findings: allFindings,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(receipt));

  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    receipt: receiptPath,
    markdown: markdownPath,
    top_root_causes: Object.entries(rootCauses).slice(0, 10).map(([root, entry]) => ({ root, count: entry.count })),
  }, null, 2));

  process.exit(receipt.status === "pass" ? 0 : 1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ schema_version: "swfipn.route_parity_gate.v1", status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
