#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-closeout-gate-latest.json");
const matrixPath = path.join(outputDir, "swfipn-closeout-gate-latest.md");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const originUrl = new URL(origin);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(origin).origin).replace(/\/$/, "");
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";
const allowAuthSkip = process.env.SWFIPN_CLOSEOUT_ALLOW_AUTH_SKIP !== "0";
const maxAgeHours = Number(process.env.SWFIPN_MAX_PACKET_AGE_HOURS || 24);

const endpoints = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  allocatorCount: "/api/allocator-activity/v1?days=90&limit=1&count_only=1",
  allocators: "/api/allocator-activity/v1?days=90&limit=25&sort=activity_count&direction=desc",
  mandates: "/api/live-opportunities/v1?limit=25&page=1",
  transactions: "/api/recent-transactions/v1?days=30&limit=25&page=1",
  news: "/api/source-intelligence/news/v1?limit=25",
  topAum: "/v1/swfi/top20?limit=5",
};

const listRoutes = [
  { id: "profiles", route: "/profiles/", api: "/api/source-data/search/v1", totalAtLeast: 590_000, kind: "entity", pattern: /\/swficc\/profiles\/detail\/\?(?=[^#]*(?:slug|name|id)=)/i },
  { id: "people", route: "/people/", api: "/api/source-data/search/v1", totalAtLeast: 100_000, kind: "person", pattern: /\/swficc\/people\/detail\/\?(?=[^#]*(?:name|id)=)/i },
  { id: "transactions", route: "/transactions/", api: "/api/transactions/v1", totalAtLeast: 180_000, kind: "transaction", pattern: /\/swficc\/transactions\/detail\/\?(?=[^#]*(?:title|id)=)/i },
  { id: "deals", route: "/deals/", api: "/api/transactions/v1", totalAtLeast: 180_000, kind: "transaction", pattern: /\/swficc\/transactions\/detail\/\?(?=[^#]*(?:title|id)=)/i },
  { id: "mandates", route: "/mandates/", api: "/api/live-opportunities/v1", totalAtLeast: 30, kind: "compass", pattern: /\/swficc\/mandates\/detail\/\?(?=[^#]*(?:title|id)=)/i },
  { id: "intelligence", route: "/intelligence/", api: "/api/source-intelligence/news/v1", totalAtLeast: 10, kind: "legacy", pattern: /(?:\/swficc\/research\/detail\/\?(?:[^#]*&)?legacy=\d+|\/v1\/news\/\d{1,12})/i },
];

const forbiddenText = [
  "Active Mirror",
  "Object ID",
  "Mongo Record ID",
  "Backend ID",
  "Endpoint:",
  "source_gap",
  "source_gap_reason",
  "schema_version",
  "result_qualifier",
  "No internal record mapping",
  "citation-only",
  "SWFI Provenance Workbench",
  "Parser status",
  "Capture ID",
  "SourceVault",
  "PixelTruth",
  "DocStruct",
  "2447",
  "completed buyer/acquirer",
  "swfi.transactions.completedAt_or_closedAt.buyer_or_acquirer.90d",
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route = "/") {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function apiUrl(route) {
  return new URL(route, backendOrigin).href;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function fetchJson(route) {
  const response = await fetch(apiUrl(route), { headers: { Accept: "application/json", "X-SWFIPN-Public": "1" } });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text || "null");
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, json };
}

function dataOf(packet) {
  return packet?.data && typeof packet.data === "object" && !Array.isArray(packet.data) ? packet.data : {};
}

function rowsOf(packet) {
  const data = dataOf(packet);
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function isFact(packet) {
  return String(packet?.status || "").toLowerCase() === "ok" && packet?.fact === true;
}

function packetAgeHours(packet) {
  const value = Date.parse(String(packet?.generated_at || ""));
  return Number.isFinite(value) ? (Date.now() - value) / 36e5 : Infinity;
}

function numberFromShowing(text) {
  const match = text.match(/Showing\s+[0-9,]+\s+of\s+([0-9,]+)/i);
  return match ? Number(match[1].replaceAll(",", "")) : 0;
}

async function waitForDashboard(page) {
  const started = Date.now();
  let body = "";
  while (Date.now() - started < 120_000) {
    body = await page.locator("body").innerText().catch(() => "");
    const linkKinds = await page.evaluate(() => {
      const counts = { entity: 0, transaction: 0, compass: 0 };
      for (const anchor of document.querySelectorAll('a[data-record-link="true"][href]')) {
        const href = anchor.href || "";
        if (href.includes("/swficc/profiles/detail/")) counts.entity += 1;
        if (href.includes("/swficc/transactions/detail/")) counts.transaction += 1;
        if (href.includes("/swficc/mandates/detail/")) counts.compass += 1;
        if (href.includes("/v1/signin/") && href.includes("redirect=")) {
          const decoded = decodeURIComponent(href);
          if (decoded.includes("/v1/entities/")) counts.entity += 1;
          if (decoded.includes("/v1/transactions/")) counts.transaction += 1;
          if (decoded.includes("/v1/compass/")) counts.compass += 1;
        }
      }
      return counts;
    }).catch(() => ({ entity: 0, transaction: 0, compass: 0 }));
    const linksReady = linkKinds.entity >= 4 && linkKinds.transaction >= 3 && linkKinds.compass >= 3;
    if (/Top AUM ranking/i.test(body) && /Investment Trends by Sector/i.test(body) && /Recent Activity/i.test(body) && linksReady && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function collectLinks(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((anchor) => ({
    text: (anchor.textContent || "").trim().replace(/\s+/g, " "),
    href: typeof anchor.href === "string" ? anchor.href : new URL(anchor.getAttribute("href") || "", window.location.href).href,
    record: anchor.getAttribute("data-record-link") || "",
    sourceState: anchor.getAttribute("data-source-state") || "",
  })));
}

function swfiRecordKind(href) {
  try {
    const parsed = new URL(href);
    if (parsed.hostname === originUrl.hostname) {
      if (/\/swficc\/profiles\/detail\/?/i.test(parsed.pathname)) return "entity";
      if (/\/swficc\/transactions\/detail\/?/i.test(parsed.pathname)) return "transaction";
      if (/\/swficc\/mandates\/detail\/?/i.test(parsed.pathname)) return "compass";
      if (/\/swficc\/people\/detail\/?/i.test(parsed.pathname)) return "person";
      if (/\/swficc\/research\/detail\/?/i.test(parsed.pathname)) return "legacy";
      return "";
    }
    if (!parsed.hostname.endsWith("swfi.com")) return "";
    if (parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/") {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (!redirect || /^https?:\/\//i.test(redirect)) return "";
      const target = new URL(redirect, "https://www.swfi.com");
      if (/\/v1\/entities\/[^/]+\/?$/i.test(target.pathname)) return "entity";
      if (/\/v1\/transactions\/[^/]+\/?$/i.test(target.pathname)) return "transaction";
      if (/\/v1\/compass\/[^/]+\/?$/i.test(target.pathname)) return "compass";
      if (/\/v1\/people\/[^/]+\/?$/i.test(target.pathname)) return "person";
      if (/\/v1\/news\/\d{1,12}\/?$/i.test(target.pathname)) return "legacy";
      return "";
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1 = parts.indexOf("v1");
    const section = v1 >= 0 ? parts[v1 + 1] : parts[0];
    const id = v1 >= 0 ? parts[v1 + 2] : parts[1];
    if (section === "entities" && id) return "entity";
    if (section === "transactions" && id) return "transaction";
    if (section === "compass" && id) return "compass";
    if ((section === "people" || section === "person") && id) return "person";
    if (section === "news" && /^\d{1,12}$/.test(id || "")) return "legacy";
    if (parsed.searchParams.get("p")) return "legacy";
  } catch {
    return "";
  }
  return "";
}

function forbiddenHits(body) {
  return forbiddenText.filter((item) => body.includes(item));
}

async function dashboardCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1100 } });
  const page = await context.newPage();
  const result = { id: "dashboard_public_and_canonical_links", ok: true, failures: [], first_usable_ms: 0, link_counts: {}, screenshot: path.join(outputDir, "swfipn-closeout-dashboard.png") };
  try {
    const start = Date.now();
    const response = await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    const body = await waitForDashboard(page);
    result.first_usable_ms = Date.now() - start;
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    for (const text of ["SWFI", "Top AUM ranking", "Investment Trends by Sector", "Recent Activity", "Recently Fundraising Institutions"]) {
      if (!body.includes(text)) result.failures.push(`missing_text:${text}`);
    }
    const hits = forbiddenHits(body);
    if (hits.length) result.failures.push(`forbidden_text:${hits.join("|")}`);
    if (/\bLoading\b/.test(body)) result.failures.push("dashboard_still_loading");
    await page.waitForSelector('a[data-record-link="true"]', { timeout: 30_000 }).catch(() => {});
    const links = await collectLinks(page);
    const recordLinks = links.filter((link) => link.record === "true" || swfiRecordKind(link.href));
    result.link_counts = recordLinks.reduce((acc, link) => {
      const kind = swfiRecordKind(link.href) || "unknown";
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {});
    if ((result.link_counts.entity || 0) < 5) result.failures.push("too_few_entity_links");
    if ((result.link_counts.transaction || 0) < 5) result.failures.push("too_few_transaction_links");
    if ((result.link_counts.compass || 0) < 3) result.failures.push("too_few_compass_links");
    if ((result.link_counts.unknown || 0) > 0) result.failures.push(`unknown_record_links:${result.link_counts.unknown}`);
    await page.screenshot({ path: result.screenshot, fullPage: true }).catch(() => {});
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function apiCheck() {
  const result = { id: "api_data_parity_and_freshness", ok: true, failures: [], packets: {} };
  for (const [key, route] of Object.entries(endpoints)) {
    const { status, json } = await fetchJson(route);
    const age = packetAgeHours(json);
    const rowCount = rowsOf(json).length;
    result.packets[key] = { status, fact: isFact(json), generated_at: json?.generated_at || "", age_hours: Number.isFinite(age) ? Number(age.toFixed(2)) : null, row_count: rowCount };
    if (status >= 400) result.failures.push(`${key}:http_${status}`);
    if (!isFact(json)) result.failures.push(`${key}:not_fact`);
    if (age > maxAgeHours) result.failures.push(`${key}:stale_${age.toFixed(1)}h`);
  }
  const allocatorRows = rowsOf((await fetchJson(endpoints.allocators)).json);
  if (!allocatorRows.length) result.failures.push("allocators:no_rows");
  for (const row of allocatorRows.slice(0, 5)) {
    if (!row.activity_reason || !row.activity_count || !row.most_recent_activity_date) result.failures.push(`allocator_missing_java_fields:${row.name || "unknown"}`);
    if (!/^https:\/\/www\.swfi\.com\/v1\/entities\//i.test(String(row.source_url || ""))) result.failures.push(`allocator_missing_entity_source:${row.name || "unknown"}`);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function listPageCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1100 } });
  const result = { id: "list_pages_have_counts_controls_and_canonical_links", ok: true, failures: [], routes: [] };
  try {
    for (const spec of listRoutes) {
      const page = await context.newPage();
      const row = { id: spec.id, route: spec.route, ok: true, failures: [], showing: "", rendered_total: 0, matching_links: 0, api_200: false };
      const apiResponses = [];
      page.on("response", (response) => {
        if (response.url().includes(spec.api)) apiResponses.push(response.status());
      });
      try {
        const response = await page.goto(appUrl(spec.route), { waitUntil: "domcontentloaded", timeout: 90_000 });
        await page.waitForFunction(
          () => /Showing\s+[0-9,]+\s+of\s+[0-9,]+/i.test(document.body.innerText) && !/\bLoading\b/.test(document.body.innerText),
          null,
          { timeout: 120_000 },
        );
        let body = await page.locator("body").innerText();
        if ((!body.includes("Filter") || !body.includes("Rows")) && /Visualization-first view/i.test(body)) {
          await page.getByRole("button", { name: /^Records$/i }).click({ timeout: 10_000 }).catch(() => {});
          await page.waitForFunction(
            () => /Filter/i.test(document.body.innerText) && /Rows/i.test(document.body.innerText),
            null,
            { timeout: 20_000 },
          ).catch(() => null);
          body = await page.locator("body").innerText();
        }
        row.showing = (body.match(/Showing\s+[^\n]+/) || [""])[0];
        row.rendered_total = numberFromShowing(row.showing);
        const links = await collectLinks(page);
        row.matching_links = links.filter((link) => swfiRecordKind(link.href) === spec.kind || spec.pattern.test(link.href)).length;
        row.api_200 = apiResponses.includes(200);
        if (!response || response.status() >= 400) row.failures.push(`http_${response?.status() || "missing"}`);
        if (!row.api_200) row.failures.push(`missing_api_200:${spec.api}`);
        if (row.rendered_total < spec.totalAtLeast) row.failures.push(`total_too_low:${row.rendered_total}<${spec.totalAtLeast}`);
        if (row.matching_links < 3) row.failures.push(`too_few_mirrored_record_links:${row.matching_links}`);
        if (!body.includes("Filter") || !body.includes("Rows")) row.failures.push("controls_missing");
        const hits = forbiddenHits(body);
        if (hits.length) row.failures.push(`forbidden_text:${hits.join("|")}`);
      } catch (error) {
        row.failures.push(error.message);
      } finally {
        row.ok = row.failures.length === 0;
        result.routes.push(row);
        await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  result.failures = result.routes.flatMap((row) => row.ok ? [] : row.failures.map((failure) => `${row.id}:${failure}`));
  result.ok = result.failures.length === 0;
  return result;
}

async function firstPartyRecordMirrorCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage({ viewport: { width: 1440, height: 1100 } });
  const result = { id: "first_party_record_links_resolve_to_terminal_records", ok: true, failures: [], samples: [] };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await waitForDashboard(page);
    await page.waitForSelector('a[data-record-link="true"]', { timeout: 30_000 }).catch(() => {});
    const links = await collectLinks(page);
    const samples = ["entity", "transaction", "compass"].map((kind) => links.find((link) => swfiRecordKind(link.href) === kind)).filter(Boolean);
    for (const link of samples) {
      const isSwfiSignin = /^https:\/\/(www\.)?swfi\.com\/v1\/signin\//i.test(link.href);
      const response = isSwfiSignin
        ? await context.request.get(link.href, { maxRedirects: 0, timeout: 45_000 })
        : await context.request.get(link.href, { timeout: 45_000 });
      const body = await response.text().catch(() => "");
      const parsed = new URL(link.href);
      const finalUrl = response.url();
      const final = new URL(finalUrl);
      const row = { kind: swfiRecordKind(link.href), label: link.text, href: link.href, final_url: finalUrl, status: response.status(), ok: true, failures: [] };
      if (response.status() >= 400) row.failures.push(`http_${response.status()}`);
      if (isSwfiSignin) {
        if (parsed.hostname !== "www.swfi.com") row.failures.push(`unexpected_swfi_host:${parsed.hostname}`);
        if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") row.failures.push(`unexpected_swfi_signin_path:${parsed.pathname}`);
        if ((parsed.searchParams.get("msg") || "") !== "auth") row.failures.push("missing_swfi_auth_msg");
        if (!/^\/v1\/(entities|transactions|compass)\/[^/]+\/?$/i.test(parsed.searchParams.get("redirect") || "")) {
          row.failures.push(`missing_swfi_record_redirect:${parsed.searchParams.get("redirect") || ""}`);
        }
      } else {
        if (final.hostname !== originUrl.hostname) row.failures.push(`escaped_destination:${finalUrl}`);
        if (final.pathname !== parsed.pathname) row.failures.push(`unexpected_terminal_destination:${finalUrl}`);
        if (body.trim().length < 200) row.failures.push("blank_or_tiny_swfi_response");
        const hits = forbiddenHits(body);
        if (hits.length) row.failures.push(`forbidden_text:${hits.join("|")}`);
      }
      row.ok = row.failures.length === 0;
      result.samples.push(row);
    }
    if (result.samples.length < 3) result.failures.push(`sample_count_${result.samples.length}_lt_3`);
    result.failures.push(...result.samples.flatMap((row) => row.ok ? [] : row.failures.map((failure) => `${row.kind}:${failure}`)));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function staleSwficcV1PassthroughCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const result = { id: "legacy_swficc_v1_routes_redirect_to_terminal_records", ok: true, failures: [], samples: [] };
  const samples = [
    { section: "entities", id: "930378", detailPath: "/swficc/profiles/detail/" },
    { section: "transactions", id: "6a300360f573546e66a087b5", detailPath: "/swficc/transactions/detail/" },
    { section: "compass", id: "6a054a79fc240d9d3ab4e22c", detailPath: "/swficc/mandates/detail/" },
    { section: "people", id: "65f194e86967a79fee4f5856", detailPath: "/swficc/people/detail/" },
  ];
  try {
    for (const sample of samples) {
      const localPath = `/v1/${sample.section}/${sample.id}`;
      const expectedSource = `https://www.swfi.com/v1/${sample.section}/${sample.id}`;
      const response = await context.request.get(appUrl(localPath), { maxRedirects: 0, timeout: 45_000 });
      const location = response.headers().location || "";
      const row = { ...sample, local_url: appUrl(localPath), status: response.status(), location, expected_source: expectedSource, ok: true, failures: [] };
      if (response.status() !== 302) row.failures.push(`expected_302_got_${response.status()}`);
      let redirected = null;
      try {
        redirected = new URL(location, origin);
      } catch {
        row.failures.push(`invalid_redirect:${location || "missing"}`);
      }
      if (redirected) {
        if (redirected.origin !== originUrl.origin || redirected.pathname !== sample.detailPath) row.failures.push(`expected_terminal_detail_got_${location || "missing"}`);
        if (redirected.searchParams.get("id") !== sample.id) row.failures.push(`expected_id_${sample.id}_got_${redirected.searchParams.get("id") || "missing"}`);
        if (redirected.searchParams.get("source") !== expectedSource) row.failures.push(`expected_source_${expectedSource}_got_${redirected.searchParams.get("source") || "missing"}`);
      }
      row.ok = row.failures.length === 0;
      result.samples.push(row);
    }
    result.failures.push(...result.samples.flatMap((row) => row.ok ? [] : row.failures.map((failure) => `${row.section}:${failure}`)));
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function credentialedSwfiReturnCheck(browser) {
  const result = { id: "credentialed_swfi_return_to_record", ok: true, skipped: false, failures: [], final_url: "", target_href: "" };
  if (!username || !password) {
    result.skipped = true;
    if (!allowAuthSkip) result.failures.push("missing_auth_test_credentials");
    result.ok = result.failures.length === 0;
    return result;
  }
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  try {
    const targetPath = "/v1/entities/5e5713b876fb1e43b1bb71eb";
    result.target_href = `https://www.swfi.com${targetPath}`;
    await page.goto(`https://www.swfi.com/v1/signin/?msg=auth&redirect=${encodeURIComponent(targetPath)}`, { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[name="email"], input[name="username"]').first().fill(username, { timeout: 30_000 });
    await page.locator('input[name="password"]').first().fill(password, { timeout: 30_000 });
    await Promise.all([
      page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => null),
      page.locator('input[type="submit"], button[type="submit"]').first().click({ timeout: 30_000 }),
    ]);
    await page.waitForTimeout(3000);
    result.final_url = page.url();
    if (!result.final_url.includes(targetPath)) result.failures.push(`did_not_return_to_record:${result.final_url}`);
    const body = await page.locator("body").innerText({ timeout: 30_000 }).catch(() => "");
    if (/Sign In|Email|Password/i.test(body) && !body.includes("ENTITY DETAILS")) result.failures.push("still_on_signin");
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function matrixLine(label, check) {
  const status = check.skipped ? "SKIPPED" : check.ok ? "PASS" : "FAIL";
  const detail = check.skipped ? "No secure credential env supplied" : check.ok ? "Verified" : check.failures.join("; ");
  return `| ${label} | ${status} | ${detail.replace(/\|/g, "/")} |`;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const checks = [];
  try {
    checks.push(await dashboardCheck(browser));
    checks.push(await apiCheck());
    checks.push(await listPageCheck(browser));
    checks.push(await firstPartyRecordMirrorCheck(browser));
    checks.push(await staleSwficcV1PassthroughCheck(browser));
    checks.push(await credentialedSwfiReturnCheck(browser));
  } finally {
    await browser.close().catch(() => {});
  }
  const failures = checks.flatMap((check) => check.ok || check.skipped ? [] : check.failures.map((failure) => `${check.id}:${failure}`));
  const skipped = checks.filter((check) => check.skipped).map((check) => check.id);
  const receipt = {
    schema_version: "swfipn.closeout_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    status: failures.length ? "fail" : "pass",
    skipped,
    summary: {
      checks: checks.length,
      failures: failures.length,
      skipped: skipped.length,
    },
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  const matrix = [
    "# SWFIPN Closeout Gate",
    "",
    `Generated: ${receipt.generated_at}`,
    `Origin: ${origin}`,
    "",
    "| Requirement | Status | Evidence |",
    "|---|---:|---|",
    matrixLine("Dashboard public, SWFI-like, no internal leakage", checks[0]),
    matrixLine("Data packets fact-backed and fresh", checks[1]),
    matrixLine("List pages count, filter, paginate, canonical-link", checks[2]),
    matrixLine("Dashboard record links resolve to SWFI core record handoff pages", checks[3]),
    matrixLine("Credentialed SWFI return-to-record", checks[5]),
    "",
  ].join("\n");
  fs.writeFileSync(matrixPath, matrix);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, skipped, receipt: receiptPath, matrix: matrixPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), fatal: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
