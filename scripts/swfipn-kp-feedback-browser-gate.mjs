#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:4317").replace(/\/swficc\/?$/, "").replace(/\/$/, "");
const checks = [];

function check(id, pass, evidence) {
  checks.push({ id, status: pass ? "PASS" : "FAIL", evidence: String(evidence || "").slice(0, 800) });
}

async function json(path) {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { accept: "application/json", "X-SWFIPN-Public": "1" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

function dataRows(packet) {
  return packet?.data?.rows || packet?.data?.results || [];
}

function compactRankedUsd(value) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 2 }).format(Number(value));
}

const browser = await chromium.launch({ headless: true });

try {
  const smartSearchCases = [
    ["Top Active Investors", "Transaction-buyer entities ranked by sourced 30-day activity count"],
    ["RFPs from the Middle East", "Current RFP, mandate, and opportunity records with sourced region Middle East"],
    ["Sovereign Wealth Funds investing in AI", "AI transactions in the last 365 days with a sourced Sovereign Wealth Fund buyer"],
    ["Pension Funds in Europe", "Pension funds with a sourced region in Europe"],
    ["Family offices in MENA", "Family offices with a sourced region in Middle East"],
    ["Central banks in APAC", "Central banks with a sourced region in APAC"],
    ["Pension plans investing in healthcare in the last 90 days", "healthcare transactions in the last 90 days with a sourced pension-fund buyer"],
    ["Family offices deploying capital into real estate", "real estate transactions in the last 365 days with a sourced family-office buyer"],
  ];

  const smartResults = await Promise.all(smartSearchCases.map(async ([query, explanation]) => {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    page.setDefaultTimeout(120_000);
    try {
      await page.goto(`${ORIGIN}/swficc/search/?q=${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
      await page.getByText(`Interpreted as: ${explanation}`, { exact: true }).waitFor({ state: "visible" });
      await page.waitForFunction(() => /All categories · Showing [1-9][\d,]* of [1-9][\d,]*/.test(document.body.innerText), null, { timeout: 120_000 });
      const body = await page.locator("body").innerText();
      const resultSummary = body.match(/All categories · Showing ([\d,]+) of ([\d,]+)/)?.[0] || "";
      const resultRows = await page.locator("main tbody tr").count();
      const sourceHandoffs = await page.locator('main tbody a[href*="www.swfi.com/v1/signin/"]').count();
      const detailCells = (await page.locator("main tbody tr td:nth-child(4)").allTextContents()).map((value) => value.trim());
      const requiresMatchedBuyer = query === "Sovereign Wealth Funds investing in AI";
      const minimumRows = query === "Pension Funds in Europe" ? 10 : 1;
      return {
        query,
        explanation,
        resultSummary,
        resultRows,
        sourceHandoffs,
        matchingBuyerEvidence: detailCells.filter((value) => value.startsWith("Matched buyer:")),
        pass: resultRows >= minimumRows
          && sourceHandoffs > 0
          && (!requiresMatchedBuyer || detailCells.every((value) => value.startsWith("Matched buyer:"))),
      };
    } finally {
      await page.close();
    }
  }));

  smartResults.forEach((result) => {
    check(`smart_search_${result.query.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`, result.pass, JSON.stringify(result));
  });
  console.log("kp-feedback-gate: smart search complete");

  const aumPacket = await json("/v1/swfi/top20?limit=25");
  const expectedAumRows = dataRows(aumPacket)
    .filter((row) => Number.isFinite(Number(row.aum_usd)) && Number(row.aum_usd) > 0)
    .sort((a, b) => Number(b.aum_usd) - Number(a.aum_usd));
  const sourceAumFailures = expectedAumRows.filter((row) =>
    String(row.aum_currency || "").toUpperCase() !== "USD"
    || !String(row.aum_usd_basis || "").trim()
    || !String(row.aum_usd_source || "").trim()
    || !String(row.aum_date || "").trim()
  );
  check(
    "aum_rank_source_has_usd_provenance",
    expectedAumRows.length >= 10 && sourceAumFailures.length === 0,
    JSON.stringify({ rows: expectedAumRows.length, failures: sourceAumFailures.map((row) => row.name) }),
  );
  const aumPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  aumPage.setDefaultTimeout(120_000);
  await aumPage.goto(`${ORIGIN}/swficc/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const ranking = aumPage.getByTestId("top-aum-ranking");
  await ranking.waitFor({ state: "visible" });
  await ranking.locator("a").first().waitFor({ state: "visible" });
  const rankingBasis = await ranking.getAttribute("data-aum-basis");
  const renderedAumRows = (await ranking.locator("a").allTextContents()).map((value) => value.replace(/\s+/g, " ").trim());
  check(
    "aum_dashboard_matches_proven_usd_rank",
    rankingBasis === "proven-usd"
      && Boolean(expectedAumRows[0]?.name)
      && renderedAumRows[0]?.startsWith(expectedAumRows[0].name)
      && renderedAumRows.every((value, index) => value.endsWith(`USD ${compactRankedUsd(expectedAumRows[index]?.aum_usd)}`)),
    JSON.stringify({ basis: rankingBasis, source_first: expectedAumRows[0]?.name, rendered: renderedAumRows }),
  );
  await aumPage.screenshot({ path: "output/swfipn-kp-aum-ranking-latest.png", fullPage: true });
  await aumPage.close();

  const directoryPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  directoryPage.setDefaultTimeout(120_000);
  await directoryPage.goto(`${ORIGIN}/swficc/profiles/?filter=${encodeURIComponent("Sovereign Wealth Fund")}`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await directoryPage.getByRole("button", { name: "Entity Name asc" }).waitFor({ state: "visible" });
  await directoryPage.getByText("AUM retains its source currency and is not ranked across currencies.", { exact: false }).waitFor({ state: "visible" });
  const nativeAumHeader = directoryPage.locator('[data-aum-comparability="source-currency-only"]');
  const sortableAumButtons = await directoryPage.getByRole("button", { name: /AUM (?:asc|desc)/ }).count();
  check(
    "aum_directory_discloses_non_comparability",
    await nativeAumHeader.isVisible() && sortableAumButtons === 0,
    JSON.stringify({ header: await nativeAumHeader.innerText(), sortable_aum_buttons: sortableAumButtons }),
  );
  await directoryPage.close();
  console.log("kp-feedback-gate: AUM ranking complete");

  const dealsPage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  dealsPage.setDefaultTimeout(120_000);
  await dealsPage.goto(`${ORIGIN}/swficc/deals/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await dealsPage.waitForFunction(() => /Showing 25 of [\d,]+/.test(document.body.innerText) && document.body.innerText.includes("4 of 4 SWFI record sets ready"), null, { timeout: 120_000 });
  await dealsPage.getByRole("button", { name: "Records" }).click();
  console.log("kp-feedback-gate: deals source sets ready");

  async function selectFirstTwo(testId) {
    const field = dealsPage.getByTestId(testId);
    const details = field.locator("details");
    await details.locator("summary").click();
    const labels = (await details.locator('label:has(input[type="checkbox"]) span').allTextContents()).map((value) => value.trim()).filter(Boolean).slice(0, 2);
    if (labels.length < 2) throw new Error(`${testId}: fewer than two source options`);
    for (const label of labels) {
      if (!(await details.evaluate((element) => element.open))) await details.locator("summary").click();
      await details.locator("label", { hasText: label }).first().click();
    }
    await field.locator("summary").filter({ hasText: "2 selected" }).waitFor({ state: "visible" });
    if (await details.evaluate((element) => element.open)) await details.locator("summary").click();
    return labels;
  }

  async function addCustomPair(testId, values) {
    const field = dealsPage.getByTestId(testId);
    for (const value of values) {
      console.log(`kp-feedback-gate: ${testId} adding ${value}`);
      const details = field.locator("details");
      const isOpen = await details.evaluate((element) => element.open);
      console.log(`kp-feedback-gate: ${testId} details open=${isOpen}`);
      if (!isOpen) await details.locator("summary").click();
      console.log(`kp-feedback-gate: ${testId} details visible`);
      const input = details.locator('input[type="search"]');
      await input.fill(value);
      console.log(`kp-feedback-gate: ${testId} custom input filled`);
      await input.press("Enter");
      console.log(`kp-feedback-gate: ${testId} added ${value}`);
    }
    await field.locator("summary").filter({ hasText: "2 selected" }).waitFor({ state: "visible" });
    const details = field.locator("details");
    if (await details.evaluate((element) => element.open)) await details.locator("summary").click();
    return values;
  }

  const entityTypes = await selectFirstTwo("deals-entity-type-multiselect");
  console.log("kp-feedback-gate: entity type multiselect complete");
  const industries = await addCustomPair("deals-industry-multiselect", ["Infrastructure", "Software"]);
  console.log("kp-feedback-gate: industry multiselect complete");
  const sectors = await addCustomPair("deals-sector-multiselect", ["Infrastructure", "Information Technology"]);
  console.log("kp-feedback-gate: sector multiselect complete");
  const primarySelectedCounts = await Promise.all([
    "deals-entity-type-multiselect",
    "deals-industry-multiselect",
    "deals-sector-multiselect",
  ].map(async (id) => dealsPage.getByTestId(id).locator("summary").innerText()));
  check(
    "deals_primary_multiselect_all_filters",
    primarySelectedCounts.every((text) => text.includes("2 selected")),
    JSON.stringify({ entityTypes, industries, sectors, primarySelectedCounts }),
  );

  const drilldownPackets = await Promise.all([
    ["industry", "Infrastructure"],
    ["industry", "Software"],
    ["sector", "Infrastructure"],
    ["sector", "Information Technology"],
  ].map(async ([field, value]) => {
    const endpoint = `/api/transaction-drilldown/v1?field=${field}&value=${encodeURIComponent(value)}&days=365&limit=25&page=1`;
    const packet = await json(endpoint);
    return { endpoint, fact: packet?.fact === true, rows: dataRows(packet).length };
  }));
  check(
    "deals_drilldown_contract",
    drilldownPackets.every((row) => row.fact && row.rows > 0 && !/[?&]days=(?:1095|3650)(?:&|$)/.test(row.endpoint)),
    JSON.stringify(drilldownPackets),
  );

  await dealsPage.waitForTimeout(2_000);
  await dealsPage.screenshot({ path: "output/swfipn-kp-deals-multiselect-latest.png", fullPage: true });
  await dealsPage.setViewportSize({ width: 390, height: 844 });
  await dealsPage.waitForTimeout(500);
  const mobileWidth = await dealsPage.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  check("deals_mobile_horizontal_containment", mobileWidth.document <= mobileWidth.viewport, JSON.stringify(mobileWidth));
  await dealsPage.close();

  const enginePage = await browser.newPage({ viewport: { width: 1440, height: 1050 } });
  enginePage.setDefaultTimeout(120_000);
  const engineResponses = [];
  enginePage.on("response", (response) => {
    if (response.url().includes("/api/transaction-drilldown/v1")) engineResponses.push({ url: response.url(), status: response.status() });
  });
  await enginePage.goto(`${ORIGIN}/swficc/deals/`, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await enginePage.waitForFunction(() => document.body.innerText.includes("4 of 4 SWFI record sets ready"), null, { timeout: 120_000 });
  const engineField = enginePage.getByTestId("capital-deal-engine-multiselect");
  await engineField.locator("summary").click();
  const engineSecondOption = (await engineField.locator('label:has(input[type="checkbox"]:not(:checked)) span').first().innerText()).trim();
  await engineField.locator("label", { hasText: engineSecondOption }).first().click();
  await engineField.locator("summary").filter({ hasText: "2 selected" }).waitFor({ state: "visible" });
  if (await engineField.locator("details").evaluate((element) => element.open)) await engineField.locator("summary").click();
  engineResponses.length = 0;
  await enginePage.getByRole("button", { name: "Apply", exact: true }).click();
  for (let attempt = 0; attempt < 45 && engineResponses.filter((row) => row.status === 200).length < 2; attempt += 1) {
    await enginePage.waitForTimeout(1_000);
  }
  console.log("kp-feedback-gate: Capital Deal Engine multiselect complete");
  const periodOptions = await enginePage.getByRole("combobox", { name: "Period" }).locator("option").allTextContents();
  check(
    "capital_deal_engine_multiselect",
    (await engineField.locator("summary").innerText()).includes("2 selected")
      && !periodOptions.some((value) => /3 years/i.test(value))
      && engineResponses.filter((row) => row.status === 200).length >= 2,
    JSON.stringify({ selected: ["Infrastructure", engineSecondOption], periodOptions, responses: engineResponses.slice(-6) }),
  );
  await enginePage.screenshot({ path: "output/swfipn-kp-capital-deal-engine-latest.png", fullPage: true });
  await enginePage.close();
} finally {
  await browser.close();
}

mkdirSync("output", { recursive: true });
const receipt = {
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  pass: checks.every((item) => item.status === "PASS"),
  checks,
};
writeFileSync("output/swfipn-kp-feedback-browser-latest.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ pass: receipt.pass, checks: checks.length, failing: checks.filter((item) => item.status === "FAIL").map((item) => item.id) }, null, 2));
if (!receipt.pass) process.exitCode = 1;
