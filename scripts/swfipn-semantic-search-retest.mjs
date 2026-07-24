#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:4317").replace(/\/$/, "");
const TIMEOUT_MS = Number(process.env.SWFIPN_SEMANTIC_TIMEOUT_MS || 45_000);
const RECEIPT = process.env.SWFIPN_SEMANTIC_RECEIPT || "output/swfipn-semantic-search-retest-latest.json";
const cases = [
  ["Top Active Investors", "Transaction-buyer entities ranked by sourced 30-day activity count", 1, "entities"],
  ["RFPs from the Middle East", "Current RFP, mandate, and opportunity records with sourced region Middle East", 1, "opportunities"],
  ["Sovereign Wealth Funds investing in AI", "AI transactions in the last 365 days with a sourced Sovereign Wealth Fund buyer", 1, "transactions"],
  ["Pension Funds in Europe", "Pension funds with a sourced region in Europe", 5, "entities"],
  ["Open manager searches in EMEA", "Current RFP, mandate, and opportunity records with sourced region EMEA", 1, "opportunities"],
  ["Central banks in APAC", "Central banks with a sourced region in APAC", 5, "entities"],
  ["Family offices deploying capital into real estate", "real estate transactions in the last 365 days with a sourced family-office buyer", 1, "transactions"],
];
const checks = [];
const browser = await chromium.launch({ headless: true });

try {
  for (const [query, explanation, minimumRows, category] of cases) {
    const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
    page.setDefaultTimeout(TIMEOUT_MS);
    const startedAt = Date.now();
    try {
      await page.goto(`${ORIGIN}/swficc/search/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
      const interpretation = page.getByText(`Interpreted as: ${explanation}`, { exact: true });
      await interpretation.waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(
        `main[data-search-results-query="${query.trim().toLowerCase()}"][data-search-results-ready="true"]`,
      ).waitFor({ state: "visible", timeout: TIMEOUT_MS });
      const rows = page.getByTestId("search-result-row");
      const rowCount = await rows.count();
      const typeLabels = (await rows.getByTestId("search-result-record-type").allTextContents()).map((value) => value.trim());
      const matchedBuyerCount = await rows.locator("td:nth-child(4)").filter({ hasText: "Matched buyer:" }).count();
      const exactTypeProof = category === "opportunities"
        ? typeLabels.every((label) => /\b(?:RFP|Opportunity)\b/.test(label))
        : category === "entities"
          ? typeLabels.every((label) => !/^Entities$/i.test(label))
          : typeLabels.every((label) => !/^Transactions$/i.test(label));
      checks.push({
        id: `semantic_${query.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        status: rowCount >= minimumRows && exactTypeProof && (category !== "transactions" || matchedBuyerCount === rowCount) ? "PASS" : "FAIL",
        query,
        elapsed_ms: Date.now() - startedAt,
        interpretation: explanation,
        row_count: rowCount,
        minimum_rows: minimumRows,
        type_labels: typeLabels.slice(0, 12),
        matched_buyer_count: matchedBuyerCount,
      });
    } catch (error) {
      const requests = await page.locator("body").innerText().catch(() => "");
      checks.push({
        id: `semantic_${query.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
        status: "FAIL",
        query,
        elapsed_ms: Date.now() - startedAt,
        error: String(error?.message || error),
        visible_text: requests.slice(0, 1000),
      });
    } finally {
      await page.close();
    }
  }

  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  page.setDefaultTimeout(TIMEOUT_MS);
  try {
    await page.goto(`${ORIGIN}/swficc/`, { waitUntil: "domcontentloaded", timeout: TIMEOUT_MS });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    const dialog = page.getByRole("dialog", { name: "Global Search" });
    await dialog.getByRole("textbox", { name: "Search query" }).fill("ADIA");
    await dialog.getByRole("heading", { name: "Entities" }).waitFor({ state: "visible" });
    await dialog.getByRole("heading", { name: "RFPs & Opportunities" }).waitFor({ state: "visible" });
    await dialog.getByRole("heading", { name: "Transactions" }).waitFor({ state: "visible" });
    const viewAll = dialog.getByRole("link", { name: "View all results" });
    const viewAllHref = await viewAll.getAttribute("href");
    const detailedFilterLeak = await dialog.getByText(/^(?:Country|Region|Entity Type|Buyer|Seller|Sector)$/).count();
    await viewAll.click();
    await page.getByTestId("search-result-category-refinements").waitFor({ state: "visible" });
    await page.locator('main[data-search-results-query="adia"][data-search-results-ready="true"]').waitFor({
      state: "visible",
      timeout: TIMEOUT_MS,
    });
    const queryPreserved = await page.getByRole("searchbox", { name: "Smart Search" }).inputValue();
    const categoryButtons = await page.getByTestId("search-result-category-refinements").getByRole("button").count();
    checks.push({
      id: "two_screen_transition",
      status: viewAllHref?.includes("q=ADIA") && detailedFilterLeak === 0 && queryPreserved === "ADIA" && categoryButtons === 6 ? "PASS" : "FAIL",
      view_all_href: viewAllHref,
      initial_detailed_filter_leak_count: detailedFilterLeak,
      detailed_query: queryPreserved,
      category_refinement_buttons: categoryButtons,
    });

    await page.getByTestId("search-result-category-refinements").getByRole("button", { name: /^Transactions \(/ }).click();
    await page.waitForFunction(() => /[?&]category=transactions/.test(window.location.search));
    await page.locator('main[data-search-results-ready="true"] section[data-search-category="transactions"]').waitFor({
      state: "visible",
      timeout: TIMEOUT_MS,
    });
    const transactionRows = page.getByTestId("search-result-row");
    checks.push({
      id: "detailed_category_refinement",
      status: await transactionRows.count() === 10 ? "PASS" : "FAIL",
      url: page.url(),
      visible_transaction_rows: await transactionRows.count(),
    });
  } catch (error) {
    checks.push({ id: "two_screen_transition", status: "FAIL", error: String(error?.message || error) });
  } finally {
    await page.close();
  }
} finally {
  await browser.close();
}

const failures = checks.filter((check) => check.status !== "PASS");
const receipt = {
  schema_version: "swfipn.semantic_search_retest.v1",
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  status: failures.length ? "fail" : "pass",
  checks,
  failures: failures.map((check) => check.id),
  pending_external_requirements: [
    "Exact field-level filters for each result category are pending Prem/Jaykesh specification.",
    "CALA and Southeast Asia country membership require an approved SWFI regional map.",
    "Top allocators requires an approved ranking metric when the user does not say activity or AUM.",
  ],
};
mkdirSync("output", { recursive: true });
writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: RECEIPT, failures: receipt.failures }, null, 2));
if (failures.length) process.exit(1);
