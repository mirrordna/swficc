#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-brd-performance-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const ttiTargetMs = Number(process.env.SWFIPN_DASHBOARD_TTI_TARGET_MS || 2000);
const dataTargetMs = Number(process.env.SWFIPN_DASHBOARD_DATA_TARGET_MS || 500);
const criticalApi = [
  "/api/swfi/dashboard-metrics/v1",
  "/api/source-data/search/v1?collection=entities",
  "/api/source-data/search/v1?collection=people",
  "/api/recent-transactions/v1",
  "/api/live-opportunities/v1",
  "/api/source-intelligence/news/v1",
  "/api/sector-flows/v1",
  "/api/allocator-activity/v1",
  "/api/institution-types/v1"
];
const routes = [
  { id: "home", path: "", api: ["/api/swfi/dashboard-metrics/v1", "/api/source-data/search/v1?collection=entities", "/api/recent-transactions/v1", "/api/live-opportunities/v1"] },
  { id: "profiles", path: "profiles/", api: ["/api/source-data/search/v1?collection=entities", "/api/institution-types/v1"] },
  { id: "mandates", path: "mandates/", api: ["/api/live-opportunities/v1"] },
  { id: "allocators", path: "allocators/", api: ["/api/allocator-activity/v1"] },
];

async function main() {
  const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(() => chromium.launch({ headless: true }));
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const consoleErrors = [];
  const starts = new Map();
  const apiResponses = [];
  let activeRoute = "startup";

  page.on("request", (request) => starts.set(request, Date.now()));
  page.on("response", (response) => {
    const url = response.url();
    if (!criticalApi.some((needle) => url.includes(needle))) return;
    const started = starts.get(response.request()) || Date.now();
    apiResponses.push({
      url,
      status: response.status(),
      duration_ms: Date.now() - started,
      route: activeRoute,
    });
  });
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const failures = [];
  const routeTimings = [];

  for (const route of routes) {
    activeRoute = route.id;
    const apiStart = apiResponses.length;
    const routeConsoleStart = consoleErrors.length;
    const started = Date.now();
    const responseWaits = route.api.map((needle) => page.waitForResponse((response) => response.url().includes(needle), { timeout: 120_000 }));
    let navigation = null;
    let navigationError = null;
    try {
      navigation = await page.goto(new URL(route.path, origin).href, { waitUntil: "domcontentloaded", timeout: 120_000 });
    } catch (error) {
      navigationError = error instanceof Error ? error.message : String(error);
    }
    const domContentLoadedMs = Date.now() - started;
    const apiSettlements = await Promise.allSettled(responseWaits);
    let primaryUsableMs = null;
    if (route.id === "home") {
      await page.waitForFunction(() => {
        const body = document.body.innerText || "";
        const sourceBackedLink = document.querySelector('a[data-source-state="on-file"], a[data-record-link="true"]');
        const primaryReady = document.querySelector('[data-dashboard-primary-ready="true"]');
        return !/Source not verified|temporarily unavailable/i.test(body) && Boolean(primaryReady && sourceBackedLink);
      }, null, { timeout: 120_000 }).then(() => {
        primaryUsableMs = Date.now() - started;
      }).catch(() => null);
    }
    let sourceBackedReady = false;
    let sourceBackedError = null;
    try {
      await page.waitForFunction((routeId) => {
        const body = document.body.innerText || "";
        const sourceBackedLink = document.querySelector('a[data-source-state="on-file"], a[data-record-link="true"]');
        const homeReady = document.querySelector('[data-dashboard-ready="true"]');
        return !/Source not verified|temporarily unavailable/i.test(body)
          && (routeId === "home" ? Boolean(homeReady && sourceBackedLink) : Boolean(sourceBackedLink));
      }, route.id, { timeout: 120_000 });
      sourceBackedReady = true;
    } catch (error) {
      sourceBackedError = error instanceof Error ? error.message : String(error);
    }
    const usableMs = Date.now() - started;
    const dataMs = Math.max(0, usableMs - domContentLoadedMs);
    const routeApi = apiResponses.slice(apiStart).filter((item) => route.api.some((needle) => item.url.includes(needle)));
    const successfulCritical = routeApi.filter((item) => item.status === 200);
    const requiredApi200Count = route.api.filter((needle) => successfulCritical.some((item) => item.url.includes(needle))).length;
    const apiMaxMs = successfulCritical.length ? Math.max(...successfulCritical.map((item) => item.duration_ms)) : null;
    const routeFailures = [];
    if (navigationError) routeFailures.push("navigation_failed");
    if ((navigation?.status() || 0) >= 400) routeFailures.push(`http_${navigation?.status() || 0}`);
    if (!sourceBackedReady) routeFailures.push("source_backed_state_missing");
    if (usableMs > ttiTargetMs) routeFailures.push(`usable_${usableMs}_gt_${ttiTargetMs}`);
    if (dataMs > dataTargetMs) routeFailures.push(`data_${dataMs}_gt_${dataTargetMs}`);
    if (apiSettlements.some((item) => item.status === "rejected")) routeFailures.push("required_api_missing");
    if (requiredApi200Count !== route.api.length) routeFailures.push(`required_api_200_${requiredApi200Count}_of_${route.api.length}`);
    if (apiMaxMs === null || apiMaxMs > dataTargetMs) routeFailures.push(`api_max_${apiMaxMs ?? "missing"}_gt_${dataTargetMs}`);
    if (consoleErrors.length > routeConsoleStart) routeFailures.push("console_errors_present");
    routeTimings.push({
      id: route.id,
      url: new URL(route.path, origin).href,
      status: routeFailures.length ? "fail" : "pass",
      dom_content_loaded_ms: domContentLoadedMs,
      primary_usable_source_backed_ms: primaryUsableMs,
      usable_source_backed_ms: usableMs,
      data_after_dom_ms: dataMs,
      required_api_max_ms: apiMaxMs,
      required_api: route.api,
      api_responses: routeApi,
      navigation_error: navigationError,
      source_backed_error: sourceBackedError,
      failures: routeFailures,
    });
    failures.push(...routeFailures.map((failure) => `${route.id}:${failure}`));
  }

  const successfulCritical = apiResponses.filter((item) => item.status === 200);
  const liveRefreshMaxMs = successfulCritical.length ? Math.max(...successfulCritical.map((item) => item.duration_ms)) : null;
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.brd_performance_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status,
    summary: {
      routes_checked: routeTimings.length,
      routes_passed: routeTimings.filter((route) => route.status === "pass").length,
      dashboard_tti_ms: routeTimings[0]?.usable_source_backed_ms ?? null,
      dashboard_primary_tti_ms: routeTimings[0]?.primary_usable_source_backed_ms ?? null,
      dashboard_tti_target_ms: ttiTargetMs,
      dashboard_data_ms: routeTimings[0]?.data_after_dom_ms ?? null,
      dashboard_data_target_ms: dataTargetMs,
      live_refresh_max_ms: liveRefreshMaxMs,
      critical_api_200_count: successfulCritical.length,
      console_errors: consoleErrors.slice(0, 10),
      failures
    },
    caveats: [
      "Every checked route must reach a source-backed usable state and receive each required live API response within the blocking targets; bundled fallback content alone cannot pass.",
      "The homepage primary-ready timing is diagnostic only; a homepage PASS still requires the full dashboard-ready contract, including secondary source panels.",
    ],
    routes: routeTimings,
    api_responses: apiResponses
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
