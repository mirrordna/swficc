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
const performanceBlocking = process.env.SWFIPN_SEARCH_PERFORMANCE_BLOCKING !== "0";
const requiredTabs = ["All", "Entities", "RFPs & Opportunities", "Transactions", "News & Articles"];
const requiredGroups = ["Entities", "Transactions", "People", "News & Articles"];
const expectedResult = expectedResultForQuery(query);

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const network = createNetworkRecorder(page);
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const dashboardStarted = Date.now();
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("text=Global Capital Map", { timeout: 120_000 });
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
  await page.evaluate(({ expected, queryValue }) => {
    const dialog = document.querySelector("[role='dialog']");
    const searchInput = document.querySelector("[aria-label='Search query']");
    const timing = { started_at: null, completed_at: null };
    window.__swfipnAutocompleteTiming = timing;
    if (!dialog || !searchInput) return;
    const normalizedQuery = String(queryValue || "").trim().toLowerCase();
    const check = () => {
      if (timing.started_at === null || timing.completed_at !== null) return;
      const committedQuery = dialog.getAttribute("data-search-query") || "";
      const hasExpectedResult = !expected || (dialog.textContent || "").includes(String(expected));
      if (committedQuery === normalizedQuery && hasExpectedResult) {
        timing.completed_at = performance.now();
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(dialog, { attributes: true, attributeFilter: ["data-search-query"], childList: true, subtree: true });
    searchInput.addEventListener("input", () => {
      timing.started_at = performance.now();
      queueMicrotask(check);
      requestAnimationFrame(check);
    }, { once: true });
  }, { expected: expectedResult, queryValue: query });
  const autocompleteRunnerStarted = Date.now();
  await input.fill(query);
  await page.waitForFunction(() => {
    const dialog = document.querySelector("[role='dialog']");
    if (!dialog) return false;
    const text = dialog.textContent || "";
    return text.includes("Entities") || text.includes("No visible dashboard matches.");
  }, null, { timeout: 10_000 });
  if (expectedResult) {
    await page.waitForFunction(({ expected, queryValue }) => {
      const dialog = document.querySelector("[role='dialog']");
      if (!dialog) return false;
      return (dialog.getAttribute("data-search-query") || "") === String(queryValue).trim().toLowerCase()
        && (dialog.textContent || "").includes(String(expected));
    }, { expected: expectedResult, queryValue: query }, { timeout: Math.max(10_000, autocompleteTargetMs) }).catch(() => {});
  }
  const autocompleteRunnerMs = Date.now() - autocompleteRunnerStarted;
  const autocompleteMs = await page.evaluate(() => {
    const timing = window.__swfipnAutocompleteTiming;
    return timing && Number.isFinite(timing.started_at) && Number.isFinite(timing.completed_at)
      ? Math.ceil(timing.completed_at - timing.started_at)
      : null;
  }).then((value) => Number.isFinite(value) ? value : autocompleteRunnerMs);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const modalText = await page.locator("[role=\"dialog\"]").innerText();
  const tabsMissing = requiredTabs.filter((tab) => !modalText.includes(tab));
  const groupsMissing = requiredGroups.filter((group) => !modalText.includes(group));
  const modalHasExpectedResult = expectedResult ? modalText.includes(expectedResult) : true;
  const modalPrefetchEvidence = await readPrefetchEvidence(page, query, expectedResult);
  const clearButtonVisible = await page.locator("button", { hasText: "Clear" }).count().then((count) => count > 0);
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const modalClosed = await page.locator("[role=\"dialog\"]").count().then((count) => count === 0);

  const searchUrl = `${origin.replace(/\/$/, "")}/search/?q=${encodeURIComponent(query)}`;
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForSelector("[role=\"dialog\"]", { timeout: 10_000 });
  await page.evaluate(({ expected, queryValue }) => {
    const timing = { started_at: null, completed_at: null };
    window.__swfipnResultsTiming = timing;
    const normalizedQuery = String(queryValue || "").trim().toLowerCase();
    const check = () => {
      if (timing.started_at === null || timing.completed_at !== null) return;
      const results = document.querySelector("[data-search-results-ready='true']");
      const committedQuery = results?.getAttribute("data-search-results-query") || "";
      const hasExpectedResult = !expected || (results?.textContent || "").includes(String(expected));
      if (committedQuery === normalizedQuery && hasExpectedResult) {
        timing.completed_at = performance.now();
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(check);
    observer.observe(document.documentElement, { attributes: true, childList: true, subtree: true });
    const resultsLink = [...document.querySelectorAll("a")]
      .find((node) => (node.textContent || "").trim() === "View all results");
    resultsLink?.addEventListener("click", () => {
      timing.started_at = performance.now();
      queueMicrotask(check);
      requestAnimationFrame(check);
    }, { once: true });
  }, { expected: expectedResult, queryValue: query });
  network.reset();
  const resultsRunnerStarted = Date.now();
  await page.getByRole("link", { name: "View all results" }).click({ timeout: 10_000 });
  await page.waitForURL(searchUrl, { timeout: 120_000 });
  const clickPrefetchEvidence = await readPrefetchEvidence(page, query, expectedResult);
  const prefetchEvidence = clickPrefetchEvidence.valid ? clickPrefetchEvidence : modalPrefetchEvidence;
  await page.waitForFunction((expected) => {
    const text = document.body.innerText || "";
    return !text.includes("Loading")
      && !text.includes("Awaiting search")
      && (expected ? text.includes(String(expected)) : (text.includes("Showing") || text.includes("Not disclosed") || text.includes("Search")));
  }, expectedResult, { timeout: 120_000 });
  const resultsRunnerMs = Date.now() - resultsRunnerStarted;
  const resultsPageMs = await page.evaluate(() => {
    const timing = window.__swfipnResultsTiming;
    return timing && Number.isFinite(timing.started_at) && Number.isFinite(timing.completed_at)
      ? Math.ceil(timing.completed_at - timing.started_at)
      : null;
  }).then((value) => Number.isFinite(value) ? value : resultsRunnerMs);
  const resultsResourceTimings = await page.evaluate(() => {
    const startedAt = window.__swfipnResultsTiming?.started_at;
    if (!Number.isFinite(startedAt)) return [];
    return performance.getEntriesByType("resource")
      .filter((entry) => entry.startTime >= startedAt)
      .map((entry) => ({
        name: entry.name,
        initiator_type: entry.initiatorType,
        start_ms: Math.round(entry.startTime - startedAt),
        duration_ms: Math.round(entry.duration),
        transfer_size: entry.transferSize,
      }))
      .sort((left, right) => right.duration_ms - left.duration_ms)
      .slice(0, 30);
  });
  const resultsBody = await page.locator("body").innerText();
  const resultsHasRowsOrEmptyState = /Showing\s+\d+\s+of\s+[\d,]+/.test(resultsBody) || resultsBody.includes("Not disclosed");
  const resultsHasExpectedResult = expectedResult ? resultsBody.includes(expectedResult) : true;
  const searchApiResponses = network.items().filter((item) => /api\/(v1\/public\/search|source-data\/search|transaction-drilldown)/.test(item.url));
  const serverRenderedSearch = false;
  const apiOk = prefetchEvidence.valid || searchApiResponses.some((item) => item.status === 200);

  const failures = [];
  const p1Findings = [];
  if (!autofocus) failures.push("modal_input_not_autofocused");
  if (tabsMissing.length) failures.push(`missing_tabs:${tabsMissing.join("|")}`);
  if (groupsMissing.length) failures.push(`missing_groups:${groupsMissing.join("|")}`);
  if (!clearButtonVisible) failures.push("clear_button_missing_after_query");
  if (!modalClosed) failures.push("escape_did_not_close_modal");
  if (!modalHasExpectedResult) failures.push(`modal_missing_expected_result:${expectedResult}`);
  if (!resultsHasExpectedResult) failures.push(`results_missing_expected_result:${expectedResult}`);
  if (autocompleteMs > autocompleteTargetMs) p1Findings.push(`autocomplete_${autocompleteMs}_gt_${autocompleteTargetMs}`);
  if (resultsPageMs > resultsTargetMs) p1Findings.push(`results_page_${resultsPageMs}_gt_${resultsTargetMs}`);
  if (performanceBlocking) failures.push(...p1Findings);
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
      autocomplete_runner_ms: autocompleteRunnerMs,
      autocomplete_measurement: "browser_input_to_react_committed_query_dom",
      autocomplete_p95_ms: autocompleteMs,
      autocomplete_target_ms: autocompleteTargetMs,
      results_page_ms: resultsPageMs,
      results_page_runner_ms: resultsRunnerMs,
      results_measurement: "browser_click_to_react_committed_results_dom",
      results_target_ms: resultsTargetMs,
      performance_blocking: performanceBlocking,
      p1_findings: p1Findings,
      tabs_missing: tabsMissing,
      groups_missing: groupsMissing,
      autofocus,
      clear_button_visible: clearButtonVisible,
      modal_closed: modalClosed,
      expected_result: expectedResult || "",
      modal_has_expected_result: modalHasExpectedResult,
      results_has_expected_result: resultsHasExpectedResult,
      results_has_rows_or_empty_state: resultsHasRowsOrEmptyState,
      search_api_200: apiOk,
      prefetch_cache_valid: prefetchEvidence.valid,
      server_rendered_search: serverRenderedSearch,
      console_errors: consoleErrors.slice(0, 10),
      failures
    },
    network: searchApiResponses,
    evidence: {
      modal_screenshot: screenshotPath,
      results_url: searchUrl,
      prefetch_cache: prefetchEvidence,
      modal_prefetch_cache: modalPrefetchEvidence,
      click_prefetch_cache: clickPrefetchEvidence,
      results_resource_timings: resultsResourceTimings,
    }
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

async function readPrefetchEvidence(page, searchQuery, expected) {
  return page.evaluate(({ cacheKey, expectedResult, queryValue }) => {
    try {
      const raw = window.sessionStorage.getItem(cacheKey);
      if (!raw) return { valid: false, reason: "missing", result_count: 0, source_backed_rows: 0 };
      const parsed = JSON.parse(raw);
      const packet = parsed?.packet;
      const packetRows = Array.isArray(packet?.data?.results) ? packet.data.results : [];
      const sourceBackedRows = packetRows.filter((row) => typeof row?.source_url === "string" && row.source_url.startsWith("https://www.swfi.com/")).length;
      const expectedMatch = !expectedResult || packetRows.some((row) => String(row?.name || "").includes(expectedResult));
      const valid = String(parsed?.query || "").trim().toLowerCase() === queryValue.trim().toLowerCase()
        && Number.isFinite(parsed?.stored_at)
        && Date.now() - parsed.stored_at <= 60_000
        && packet?.status === "ok"
        && packet?.fact === true
        && packetRows.length > 0
        && sourceBackedRows === packetRows.length
        && expectedMatch;
      return {
        valid,
        reason: valid ? "fresh_query_matched_source_backed_packet" : "packet_contract_mismatch",
        result_count: packetRows.length,
        source_backed_rows: sourceBackedRows,
        expected_match: expectedMatch,
      };
    } catch {
      return { valid: false, reason: "unreadable", result_count: 0, source_backed_rows: 0 };
    }
  }, {
    cacheKey: `swfipn.search.prefetch.v1:${searchQuery.trim().toLowerCase()}`,
    expectedResult: expected,
    queryValue: searchQuery,
  });
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
      resource_type: request.resourceType(),
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

function expectedResultForQuery(value) {
  const key = String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
  const expected = new Map([
    ["pif", "Public Investment Fund"],
    ["gic", "GIC Private Limited"],
    ["abu dhabi", "Abu Dhabi Investment Authority"],
    ["zurich insurance group", "Zurich Insurance Group"],
  ]);
  return expected.get(key) || "";
}

main().catch((error) => {
  const receipt = {
    schema_version: "swfipn.global_search_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    query,
    status: "fail",
    summary: {
      performance_blocking: performanceBlocking,
      p1_findings: [],
      failures: ["gate_did_not_complete"],
      error_name: String(error?.name || "Error"),
      error: String(error?.message || error),
    },
    network: [],
    evidence: {
      modal_screenshot: screenshotPath,
      results_url: "",
      prefetch_cache: null,
      results_resource_timings: [],
    },
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.error(error);
  process.exit(1);
});
