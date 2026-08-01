#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-list-data-proof-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");

const routes = [
  { id: "profiles", route: "/profiles/", api: "/api/source-data/search/v1", required: ["Institutions", "Entity Name"], totalAtLeast: 590_000, recordHrefPattern: "/swficc/profiles/detail/\\?id=[0-9a-f]{24}", handoffPattern: "https://www\\.swfi\\.com/v1/signin/\\?[^#]*redirect=.*%2Fv1%2Fentities%2F[0-9a-f]{24}", sourcePattern: "https://www\\.swfi\\.com/v1/entities/[0-9a-f]{24}" },
  { id: "people", route: "/people/", api: "/api/source-data/search/v1", required: ["People", "Name"], totalAtLeast: 100_000, recordHrefPattern: "/swficc/people/detail/\\?id=[0-9a-f]{24}", handoffPattern: "https://www\\.swfi\\.com/v1/signin/\\?[^#]*redirect=.*%2Fv1%2Fpeople%2F[0-9a-f]{24}", sourcePattern: "https://www\\.swfi\\.com/v1/people/[0-9a-f]{24}" },
  { id: "transactions", route: "/transactions/", api: "/api/transactions/v1", required: ["Transactions", "Buyer Entity"], totalAtLeast: 180_000, recordHrefPattern: "/swficc/transactions/detail/\\?id=[0-9a-f]{24}", handoffPattern: "https://www\\.swfi\\.com/v1/signin/\\?[^#]*redirect=.*%2Fv1%2Ftransactions%2F[0-9a-f]{24}", sourcePattern: "https://www\\.swfi\\.com/v1/transactions/[0-9a-f]{24}" },
  { id: "deals", route: "/deals/", api: "/api/transactions/v1", required: ["Deals", "Buyer Entity"], totalAtLeast: 180_000, recordHrefPattern: "/swficc/transactions/detail/\\?id=[0-9a-f]{24}", handoffPattern: "https://www\\.swfi\\.com/v1/signin/\\?[^#]*redirect=.*%2Fv1%2Ftransactions%2F[0-9a-f]{24}", sourcePattern: "https://www\\.swfi\\.com/v1/transactions/[0-9a-f]{24}" },
  { id: "mandates", route: "/mandates/", api: "/api/live-opportunities/v1", required: ["RFPs", "Title"], totalAtLeast: 30, recordHrefPattern: "/swficc/mandates/detail/\\?id=[0-9a-f]{24}", handoffPattern: "https://www\\.swfi\\.com/v1/signin/\\?[^#]*redirect=.*%2Fv1%2Fcompass%2F[0-9a-f]{24}", sourcePattern: "https://www\\.swfi\\.com/v1/compass/[0-9a-f]{24}" },
  { id: "research", route: "/research/", api: "/api/source-intelligence/news/v1", required: ["Research", "Title"], totalAtLeast: 10, recordHrefPattern: "/swficc/research/detail/\\?" },
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function numberFromShowing(text) {
  const match = text.match(/Showing\s+[0-9,]+\s+of\s+([0-9,]+)/i);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

async function inspectRoute(context, spec) {
  const page = await context.newPage();
  const apiRequests = [];
  const apiResponses = [];
  const failedRequests = [];
  const consoleErrors = [];
  page.on("request", (request) => {
    const url = request.url();
    if (url.includes("/api/")) apiRequests.push(url);
  });
  page.on("response", (response) => {
    const url = response.url();
    if (url.includes("/api/")) apiResponses.push({ url, status: response.status() });
  });
  page.on("requestfailed", (request) => {
    const url = request.url();
    if (!url.includes("/cdn-cgi/rum")) failedRequests.push(url);
  });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });

  const result = {
    ...spec,
    url: appUrl(spec.route),
    status: 0,
    ok: false,
    failures: [],
    api_requests: [],
    api_responses: [],
    showing_text: "",
    rendered_total: 0,
    row_links: [],
    failed_requests: [],
    console_errors: [],
    screenshot: "",
  };

  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    result.status = response?.status() || 0;
    await page.waitForFunction(
      (required) => required.every((item) => document.body.innerText.includes(item)) && /Showing\s+[0-9,]+\s+of\s+[0-9,]+/i.test(document.body.innerText),
      spec.required,
      { timeout: 90_000 },
    );
    const snapshot = await page.evaluate(({ recordHrefPattern, handoffPattern, sourcePattern }) => {
      const recordPattern = new RegExp(recordHrefPattern);
      const authHandoffPattern = handoffPattern ? new RegExp(handoffPattern) : null;
      const sourceRecordPattern = sourcePattern ? new RegExp(sourcePattern) : null;
      const bodyText = document.body.innerText || "";
      const showing = (bodyText.match(/Showing\s+[^\n]+/) || [""])[0];
      const links = [...document.querySelectorAll('a[data-source-state="on-file"], a[data-record-link="true"], table a[href], .grid a[href]')]
        .map((anchor) => ({
          text: (anchor.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
          href: anchor.href,
          sourceState: anchor.getAttribute("data-source-state") || "",
          title: anchor.getAttribute("title") || "",
        }))
        .filter((anchor) => recordPattern.test(anchor.href) || (authHandoffPattern ? authHandoffPattern.test(anchor.href) : false))
        .slice(0, 10);
      const internalRecordLinks = links.filter((anchor) => recordPattern.test(anchor.href)).length;
      const authHandoffLinks = links.filter((anchor) => authHandoffPattern ? authHandoffPattern.test(anchor.href) : false).length;
      const sourceBackedLinks = [...document.querySelectorAll('a[data-source-state="on-file"], a[data-record-link="true"], table a[href], .grid a[href]')]
        .map((anchor) => ({
          href: anchor.href,
          sourceState: anchor.getAttribute("data-source-state") || "",
          title: anchor.getAttribute("title") || "",
          recordLink: anchor.getAttribute("data-record-link") || "",
        }))
        .filter((anchor) => anchor.sourceState === "on-file" || anchor.title === "View details" || anchor.recordLink === "true" || (sourceRecordPattern ? sourceRecordPattern.test(anchor.href) : false))
        .length;
      return { bodyText, showing, links, internalRecordLinks, authHandoffLinks, sourceBackedLinks };
    }, { recordHrefPattern: spec.recordHrefPattern, handoffPattern: spec.handoffPattern || "", sourcePattern: spec.sourcePattern || "" });
    result.showing_text = snapshot.showing;
    result.rendered_total = numberFromShowing(snapshot.showing);
    result.row_links = snapshot.links;
    result.link_contract = snapshot.internalRecordLinks ? "internal_record" : snapshot.authHandoffLinks ? "swfi_auth_handoff" : "missing";
    if (result.status >= 400 || !result.status) result.failures.push(`http_${result.status || "missing"}`);
    if (!apiRequests.some((url) => url.includes(spec.api))) result.failures.push(`missing_api_request:${spec.api}`);
    if (!apiResponses.some((item) => item.url.includes(spec.api) && item.status === 200)) result.failures.push(`missing_api_200:${spec.api}`);
    if (result.rendered_total < spec.totalAtLeast) result.failures.push(`total_too_low:${result.rendered_total}<${spec.totalAtLeast}`);
    if (!result.row_links.length) result.failures.push(`missing_record_row_link:${spec.recordHrefPattern}`);
    if (!snapshot.sourceBackedLinks) result.failures.push("missing_source_backed_link_markers");
    if (snapshot.bodyText.includes("source_gap") || snapshot.bodyText.includes("Active Mirror") || snapshot.bodyText.includes("undefined") || snapshot.bodyText.includes("null")) {
      result.failures.push("forbidden_internal_or_empty_text");
    }
    const screenshotPath = path.join(outputDir, `swfipn-list-data-proof-${spec.id}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshot = screenshotPath;
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    result.api_requests = apiRequests.slice(0, 20);
    result.api_responses = apiResponses.slice(0, 20);
    result.failed_requests = failedRequests.slice(0, 20);
    result.console_errors = consoleErrors.slice(0, 20);
    if (result.failed_requests.length) result.failures.push(`failed_requests:${result.failed_requests.length}`);
    result.ok = result.failures.length === 0;
    await page.close().catch(() => {});
  }
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  const results = [];
  try {
    for (const spec of routes) {
      console.log(`[swfipn-list-data-proof] ${spec.route}`);
      results.push(await inspectRoute(context, spec));
    }
  } finally {
    await browser.close().catch(() => {});
  }
  const failures = results.flatMap((result) => result.ok ? [] : result.failures.map((failure) => ({ id: result.id, route: result.route, failure })));
  const receipt = {
    schema_version: "swfipn.list_data_proof.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: failures.length ? "fail" : "pass",
    summary: results.map((result) => ({
      id: result.id,
      route: result.route,
      api_200: result.api_responses.some((item) => item.url.includes(result.api) && item.status === 200),
      showing_text: result.showing_text,
      rendered_total: result.rendered_total,
      row_links: result.row_links.length,
      link_contract: result.link_contract || "missing",
      ok: result.ok,
    })),
    results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failures, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), fatal: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
