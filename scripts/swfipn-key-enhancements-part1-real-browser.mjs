#!/usr/bin/env node
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8391").replace(/\/$/, "");
const IS_PUBLIC_ACCEPTANCE = ORIGIN === "https://dashboard.swfi.com";
const TIMEOUT_MS = Number(process.env.SWFIPN_PART1_TIMEOUT_MS || 180_000);
const RECEIPT = process.env.SWFIPN_PART1_RECEIPT || "output/swfipn-key-enhancements-part1-real-browser-latest.json";
const GROUPS = new Set(
  (process.env.SWFIPN_PART1_GROUPS || "semantic,two-screen,top-aum,filters")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const CASE_IDS = new Set(
  (process.env.SWFIPN_PART1_CASES || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
);
const CANDIDATE_BINDING_FILES = [
  "src/app/page.tsx",
  "src/components/QuickActions.tsx",
  "src/components/SearchResultsPage.tsx",
  "src/components/SourceListPage.tsx",
  "src/lib/searchResultPresentation.ts",
  "src/lib/smartSearchIntent.ts",
  "src/lib/textQueryPolicy.ts",
  "out/swficc-release.json",
  "output/swfipn-asset-version-latest.json",
  "scripts/serve-static-with-headers.py",
  "scripts/swfipn-key-enhancements-part1-real-browser.mjs",
];
const NO_RESULT_TEXT = /\b(?:No Results|No Hits|No Records|No Documents|No matches in this category|No matching SWFI records)\b/i;
const LOADING_TEXT = /\b(?:Loading|Searching this category|Searching SWFI records)\b/i;
const semanticCases = [
  { id: "top_active_investors", query: "Top Active Investors", category: "entities" },
  { id: "rfps_middle_east", query: "RFPs from the Middle East", category: "opportunities" },
  { id: "swfs_investing_ai", query: "Sovereign Wealth Funds investing in AI", category: "transactions" },
  { id: "pension_funds_europe", query: "Pension Funds in Europe", category: "entities" },
  { id: "open_manager_searches_emea", query: "Open manager searches in EMEA", category: "opportunities" },
  { id: "central_banks_apac", query: "Central banks in APAC", category: "entities" },
  { id: "family_offices_real_estate", query: "Family offices deploying capital into real estate", category: "transactions" },
];

const checks = [];
const allApiReceipts = [];
const browser = await chromium.launch({ headless: true });

try {
  for (const testCase of GROUPS.has("semantic")
    ? semanticCases.filter((item) => CASE_IDS.size === 0 || CASE_IDS.has(item.id))
    : []) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page.setDefaultTimeout(TIMEOUT_MS);
    const observer = createRealNetworkObserver(page);
    observer.setScope(page.locator("main"));
    const startedAt = Date.now();
    try {
      await page.goto(`${ORIGIN}/swficc/search/?q=${encodeURIComponent(testCase.query)}`, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS,
      });
      await page.getByTestId("smart-search-results-interpretation").waitFor({ state: "visible" });
      await observer.waitForSettled();
      await observer.flushResponses();

      const rowReceipts = await visibleSearchRows(page);
      const classification = classifyAgainstObservedSource(rowReceipts, observer.sourceRowsByName, testCase.category);
      const matchedBuyerCount = testCase.category === "transactions"
        ? await page.getByTestId("search-result-row").locator("td:nth-child(4)").filter({ hasText: "Matched buyer:" }).count()
        : 0;
      const sourceUrlCount = rowReceipts.filter((row) => observer.sourceRowsByName.get(normalize(row.name))?.sourceUrls.size).length;
      const pass = rowReceipts.length > 0
        && observer.violations.length === 0
        && sourceUrlCount === rowReceipts.length
        && (testCase.category === "transactions" ? matchedBuyerCount === rowReceipts.length : classification.mismatches.length === 0);
      checks.push({
        id: `P1_BOUNDED_NL_${testCase.id}`,
        status: pass ? "PASS" : "FAIL",
        evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
        query: testCase.query,
        category: testCase.category,
        elapsed_ms: Date.now() - startedAt,
        visible_rows: rowReceipts.length,
        source_backed_visible_rows: sourceUrlCount,
        visible_types: [...new Set(rowReceipts.map((row) => row.type))],
        classification_mismatches: classification.mismatches,
        matched_buyer_rows: matchedBuyerCount,
        premature_no_result_violations: observer.violations,
        observed_api_responses: observer.apiReceipts,
      });
    } catch (error) {
      checks.push({
        id: `P1_BOUNDED_NL_${testCase.id}`,
        status: "FAIL",
        evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
        query: testCase.query,
        error: String(error?.message || error),
        visible_text: (await page.locator("main").innerText().catch(() => "")).slice(0, 1200),
        premature_no_result_violations: observer.violations,
        observed_api_responses: observer.apiReceipts,
      });
    } finally {
      await observer.close();
      allApiReceipts.push(...observer.apiReceipts);
      await page.close();
    }
  }

  if (GROUPS.has("two-screen")) await runTwoScreenAndThresholdCheck(browser);
  if (GROUPS.has("top-aum")) await runTopAumContextCheck(browser);
  if (GROUPS.has("filters")) await runSupportedFiltersCheck(browser);
} finally {
  await browser.close();
}

const failures = checks.filter((check) => check.status === "FAIL");
const assetVersionReceipt = JSON.parse(readFileSync("output/swfipn-asset-version-latest.json", "utf8"));
const receipt = {
  schema_version: "swfipn.key_enhancements_part1.real_browser.v1",
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  candidate_binding: {
    asset_version: assetVersionReceipt.version,
    asset_version_generated_at: assetVersionReceipt.generated_at,
    release_marker_sha256: assetVersionReceipt.release_marker_sha256,
    files: Object.fromEntries(CANDIDATE_BINDING_FILES.map((path) => [path, sha256File(path)])),
  },
  requested_groups: [...GROUPS],
  requested_semantic_cases: [...CASE_IDS],
  candidate_only: !IS_PUBLIC_ACCEPTANCE,
  public_acceptance: IS_PUBLIC_ACCEPTANCE ? "TESTED" : "NOT_TESTED_OR_CLAIMED",
  evidence_policy: {
    network_interception: "NONE",
    response_substitution: "NONE",
    synthetic_rows: "NONE",
    mocked_packets: "NONE",
    source_assertions_without_runtime_observation: "NOT_ACCEPTANCE",
  },
  status: failures.length ? "fail" : "pass",
  checks,
  failures: failures.map((check) => check.id),
  observed_api_response_count: allApiReceipts.length,
  observed_api_response_hashes: [...new Set(allApiReceipts.map((item) => item.body_sha256))],
  blocked_external_scope: [
    "Complete client-query spreadsheet and presentations were not available.",
    "Comprehensive free-form natural-language routing remains future work.",
    "Category-specific filter definitions, Period semantics, and unapproved regional membership remain blocked.",
  ],
};
mkdirSync("output", { recursive: true });
writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: RECEIPT, failures: receipt.failures }, null, 2));
if (failures.length) process.exit(1);

function sha256File(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

async function runTwoScreenAndThresholdCheck(browserInstance) {
  const page = await browserInstance.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(TIMEOUT_MS);
  const observer = createRealNetworkObserver(page, (url) => {
    const query = (url.searchParams.get("q") || url.searchParams.get("value") || "").toLowerCase();
    return ["ab", "gic", "adia"].includes(query);
  });
  try {
    await page.goto(`${ORIGIN}/swficc/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.locator('[data-client-hydrated="true"]').waitFor({ state: "attached" });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    const dialog = page.getByRole("dialog", { name: "Global Search" });
    observer.setScope(dialog);
    const input = dialog.getByRole("textbox", { name: "Search query" });

    const beforeShort = observer.requests.length;
    await input.fill("ab");
    await page.waitForTimeout(1200);
    const shortRequests = observer.requests.slice(beforeShort).filter((item) => queryValue(item.url).toLowerCase() === "ab");

    const beforeExactMinimum = observer.requests.length;
    await input.fill("GIC");
    await observer.waitForRequest((item) => queryValue(item.url).toLowerCase() === "gic", beforeExactMinimum);
    await observer.waitForSettled();
    const exactMinimumRequests = observer.requests.slice(beforeExactMinimum).filter((item) => queryValue(item.url).toLowerCase() === "gic");
    const detailedFilterLeak = await dialog.getByText(/^(?:Country|Region|Entity Type|Buyer|Seller|Sector|Period)$/).count();

    const beforeAdia = observer.requests.length;
    await input.fill("ADIA");
    await observer.waitForRequest((item) => queryValue(item.url).toLowerCase() === "adia", beforeAdia);
    await observer.waitForSettled();
    const viewAll = dialog.getByRole("link", { name: "View all results" });
    const viewAllHref = await viewAll.getAttribute("href");
    observer.setScope(page.locator("main"));
    const beforeDetailed = observer.requests.length;
    await viewAll.click();
    await page.waitForURL(/\/swficc\/search\//, { timeout: TIMEOUT_MS });
    await page.getByTestId("search-result-category-refinements").waitFor({ state: "visible" });
    await observer.waitForRequest(() => true, beforeDetailed);
    await observer.waitForSettled();
    await observer.flushResponses();

    const queryPreserved = await page.getByRole("searchbox", { name: "Smart Search" }).inputValue();
    const categoryButtons = await page.getByTestId("search-result-category-refinements").getByRole("button").count();
    const allRows = await visibleSearchRows(page);
    const allCategoryCounts = countValues(allRows.map((row) => row.category));
    const allLimit = await page.getByLabel("Rows per category").inputValue();
    const representedCategories = Object.keys(allCategoryCounts).filter(Boolean);
    const balanced = representedCategories.length >= 2 && Object.values(allCategoryCounts).every((count) => count <= 5);

    const beforeTransactions = observer.requests.length;
    await page.getByTestId("search-result-category-refinements").getByRole("button", { name: /^Transactions \(/ }).click();
    await page.waitForFunction(() => /[?&]category=transactions/.test(window.location.search));
    await observer.waitForRequest(() => true, beforeTransactions);
    await observer.waitForSettled();
    const transactionRows = await visibleSearchRows(page);
    const rowLimit = await page.getByLabel("Rows").inputValue();

    checks.push({
      id: "P1_THREE_CHARACTER_MINIMUM",
      status: shortRequests.length === 0 && exactMinimumRequests.length > 0 ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      short_query_requests: shortRequests,
      exact_minimum_requests: exactMinimumRequests,
    });
    checks.push({
      id: "P1_TWO_SCREEN_STRUCTURE",
      status: viewAllHref?.includes("q=ADIA") && detailedFilterLeak === 0 && queryPreserved === "ADIA" && categoryButtons === 6 ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      view_all_href: viewAllHref,
      initial_detailed_filter_leak_count: detailedFilterLeak,
      detailed_query: queryPreserved,
      category_refinement_buttons: categoryButtons,
    });
    checks.push({
      id: "P1_ALL_CATEGORY_BALANCE",
      status: allLimit === "5" && balanced ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      rows_per_category_default: allLimit,
      visible_category_counts: allCategoryCounts,
      represented_categories: representedCategories,
    });
    checks.push({
      id: "P1_TRANSACTION_DEFAULT",
      status: rowLimit === "10" && transactionRows.length === 10 ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      rows_default: rowLimit,
      visible_transaction_rows: transactionRows.length,
    });
    checks.push({
      id: "P1_LOADING_TRUTH",
      status: observer.violations.length === 0 ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      premature_no_result_violations: observer.violations,
      observed_relevant_requests: observer.requests.length,
    });
  } catch (error) {
    checks.push({
      id: "P1_TWO_SCREEN_AND_THRESHOLD_RUNTIME",
      status: "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      error: String(error?.message || error),
      premature_no_result_violations: observer.violations,
    });
  } finally {
    await observer.close();
    allApiReceipts.push(...observer.apiReceipts);
    await page.close();
  }
}

async function runTopAumContextCheck(browserInstance) {
  const page = await browserInstance.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(TIMEOUT_MS);
  const observer = createRealNetworkObserver(page, (url) => (
    url.pathname.replace(/^\/swficc/, "") === "/api/source-data/search/v1"
    && url.searchParams.get("collection") === "entities"
    && url.searchParams.get("entity_type") === "Sovereign Wealth Fund"
  ));
  observer.setScope(page.locator("main"));
  try {
    await page.goto(`${ORIGIN}/swficc/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    const topAumLabel = page.getByText("TOP-RANKED AUM TOTAL", { exact: true });
    await topAumLabel.waitFor({ state: "visible" });
    const topAumLink = topAumLabel.locator("xpath=ancestor::a[1]");
    const href = await topAumLink.getAttribute("href");
    const beforeNavigation = observer.requests.length;
    await topAumLink.click();
    await page.waitForURL(/\/swficc\/profiles\//, { timeout: TIMEOUT_MS });
    await observer.waitForRequest((item) => item.url.includes("collection=entities"), beforeNavigation);
    await observer.waitForSettled();
    await observer.flushResponses();

    const context = await page.locator("[data-entity-type-context]").getAttribute("data-entity-type-context");
    const profileRequests = observer.requests.slice(beforeNavigation).filter((item) => item.url.includes("collection=entities"));
    const strictRequest = profileRequests.some((item) => new URL(item.url).searchParams.get("entity_type") === "Sovereign Wealth Fund");
    const sourceRows = observer.sourceRows.filter((row) => sourceType(row) && sourceName(row));
    const sourceTypes = [...new Set(sourceRows.map(sourceType))];
    const defunctCount = sourceRows.filter(isDefunct).length;

    const visualization = page.getByRole("button", { name: "Visualization", exact: true });
    await visualization.click();
    await page.waitForTimeout(250);
    const contextAfterVisualization = await page.locator("[data-entity-type-context]").getAttribute("data-entity-type-context");
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page.locator("main tbody tr").first().waitFor({ state: "visible" });
    const visibleTypes = await page.locator("main tbody tr td:nth-child(2)").allTextContents();
    const visibleStrict = visibleTypes.length > 0 && visibleTypes.every((value) => value.trim() === "Sovereign Wealth Fund");

    checks.push({
      id: "P1_TOP_AUM_ENTITY_CONTEXT",
      status: href?.includes("entity_type=Sovereign%20Wealth%20Fund")
        && strictRequest
        && context === "Sovereign Wealth Fund"
        && contextAfterVisualization === "Sovereign Wealth Fund"
        && sourceTypes.length === 1
        && sourceTypes[0] === "Sovereign Wealth Fund"
        && defunctCount === 0
        && visibleStrict ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      top_aum_href: href,
      strict_entity_type_request_observed: strictRequest,
      entity_type_context_before_visualization: context,
      entity_type_context_after_visualization: contextAfterVisualization,
      observed_source_types: sourceTypes,
      observed_source_defunct_rows: defunctCount,
      visible_row_types: [...new Set(visibleTypes.map((value) => value.trim()))],
      observed_api_responses: observer.apiReceipts,
    });
    checks.push({
      id: "P1_DEFUNCT_DEFAULT",
      status: strictRequest && !profileRequests.some((item) => item.url.includes("include_defunct=true")) && defunctCount === 0 ? "PASS" : "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      include_defunct_request_observed: profileRequests.some((item) => item.url.includes("include_defunct=true")),
      observed_source_defunct_rows: defunctCount,
    });
  } catch (error) {
    checks.push({
      id: "P1_TOP_AUM_ENTITY_CONTEXT",
      status: "FAIL",
      evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
      error: String(error?.message || error),
      observed_api_responses: observer.apiReceipts,
    });
  } finally {
    await observer.close();
    allApiReceipts.push(...observer.apiReceipts);
    await page.close();
  }
}

async function runSupportedFiltersCheck(browserInstance) {
  const filterCases = [
    { id: "entities", query: "Fund", category: "entities", required: ["recordType", "geography"], exercise: "recordType" },
    { id: "transactions", query: "ADIA", category: "transactions", required: ["transactionType", "buyer", "geography"], exercise: "transactionType" },
    { id: "opportunities", query: "RFP", category: "opportunities", required: ["recordType", "strategy", "geography"], exercise: "recordType" },
    { id: "news", query: "fund", category: "news", required: ["source"], exercise: "source" },
    { id: "people", query: "John", category: "people", required: ["geography"], exercise: "geography" },
  ];

  for (const filterCase of filterCases) {
    const page = await browserInstance.newPage({ viewport: { width: 1360, height: 900 } });
    page.setDefaultTimeout(TIMEOUT_MS);
    const observer = createRealNetworkObserver(page);
    observer.setScope(page.locator("main"));
    try {
      await page.goto(`${ORIGIN}/swficc/search/?q=${encodeURIComponent(filterCase.query)}&category=${filterCase.category}`, {
        waitUntil: "domcontentloaded",
        timeout: TIMEOUT_MS,
      });
      await page.getByTestId("search-result-supported-filters").waitFor({ state: "visible" });
      await observer.waitForSettled();
      await observer.flushResponses();

      const controlReceipts = [];
      const controlValuesByKey = new Map();
      for (const key of filterCase.required) {
        const control = page.getByTestId(`search-filter-${key}`);
        const values = await control.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
        controlValuesByKey.set(key, values);
        const observedValues = new Set(observer.sourceRows.flatMap((row) => sourceFilterValues(row, key)).map(normalize));
        const unbackedOptions = values.filter((value) => !observedValues.has(normalize(value)));
        controlReceipts.push({ key, option_count: values.length, options: values.slice(0, 12), unbacked_options: unbackedOptions });
      }

      const exerciseControl = page.getByTestId(`search-filter-${filterCase.exercise}`);
      const exerciseOptions = await exerciseControl.locator("option").evaluateAll((options) => options.map((option) => option.value).filter(Boolean));
      const selected = exerciseOptions[0] || "";
      if (selected) await exerciseControl.selectOption(selected);
      const selectedFilters = selected ? { [filterCase.exercise]: selected } : {};
      const secondKey = filterCase.required.find((key) => key !== filterCase.exercise);
      if (secondKey && selected) {
        const compatibleSourceRow = observer.sourceRows.find((row) => sourceFilterValues(row, filterCase.exercise).some(
          (value) => normalize(value) === normalize(selected),
        ));
        const availableSecondValues = controlValuesByKey.get(secondKey) || [];
        const secondSelected = compatibleSourceRow
          ? sourceFilterValues(compatibleSourceRow, secondKey).find((value) => availableSecondValues.some(
              (option) => normalize(option) === normalize(value),
            )) || ""
          : "";
        if (secondSelected) {
          await page.getByTestId(`search-filter-${secondKey}`).selectOption(secondSelected);
          selectedFilters[secondKey] = secondSelected;
        }
      }
      await page.waitForTimeout(150);
      const visibleRows = await visibleSearchRows(page);
      const mismatches = visibleRows.filter((row) => {
        const observedRows = observer.sourceRowsByName.get(normalize(row.name))?.rows || [];
        return !observedRows.some((sourceRow) => Object.entries(selectedFilters).every(([key, value]) => (
          sourceFilterValues(sourceRow, key).some((sourceValue) => normalize(sourceValue) === normalize(value))
        )));
      }).map((row) => row.name);
      const allControlsBacked = controlReceipts.every((control) => control.option_count > 0 && control.unbacked_options.length === 0);
      const multipleFilterProofRequired = filterCase.required.length > 1;
      const multipleFilterProofPresent = Object.keys(selectedFilters).length > 1;
      const pass = allControlsBacked
        && Boolean(selected)
        && (!multipleFilterProofRequired || multipleFilterProofPresent)
        && visibleRows.length > 0
        && mismatches.length === 0;
      checks.push({
        id: `P1_SUPPORTED_FILTERS_${filterCase.id}`,
        status: pass ? "PASS" : "FAIL",
        evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
        query: filterCase.query,
        category: filterCase.category,
        option_source: await page.getByTestId("search-result-supported-filters").getAttribute("data-option-source"),
        controls: controlReceipts,
        selected_source_values: selectedFilters,
        multiple_filter_proof_required: multipleFilterProofRequired,
        multiple_filter_proof_present: multipleFilterProofPresent,
        visible_rows_after_filter: visibleRows.length,
        source_value_mismatches: mismatches,
        observed_api_responses: observer.apiReceipts,
      });
    } catch (error) {
      checks.push({
        id: `P1_SUPPORTED_FILTERS_${filterCase.id}`,
        status: "FAIL",
        evidence_class: "REAL_CANDIDATE_REAL_SWFI_BROWSER",
        query: filterCase.query,
        category: filterCase.category,
        error: String(error?.message || error),
        observed_api_responses: observer.apiReceipts,
      });
    } finally {
      await observer.close();
      allApiReceipts.push(...observer.apiReceipts);
      await page.close();
    }
  }
}

function createRealNetworkObserver(page, operationFilter = () => true) {
  const relevant = (url) => {
    try {
      const parsed = new URL(url);
      return parsed.origin === new URL(ORIGIN).origin
        && (/^\/api\//.test(parsed.pathname.replace(/^\/swficc/, "")) || /^\/v1\//.test(parsed.pathname.replace(/^\/swficc/, "")))
        && operationFilter(parsed);
    } catch {
      return false;
    }
  };
  const pending = new Set();
  const requests = [];
  const apiReceipts = [];
  const sourceRows = [];
  const sourceRowsByName = new Map();
  const responseTasks = [];
  const violations = [];
  let scope = page.locator("body");
  let lastRelevantEventAt = Date.now();
  let sampleInFlight = false;

  const inspectPendingSurface = async () => {
    if (sampleInFlight || pending.size === 0) return;
    sampleInFlight = true;
    try {
      const content = await scope.innerText({ timeout: 250 }).catch(() => "");
      const pendingAtObservation = pending.size;
      if (pendingAtObservation > 0 && content && NO_RESULT_TEXT.test(content)) {
        violations.push({ at: new Date().toISOString(), pending_requests: pendingAtObservation, visible_text: content.slice(0, 500) });
      }
    } finally {
      sampleInFlight = false;
    }
  };
  const timer = setInterval(() => void inspectPendingSurface(), 40);

  page.on("request", (request) => {
    if (!relevant(request.url())) return;
    pending.add(request);
    requests.push({ method: request.method(), url: request.url(), at: new Date().toISOString() });
    lastRelevantEventAt = Date.now();
    void inspectPendingSurface();
  });
  page.on("requestfinished", (request) => {
    if (!relevant(request.url())) return;
    pending.delete(request);
    lastRelevantEventAt = Date.now();
  });
  page.on("requestfailed", (request) => {
    if (!relevant(request.url())) return;
    pending.delete(request);
    lastRelevantEventAt = Date.now();
  });
  page.on("response", (response) => {
    if (!relevant(response.url())) return;
    const task = (async () => {
      const body = await response.text().catch(() => "");
      if (!body) return;
      let payload;
      try {
        payload = JSON.parse(body);
      } catch {
        return;
      }
      const packetEntityName = isRecord(payload?.data?.entity) ? String(payload.data.entity.name || "").trim() : "";
      const rows = packetRows(payload).map((row) => packetEntityName ? { ...row, __searchEntityName: packetEntityName } : row);
      rows.forEach((row) => {
        sourceRows.push(row);
        const key = normalize(sourceName(row));
        if (!key) return;
        const current = sourceRowsByName.get(key) || { types: new Set(), sourceUrls: new Set(), rows: [] };
        const type = sourceType(row);
        const sourceUrl = String(row.source_url || row.swfi_url || row.url || "").trim();
        if (type) current.types.add(type);
        if (sourceUrl) current.sourceUrls.add(sourceUrl);
        current.rows.push(row);
        sourceRowsByName.set(key, current);
      });
      apiReceipts.push({
        url: response.url(),
        http_status: response.status(),
        packet_status: String(payload?.status || ""),
        fact: payload?.fact === true,
        row_count: rows.length,
        source_url_rows: rows.filter((row) => String(row.source_url || row.swfi_url || row.url || "").trim()).length,
        source_types: [...new Set(rows.map(sourceType).filter(Boolean))],
        defunct_rows: rows.filter(isDefunct).length,
        body_sha256: createHash("sha256").update(body).digest("hex"),
      });
    })();
    responseTasks.push(task);
  });

  return {
    requests,
    apiReceipts,
    sourceRows,
    sourceRowsByName,
    violations,
    setScope(nextScope) {
      scope = nextScope;
    },
    async waitForRequest(predicate, startIndex = 0) {
      await waitUntil(() => requests.slice(startIndex).some(predicate), TIMEOUT_MS, "expected real API request was not observed");
    },
    async waitForSettled() {
      await waitUntil(async () => {
        if (pending.size > 0) return false;
        if (Date.now() - lastRelevantEventAt < 800) return false;
        const content = await scope.innerText({ timeout: 500 }).catch(() => "");
        return Boolean(content) && !LOADING_TEXT.test(content);
      }, TIMEOUT_MS, "real API requests or the visible loading state did not settle");
    },
    async flushResponses() {
      await Promise.allSettled(responseTasks);
    },
    async close() {
      clearInterval(timer);
      await Promise.allSettled(responseTasks);
    },
  };
}

async function visibleSearchRows(page) {
  const rows = page.getByTestId("search-result-row");
  const count = await rows.count();
  const receipts = [];
  for (let index = 0; index < count; index += 1) {
    const row = rows.nth(index);
    receipts.push({
      name: (await row.locator("td").nth(1).innerText()).trim(),
      type: (await row.getByTestId("search-result-record-type").innerText()).trim(),
      category: (await row.locator("td").nth(0).locator("span").nth(1).innerText()).trim(),
    });
  }
  return receipts;
}

function classifyAgainstObservedSource(visibleRows, sourceRowsByName, category) {
  if (category === "transactions") return { mismatches: [] };
  const mismatches = [];
  for (const row of visibleRows) {
    const observed = sourceRowsByName.get(normalize(row.name));
    const generic = category === "entities"
      ? /^(?:Entity|Entities)$/i.test(row.type)
      : /^(?:RFPs?\s*(?:&|and|or|\/)\s*Opportunit(?:y|ies)|RFP or Opportunity)$/i.test(row.type);
    if (!observed || generic || !observed.types.has(row.type)) {
      mismatches.push({ name: row.name, visible_type: row.type, observed_source_types: observed ? [...observed.types] : [] });
    }
  }
  return { mismatches };
}

function packetRows(payload) {
  const data = payload && typeof payload.data === "object" && !Array.isArray(payload.data) ? payload.data : {};
  if (Array.isArray(data.rows)) return data.rows.filter(isRecord);
  if (Array.isArray(data.results)) return data.results.filter(isRecord);
  return [];
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function sourceName(row) {
  return String(row.name || row.title || row.institution || "").trim();
}

function sourceType(row) {
  return String(row.entity_type || row.entityType || row.record_type || row.opportunity_type || row.type || "").trim();
}

function sourceFilterValues(row, key) {
  const nestedNames = (value) => Array.isArray(value)
    ? value.map((item) => isRecord(item) ? item.name || item.title : item)
    : [];
  const values = key === "recordType"
    ? [sourceType(row)]
    : key === "geography"
      ? [row.country, row.region, row.buyer_country, row.buyer_region, row.seller_country, row.seller_region, row.location]
      : key === "transactionType"
        ? [row.acquisition_type, row.investment_type, row.transaction_type, row.type]
        : key === "buyer"
          ? [row.buyer_entity, row.buyer, row.institution, /buyer/i.test(String(row.role || "")) ? row.__searchEntityName : "", ...nestedNames(row.buyer_entities)]
          : key === "seller"
            ? [row.seller_entity, row.seller, /seller/i.test(String(row.role || "")) ? row.__searchEntityName : "", ...nestedNames(row.seller_entities)]
            : key === "sector"
              ? [row.sector, row.industry]
              : key === "strategy"
                ? [row.strategy, row.asset_class_or_strategy, row.investment_type]
                : key === "source"
                  ? [row.source, row.source_name, row.publisher]
                  : key === "institution"
                    ? [row.institution, row.organization, row.entity_name]
                    : [row.title, row.role, row.position];
  return values.map((value) => String(value || "").trim()).filter((value) => value && !/^(?:not disclosed|unavailable|loading)$/i.test(value));
}

function isDefunct(row) {
  const status = String(row.entity_status || row.status || "").trim().toLowerCase();
  return row.defunct === true || row.Defunct === true || status === "defunct" || status === "inactive";
}

function normalize(value) {
  return String(value || "").normalize("NFKD").replace(/[^a-zA-Z0-9]+/g, " ").trim().toLowerCase();
}

function queryValue(url) {
  try {
    return new URL(url).searchParams.get("q") || "";
  } catch {
    return "";
  }
}

function countValues(values) {
  return values.reduce((counts, value) => {
    counts[value] = (counts[value] || 0) + 1;
    return counts;
  }, {});
}

async function waitUntil(predicate, timeoutMs, message) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(message);
}
