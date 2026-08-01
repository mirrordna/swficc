#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-strongest-crawl-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-home-strongest-crawl.png");

const forbiddenText = [
  "38,412",
  "1,284",
  "$120B",
  "$90B",
  "ADIA invests in AI fund",
  "GIC opens $500M infrastructure mandate",
  "CPP increases energy exposure",
];

const routes = [
  { path: "/", required: ["SWFI", "KPI CARDS", "INSIGHTS", "QUICK ACTIONS"] },
  { path: "/profiles/", required: ["Institutions"] },
  { path: "/people/", required: ["People"] },
  { path: "/transactions/", required: ["Transactions"] },
  { path: "/mandates/", required: ["RFPs"] },
  { path: "/reports/", required: ["Reports Intelligence", "AUM Rankings"] },
  { path: "/search/", required: ["Smart Search"] },
  { path: "/research/", required: ["Research / News", "Data source", "Citation"] },
];

function loadPlaywright() {
  const roots = [
    repoRoot,
    "/Users/mirror-pro/repos/SWFI2.0-final-frontend",
    "/Users/mirror-pro/repos/SWFI2.0-final",
  ];
  for (const root of roots) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) {
      return createRequire(marker)("playwright");
    }
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeBase(input) {
  const value = input || "http://localhost:3011/swficc/";
  return value.endsWith("/") ? value : `${value}/`;
}

function routeUrl(base, routePath) {
  if (routePath === "/") return base;
  return new URL(routePath.replace(/^\//, ""), base).href;
}

function isBackendPacketUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.pathname.startsWith("/api/") || parsed.pathname.startsWith("/v1/");
  } catch {
    return false;
  }
}

async function run() {
  const { chromium } = loadPlaywright();
  const base = normalizeBase(process.env.SWFIPN_ORIGIN || process.env.SWFI_FRONTEND_ORIGIN);
  const baseHost = new URL(base).hostname;
  const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
  const browser = await chromium.launch({     headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${baseHost} ${resolveIp}`] : [],
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
  const receipt = {
    origin: base,
    generated_at: new Date().toISOString(),
    status: "pass",
    routes: [],
    packets: [],
    forbidden_text: forbiddenText,
    screenshot: screenshotPath,
  };

  const consoleErrors = [];
  const pageErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => pageErrors.push(err.message));
  page.on("response", async (response) => {
    const url = response.url();
    if (!isBackendPacketUrl(url)) return;
    if (response.request().method() !== "GET") return;
    const entry = { url, status: response.status(), packet_status: null, state: null, result_qualifier: null, source_gap: null };
    try {
      const json = await response.json();
      entry.packet_status = json?.status ?? null;
      entry.state = json?.state ?? null;
      entry.result_qualifier = json?.result_qualifier ?? null;
      entry.source_gap = Boolean(json?.source_gap);
    } catch {
      entry.packet_status = "unreadable_json";
    }
    receipt.packets.push(entry);
  });

  for (const route of routes) {
    const url = routeUrl(base, route.path);
    const routeResult = { path: route.path, url, status: null, ok: true, failures: [] };
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
    routeResult.status = response?.status() ?? null;
    if (!response || response.status() >= 400) {
      routeResult.ok = false;
      routeResult.failures.push(`http_status_${routeResult.status}`);
    }
    await page.waitForLoadState("networkidle", { timeout: 45000 }).catch(() => {});
    const bodyText = await page.locator("body").innerText({ timeout: 15000 });
    for (const expected of route.required) {
      if (!bodyText.includes(expected)) {
        routeResult.ok = false;
        routeResult.failures.push(`missing_text:${expected}`);
      }
    }
    for (const forbidden of forbiddenText) {
      if (bodyText.includes(forbidden)) {
        routeResult.ok = false;
        routeResult.failures.push(`forbidden_seed_text:${forbidden}`);
      }
    }
    const badLinks = await page.$$eval("a[href]", (links) => links
      .map((link) => link.getAttribute("href") || "")
      .filter((href) => href === "#" || href.startsWith("javascript:") || href.includes("/admin") || href.includes("/api-docs")));
    if (badLinks.length) {
      routeResult.ok = false;
      routeResult.failures.push(`bad_links:${badLinks.join(",")}`);
    }
    if (route.path === "/") {
      await page.screenshot({ path: screenshotPath, fullPage: true });
    }
    receipt.routes.push(routeResult);
  }

  for (const packet of receipt.packets) {
    const okFact = packet.packet_status === "ok" && !packet.source_gap;
    const okGap = packet.packet_status === "source_gap" || packet.source_gap === true;
    if (packet.status >= 400 || (!okFact && !okGap)) {
      receipt.status = "fail";
      packet.failure = "packet_not_fact_or_source_gap";
    }
  }

  if (consoleErrors.length || pageErrors.length) {
    receipt.status = "fail";
    receipt.console_errors = consoleErrors;
    receipt.page_errors = pageErrors;
  }
  if (receipt.routes.some((route) => !route.ok)) {
    receipt.status = "fail";
  }

  await browser.close();
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, screenshot: screenshotPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((err) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: err.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(err);
  process.exit(1);
});
