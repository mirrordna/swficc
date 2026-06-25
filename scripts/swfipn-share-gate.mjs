#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-share-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const maxReceiptAgeMs = Number(process.env.SWFIPN_SHARE_MAX_RECEIPT_AGE_MS || 2 * 60 * 60 * 1000);
const requiredReceipts = [
  "swfipn-product-truth-audit-latest.json",
  "swfipn-doctrine-gate-latest.json",
  "swfipn-source-truth-gate-latest.json",
  "swfipn-record-manifest-scan-latest.json",
  "swfipn-record-mirror-gate-latest.json",
  "swfipn-table-controls-proof-latest.json",
  "swfipn-visual-gate-latest.json",
  "swfipn-kp-acceptance-gate-latest.json",
  "swfipn-e2e-gate-latest.json",
  "swfipn-runtime-staleness-gate-latest.json",
  "swfipn-route-ledger-gate-latest.json",
  "swfipn-data-validation-gate-latest.json",
  "swfipn-ml-loop-registry-latest.json",
];
const requiredScreenshots = [
  "swfipn-visual-desktop-top.png",
  "swfipn-visual-desktop-visuals.png",
  "swfipn-visual-mobile-full.png",
];
const forbiddenVisible = [
  "Endpoint:",
  "Source-backed fact",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Mongo Record ID",
  "Runtime Source",
  "SWFIPN source detail",
  "Source packet:",
  "No internal record mapping",
  "citation-only",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function readJsonReceipt(file) {
  const absolute = path.join(outputDir, file);
  if (!fs.existsSync(absolute)) return { file, ok: false, failures: ["missing_receipt"] };
  try {
    const stat = fs.statSync(absolute);
    const body = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const ageMs = Date.now() - stat.mtimeMs;
    const status = body.status || "";
    const failures = [];
    if (!["pass", "pass_with_quarantine", "complete"].includes(status)) failures.push(`status_${status || "missing"}`);
    if (ageMs > maxReceiptAgeMs) failures.push(`stale_${Math.round(ageMs / 1000)}s`);
    return {
      file,
      ok: failures.length === 0,
      status,
      caveat: status === "pass_with_quarantine" ? {
        total_unreadable_delta: body.total_unreadable_delta || 0,
        data_quality_caveats: body.data_quality_caveats || [],
      } : null,
      mtime: stat.mtime.toISOString(),
      age_ms: Math.round(ageMs),
      summary: body.summary,
      failures,
    };
  } catch (error) {
    return { file, ok: false, failures: [`unreadable:${error.message}`] };
  }
}

function readScreenshot(file) {
  const absolute = path.join(outputDir, file);
  if (!fs.existsSync(absolute)) return { file, ok: false, failures: ["missing_screenshot"] };
  const stat = fs.statSync(absolute);
  const ageMs = Date.now() - stat.mtimeMs;
  const failures = [];
  if (stat.size < 20_000) failures.push(`screenshot_too_small:${stat.size}`);
  if (ageMs > maxReceiptAgeMs) failures.push(`stale_${Math.round(ageMs / 1000)}s`);
  return {
    file,
    ok: failures.length === 0,
    mtime: stat.mtime.toISOString(),
    age_ms: Math.round(ageMs),
    size: stat.size,
    failures,
  };
}

async function renderedPublicCheck() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { ok: true, url: origin, final_url: "", status: null, failures: [], counts: {} };
  try {
    const response = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
    result.status = response?.status() || null;
    result.final_url = page.url();
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    if (!result.final_url.startsWith(origin.replace(/\/$/, ""))) result.failures.push(`wrong_final_url:${result.final_url}`);
    const body = await waitForBody(page, ["SWFI", "KPI CARDS", "Data source: SWFI records", "Top Active Allocators", "Newest Transactions"], 90_000);
    for (const text of forbiddenVisible) {
      if (body.includes(text)) result.failures.push(`forbidden_visible:${text}`);
    }
    result.counts.showing = (body.match(/Showing [^\n]+/g) || []).slice(0, 8);
    result.counts.source_links = await page.locator('[data-source-state="on-file"], [data-source-path]').count();
    result.counts.detail_links = await page.locator('a[href*="/detail/"], a[data-dashboard-target*="/detail/"]').count();
    result.counts.mirror_record_links = await page.locator([
      'a[href*="/swficc/profiles/detail/"]',
      'a[href*="/swficc/transactions/detail/"]',
      'a[href*="/swficc/mandates/detail/"]',
      'a[href*="/swficc/people/detail/"]',
      'a[href*="/swficc/research/detail/"]',
      'a[data-dashboard-target*="/profiles/detail/"]',
      'a[data-dashboard-target*="/transactions/detail/"]',
      'a[data-dashboard-target*="/mandates/detail/"]',
      'a[data-dashboard-target*="/people/detail/"]',
      'a[data-dashboard-target*="/research/detail/"]',
    ].join(", ")).count();
    result.counts.external_swfi_links = await page.locator('a[href^="https://www.swfi.com"], a[href^="https://swfi.com"], a[href^="http://www.swfi.com"], a[href^="http://swfi.com"]').count();
    if (result.counts.source_links < 8) result.failures.push(`source_links_${result.counts.source_links}_lt_8`);
    if (result.counts.mirror_record_links < 8) result.failures.push(`mirror_record_links_${result.counts.mirror_record_links}_lt_8`);
    if (result.counts.external_swfi_links > 0) result.failures.push(`external_swfi_links_${result.counts.external_swfi_links}_gt_0`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function waitForBody(page, required, timeout) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    if (required.every((item) => lower.includes(item.toLowerCase())) && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipts = requiredReceipts.map(readJsonReceipt);
  const screenshots = requiredScreenshots.map(readScreenshot);
  const public_render = await renderedPublicCheck();
  const failures = [
    ...receipts.filter((item) => !item.ok).map((item) => ({ type: "receipt", file: item.file, failures: item.failures })),
    ...screenshots.filter((item) => !item.ok).map((item) => ({ type: "screenshot", file: item.file, failures: item.failures })),
    ...(public_render.ok ? [] : [{ type: "public_render", failures: public_render.failures }]),
  ];
  const receipt = {
    schema_version: "swfipn.share_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      receipts: receipts.length,
      screenshots: screenshots.length,
      failures: failures.length,
      source_links: public_render.counts.source_links || 0,
      detail_links: public_render.counts.detail_links || 0,
      mirror_record_links: public_render.counts.mirror_record_links || 0,
      external_swfi_links: public_render.counts.external_swfi_links || 0,
    },
    sendable: failures.length === 0,
    share_url: origin,
    receipts,
    screenshots,
    public_render,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    sendable: receipt.sendable,
    share_url: receipt.share_url,
    summary: receipt.summary,
    receipt: receiptPath,
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
