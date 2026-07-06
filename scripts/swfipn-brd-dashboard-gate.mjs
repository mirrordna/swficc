#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const target = normalizeTarget(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const targetHost = new URL(target).hostname;
const targetOrigin = new URL(target).origin;
const shouldProxyBackend = process.env.SWFIPN_PROXY_BACKEND === "1"
  || (process.env.SWFIPN_PROXY_BACKEND !== "0" && ["localhost", "127.0.0.1", "::1"].includes(targetHost));
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const screenshots = {
  desktop: path.join(outputDir, "swfipn-brd-dashboard-local-desktop-20260626.png"),
  search: path.join(outputDir, "swfipn-brd-search-modal-local-desktop-20260626.png"),
  mobile: path.join(outputDir, "swfipn-brd-dashboard-local-mobile-20260626.png"),
};
const receiptPath = path.join(outputDir, "swfipn-brd-dashboard-receipt-latest.json");

const requiredText = [
  "Dashboard",
  "News",
  "Entities",
  "People",
  "Transactions",
  "Compass",
  "Reports",
  "Here's your intelligence and pipeline overview.",
  "Global Capital Map",
  "AI Insights",
  "Latest Intelligence",
  "Most Referenced",
  "Topics",
  "Upcoming Events",
  "Market Focus",
  "Recent Activity",
  "Top 10",
  "Compass Investment Types",
  "SWF Buys by Sector",
];

const leakNeedles = [
  "Active Mirror",
  "source_gap",
  "backend_http",
  "backend_fetch",
  "source_gap_reason",
  "object id",
  "Object ID",
  "API endpoint",
];

const apiPattern = /api\/(source-data|source-intelligence|recent-transactions|live-opportunities|sector-flows|allocator-activity|swfi)|\/v1\/swfi\//;

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1469, height: 841 }, deviceScaleFactor: 1 });
  const consoleErrors = [];
  const apiResponses = [];

  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  if (shouldProxyBackend) {
    await page.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = new URL(request.url());
      if (!apiPattern.test(request.url())) {
        await route.continue();
        return;
      }
      const upstreamUrl = requestUrl.origin === targetOrigin
        ? `${backendOrigin}${requestUrl.pathname}${requestUrl.search}`
        : request.url();
      if (request.method() === "OPTIONS") {
        await route.fulfill({ status: 204, headers: corsHeaders() });
        return;
      }
      try {
        const response = await route.fetch({ url: upstreamUrl, timeout: 120_000 });
        apiResponses.push({ status: response.status(), url: upstreamUrl });
        await route.fulfill({
          response,
          headers: { ...response.headers(), ...corsHeaders(), "cache-control": "no-store" },
        });
      } catch (error) {
        apiResponses.push({ status: 0, url: request.url(), error: String(error) });
        await route.fulfill({
          status: 502,
          headers: { ...corsHeaders(), "content-type": "application/json" },
          body: JSON.stringify({ status: "unavailable", fact: false, unavailable_reason: "playwright_proxy_failed", data: { rows: [] } }),
        });
      }
    });
  } else {
    page.on("response", (response) => {
      if (apiPattern.test(response.url())) apiResponses.push({ status: response.status(), url: response.url() });
    });
  }

  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForHydration(page);
  await page.screenshot({ path: screenshots.desktop, fullPage: true });

  const body = await page.locator("body").innerText();
  const lowerBody = body.toLowerCase();
  const requiredMissing = requiredText.filter((value) => !lowerBody.includes(value.toLowerCase()));
  const stillLoading = body.includes("Loading");

  await page.waitForSelector("[aria-label=\"Open Global Search\"]", { timeout: 30_000 });
  await page.bringToFront();
  await page.keyboard.press(process.platform === "darwin" ? "Meta+K" : "Control+K");
  await page.waitForSelector("[role=\"dialog\"]", { timeout: 3_000 }).catch(async () => {
    await page.locator("[aria-label=\"Open Global Search\"]").first().click({ timeout: 10_000 });
    await page.waitForSelector("[role=\"dialog\"]", { timeout: 10_000 });
  });
  await page.locator("[aria-label=\"Search query\"]").fill("GIC");
  await page.waitForTimeout(500);
  await page.screenshot({ path: screenshots.search, fullPage: true });
  const modalText = await page.locator("[role=\"dialog\"]").innerText();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Escape");
  const modalClosed = await page.locator("[role=\"dialog\"]").count() === 0;

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(target, { waitUntil: "domcontentloaded", timeout: 120_000 });
  await waitForHydration(page);
  await page.screenshot({ path: screenshots.mobile, fullPage: true });

  const mobileBody = await page.locator("body").innerText();
  const mobileLower = mobileBody.toLowerCase();
  const internalLeaks = leakNeedles.filter((needle) => lowerBody.includes(needle.toLowerCase()) || mobileLower.includes(needle.toLowerCase()));
  const modalHasGroups = ["Entities", "Transactions", "People", "News & Articles"].every((needle) => modalText.includes(needle));
  const modalOpened = modalText.includes("Entities") || modalText.includes("Global Search");
  const hasLiveApi = apiResponses.some((response) => response.status === 200);
  const caveats = [
    shouldProxyBackend ? "Local proof uses Playwright API proxy only to bypass localhost CORS; payloads are live from the configured backend origin." : "",
  ].filter(Boolean);
  const basePassed = !requiredMissing.length
    && !stillLoading
    && modalOpened
    && modalHasGroups
    && modalClosed
    && !internalLeaks.length
    && hasLiveApi;
  const status = basePassed ? (caveats.length ? "pass_with_caveats" : "pass") : "fail";

  const receipt = {
    generated_at: new Date().toISOString(),
    target,
    backend_origin: backendOrigin,
    backend_proxy_used: shouldProxyBackend,
    brd_source: "/Users/mirror-pro/Downloads/SWFI_BRD_v1_3_june2026.docx",
    brd_reference_image: path.join(cwd, "output/SWFI_BRD_v1_3_images/image1.png"),
    status,
    result: {
      requiredMissing,
      stillLoading,
      apiResponses,
      modalOpened,
      modalHasGroups,
      modalClosed,
      internalLeaks,
      consoleErrors: consoleErrors.slice(0, 12),
      screenshots: Object.fromEntries(Object.entries(screenshots).map(([key, value]) => [key, value])),
    },
    caveats,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.log(JSON.stringify({ status, receipt: receiptPath, ...receipt.result }, null, 2));
  await browser.close();
  if (status === "fail") process.exit(1);
}

async function waitForHydration(page) {
  await page.waitForFunction(() => !document.body.innerText.includes("Loading"), null, { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(1_000);
}

function normalizeTarget(value) {
  if (value.endsWith("/")) return value;
  return `${value}/`;
}

function corsHeaders() {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "accept,content-type,x-swfipn-public",
  };
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
