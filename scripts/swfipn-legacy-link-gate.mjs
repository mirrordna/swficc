#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-legacy-link-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const routes = ["/", "/intelligence/", "/research/", "/search/?q=US%20Pension%20Funds"];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function routeUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function inspectRoute(browser, route) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { route, url: routeUrl(route), ok: true, failures: [], links: [] };
  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    await page.waitForFunction(() => {
      const body = document.body.innerText || "";
      return body.includes("SWFI") && !/\bLoading\b/.test(body);
    }, { timeout: 90_000 });
    await page.waitForTimeout(1_000);

    result.links = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]"))
      .filter((anchor) => !!(anchor.offsetWidth || anchor.offsetHeight || anchor.getClientRects().length))
      .map((anchor) => ({
        text: (anchor.innerText || anchor.textContent || "").trim().replace(/\s+/g, " "),
        href: new URL(anchor.getAttribute("href") || "", document.baseURI).href,
        raw: anchor.getAttribute("href") || "",
        sourceState: anchor.getAttribute("data-source-state") || "",
      })));

    const escapedLegacy = result.links.filter((link) => {
      try {
        const parsed = new URL(link.href);
        return parsed.hostname.endsWith("swfi.com") && parsed.pathname === "/" && parsed.searchParams.has("p");
      } catch {
        return false;
      }
    });
    if (escapedLegacy.length) {
      result.failures.push(`escaped_legacy_article_links:${escapedLegacy.map((link) => `${link.text || "(blank)"}=>${link.href}`).slice(0, 10).join("|")}`);
    }

    const pension = result.links.find((link) => /pension funds/i.test(link.text));
    if (pension && !/\/swficc\/research\/detail\/\?/.test(pension.href)) {
      result.failures.push(`us_pension_article_not_internal:${pension.href}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks = [];
  for (const route of routes) checks.push(await inspectRoute(browser, route));
  await browser.close();

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    route: check.route,
    url: check.url,
    failures: check.failures,
  }));
  const receipt = {
    schema_version: "swfipn.legacy_link_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: { routes: checks.length, failures: failures.length },
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, JSON.stringify({
    schema_version: "swfipn.legacy_link_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: "fail",
    summary: { routes: routes.length, failures: 1 },
    failures: [{ route: "fatal", failures: [error.stack || error.message] }],
  }, null, 2));
  console.error(error);
  process.exit(1);
});
