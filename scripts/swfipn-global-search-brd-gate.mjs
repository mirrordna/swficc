#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-global-search-brd-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-global-search-brd-modal-latest.png");
fs.mkdirSync(outputDir, { recursive: true });

const query = process.env.SWFIPN_SEARCH_QUERY || "GIC";
const autocompleteTargetMs = Number(process.env.SWFIPN_SEARCH_AUTOCOMPLETE_TARGET_MS || 300);
const resultsTargetMs = Number(process.env.SWFIPN_SEARCH_RESULTS_TARGET_MS || 800);
const requiredTabs = ["All", "Entities", "RFPs & Opportunities", "Transactions", "News & Articles"];
const requiredGroups = ["Entities", "Transactions", "People", "News & Articles"];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const network = createNetworkRecorder(page);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const dashboardStarted = Date.now();
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=Discover", { timeout: 120_000 });
  await page.waitForSelector("[aria-label=\"Open Global Search\"]", { timeout: 120_000 });
  await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 120_000 }).catch(() => {});
  await page.bringToFront();
  const dashboardReadyMs = Date.now() - dashboardStarted;

  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForSelector("[role=\"dialog\"]", { timeout: 3_000 }).catch(async () => {
    await page.locator("[aria-label=\"Open Global Search\"]").first().click({ timeout: 10_000 });
    await page.waitForSelector("[role=\"dialog\"]", { timeout: 10_000 });
  });
  const input = page.locator("[aria-label=\"Search query\"]");
  const autofocus = await input.evaluate((node) => document.activeElement === node).catch(() => false);
  const autocompleteStarted = Date.now();
  await input.fill(query);
  await page.waitForFunction(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (!dialog) return false;
    const text = dialog.textContent || "";
    return text.includes("Entities") || text.includes("No visible dashboard matches.");
  }, null, { timeout: 10_000 });
  const autocompleteMs = Date.now() - autocompleteStarted;
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const modalText = await page.locator("[role=\"dialog\"]").innerText();
  const tabsMissing = requiredTabs.filter((tab) => !modalText.includes(tab));
  const groupsMissing = requiredGroups.filter((group) => !modalText.includes(group));
  const clearButtonVisible = await page.locator("button", { hasText: "Clear" }).count().then((count) => count > 0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const modalClosed = await page.locator("[role=\"dialog\"]").count().then((count) => count === 0);

  const searchUrl = `${origin.replace(/\/$/, "")}/search/?q=${encodeURIComponent(query)}`;
  network.reset();
  const resultsStarted = Date.now();
  await page.goto(searchUrl, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => {
    const text = document.body.innerText || "";
    return !text.includes("Loading")
      && !text.includes("Awaiting search")
      && (text.includes("Showing") || text.includes("Not disclosed") || text.includes("Search"));
  }, null, { timeout: 120_000 });
  const resultsPageMs = Date.now() - resultsStarted;
  const resultsBody = await page.locator("body").innerText();
  const resultsHasRowsOrEmptyState = /Showing\s+\d+\s+of\s+[\d,]+/.test(resultsBody) || resultsBody.includes("Not disclosed");
  const searchApiResponses = network.items().filter((item) => /api\/(v1\/public\/search|source-data\/search|transaction-drilldown)/.test(item.url));
  const apiOk = searchApiResponses.some((item) => item.status === 200);

  const failures = [];
  if (!autofocus) failures.push("modal_input_not_autofocused");
  if (tabsMissing.length) failures.push(`missing_tabs:${tabsMissing.join("|")}`);
  if (groupsMissing.length) failures.push(`missing_groups:${groupsMissing.join("|")}`);
  if (!clearButtonVisible) failures.push("clear_button_missing_after_query");
  if (!modalClosed) failures.push("escape_did_not_close_modal");
  if (autocompleteMs > autocompleteTargetMs) failures.push(`autocomplete_${autocompleteMs}_gt_${autocompleteTargetMs}`);
  if (resultsPageMs > resultsTargetMs) failures.push(`results_page_${resultsPageMs}_gt_${resultsTargetMs}`);
  if (!resultsHasRowsOrEmptyState) failures.push("results_page_missing_rows_or_empty_state");
  if (!apiOk) failures.push("results_page_missing_search_api_200");
  if (consoleErrors.length) failures.push("console_errors_present");

  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.global_search_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    query,
    status,
    summary: {
      dashboard_ready_ms: dashboardReadyMs,
      autocomplete_ms: autocompleteMs,
      autocomplete_p95_ms: autocompleteMs,
      autocomplete_target_ms: autocompleteTargetMs,
      results_page_ms: resultsPageMs,
      results_target_ms: resultsTargetMs,
      tabs_missing: tabsMissing,
      groups_missing: groupsMissing,
      autofocus,
      clear_button_visible: clearButtonVisible,
      modal_closed: modalClosed,
      results_has_rows_or_empty_state: resultsHasRowsOrEmptyState,
      search_api_200: apiOk,
      console_errors: consoleErrors.slice(0, 10),
      failures
    },
    network: searchApiResponses,
    evidence: {
      modal_screenshot: screenshotPath,
      results_url: searchUrl
    }
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

function createNetworkRecorder(page) {
  let records = [];
  const starts = new Map();
  page.on("request", (request) => starts.set(request, Date.now()));
  page.on("response", (response) => {
    const request = response.request();
    const started = starts.get(request) || Date.now();
    records.push({
      url: response.url(),
      status: response.status(),
      method: request.method(),
      duration_ms: Date.now() - started
    });
  });
  return {
    items: () => records,
    reset: () => {
      records = [];
      starts.clear();
    }
  };
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
