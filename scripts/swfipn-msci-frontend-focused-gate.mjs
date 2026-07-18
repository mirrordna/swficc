#!/usr/bin/env node
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const origin = new URL(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/");
const requests = [];
let releasePeopleResponse = () => {};
const peopleResponseHold = new Promise((resolve) => {
  releasePeopleResponse = resolve;
});

function loadPlaywright() {
  const marker = path.join(repoRoot, "node_modules", "playwright", "package.json");
  return createRequire(marker)("playwright");
}

function packet(rows, extra = {}) {
  return {
    status: "ok",
    fact: true,
    generated_at: "2026-07-18T00:00:00Z",
    data: { rows, results: rows, count: rows.length, ...extra },
  };
}

function mandateRows(primaryTitle) {
  return [
    { title: primaryTitle, institution: "SWFI", region: "Europe", source_url: "https://www.swfi.com/v1/compass/222222222222222222222222" },
    ...Array.from({ length: 25 }, (_, index) => ({
      title: `Partial Coverage Mandate ${index + 2}`,
      institution: "SWFI",
      region: "Europe",
      source_url: `https://www.swfi.com/v1/compass/${(index + 2).toString(16).padStart(24, "0")}`,
    })),
  ];
}

const incompleteMandateCoverage = {
  count: null,
  source_total: null,
  coverage: { complete: false, reason: "stable_snapshot_or_cursor_contract_unavailable" },
};

async function fulfillApi(route) {
  const url = new URL(route.request().url());
  requests.push(url);
  let body = packet([]);
  if (url.pathname.endsWith("/api/source-intelligence/news/v1")) {
    body = packet([{ title: "Direct News Receipt", legacy_post: "101" }]);
  } else if (url.pathname.endsWith("/api/people/search/v1")) {
    await peopleResponseHold;
    body = packet([{ name: "RFPs in Europe Person Receipt", title: "Governor", source_url: "https://www.swfi.com/v1/people/111111111111111111111111" }]);
  } else if (url.pathname.endsWith("/api/live-opportunities/v1")) {
    body = url.searchParams.has("investment_type")
      ? packet(mandateRows("Filtered Mandate Receipt"), incompleteMandateCoverage)
      : packet(mandateRows("RFPs in Europe Opportunity Receipt"), incompleteMandateCoverage);
  }
  await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
}

async function main() {
  const contract = fs.readFileSync(path.join(repoRoot, "docs", "swfipn-phase2-backend-contracts.md"), "utf8");
  const rfpContract = contract.split("\n").find((line) => line.startsWith("| RFP Opportunities |"));
  assert.ok(rfpContract, "RFP Opportunities contract row is missing");
  for (const parameter of ["limit", "page", "investment_type", "ticket_min", "ticket_max", "ticket_currency"]) {
    assert.ok(rfpContract.includes("`" + parameter + "`"), `RFP contract is missing ${parameter}`);
  }

  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, timeout: 30_000, args: ["--disable-gpu"] });
  const context = await browser.newContext();
  await context.route("**/api/**", fulfillApi);
  const page = await context.newPage();
  try {
    const semanticQuery = "RFPs in Europe";
    const initialIntentRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/live-opportunities/v1") && url.searchParams.get("limit") === "100";
    }, { timeout: 30_000 });
    const directUrl = new URL(`search/?q=${encodeURIComponent(semanticQuery)}`, origin).href;
    await page.goto(directUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await initialIntentRequestPromise;
    await page.getByText("RFPs in Europe Opportunity Receipt", { exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });

    const requestBoundary = requests.length;
    const selectedCategoryRequestPromise = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/api/people/search/v1"), { timeout: 30_000 });
    await page.getByRole("button", { name: /^People \(/ }).click();
    const selectedCategoryRequest = new URL((await selectedCategoryRequestPromise).url());
    assert.equal(selectedCategoryRequest.searchParams.get("q"), semanticQuery);
    assert.equal(selectedCategoryRequest.searchParams.get("limit"), "100");
    assert.equal(await page.locator("[data-search-category]").getAttribute("data-search-category"), "people");
    assert.equal(await page.getByText("RFPs in Europe Opportunity Receipt", { exact: true }).count(), 0, "stale intent result remained visible while selected-category response was pending");
    const switchedRequests = requests.slice(requestBoundary);
    assert.ok(switchedRequests.some((url) => url.pathname.endsWith("/api/people/search/v1")));
    assert.equal(switchedRequests.some((url) => url.pathname.endsWith("/api/live-opportunities/v1")), false, "original semantic-intent request reran after category override");
    releasePeopleResponse();
    await page.getByText("RFPs in Europe Person Receipt", { exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
    assert.equal(await page.getByText("RFPs in Europe Opportunity Receipt", { exact: true }).count(), 0);

    requests.length = 0;
    const initialMandateRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/live-opportunities/v1")
        && url.searchParams.get("limit") === "25"
        && !url.searchParams.has("investment_type");
    }, { timeout: 30_000 });
    await page.goto(new URL("mandates/", origin).href, { waitUntil: "domcontentloaded", timeout: 60_000 });
    const initialMandateRequest = new URL((await initialMandateRequestPromise).url());
    assert.deepEqual([...initialMandateRequest.searchParams.keys()].sort(), ["limit", "page"]);
    await page.getByText("Observed RFP Records", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    await page.getByText("Analyzing 26 loaded Compass rows. Coverage partial: complete source snapshot unavailable.", { exact: true }).waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await page.getByText("Total RFP Records", { exact: true }).count(), 0, "partial Compass packet exposed a complete-universe total label");
    assert.equal(await page.getByText(/from 26 total records/i).count(), 0, "partial Compass packet described loaded rows as total records");
    assert.equal(await page.getByText(/Showing \d+ of \d+/).count(), 0, "partial Compass packet exposed complete-universe count wording");
    await page.getByRole("button", { name: "Records", exact: true }).click();
    await page.getByText("RFPs in Europe Opportunity Receipt", { exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });
    await page.getByText("Loaded Compass rows observed: 26; 26 shown. Coverage partial: complete source snapshot unavailable.", { exact: true }).first().waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await page.getByRole("button", { name: "Next", exact: true }).count(), 0, "partial loaded-row fallback enabled a deeper page");
    const mandateFilters = page.getByTestId("mandates-supported-filters");
    await mandateFilters.waitFor({ state: "visible", timeout: 30_000 });
    assert.equal(await mandateFilters.getAttribute("data-contract-status"), "supported");
    await page.getByTestId("mandates-investment-type-filter").fill("Infrastructure Fund");
    await page.getByTestId("mandates-ticket-min-filter").fill("1000000");
    await page.getByTestId("mandates-ticket-max-filter").fill("5000000");
    await page.getByTestId("mandates-ticket-currency-filter").fill("usd");
    const filteredMandateRequestPromise = page.waitForRequest((request) => {
      const url = new URL(request.url());
      return url.pathname.endsWith("/api/live-opportunities/v1") && url.searchParams.has("investment_type");
    }, { timeout: 30_000 });
    await page.getByTestId("mandates-apply-filters").click();
    const filteredMandateRequest = new URL((await filteredMandateRequestPromise).url());
    assert.deepEqual([...filteredMandateRequest.searchParams.keys()].sort(), ["investment_type", "limit", "page", "ticket_currency", "ticket_max", "ticket_min"]);
    assert.equal(filteredMandateRequest.searchParams.get("investment_type"), "Infrastructure Fund");
    assert.equal(filteredMandateRequest.searchParams.get("ticket_min"), "1000000");
    assert.equal(filteredMandateRequest.searchParams.get("ticket_max"), "5000000");
    assert.equal(filteredMandateRequest.searchParams.get("ticket_currency"), "USD");
    await page.getByText("Filtered Mandate Receipt", { exact: true }).filter({ visible: true }).waitFor({ timeout: 30_000 });

    console.log(JSON.stringify({
      status: "pass",
      recognized_intent: "regional-opportunities",
      switched_category: "people",
      switched_api: "/api/people/search/v1",
      stale_result_cleared_before_response: true,
      original_intent_request_replayed: false,
      switched_query_params: Object.fromEntries(selectedCategoryRequest.searchParams),
      mandate_contract_status: "supported",
      mandate_query_params: Object.fromEntries(filteredMandateRequest.searchParams),
    }, null, 2));
  } finally {
    releasePeopleResponse();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
