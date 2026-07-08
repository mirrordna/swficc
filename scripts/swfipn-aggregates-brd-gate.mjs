#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const backendOrigin = normalizeBackend(process.env.SWFIPN_BACKEND_ORIGIN || origin);
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-aggregates-brd-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-aggregates-brd-gate-latest.png");
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  const apiChecks = await checkApi();
  const pageCheck = await checkPage();
  const failures = [
    ...apiChecks.failures.map((failure) => `api:${failure}`),
    ...pageCheck.failures.map((failure) => `page:${failure}`),
  ];
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.aggregates_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    status,
    summary: {
      failures,
      api_status: apiChecks.status,
      page_status: pageCheck.status,
      point_count: apiChecks.point_count,
      raw_point_count: apiChecks.raw_point_count,
      estimated_points: apiChecks.estimated_points,
      none_gap_count: apiChecks.none_gap_count,
      smoothing_methods: apiChecks.smoothing_methods,
      chart_present: pageCheck.chart_present,
      export_csv: pageCheck.export_csv,
      export_png: pageCheck.export_png,
      internal_leaks: pageCheck.internal_leaks,
      console_errors: pageCheck.console_errors,
    },
    api: apiChecks,
    page: pageCheck,
    screenshot: screenshotPath,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  if (status === "fail") process.exit(1);
}

async function checkApi() {
  const failures = [];
  const url = new URL("/api/entities/aggregates/v1?entity_class=pensions&region=all&smoothing=linear&start_year=1971", backendOrigin).href;
  const noneUrl = new URL("/api/entities/aggregates/v1?entity_class=pensions&region=all&smoothing=none&start_year=1971", backendOrigin).href;
  const response = await fetch(url, { headers: { Accept: "application/json", "x-swfipn-internal": "1" } });
  const packet = await response.json().catch(() => ({}));
  const noneResponse = await fetch(noneUrl, { headers: { Accept: "application/json", "x-swfipn-internal": "1" } });
  const nonePacket = await noneResponse.json().catch(() => ({}));
  const data = packet.data && typeof packet.data === "object" ? packet.data : {};
  const noneData = nonePacket.data && typeof nonePacket.data === "object" ? nonePacket.data : {};
  const points = Array.isArray(data.points) ? data.points : [];
  const rawPoints = Array.isArray(data.raw_points) ? data.raw_points : [];
  const nonePoints = Array.isArray(noneData.points) ? noneData.points : [];
  const smoothingMethods = Array.isArray(data.smoothing_methods) ? data.smoothing_methods : [];
  const provenance = packet.provenance && typeof packet.provenance === "object" ? packet.provenance : {};
  const sourceCollections = Array.isArray(provenance.source_collections) ? provenance.source_collections : [];
  const estimatedPoints = points.filter((point) => point && point.estimated === true).length;
  const rawGapCount = nonePoints.filter((point) => point && point.gap === true).length;

  if (!response.ok) failures.push(`http_${response.status}`);
  if (packet.status !== "ok") failures.push(`packet_status_${packet.status || "missing"}`);
  if (!points.length) failures.push("missing_points");
  if (!rawPoints.length) failures.push("missing_raw_points");
  if (rawGapCount > 0 && estimatedPoints < 1) failures.push("missing_estimated_points_for_raw_gaps");
  for (const method of ["linear", "forward_fill", "rolling_3y", "none"]) {
    if (!smoothingMethods.includes(method)) failures.push(`missing_smoothing_${method}`);
  }
  if (!String(data.calculation_method || "").includes("server_side_query_time_aum_smoothing")) failures.push("missing_server_side_calculation_method");
  if (!String(data.calculation_method || "").includes("raw entitiesAUM rows are not modified")) failures.push("missing_raw_preservation_statement");
  if (!sourceCollections.includes("entities") || !sourceCollections.includes("entitiesAUM")) failures.push("wrong_source_collections");
  if (!noneResponse.ok || nonePacket.status !== "ok") failures.push("none_smoothing_unavailable");
  if (rawGapCount < 1 && nonePoints.length > rawPoints.length) failures.push("none_smoothing_does_not_show_gaps");

  return {
    status: failures.length ? "fail" : "pass",
    url,
    none_url: noneUrl,
    response_status: response.status,
    none_response_status: noneResponse.status,
    packet_status: packet.status || null,
    point_count: points.length,
    raw_point_count: rawPoints.length,
    estimated_points: estimatedPoints,
    none_gap_count: rawGapCount,
    smoothing_methods: smoothingMethods,
    source_collections: sourceCollections,
    failures,
  };
}

async function checkPage() {
  const failures = [];
  const consoleErrors = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  const url = new URL("profiles/aggregates/", origin).href;
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await page.waitForSelector("[data-brd-aggregates='true']", { timeout: 90_000 }).catch(() => failures.push("missing_aggregates_panel"));
  await page.waitForFunction(() => /Historical AUM Charts/i.test(document.body.innerText), null, { timeout: 90_000 }).catch(() => failures.push("missing_title"));
  await page.waitForFunction(() => !/Loading/.test(document.body.innerText), null, { timeout: 120_000 }).catch(() => failures.push("permanent_loading"));
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const body = await page.locator("body").innerText();
  const chartPresent = await page.locator("[data-brd-aggregates='true'] svg").count();
  // Dashboard 2.0 P05: exports are sign-in gated — the gate asserts the
  // sign-in export link instead of public download buttons.
  const signinExport = await page.getByRole("link", { name: "Sign in on SWFI to export" }).count();
  const smoothing = await page.locator("#aggregate-smoothing").count();
  const classButtons = await page.locator("button", { hasText: "Pensions" }).count();
  const regionButtons = await page.locator("button", { hasText: "United States" }).count();
  const internalLeaks = ["Active Mirror", "source_gap", "backend_http", "backend_fetch", "undefined", "null"].filter((needle) => body.includes(needle));
  if ((response?.status() || 0) >= 400) failures.push(`http_${response?.status() || 0}`);
  if (!chartPresent) failures.push("missing_chart");
  if (!signinExport) failures.push("missing_signin_gated_export");
  if (!smoothing) failures.push("missing_smoothing_dropdown");
  if (!classButtons) failures.push("missing_entity_class_tabs");
  if (!regionButtons) failures.push("missing_region_tabs");
  if (internalLeaks.length) failures.push(`internal_leaks:${internalLeaks.join("|")}`);
  if (consoleErrors.length) failures.push("console_errors_present");

  await browser.close();
  return {
    status: failures.length ? "fail" : "pass",
    url,
    response_status: response?.status() || null,
    chart_present: chartPresent,
    export_csv: exportCsv,
    export_png: exportPng,
    smoothing_dropdown: smoothing,
    entity_class_tabs: classButtons,
    region_tabs: regionButtons,
    internal_leaks: internalLeaks,
    console_errors: consoleErrors.slice(0, 10),
    failures,
  };
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function normalizeBackend(value) {
  const parsed = new URL(value);
  return parsed.origin;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
