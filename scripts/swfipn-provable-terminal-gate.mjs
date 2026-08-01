#!/usr/bin/env node
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-provable-terminal-gate-latest.json");

const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(origin).origin).replace(/\/$/, "");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const maxReceiptAgeMinutes = Number(process.env.SWFIPN_MAX_RECEIPT_AGE_MINUTES || "180");
const routeTimeoutMs = Number(process.env.SWFIPN_PROVABLE_ROUTE_TIMEOUT_MS || "90_000".replace("_", ""));
const detailTimeoutMs = Number(process.env.SWFIPN_PROVABLE_DETAIL_TIMEOUT_MS || "60_000".replace("_", ""));
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";

const truthStates = new Set(["FACT", "DERIVED", "ANALYSIS", "SIGNAL", "CONFLICT", "STALE", "UNKNOWN"]);

const recordClasses = [
  {
    id: "entities",
    label: "Institutions",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=5&page=1",
    minCount: 500_000,
    sourceSection: "entities",
    detailPath: (row) => `/profiles/detail/?${new URLSearchParams({
      id: recordId(row),
      source: sourceUrl(row, "entities"),
    }).toString()}`,
    requiredFields: ["id_or_entity_id", "name", "type", "country", "source_url"],
  },
  {
    id: "people",
    label: "People",
    endpoint: "/api/source-data/search/v1?collection=people&limit=5&page=1",
    minCount: 100_000,
    sourceSection: "people",
    detailPath: (row) => `/people/detail/?${new URLSearchParams({
      id: recordId(row),
      source: sourceUrl(row, "people"),
    }).toString()}`,
    requiredFields: ["id_or_entity_id", "name", "source_url"],
  },
  {
    id: "transactions",
    label: "Transactions",
    endpoint: "/api/transactions/v1?limit=5&page=1",
    minCount: 180_000,
    sourceSection: "transactions",
    detailPath: (row) => `/transactions/detail/?${new URLSearchParams({
      id: recordId(row),
      source: sourceUrl(row, "transactions"),
    }).toString()}`,
    requiredFields: ["id_or_entity_id", "name_or_title", "source_url"],
  },
  {
    id: "compass",
    label: "Compass",
    endpoint: "/api/source-data/search/v1?collection=compass&limit=5&page=1",
    minCount: 4_000,
    sourceSection: "compass",
    detailPath: (row) => `/mandates/detail/?${new URLSearchParams({
      id: recordId(row),
      source: sourceUrl(row, "compass"),
    }).toString()}`,
    requiredFields: ["id_or_entity_id", "name_or_title", "source_url"],
  },
  {
    id: "news",
    label: "Research / News",
    endpoint: "/api/source-intelligence/news/v1?limit=5&page=1",
    minCount: 17_000,
    sourceSection: "news",
    detailPath: (row) => `/research/detail/?${new URLSearchParams({
      legacy: recordId(row),
      source: sourceUrl(row, "news"),
    }).toString()}`,
    requiredFields: ["id_or_entity_id", "name_or_title", "source_url"],
  },
];

const widgetChecks = [
  {
    id: "dashboard_metrics",
    endpoint: "/api/swfi/dashboard-metrics/v1",
    requireStatusOk: true,
    requiredText: ["institutions", "transactions"],
  },
  {
    id: "active_allocators",
    endpoint: "/api/allocator-activity/v1?days=90&limit=5",
    requireRows: true,
    requiredRowFields: ["name", "deal_count"],
  },
  {
    id: "recent_transactions",
    endpoint: "/api/recent-transactions/v1?days=30&limit=5&page=1",
    requireRows: true,
    requiredRowFields: ["source_url"],
  },
  {
    id: "live_rfps",
    endpoint: "/api/live-opportunities/v1?limit=5&page=1",
    requireRows: true,
    requiredRowFields: ["source_url"],
  },
  {
    id: "sector_flows",
    endpoint: "/api/sector-flows/v1?days=365",
    requireRowsOrFacets: true,
  },
];

const renderedRoutes = [
  { route: "/", ready: ["KPI CARDS", "Top Active Allocators", "Newest Transactions"], minDataLinks: 5, allowSourceGap: false, authRequired: false },
  { route: "/profiles/", ready: ["Entity Name", "AUM", "Showing 5 of"], minDataLinks: 5, allowSourceGap: false, detailHrefIncludes: "/profiles/detail/", authRequired: false },
  { route: "/people/", ready: ["People", "Showing 5 of"], minDataLinks: 1, allowSourceGap: false, detailHrefIncludes: "/people/detail/", authRequired: false },
  { route: "/transactions/", ready: ["SWFI transaction source", "Showing 5 of"], minDataLinks: 5, allowSourceGap: false, detailHrefIncludes: "/transactions/detail/", authRequired: false },
  { route: "/mandates/", ready: ["Showing 5 of"], minDataLinks: 5, allowSourceGap: false, detailHrefIncludes: "/mandates/detail/", authRequired: false },
  { route: "/search/?q=Real%20Estate", ready: ["Real Estate", "Showing 5 of"], minDataLinks: 1, allowSourceGap: false, authRequired: false },
];

const supportingReceipts = [
  "swfipn-source-truth-gate-latest.json",
  "swfipn-source-url-coverage-latest.json",
  "swfipn-list-data-proof-latest.json",
  "swfipn-table-controls-proof-latest.json",
  "swfipn-auth-navigation-gate-latest.json",
  "swfipn-phase1-public-dashboard-gate-latest.json",
  "swfipn-data-validation-gate-latest.json",
  "swfipn-e2e-gate-latest.json",
  "swfipn-detail-depth-gate-latest.json",
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function backendUrl(endpoint) {
  return `${backendOrigin}${endpoint}`;
}

function recordId(row) {
  const direct = String(row?.id || row?._id || row?.entity_id || row?.source_record_id || "");
  if (direct) return direct;
  return swfiIdFromUrl(row?.source_url || row?.swfi_url || row?.institution_url || row?.buyer_entity_url || "");
}

function sourceUrl(row, section) {
  const direct = String(row?.source_url || row?.swfi_url || "");
  if (direct.startsWith("http://") || direct.startsWith("https://")) return normalizeSwfiUrl(direct);
  const id = recordId(row);
  if (section === "news") return id ? `https://www.swfi.com/?p=${encodeURIComponent(id)}` : "";
  return id ? `https://www.swfi.com/v1/${section}/${encodeURIComponent(id)}` : "";
}

function normalizeSwfiUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "cms.swfi.com") parsed.hostname = "www.swfi.com";
    return parsed.toString();
  } catch {
    return value;
  }
}

function swfiIdFromUrl(value) {
  const raw = String(value || "");
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    const legacy = parsed.searchParams.get("p");
    if (legacy) return legacy;
    return parsed.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    const match = raw.match(/\/([a-f0-9]{24})(?:[/?#]|$)/i);
    return match ? match[1] : "";
  }
}

function sameAppUrl(href) {
  try {
    const parsed = new URL(href);
    const root = new URL(origin);
    const basePath = root.pathname.replace(/\/$/, "");
    return parsed.origin === root.origin && parsed.pathname.startsWith(basePath || "/");
  } catch {
    return false;
  }
}

function isAllowedExternalRecordUrl(href) {
  try {
    const parsed = new URL(String(href || ""));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.searchParams.get("p")) return true;
    return /^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname)
      || /^\/v1\/news\/\d{1,12}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function normalizeTruthState(value) {
  const state = String(value || "").trim().replace(/[-\s]/g, "_").toUpperCase();
  if (state === "DERIVED_FACT") return "DERIVED";
  if (state === "SOURCE_GAP" || state === "UNKNOWN") return "UNKNOWN";
  return state;
}

function hashObject(value) {
  return `sha256:${crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex")}`;
}

async function fetchJson(endpoint) {
  const response = await fetch(backendUrl(endpoint), { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 1000) };
  }
  return { endpoint, url: backendUrl(endpoint), http_status: response.status, body, body_hash: hashObject(body) };
}

function packetData(packet) {
  return packet.body?.data && typeof packet.body.data === "object" ? packet.body.data : {};
}

function packetRows(packet) {
  const data = packetData(packet);
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function packetCount(packet) {
  const data = packetData(packet);
  return Number(data.count ?? data.total ?? data.source_total ?? packetRows(packet).length ?? 0);
}

function packetSourceOfTruth(packet) {
  return String(
    packet.body?.source_contract?.source_of_truth
    || packet.body?.provenance?.source_of_truth
    || packet.body?.source_receipt?.source
    || "",
  );
}

function isMongoSourceOfTruth(packet) {
  const source = packetSourceOfTruth(packet).toLowerCase();
  return source.includes("swfi_mongo_mirror") || source.includes("swfi production mongo mirror");
}

function hasField(row, field) {
  if (field === "id_or_entity_id") return Boolean(recordId(row));
  if (field === "name_or_title") return Boolean(row?.name || row?.title || row?.deal || row?.transaction_name);
  if (field === "source_url") return sourceUrl(row, "records").startsWith("https://www.swfi.com/");
  return row?.[field] !== undefined && row?.[field] !== null && String(row[field]).trim() !== "";
}

function rowTruthState(row, fallback = "UNKNOWN") {
  return normalizeTruthState(row?.truth_state || row?.result_qualifier || fallback);
}

function receiptAge(receipt) {
  const date = Date.parse(receipt.generated_at || receipt.checked_at || receipt.run_at || "");
  if (!Number.isFinite(date)) return Infinity;
  return (Date.now() - date) / 60_000;
}

async function checkBackendHealth() {
  const health = await fetchJson("/healthz");
  const failures = [];
  if (health.http_status !== 200) failures.push(`http_${health.http_status}`);
  if (health.body?.status !== "ok") failures.push(`status_${health.body?.status || "missing"}`);
  if (health.body?.checks?.sync_fresh === false) failures.push("sync_not_fresh");
  if (health.body?.fact_source && health.body.fact_source !== "mongo") failures.push(`fact_source_${health.body.fact_source}`);
  return { id: "backend_health", ok: failures.length === 0, failures, packet: health };
}

async function checkRecordClass(item) {
  const packet = await fetchJson(item.endpoint);
  const rows = packetRows(packet);
  const count = packetCount(packet);
  const failures = [];
  if (packet.http_status !== 200) failures.push(`http_${packet.http_status}`);
  if (packet.body?.status !== "ok") failures.push(`status_${packet.body?.status || "missing"}`);
  if (count < item.minCount) failures.push(`count_below_min:${count}<${item.minCount}`);
  if (!isMongoSourceOfTruth(packet)) failures.push("missing_mongo_source_of_truth");
  if (!rows.length) failures.push("no_rows");

  const rowChecks = rows.slice(0, 5).map((row) => {
    const rowFailures = [];
    for (const field of item.requiredFields) {
      if (!hasField(row, field)) rowFailures.push(`missing_${field}`);
    }
    const truthState = rowTruthState(row, packet.body?.result_qualifier);
    if (!truthStates.has(truthState)) rowFailures.push(`bad_truth_state:${truthState || "missing"}`);
    const rowSourceUrl = sourceUrl(row, item.sourceSection);
    if (item.sourceSection === "news" && !/\?p=\d+/.test(rowSourceUrl)) {
      rowFailures.push(`wrong_source_section:${rowSourceUrl}`);
    } else if (!rowSourceUrl.includes(`/v1/${item.sourceSection}/`) && item.sourceSection !== "compass" && item.sourceSection !== "news") {
      rowFailures.push(`wrong_source_section:${rowSourceUrl}`);
    }
    if (item.sourceSection === "compass" && !rowSourceUrl.includes("/v1/compass/")) {
      rowFailures.push(`wrong_source_section:${rowSourceUrl}`);
    }
    return {
      id: recordId(row),
      label: String(row.name || row.title || row.deal || "").slice(0, 160),
      source_url: rowSourceUrl,
      truth_state: truthState,
      internal_detail_url: appUrl(item.detailPath(row)),
      ok: rowFailures.length === 0,
      failures: rowFailures,
    };
  });

  for (const check of rowChecks) {
    if (!check.ok) failures.push(`row_failed:${check.id || check.label || "unknown"}`);
  }

  return {
    id: item.id,
    label: item.label,
    endpoint: item.endpoint,
    http_status: packet.http_status,
    count,
    source_of_truth: packetSourceOfTruth(packet),
    rows_checked: rowChecks.length,
    row_checks: rowChecks,
    ok: failures.length === 0,
    failures,
    api_response_hash: packet.body_hash,
  };
}

async function checkWidget(item) {
  const packet = await fetchJson(item.endpoint);
  const rows = packetRows(packet);
  const data = packetData(packet);
  const failures = [];
  if (packet.http_status !== 200) failures.push(`http_${packet.http_status}`);
  if (item.requireStatusOk && packet.body?.status !== "ok") failures.push(`status_${packet.body?.status || "missing"}`);
  if (item.requireRows && !rows.length) failures.push("no_rows");
  if (item.requireRowsOrFacets && !rows.length && !Object.values(data.facets || {}).some((value) => Array.isArray(value) && value.length)) {
    failures.push("no_rows_or_facets");
  }
  if (item.requiredText) {
    const text = JSON.stringify(data).toLowerCase();
    for (const required of item.requiredText) {
      if (!text.includes(required.toLowerCase())) failures.push(`missing_text:${required}`);
    }
  }
  if (item.requiredRowFields && rows.length) {
    rows.slice(0, 5).forEach((row, index) => {
      for (const field of item.requiredRowFields) {
        if (!hasField(row, field)) failures.push(`row_${index}_missing_${field}`);
      }
      const truthState = rowTruthState(row, packet.body?.result_qualifier);
      if (!truthStates.has(truthState)) failures.push(`row_${index}_bad_truth_state:${truthState}`);
    });
  }
  return {
    id: item.id,
    endpoint: item.endpoint,
    http_status: packet.http_status,
    packet_status: packet.body?.status || null,
    row_count: rows.length,
    source_of_truth: packetSourceOfTruth(packet),
    ok: failures.length === 0,
    failures,
    api_response_hash: packet.body_hash,
  };
}

async function waitForRouteReady(page, ready, allowSourceGap) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < routeTimeoutMs) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const readyOk = ready.every((text) => lower.includes(text.toLowerCase()));
    const loadingOk = !/\bLoading\b/.test(body);
    const sourceOk = allowSourceGap || !/Source gap/.test(body);
    if (readyOk && loadingOk && sourceOk) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function inspectRoute(surface, spec) {
  const page = await surface.newPage();
  await page.setViewportSize({ width: 1366, height: 900 });
  const failures = [];
  const url = appUrl(spec.route);
  const result = {
    route: spec.route,
    url,
    final_url: "",
    http_status: null,
    ok: true,
    failures,
    showing_labels: [],
    source_gap_count: 0,
    loading_count: 0,
    visible_links: 0,
    data_source_links: 0,
    same_host_links: 0,
    external_visible_links: [],
    detail_checks: [],
    frontend_snapshot_hash: "",
    body_first: [],
  };

  try {
    const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    result.http_status = response?.status() || 0;
    result.final_url = page.url();
    if (!response || response.status() >= 400) failures.push(`http_${response?.status() || "missing"}`);
    if (!sameAppUrl(result.final_url)) failures.push(`wrong_host:${result.final_url}`);
    const body = await waitForRouteReady(page, spec.ready, spec.allowSourceGap);
    await page.waitForTimeout(500);
    const snapshot = await page.evaluate(() => {
      const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length);
      const text = (el) => (el.innerText || el.textContent || "").trim().replace(/\s+/g, " ");
      return {
        body: document.body.innerText || "",
        links: Array.from(document.querySelectorAll("a[href]"))
          .filter(visible)
          .map((link) => ({
            text: text(link),
            href: link.href,
            raw: link.getAttribute("href") || "",
            sourceHref: link.getAttribute("data-source-href") || "",
          })),
      };
    });
    const bodyText = snapshot.body || body;
    result.frontend_snapshot_hash = hashObject({
      route: spec.route,
      body: bodyText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 80),
      hrefs: snapshot.links.map((link) => link.href).slice(0, 80),
    });
    result.body_first = bodyText.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 32);
    result.source_gap_count = (bodyText.match(/Source gap/g) || []).length;
    result.loading_count = (bodyText.match(/Loading/g) || []).length;
    result.showing_labels = [...bodyText.matchAll(/Showing\s+\d+\s+of\s+[\d,]+(?:\s+\/\s+loaded\s+\d+)?/g)].map((match) => match[0]);
    result.visible_links = snapshot.links.length;
    result.same_host_links = snapshot.links.filter((link) => sameAppUrl(link.href)).length;
    result.external_visible_links = snapshot.links.filter((link) => link.href.startsWith("http") && !sameAppUrl(link.href) && !isAllowedExternalRecordUrl(link.href)).slice(0, 20);
    const sourceLinks = snapshot.links.filter((link) => link.sourceHref || link.href.includes("/source/?url=") || /detail/i.test(link.href) || isAllowedExternalRecordUrl(link.href));
    result.data_source_links = sourceLinks.length;
    if (result.loading_count) failures.push(`loading_count_${result.loading_count}`);
    if (!spec.allowSourceGap && result.source_gap_count) failures.push(`source_gap_count_${result.source_gap_count}`);
    if (result.external_visible_links.length) failures.push(`external_visible_links_${result.external_visible_links.length}`);
    if (sourceLinks.length < spec.minDataLinks) failures.push(`data_source_links_below_min:${sourceLinks.length}<${spec.minDataLinks}`);

    const detailCandidates = sourceLinks
      .filter((link) => sameAppUrl(link.href))
      .filter((link) => !spec.detailHrefIncludes || link.href.includes(spec.detailHrefIncludes))
      .slice(0, 2);
    for (const link of detailCandidates) {
      const detail = await inspectDetail(surface, link.href, link.text);
      result.detail_checks.push(detail);
      if (!detail.ok) failures.push(`detail_failed:${link.href}`);
    }
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }

  result.ok = failures.length === 0;
  return result;
}

async function inspectDetail(surface, href, label) {
  const page = await surface.newPage();
  await page.setViewportSize({ width: 1280, height: 820 });
  const failures = [];
  const result = { label, href, final_url: "", http_status: null, ok: true, failures, source_backed: false, body_first: [] };
  try {
    const response = await page.goto(href, { waitUntil: "domcontentloaded", timeout: 45_000 });
    result.http_status = response?.status() || 0;
    result.final_url = page.url();
    if (!response || response.status() >= 400) failures.push(`http_${response?.status() || "missing"}`);
    if (!sameAppUrl(result.final_url)) failures.push(`wrong_host:${result.final_url}`);
    const start = Date.now();
    let body = "";
    while (Date.now() - start < detailTimeoutMs) {
      body = await page.locator("body").innerText().catch(() => "");
      if (!/\bLoading\b/.test(body) && (/Source-backed fact/i.test(body) || /Verified in SWFI records/i.test(body) || /SWFIPN RECORD PAGE/i.test(body) || /Showing\s+\d+\s+of/i.test(body))) break;
      await page.waitForTimeout(750);
    }
    result.source_backed = /Source-backed fact|Verified in SWFI records|SWFIPN RECORD PAGE|SWFI .* source/i.test(body);
    result.body_first = body.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 24);
    if (/\bLoading\b/.test(body)) failures.push("loading_detail");
    if (/Source gap/i.test(body) && !result.source_backed) failures.push("source_gap_detail");
    if (!result.body_first.length || result.body_first.join(" ").includes("404:")) failures.push("blank_or_404_detail");
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = failures.length === 0;
  return result;
}

async function loginContext(browser) {
  const result = { context: null, failures: [] };
  if (!username || !password) {
    result.failures.push("missing_auth_credentials");
    return result;
  }
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto(appUrl(`/login/?next=${encodeURIComponent("/swficc/")}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/swficc\/(?:$|[?#])/, { timeout: 90_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    result.context = context;
  } catch (error) {
    result.failures.push(`auth_login_failed:${error.message}`);
    await context.close().catch(() => {});
  } finally {
    await page.close().catch(() => {});
  }
  return result;
}

function blockedProtectedRoute(spec, failures) {
  return {
    route: spec.route,
    url: appUrl(spec.route),
    final_url: "",
    http_status: null,
    ok: false,
    failures,
    showing_labels: [],
    source_gap_count: 0,
    loading_count: 0,
    visible_links: 0,
    data_source_links: 0,
    same_host_links: 0,
    external_visible_links: [],
    detail_checks: [],
    frontend_snapshot_hash: "",
    body_first: [],
  };
}

function inspectSupportingReceipts() {
  return supportingReceipts.map((file) => {
    const fullPath = path.join(outputDir, file);
    const result = { file, path: fullPath, exists: fs.existsSync(fullPath), status: "missing", fresh: false, age_minutes: null, ok: false, summary: null };
    if (!result.exists) return result;
    try {
      const body = JSON.parse(fs.readFileSync(fullPath, "utf8"));
      result.status = body.status || "unknown";
      result.age_minutes = Math.round(receiptAge(body) * 10) / 10;
      result.fresh = result.age_minutes <= maxReceiptAgeMinutes;
      result.summary = body.summary || null;
      result.ok = result.status === "pass" && result.fresh;
    } catch (error) {
      result.status = `parse_error:${error.message}`;
    }
    return result;
  });
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const launchArgs = resolveIp ? [`--host-resolver-rules=MAP ${new URL(origin).hostname} ${resolveIp}`] : [];
  const browser = await chromium.launch({ headless: true, args: launchArgs });
  const receipt = {
    schema_version: "swfipn.provable_terminal_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    contract: "docs/doctrine/SWFI_PROVABLE_TERMINAL_CONTRACT.md",
    status: "pass",
    summary: {},
    failures: [],
    backend_health: null,
    record_classes: [],
    widget_checks: [],
    rendered_routes: [],
    supporting_receipts: [],
  };

  try {
    receipt.backend_health = await checkBackendHealth();
    receipt.record_classes = await Promise.all(recordClasses.map(checkRecordClass));
    receipt.widget_checks = await Promise.all(widgetChecks.map(checkWidget));
    const publicContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const auth = await loginContext(browser);
    for (const route of renderedRoutes) {
      if (route.authRequired && !auth.context) {
        receipt.rendered_routes.push(blockedProtectedRoute(route, auth.failures));
      } else {
        receipt.rendered_routes.push(await inspectRoute(route.authRequired ? auth.context : publicContext, route));
      }
    }
    await auth.context?.close().catch(() => {});
    await publicContext.close().catch(() => {});
    receipt.supporting_receipts = inspectSupportingReceipts();
  } finally {
    await browser.close().catch(() => {});
  }

  const failures = [
    ...(!receipt.backend_health.ok ? [{ type: "backend_health", failures: receipt.backend_health.failures }] : []),
    ...receipt.record_classes.filter((item) => !item.ok).map((item) => ({ type: "record_class", id: item.id, failures: item.failures })),
    ...receipt.widget_checks.filter((item) => !item.ok).map((item) => ({ type: "widget", id: item.id, failures: item.failures })),
    ...receipt.rendered_routes.filter((item) => !item.ok).map((item) => ({ type: "rendered_route", route: item.route, failures: item.failures })),
    ...receipt.supporting_receipts.filter((item) => !item.ok).map((item) => ({ type: "supporting_receipt", file: item.file, status: item.status, age_minutes: item.age_minutes })),
  ];
  receipt.failures = failures;
  receipt.status = failures.length ? "fail" : "pass";
  receipt.summary = {
    record_classes: receipt.record_classes.length,
    total_mirrorable_records_checked: receipt.record_classes.reduce((total, item) => total + item.count, 0),
    widgets_checked: receipt.widget_checks.length,
    routes_checked: receipt.rendered_routes.length,
    route_detail_checks: receipt.rendered_routes.reduce((total, item) => total + item.detail_checks.length, 0),
    supporting_receipts: receipt.supporting_receipts.length,
    failures: failures.length,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, failures, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const failure = { status: "fail", error: error.message, generated_at: new Date().toISOString() };
  fs.writeFileSync(receiptPath, `${JSON.stringify(failure, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
