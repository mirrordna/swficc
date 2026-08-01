#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-search-category-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-search-category-gate-failure.png");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8399/swficc/");
const cases = [
  { id: "entities", query: "PIF", category: "entities", label: "Entities", destination: "entities" },
  { id: "people", query: "Yasir Al-Rumayyan", category: "people", label: "People", destination: "people" },
  { id: "transactions", query: "GIC", category: "transactions", label: "Transactions", destination: "transactions" },
  { id: "opportunities", query: "National Pension Service", category: "opportunities", label: "RFPs & Opportunities", destination: "compass" },
  { id: "news", query: "GIC", category: "news", label: "News & Articles", destination: "news" },
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function categoryUrl(testCase) {
  const url = new URL("search/", origin);
  url.searchParams.set("q", testCase.query);
  url.searchParams.set("category", testCase.category);
  return url.href;
}

function destinationMatches(href, destination) {
  try {
    const parsed = new URL(href);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (destination === "news") {
      return (parsed.pathname === "/" || parsed.pathname === "") && /^\d+$/.test(parsed.searchParams.get("p") || "");
    }
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    if (parsed.searchParams.get("msg") !== "auth") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    return new RegExp(`^/v1/${destination}/[a-f0-9]{24}/?$`, "i").test(redirect);
  } catch {
    return false;
  }
}

async function inspectCase(page, testCase) {
  const consoleErrors = [];
  const onConsole = (message) => {
    if (["error", "warning"].includes(message.type())) consoleErrors.push(`${message.type()}: ${message.text()}`);
  };
  const onPageError = (error) => consoleErrors.push(error.message);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  const result = {
    id: testCase.id,
    query: testCase.query,
    category: testCase.category,
    expected_label: testCase.label,
    expected_destination: testCase.destination,
    url: categoryUrl(testCase),
    status: 0,
    search_render: "",
    rendered_category: "",
    row_types: [],
    result_count: 0,
    matching_destination_count: 0,
    sample_href: "",
    console_errors: [],
    failures: [],
  };
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    result.status = response?.status() || 0;
    result.search_render = String(response?.headers()?.["x-swfipn-search-render"] || "").toLowerCase();
    await page.waitForSelector(`[data-search-category="${testCase.category}"]`, { timeout: 30_000 });
    await page.waitForFunction((expectedLabel) => {
      const row = document.querySelector("tbody tr");
      const firstCell = row?.querySelector("td")?.textContent?.trim() || "";
      return firstCell === expectedLabel;
    }, testCase.label, { timeout: 60_000 });
    const snapshot = await page.evaluate(() => {
      const section = document.querySelector("[data-search-category]");
      const rows = [...document.querySelectorAll("tbody tr")];
      return {
        category: section?.getAttribute("data-search-category") || "",
        rowTypes: rows.map((row) => row.querySelector("td")?.textContent?.trim() || "").filter(Boolean),
        hrefs: rows.flatMap((row) => [...row.querySelectorAll("a[href]")].map((anchor) => anchor.href)),
      };
    });
    result.rendered_category = snapshot.category;
    result.row_types = [...new Set(snapshot.rowTypes)];
    result.result_count = snapshot.rowTypes.length;
    const destinations = snapshot.hrefs.filter((href) => destinationMatches(href, testCase.destination));
    result.matching_destination_count = destinations.length;
    result.sample_href = destinations[0] || snapshot.hrefs[0] || "";
    if (result.status !== 200) result.failures.push(`http_${result.status || "missing"}`);
    if (result.search_render === "server") result.failures.push("category_route_used_generic_server_fallback");
    if (result.rendered_category !== testCase.category) result.failures.push(`rendered_category_${result.rendered_category || "missing"}_ne_${testCase.category}`);
    if (!result.result_count) result.failures.push("no_result_rows");
    if (result.row_types.some((label) => label !== testCase.label)) result.failures.push(`wrong_row_types:${result.row_types.join("|")}`);
    if (!result.matching_destination_count) result.failures.push(`missing_swfi_${testCase.destination}_destination`);
    if (consoleErrors.length) result.failures.push(`console_or_page_errors:${consoleErrors.length}`);
  } catch (error) {
    result.failures.push(error.message);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  result.console_errors = consoleErrors.slice(0, 10);
  result.ok = result.failures.length === 0;
  return result;
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, args: ["--disable-gpu"], timeout: 30_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const results = [];
  try {
    for (const testCase of cases) results.push(await inspectCase(page, testCase));
  } finally {
    await browser.close().catch(() => {});
  }
  const failures = results.flatMap((result) => result.ok ? [] : result.failures.map((failure) => ({ id: result.id, failure })));
  const receipt = {
    schema_version: "swfipn.search_category_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: {
      categories: results.length,
      passed: results.filter((result) => result.ok).length,
      failures: failures.length,
    },
    results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath, failures }, null, 2));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
