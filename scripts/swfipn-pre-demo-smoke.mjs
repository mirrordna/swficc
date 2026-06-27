#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-pre-demo-smoke-latest.json");

const origin = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/").replace(/\/$/, "") + "/";
const originUrl = new URL(origin);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || originUrl.origin).replace(/\/$/, "");

const PAGE_TIMEOUT_MS = 30_000;
const RENDER_WAIT_MS = 20_000;
const VIEWPORT = { width: 1440, height: 960 };

const GENERIC_HEADINGS = new Set([
  "person detail", "profile detail", "transaction detail",
  "mandate detail", "deal detail", "entity detail",
  "research detail", "report detail", "research / news detail",
  "compass / rfp detail", "compass detail", "rfp detail",
  "transaction details", "entity profile",
  "deal / transaction detail", "transaction / deal detail",
  "people detail", "investor detail", "allocator detail",
  "institution detail", "loading", "",
]);

const LEAKAGE_PATTERNS = [
  /\bActive Mirror\b/i, /\bObject\s*_?ID\b/i, /\bMongo(?:DB)?\b/i,
  /\bBackend ID\b/i, /\bEndpoint:/i, /\bschema_version\b/i,
  /\bsource_gap(?:_reason)?\b/i, /\bSource gap\b/i, /\bresult_qualifier\b/i,
  /\bsource_doc(?:_id|_ids|_count)?\b/i, /\bsource_collection\b/i,
  /\bservice token\b/i, /\bSWFIPN_BACKEND\b/i, /\bSWFI2_API_TOKEN\b/i,
  /\bNo internal record mapping\b/i, /\bundefined\b/i, /\bnull\b/i,
];

const DEMO_ROUTES = [
  { label: "Home", path: "/" },
  { label: "Profiles list", path: "/profiles/" },
  { label: "People list", path: "/people/" },
  { label: "Transactions list", path: "/transactions/" },
  { label: "Mandates list", path: "/mandates/" },
  { label: "Research list", path: "/research/" },
  { label: "Reports list", path: "/reports/" },
  { label: "Search", path: "/search/?q=Real%20Estate" },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function fetchJson(url, timeoutMs = 15_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = null; }
    return { status: res.status, json };
  } catch (e) {
    return { status: 0, json: null, error: e.message };
  } finally { clearTimeout(timeout); }
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const started = Date.now();
  const results = { checks: [], passed: 0, failed: 0, warnings: [] };

  // 1. Backend health (scan endpoint as canary)
  console.error("[smoke] Checking backend health...");
  const dashRes = await fetchJson(`${backendOrigin}/api/source-data/scan/v1?collection=entities&limit=1`);
  const rowCount = dashRes.json?.data?.rows?.length || 0;
  const healthCheck = { name: "Backend health", status: dashRes.status === 200 && rowCount > 0 ? "PASS" : "FAIL", detail: `HTTP ${dashRes.status}, rows=${rowCount}` };
  if (dashRes.status !== 200) healthCheck.detail += ` — backend may be down, demo will show empty pages`;
  results.checks.push(healthCheck);

  // 2. API endpoint spot-check (one per collection)
  console.error("[smoke] Checking API endpoints...");
  const apiChecks = [
    { name: "Profiles API", url: `${backendOrigin}/api/source-data/scan/v1?collection=entities&limit=1` },
    { name: "People API", url: `${backendOrigin}/api/source-data/scan/v1?collection=people&limit=1` },
    { name: "Transactions API", url: `${backendOrigin}/api/source-data/scan/v1?collection=transactions&limit=1` },
    { name: "Compass API", url: `${backendOrigin}/api/source-data/scan/v1?collection=compass&limit=1` },
    { name: "News API", url: `${backendOrigin}/api/source-data/scan/v1?collection=news&limit=1` },
  ];
  for (const check of apiChecks) {
    const res = await fetchJson(check.url);
    const rowCount = res.json?.data?.rows?.length || 0;
    results.checks.push({
      name: check.name,
      status: res.status === 200 && rowCount > 0 ? "PASS" : "FAIL",
      detail: `HTTP ${res.status}, rows=${rowCount}`,
    });
  }

  // 3. Playwright: load each demo route, check render + leakage + timing
  console.error("[smoke] Launching browser for page checks...");
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, timeout: 30_000 });
  const page = await browser.newPage({ viewport: VIEWPORT });

  for (const route of DEMO_ROUTES) {
    console.error(`[smoke]   ${route.label} (${route.path})`);
    const url = appUrl(route.path);
    const check = { name: `Page: ${route.label}`, status: "PASS", detail: "", load_ms: 0, leakage: [] };
    const t0 = Date.now();
    try {
      const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      check.detail = `HTTP ${response?.status() || 0}`;
      if ((response?.status() || 0) >= 400) { check.status = "FAIL"; check.detail += " — page error"; }

      await page.waitForFunction(() => {
        const body = document.body?.innerText || "";
        return body.trim().length > 100 && !/^\s*Loading/i.test(body.trim());
      }, null, { timeout: 15_000 }).catch(() => null);

      check.load_ms = Date.now() - t0;
      if (check.load_ms > 5000) results.warnings.push(`${route.label} took ${check.load_ms}ms to render — may feel slow in demo`);

      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      for (const pattern of LEAKAGE_PATTERNS) {
        const match = bodyText.match(pattern);
        if (match) check.leakage.push(match[0]);
      }
      if (check.leakage.length) {
        check.status = "FAIL";
        check.detail += ` — leakage: ${check.leakage.join(", ")}`;
      }
    } catch (e) {
      check.status = "FAIL";
      check.detail = e.message.slice(0, 100);
      check.load_ms = Date.now() - t0;
    }
    results.checks.push(check);
  }

  // 4. Click into first detail record from profiles and transactions lists
  console.error("[smoke] Checking detail page render...");
  const detailTests = [
    { section: "Profiles", listPath: "/profiles/", apiBase: "/api/profiles/" },
    { section: "Transactions", listPath: "/transactions/", apiBase: "/api/transactions/" },
    { section: "People", listPath: "/people/", apiBase: "/api/people/" },
    { section: "Mandates", listPath: "/mandates/", apiBase: "/api/compass/" },
  ];

  for (const dt of detailTests) {
    console.error(`[smoke]   ${dt.section} detail page...`);
    const check = { name: `Detail: ${dt.section}`, status: "PASS", detail: "", load_ms: 0, record_name: "" };
    try {
      await page.goto(appUrl(dt.listPath), { waitUntil: "domcontentloaded", timeout: PAGE_TIMEOUT_MS });
      await page.waitForFunction(() => {
        const rows = document.querySelectorAll("table tbody tr, [class*='row'], [class*='Row']");
        return rows.length > 0;
      }, null, { timeout: 20_000 }).catch(() => null);
      await page.waitForTimeout(2_000);

      const selectors = [
        'a[data-source-state="on-file"]',
        `a[href*="/detail/"]`,
        `a[href*="/detail?"]`,
        'table tbody tr a[href]',
        'table a[href]',
      ];
      let clicked = false;
      for (const sel of selectors) {
        const link = page.locator(sel).first();
        const visible = await link.isVisible({ timeout: 2_000 }).catch(() => false);
        if (visible) {
          const clickLabel = await link.innerText({ timeout: 3_000 }).catch(() => "");
          check.detail = `clicked: "${clickLabel.trim().slice(0, 40)}"`;
          await link.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) { check.status = "WARN"; check.detail = "no detail links found on list page"; results.checks.push(check); continue; }

      await page.waitForURL(/detail/, { timeout: 10_000 }).catch(() => null);
      const t0 = Date.now();

      const genericSet = [...GENERIC_HEADINGS];
      await page.waitForFunction((generics) => {
        const h1 = document.querySelector("h1");
        if (!h1) return document.body?.innerText?.trim().length > 200;
        const h1Text = (h1.textContent || "").trim().toLowerCase();
        return !generics.includes(h1Text);
      }, genericSet, { timeout: RENDER_WAIT_MS }).catch(() => null);

      check.load_ms = Date.now() - t0;
      const h1 = await page.locator("h1").first().innerText({ timeout: 5_000 }).catch(() => "");
      check.record_name = h1.trim().replace(/\s+/g, " ");

      if (GENERIC_HEADINGS.has(check.record_name.toLowerCase())) {
        check.status = "FAIL";
        check.detail += ` — heading still generic after ${RENDER_WAIT_MS}ms: "${check.record_name}"`;
      } else {
        check.detail += ` → rendered: "${check.record_name.slice(0, 40)}"`;
      }

      if (check.load_ms > 5000) results.warnings.push(`${dt.section} detail took ${check.load_ms}ms to show record name`);

      const bodyText = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
      for (const pattern of LEAKAGE_PATTERNS) {
        if (bodyText.match(pattern)) { check.status = "FAIL"; check.detail += ` — leakage on detail page`; break; }
      }

      // API cross-check
      const urlParams = new URL(page.url()).searchParams;
      const recordId = urlParams.get("id") || "";
      if (/^[a-f0-9]{24}$/i.test(recordId)) {
        const apiRes = await fetchJson(`${backendOrigin}${dt.apiBase}${recordId}/v1`);
        if (apiRes.status >= 400) {
          check.status = "FAIL";
          check.detail += ` — API returned ${apiRes.status} for ${recordId}`;
        }
      }
    } catch (e) {
      check.status = "FAIL";
      check.detail = e.message.slice(0, 100);
    }
    results.checks.push(check);
  }

  await page.close().catch(() => {});
  await browser.close().catch(() => {});

  // 5. Tally
  for (const c of results.checks) {
    if (c.status === "PASS") results.passed++;
    else if (c.status === "FAIL") results.failed++;
  }

  const receipt = {
    schema_version: "swfipn.pre_demo_smoke.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    status: results.failed === 0 ? "READY" : "NOT_READY",
    summary: { total: results.checks.length, passed: results.passed, failed: results.failed, warnings: results.warnings.length },
    warnings: results.warnings,
    checks: results.checks,
    elapsed_ms: Date.now() - started,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);

  // Console output
  console.log("");
  console.log(receipt.status === "READY" ? "✅ DEMO READY" : "❌ NOT READY FOR DEMO");
  console.log("");
  const maxName = Math.max(...results.checks.map((c) => c.name.length));
  for (const c of results.checks) {
    const icon = c.status === "PASS" ? "✓" : c.status === "WARN" ? "⚠" : "✗";
    const ms = c.load_ms ? ` (${c.load_ms}ms)` : "";
    console.log(`  ${icon} ${c.name.padEnd(maxName + 2)} ${c.detail}${ms}`);
  }
  if (results.warnings.length) {
    console.log("");
    console.log("Warnings:");
    for (const w of results.warnings) console.log(`  ⚠ ${w}`);
  }
  console.log("");
  console.log(`${results.checks.length} checks, ${results.passed} passed, ${results.failed} failed | ${Date.now() - started}ms`);

  process.exit(results.failed === 0 ? 0 : 1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
