#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-brd-performance-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const ttiTargetMs = Number(process.env.SWFIPN_DASHBOARD_TTI_TARGET_MS || 2000);
const dataTargetMs = Number(process.env.SWFIPN_DASHBOARD_DATA_TARGET_MS || 500);
const criticalApi = [
  "/api/swfi/dashboard-metrics/v1",
  "/api/source-data/search/v1?collection=entities",
  "/api/source-data/search/v1?collection=people",
  "/api/recent-transactions/v1",
  "/api/live-opportunities/v1",
  "/api/source-intelligence/news/v1",
  "/api/sector-flows/v1"
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const starts = new Map();
  const apiResponses = [];

  page.on("request", (request) => starts.set(request, Date.now()));
  page.on("response", (response) => {
    const url = response.url();
    if (!criticalApi.some((needle) => url.includes(needle))) return;
    const started = starts.get(response.request()) || Date.now();
    apiResponses.push({
      url,
      status: response.status(),
      duration_ms: Date.now() - started
    });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const started = Date.now();
  await page.goto(origin, { waitUntil: "commit", timeout: 120_000 });
  const committedMs = Date.now() - started;
  await page.waitForLoadState("domcontentloaded", { timeout: 120_000 });
  const domContentLoadedMs = Date.now() - started;
  await page.waitForSelector("text=Capital by Country", { timeout: 120_000 });
  const overviewVisibleMs = Date.now() - started;
  await page.waitForSelector("text=Recent Activity", { timeout: 120_000 });
  const newestDataMs = Date.now() - started;
  await page.waitForSelector("text=Top 10", { timeout: 120_000 });
  const topTenMs = Date.now() - started;
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    const sourceBackedLink = document.querySelector('a[data-source-state="on-file"], a[data-record-link="true"]');
    return /Latest Intelligence|Most Referenced|Topics/.test(text)
      && /Recent Activity/.test(text)
      && /Top 10/.test(text)
      && Boolean(sourceBackedLink);
  }, null, { timeout: 120_000 });
  const dashboardTtiMs = Date.now() - started;
  const dashboardDataMs = Math.max(0, dashboardTtiMs - domContentLoadedMs);
  await page.waitForTimeout(1500);

  const successfulCritical = apiResponses.filter((item) => item.status === 200);
  const liveRefreshMaxMs = successfulCritical.length
    ? Math.max(...successfulCritical.map((item) => item.duration_ms))
    : null;
  const body = await page.locator("body").innerText();
  const failures = [];
  if (dashboardTtiMs > ttiTargetMs) failures.push(`dashboard_tti_${dashboardTtiMs}_gt_${ttiTargetMs}`);
  if (dashboardDataMs > dataTargetMs) failures.push(`dashboard_data_${dashboardDataMs}_gt_${dataTargetMs}`);
  if (consoleErrors.length) failures.push("console_errors_present");
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.brd_performance_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status,
    summary: {
      navigation_commit_ms: committedMs,
      dom_content_loaded_ms: domContentLoadedMs,
      overview_visible_ms: overviewVisibleMs,
      newest_data_visible_ms: newestDataMs,
      top_10_visible_ms: topTenMs,
      dashboard_tti_ms: dashboardTtiMs,
      dashboard_tti_target_ms: ttiTargetMs,
      dashboard_data_ms: dashboardDataMs,
      dashboard_data_target_ms: dataTargetMs,
      live_refresh_max_ms: liveRefreshMaxMs,
      critical_api_200_count: successfulCritical.length,
      still_refreshing_after_first_use: body.includes("Loading"),
      console_errors: consoleErrors.slice(0, 10),
      failures
    },
    caveats: [
      "dashboard_data_ms measures visible business data after DOM readiness; live_refresh_max_ms records background source refresh latency separately.",
      body.includes("Loading") ? "Some background modules were still refreshing after first usable render." : ""
    ].filter(Boolean),
    api_responses: apiResponses
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
