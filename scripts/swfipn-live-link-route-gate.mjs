#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-live-link-route-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const routes = [
  "/",
  "/profiles/",
  "/people/",
  "/transactions/",
  "/deals/",
  "/mandates/",
  "/allocators/",
  "/comparisons/",
  "/reports/",
  "/research/",
  "/intelligence/",
  "/search/?q=Real%20Estate",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function waitForHydration(page) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 90_000) {
    const body = await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "");
    if (body && !/\bLoading\b/i.test(body)) return;
    await page.waitForTimeout(750);
  }
}

async function setRowsTo100(page) {
  const selects = await page.locator("select").all();
  for (const select of selects) {
    const has100 = await select.locator("option").evaluateAll((options) => options.some((option) => option.value === "100" || option.textContent?.trim() === "100")).catch(() => false);
    if (!has100) continue;
    await select.selectOption("100").catch(() => {});
    await page.waitForTimeout(1500);
    break;
  }
}

function isRawSwfiRecordHref(href) {
  try {
    const parsed = new URL(href);
    return parsed.hostname.endsWith("swfi.com") && /^\/v1\/(entities|people|person|transactions|compass|news)\//i.test(parsed.pathname);
  } catch {
    return false;
  }
}

async function crawlRoute(browser, route) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const row = { route, url: appUrl(route), ok: true, raw_swfi_record_links: [], link_count: 0 };
  try {
    await page.goto(row.url, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForHydration(page);
    await setRowsTo100(page);
    await waitForHydration(page);
    const links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => {
      const rect = anchor.getBoundingClientRect();
      return {
        text: anchor.textContent?.trim().replace(/\s+/g, " ") || "",
        href: anchor.href,
        raw: anchor.getAttribute("href") || "",
        visible: rect.width > 0 && rect.height > 0,
      };
    }));
    row.link_count = links.length;
    row.raw_swfi_record_links = links
      .filter((link) => link.visible && isRawSwfiRecordHref(link.href))
      .map((link) => ({ text: link.text, href: link.href, raw: link.raw }))
      .slice(0, 200);
  } catch (error) {
    row.raw_swfi_record_links.push({ text: "crawl_error", href: String(error?.message || error), raw: "" });
  } finally {
    await context.close().catch(() => {});
  }
  row.ok = row.raw_swfi_record_links.length === 0;
  return row;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks = [];
  try {
    for (const route of routes) checks.push(await crawlRoute(browser, route));
  } finally {
    await browser.close().catch(() => {});
  }
  const failures = checks.flatMap((check) => check.raw_swfi_record_links.map((link) => `${check.route}:${link.text}:${link.href}`));
  const receipt = {
    schema_version: "swfipn.live_link_route_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    routes_checked: checks.length,
    raw_swfi_record_link_count: failures.length,
    failures: failures.slice(0, 200),
    checks,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    routes_checked: receipt.routes_checked,
    raw_swfi_record_link_count: receipt.raw_swfi_record_link_count,
    receipt: receiptPath,
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ schema_version: "swfipn.live_link_route_gate.v1", status: "fail", error: String(error?.stack || error) }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
