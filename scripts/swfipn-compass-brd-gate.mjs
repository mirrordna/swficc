#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-compass-brd-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-compass-brd-gate-latest.png");
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const apiResponses = [];
  const consoleErrors = [];
  page.on("response", (response) => {
    if (response.url().includes("/api/live-opportunities/v1")) apiResponses.push({ url: response.url(), status: response.status() });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const url = new URL("mandates/", origin).href;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForFunction(() => /Showing\s+[0-9,]+\s+of\s+[0-9,]+/i.test(document.body.innerText), null, { timeout: 120_000 });
  await page.getByRole("button", { name: "Visualization" }).click();
  await page.waitForSelector("[data-brd-compass-visualization=\"true\"]", { timeout: 10_000 });
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const body = await page.locator("body").innerText();
  const requiredText = [
    "Compass RFP Analytics",
    "Data",
    "Visualization",
    "Total Open RFPs",
    "Total Capital Sought",
    "Average Ticket Size",
    "RFPs by Investment Type",
    "RFPs by Region",
    "RFPs Posted Per Month"
  ];
  const lowerBody = body.toLowerCase();
  const missing = requiredText.filter((text) => !lowerBody.includes(text.toLowerCase()));
  const chartCount = await page.locator("[data-brd-compass-visualization=\"true\"] svg, [data-brd-compass-visualization=\"true\"] .bg-\\[\\#5C9BD6\\]").count();
  const filterLinks = await page.locator("[data-brd-compass-visualization=\"true\"] a[href*='/swficc/mandates/'][href*='filter=']").count();
  const showing = body.match(/Showing\s+[^\n]+/)?.[0] || "";
  const internalLeaks = ["Active Mirror", "source_gap", "backend_http", "backend_fetch", "undefined", "null"].filter((needle) => body.includes(needle));
  const failures = [];
  if ((response?.status() || 0) >= 400) failures.push(`http_${response?.status() || 0}`);
  if (!apiResponses.some((item) => item.status === 200)) failures.push("missing_live_opportunities_api_200");
  if (missing.length) failures.push(`missing_text:${missing.join("|")}`);
  if (chartCount < 3) failures.push(`chart_count_${chartCount}_lt_3`);
  if (filterLinks < 1) failures.push("missing_clickable_chart_filters");
  if (!showing) failures.push("missing_count_text");
  if (internalLeaks.length) failures.push(`internal_leaks:${internalLeaks.join("|")}`);
  if (consoleErrors.length) failures.push("console_errors_present");

  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.compass_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    url,
    status,
    summary: {
      showing,
      api_200: apiResponses.some((item) => item.status === 200),
      missing,
      chart_count: chartCount,
      clickable_chart_filters: filterLinks,
      internal_leaks: internalLeaks,
      console_errors: consoleErrors.slice(0, 10),
      failures
    },
    api_responses: apiResponses,
    screenshot: screenshotPath
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
