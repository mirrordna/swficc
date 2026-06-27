#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-section-visualization-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const ROUTES = [
  { id: "entities", route: "/profiles/", selector: "[data-brd-section-visualization='profiles']", required: ["Institution Data Visualization", "Records by Category", "Records by Geography", "Top Loaded Records"] },
  { id: "people", route: "/people/", selector: "[data-brd-section-visualization='people']", required: ["People Data Visualization", "Records by Category", "Records by Geography", "Top Loaded Records"] },
  { id: "transactions", route: "/transactions/", selector: "[data-brd-section-visualization='transactions']", required: ["Transaction Data Visualization", "Records by Category", "Records by Geography", "Top Loaded Records"] },
  { id: "deals", route: "/deals/", selector: "[data-brd-section-visualization='deals']", required: ["Transaction Data Visualization", "Records by Category", "Records by Geography", "Top Loaded Records"] },
  { id: "compass", route: "/mandates/", selector: "[data-brd-compass-visualization='true']", required: ["Compass RFP Analytics", "RFPs by Investment Type", "RFPs by Region", "RFPs Posted Per Month"] },
  { id: "reports", route: "/reports/", selector: "[data-brd-reports-visualization='true']", required: ["Reports / League Tables Visualization", "Reports by Type", "Market Activity by Sector", "League Tables"] },
];

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const checks = [];
  for (const spec of ROUTES) {
    checks.push(await checkRoute(page, spec));
  }

  const failures = checks.flatMap((check) => check.failures.map((failure) => `${check.id}:${failure}`));
  if (consoleErrors.length) failures.push("console_errors_present");
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.section_visualization_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status,
    summary: {
      routes: checks.length,
      passed_routes: checks.filter((check) => check.status === "pass").length,
      failed_routes: checks.filter((check) => check.status !== "pass").length,
      chart_filter_links: checks.reduce((sum, check) => sum + check.chart_filter_links, 0),
      export_csv_buttons: checks.reduce((sum, check) => sum + check.export_csv_buttons, 0),
      export_png_buttons: checks.reduce((sum, check) => sum + check.export_png_buttons, 0),
      console_errors: consoleErrors.slice(0, 10),
      failures,
    },
    checks,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

async function checkRoute(page, spec) {
  const url = appUrl(spec.route);
  const screenshot = path.join(outputDir, `swfipn-section-visualization-${spec.id}.png`);
  const failures = [];
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => /Showing\s+[0-9,]+\s+of\s+[0-9,]+|Reports Intelligence/i.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => null);
  if (spec.id === "reports") {
    await page.waitForFunction(() => /Quarterly Reports[\s\S]*Showing\s+\d+\s+of\s+\d+/i.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => null);
  }
  const visualizationButton = page.getByRole("button", { name: "Visualization" }).first();
  if (await visualizationButton.count()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await visualizationButton.click({ timeout: 15_000 });
      const opened = await page.waitForSelector(spec.selector, { timeout: 5_000 }).then(() => true).catch(() => false);
      if (opened) break;
      await page.waitForTimeout(1000);
    }
  } else {
    failures.push("missing_visualization_button");
  }
  await page.waitForSelector(spec.selector, { timeout: 30_000 }).catch(() => failures.push("missing_visualization_panel"));
  await page.screenshot({ path: screenshot, fullPage: true });

  const body = await page.locator("body").innerText();
  const panelText = await page.locator(spec.selector).innerText({ timeout: 10_000 }).catch(() => "");
  const missing = spec.required.filter((item) => !body.includes(item));
  const exportCsvButtons = await page.locator(`${spec.selector} button`, { hasText: "Export CSV" }).count();
  const exportPngButtons = await page.locator(`${spec.selector} button`, { hasText: "Export PNG" }).count();
  const chartFilterLinks = await page.locator(`${spec.selector} a[href*='filter=']`).count();
  const svgCount = await page.locator(`${spec.selector} svg`).count();
  const internalLeaks = ["Active Mirror", "source_gap", "backend_http", "undefined", "null"].filter((needle) => panelText.includes(needle));

  if ((response?.status() || 0) >= 400) failures.push(`http_${response?.status() || 0}`);
  if (missing.length) failures.push(`missing_text:${missing.join("|")}`);
  if (exportCsvButtons < 1) failures.push("missing_export_csv");
  if (exportPngButtons < 1) failures.push("missing_export_png");
  if (chartFilterLinks < 1) failures.push("missing_clickable_chart_filters");
  if (chartFilterLinks < 1 && svgCount < 1) failures.push("missing_chart_visual");
  if (internalLeaks.length) failures.push(`internal_leaks:${internalLeaks.join("|")}`);

  return {
    id: spec.id,
    route: spec.route,
    url,
    status: failures.length ? "fail" : "pass",
    missing,
    chart_filter_links: chartFilterLinks,
    export_csv_buttons: exportCsvButtons,
    export_png_buttons: exportPngButtons,
    svg_count: svgCount,
    screenshot,
    failures,
  };
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
