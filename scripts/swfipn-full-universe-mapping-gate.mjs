#!/usr/bin/env node
import { createRequire } from "node:module";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "full-universe");
const latestReceiptPath = path.join(repoRoot, "output", "swfipn-full-universe-mapping-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const originUrl = new URL(origin);
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || originUrl.origin).replace(/\/$/, "");
const serviceToken = text(process.env.SWFIPN_BACKEND_TOKEN || process.env.SWFI2_API_TOKEN);
const runId = process.env.SWFIPN_UNIVERSE_RUN_ID || timestampId();
const pageLimit = clampNumber(process.env.SWFIPN_UNIVERSE_LIMIT, 1, 5000, 1000);
const maxPages = Number(process.env.SWFIPN_UNIVERSE_MAX_PAGES || 0);
const maxRecords = Number(process.env.SWFIPN_UNIVERSE_MAX_RECORDS || 0);
const shardCount = Math.max(1, Number(process.env.SWFIPN_UNIVERSE_SHARD_COUNT || 1));
const shardIndex = Math.max(0, Number(process.env.SWFIPN_UNIVERSE_SHARD_INDEX || 0));
const probeLimit = Math.max(0, Number(process.env.SWFIPN_UNIVERSE_PROBE_LIMIT || 0));
const probeAll = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_PROBE_ALL || ""));
const canonicalCollections = ["entities", "people", "transactions", "compass", "news", "reports"];
const collections = envList("SWFIPN_UNIVERSE_COLLECTIONS", canonicalCollections);
const scanTimeoutMs = clampNumber(process.env.SWFIPN_UNIVERSE_SCAN_TIMEOUT_MS, 5_000, 300_000, 120_000);
const scanRetries = clampNumber(process.env.SWFIPN_UNIVERSE_SCAN_RETRIES, 0, 10, 3);
const failOnUiTotalMismatch = !/^(0|false|no)$/i.test(String(process.env.SWFIPN_UNIVERSE_FAIL_ON_UI_TOTAL_MISMATCH || "1"));
const allowPartial = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_ALLOW_PARTIAL || ""));
const allowPartialExit = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_ALLOW_PARTIAL_EXIT || ""));
const allowShardedPartial = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_ALLOW_SHARD_PARTIAL || ""));
const allowSourceTotalDrift = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_ALLOW_SOURCE_TOTAL_DRIFT || ""));
const requireReportsContract = !/^(0|false|no)$/i.test(String(process.env.SWFIPN_UNIVERSE_REQUIRE_REPORTS_CONTRACT || "1"));
const failOnMissingLabel = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_UNIVERSE_FAIL_ON_MISSING_LABEL || "0"));
let activeReceipt = null;
let activeFamily = "";

function writeLatestReceipt(receipt) {
  fs.mkdirSync(path.dirname(latestReceiptPath), { recursive: true });
  const tmpPath = `${latestReceiptPath}.${process.pid}.tmp`;
  fs.writeFileSync(tmpPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.renameSync(tmpPath, latestReceiptPath);
}

if (shardIndex >= shardCount) {
  throw new Error(`Invalid shard config: SWFIPN_UNIVERSE_SHARD_INDEX=${shardIndex} must be less than SWFIPN_UNIVERSE_SHARD_COUNT=${shardCount}`);
}

if (shardCount > 1 && !allowShardedPartial) {
  throw new Error("Sharded runs are partial by definition. Set SWFIPN_UNIVERSE_ALLOW_SHARD_PARTIAL=1 for shard receipts, then aggregate them before making a full-universe claim.");
}

const families = [
  {
    id: "entities",
    collection: "entities",
    section: "entities",
    uiRoute: "/profiles/",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/entities\/([a-f0-9]{24})\/?$/i,
    expectedRedirect: (id) => `/v1/entities/${id}`,
    clickHref: (id) => swfiSignin(`/v1/entities/${id}`),
    label: (row) => text(row.name || row.title || row.slug || ""),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "entities") || hexId(row.entity_id || row.id || row.source_record_id),
    sourceUrl: (row, id) => text(row.source_url || row.swfi_url) || `https://www.swfi.com/v1/entities/${id}`,
  },
  {
    id: "people",
    collection: "people",
    section: "people",
    uiRoute: "/people/",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/people\/([a-f0-9]{24})\/?$/i,
    expectedRedirect: (id) => `/v1/people/${id}`,
    clickHref: (id) => swfiSignin(`/v1/people/${id}`),
    label: (row) => text(row.name || row.title || ""),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "people") || hexId(row.person_id || row.id || row.source_record_id),
    sourceUrl: (row, id) => text(row.source_url || row.swfi_url) || `https://www.swfi.com/v1/people/${id}`,
  },
  {
    id: "transactions",
    collection: "transactions",
    section: "transactions",
    uiRoute: "/transactions/",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/transactions\/([a-f0-9]{24})\/?$/i,
    expectedRedirect: (id) => `/v1/transactions/${id}`,
    clickHref: (id) => swfiSignin(`/v1/transactions/${id}`),
    label: (row) => text(row.title || row.name || ""),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "transactions") || hexId(row.transaction_id || row.id || row.source_record_id),
    sourceUrl: (row, id) => text(row.source_url || row.swfi_url) || `https://www.swfi.com/v1/transactions/${id}`,
  },
  {
    id: "compass",
    collection: "compass",
    section: "compass",
    uiRoute: "/mandates/",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/compass\/([a-f0-9]{24})\/?$/i,
    uiTotalScope: "live_open_only",
    expectedRedirect: (id) => `/v1/compass/${id}`,
    clickHref: (id) => swfiSignin(`/v1/compass/${id}`),
    label: (row) => text(row.title || row.name || ""),
    idFromRow: (row) => idFromSwfiSource(row.source_url || row.swfi_url, "compass") || hexId(row.compass_id || row.mandate_id || row.rfp_id || row.id || row.source_record_id),
    sourceUrl: (row, id) => text(row.source_url || row.swfi_url) || `https://www.swfi.com/v1/compass/${id}`,
  },
  {
    id: "news",
    collection: "news",
    section: "news",
    uiRoute: "/research/",
    sourcePattern: /^(?:https:\/\/(?:www\.|cms\.)?swfi\.com\/\?p=(\d+)|https:\/\/www\.swfi\.com\/v1\/news\/(\d+)\/?|legacy_post:(\d+))$/i,
    expectedRedirect: (id) => `/swficc/research/detail/?legacy=${encodeURIComponent(id)}`,
    clickHref: (id) => appUrl(`/research/detail/?legacy=${encodeURIComponent(id)}`),
    label: (row) => text(row.title || row.name || ""),
    idFromRow: (row) => numericId(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id || row.wp_id || idFromLegacyUrl(row.source_url || row.url)),
    sourceUrl: (row, id) => text(row.source_url || row.url) || (id ? `legacy_post:${id}` : ""),
    derivedSourceAllowed: true,
  },
  {
    id: "reports",
    collection: "reports",
    section: "reports",
    uiRoute: "/reports/",
    uiTotalScope: "mixed_report_page",
    sourcePattern: /^https:\/\/assets\.swfi\.com\/reports\/[^?#]+\.pdf(?:[?#].*)?$/i,
    expectedRedirect: (id) => `/swficc/reports/detail/?key=${encodeURIComponent(id)}`,
    clickHref: (id) => appUrl(`/reports/detail/?key=${encodeURIComponent(id)}`),
    label: (row) => text(row.title || row.name || ""),
    idFromRow: (row) => text(row.report_key) || reportKeyFromUrl(row.source_url || row.report_url || row.url) || hexId(row.report_id || row.id || row.source_record_id),
    sourceUrl: (row) => text(row.source_url || row.report_url || row.url),
  },
].filter((family) => collections.includes(family.id) || collections.includes(family.collection));

const requestedCollectionIds = families.map((family) => family.id);
const missingCanonicalCollections = canonicalCollections.filter((id) => !requestedCollectionIds.includes(id));

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function envList(name, fallback) {
  const value = String(process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
  return value.length ? value : fallback;
}

function clampNumber(value, min, max, fallback) {
  const number = Number(value || fallback);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(min, Math.min(max, number));
}

function collectionPageLimit(family) {
  const envKey = `SWFIPN_UNIVERSE_LIMIT_${family.id.toUpperCase()}`;
  const fallback = family.id === "transactions" ? Math.min(pageLimit, 500) : pageLimit;
  return clampNumber(process.env[envKey], 1, 5000, fallback);
}

function timestampId() {
  return new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
}

function text(value) {
  return String(value ?? "").trim();
}

function hexId(value) {
  const match = text(value).match(/^[a-f0-9]{24}$/i);
  return match ? match[0].toLowerCase() : "";
}

function numericId(value) {
  const match = text(value).match(/^\d+$/);
  return match ? match[0] : "";
}

function idFromLegacyUrl(value) {
  try {
    const parsed = new URL(text(value));
    return numericId(parsed.searchParams.get("p"));
  } catch {
    return "";
  }
}

function reportKeyFromUrl(value) {
  try {
    const parsed = new URL(text(value));
    const match = parsed.pathname.match(/\/reports\/([^/?#]+)\.pdf$/i);
    return match ? match[1].replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-|-$/g, "") : "";
  } catch {
    return "";
  }
}

function idFromSwfiSource(value, expectedSection) {
  try {
    const parsed = new URL(text(value));
    if (!isSwfiHost(parsed.hostname)) return "";
    const match = parsed.pathname.match(/^\/v1\/(entities|people|transactions|compass)\/([a-f0-9]{24})\/?$/i);
    if (!match) return "";
    if (match[1].toLowerCase() !== expectedSection) return "";
    return match[2].toLowerCase();
  } catch {
    return "";
  }
}

function sourceSection(value) {
  try {
    const parsed = new URL(text(value));
    if (parsed.hostname.toLowerCase() === "assets.swfi.com" && /^\/reports\/[^?#]+\.pdf$/i.test(parsed.pathname)) return "reports";
    if (!isSwfiHost(parsed.hostname)) return "";
    if (/^\/v1\/news\/\d+\/?$/i.test(parsed.pathname)) return "news";
    const match = parsed.pathname.match(/^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/?$/i);
    if (match) return match[1].toLowerCase();
    if (parsed.searchParams.get("p")) return "news";
  } catch {
    if (/^legacy_post:\d+$/i.test(text(value))) return "news";
  }
  return "";
}

function isSwfiHost(hostname) {
  return ["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(String(hostname || "").toLowerCase());
}

function appUrl(route) {
  const value = String(route || "/");
  if (/^https?:\/\//i.test(value)) return value;
  return new URL(value.replace(/^\//, ""), origin).href;
}

function swfiSignin(redirectPath) {
  const params = new URLSearchParams({ msg: "auth", redirect: redirectPath });
  return `https://www.swfi.com/v1/signin/?${params.toString()}`;
}

function scanUrl(collection, limit, after) {
  const params = new URLSearchParams({ collection, limit: String(limit) });
  if (after) params.set("after", after);
  return `${backendOrigin}/api/source-data/scan/v1?${params.toString()}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonOnce(url, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(serviceToken ? { Authorization: `Bearer ${serviceToken}`, "X-SWFIPN-Internal": "1" } : {}),
        "User-Agent": "SWFIPN-FullUniverseMappingGate/1.0",
      },
    });
    const textBody = await response.text();
    let body;
    try {
      body = JSON.parse(textBody);
    } catch {
      body = { raw: textBody.slice(0, 500) };
    }
    return { status: response.status, body };
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, timeoutMs = scanTimeoutMs, retries = scanRetries) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetchJsonOnce(url, timeoutMs);
    } catch (error) {
      lastError = error;
      if (attempt >= retries) break;
      const delayMs = Math.min(30_000, 1_000 * 2 ** attempt);
      console.error(`[full-universe] fetch retry ${attempt + 1}/${retries} after ${error?.name || "error"}: ${url}`);
      await sleep(delayMs);
    }
  }
  throw lastError;
}

function rowsFromPacket(packet) {
  const data = packet.body?.data || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function dataFromPacket(packet) {
  return packet.body?.data || {};
}

function shardMatches(family, id) {
  if (shardCount <= 1) return true;
  const digest = crypto.createHash("sha1").update(`${family}:${id}`).digest();
  const value = digest.readUInt32BE(0);
  return value % shardCount === shardIndex;
}

function validateRecord(family, row, seen) {
  const failures = [];
  const warnings = [];
  const id = family.idFromRow(row);
  const label = family.label(row);
  const sourceUrl = family.sourceUrl(row, id);
  const section = sourceSection(sourceUrl);
  const explicitSourceValue = text(row.source_url || row.swfi_url || row.report_url || row.url);
  const expectedRedirect = id ? family.expectedRedirect(id) : "";
  const clickHref = id ? family.clickHref(id) : "";
  const canonicalKey = `${family.id}:${id}`;

  if (!id) failures.push("source_missing_id");
  if (!label) {
    if (failOnMissingLabel) failures.push("missing_label");
    else warnings.push("missing_label");
  }
  if (!sourceUrl) failures.push("source_missing_url");
  if (!family.derivedSourceAllowed && !explicitSourceValue) failures.push("source_synthetic_not_allowed");
  if (sourceUrl && section !== family.section) failures.push(`identity_wrong_family:${section || "unknown"}_expected_${family.section}`);
  if (sourceUrl && !family.sourcePattern.test(sourceUrl)) failures.push(`invalid_source_url:${sourceUrl}`);
  if (id && !["news", "reports"].includes(family.section) && !/^[a-f0-9]{24}$/i.test(id)) failures.push(`invalid_id:${id}`);
  if (id && family.section === "news" && !/^\d+$/.test(id)) failures.push(`invalid_legacy_id:${id}`);
  if (id && family.section === "reports" && !/^[a-zA-Z0-9_-]{3,120}$/.test(id)) failures.push(`invalid_report_key:${id}`);

  if (id && seen.keys.has(canonicalKey)) failures.push(`duplicate_key:${canonicalKey}`);
  if (sourceUrl && seen.sources.has(sourceUrl)) failures.push(`duplicate_source_url:${sourceUrl}`);
  if (clickHref && seen.clicks.has(clickHref)) failures.push(`duplicate_click_href:${clickHref}`);

  if (family.section === "news") {
    if (!clickHref) {
      failures.push("missing_click_href");
    } else {
      const parsed = new URL(clickHref);
      if (parsed.origin !== originUrl.origin || !parsed.pathname.endsWith("/research/detail/") || parsed.searchParams.get("legacy") !== id) {
        failures.push(`wrong_research_click_href:${clickHref}`);
      }
    }
  } else if (family.section === "reports") {
    if (!clickHref) {
      failures.push("missing_click_href");
    } else {
      const parsed = new URL(clickHref);
      if (parsed.origin !== originUrl.origin || !parsed.pathname.endsWith("/reports/detail/") || parsed.searchParams.get("key") !== id) {
        failures.push(`wrong_report_click_href:${clickHref}`);
      }
    }
  } else {
    const handoff = parseSwfiSignin(clickHref);
    if (!handoff) failures.push(`wrong_click_handoff:${clickHref}`);
    else if (handoff.redirect !== expectedRedirect) failures.push(`redirect_mismatch:${handoff.redirect}_expected_${expectedRedirect}`);
  }

  if (!failures.some((failure) => failure.startsWith("duplicate_key")) && id) seen.keys.add(canonicalKey);
  if (!failures.some((failure) => failure.startsWith("duplicate_source_url")) && sourceUrl) seen.sources.add(sourceUrl);
  if (!failures.some((failure) => failure.startsWith("duplicate_click_href")) && clickHref) seen.clicks.add(clickHref);

  return {
    ok: failures.length === 0,
    family: family.id,
    collection: family.collection,
    id,
    label,
    source_url: sourceUrl,
    source_origin: explicitSourceValue ? "source_record" : "legacy_post_derived",
    expected_redirect: expectedRedirect,
    click_href: clickHref,
    internal_route: family.section === "news" ? clickHref : "",
    source_fields: sourceFieldsForParity(row),
    warnings,
    failures,
  };
}

function sourceFieldsForParity(row) {
  const allowed = [
    "id",
    "source_record_id",
    "entity_id",
    "person_id",
    "transaction_id",
    "compass_id",
    "source_url",
    "swfi_url",
    "name",
    "title",
    "type",
    "country",
    "region",
    "assets",
    "aum",
    "industry",
    "investment_type",
    "strategy",
    "asset_class_or_strategy",
    "amount",
    "capital",
    "value",
    "closed_at",
    "activity_date",
    "relevant_date",
    "buyer_entity",
    "institution",
    "seller_entity",
    "due_at",
    "deadline",
    "posted_at",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => row[key] !== undefined)
      .map((key) => [key, row[key]]),
  );
}

function parseSwfiSignin(href) {
  try {
    const parsed = new URL(text(href));
    if (parsed.hostname !== "www.swfi.com") return null;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return null;
    if (parsed.searchParams.get("msg") !== "auth") return null;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect.startsWith("/") || /^https?:\/\//i.test(redirect)) return null;
    if (!/^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}$/i.test(redirect)) return null;
    return { href: parsed.href, redirect };
  } catch {
    return null;
  }
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function visibleTotal(route) {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true, timeout: 30_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(appUrl(route), { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForFunction(() => /Showing\s+\d+\s+of\s+[\d,]+/i.test(document.body?.innerText || ""), null, { timeout: 20_000 }).catch(() => null);
    const body = await page.locator("body").innerText({ timeout: 10_000 }).catch(() => "");
    const match = body.match(/Showing\s+\d+\s+of\s+([\d,]+)/i);
    return {
      route,
      ok: Boolean(match),
      total: match ? Number(match[1].replace(/,/g, "")) : 0,
      excerpt: body.slice(0, 500).replace(/\s+/g, " "),
      failures: match ? [] : ["missing_showing_total"],
    };
  } catch (error) {
    return { route, ok: false, total: 0, excerpt: "", failures: [error.message] };
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

async function probeClickHref(record) {
  if (record.family === "news") {
    const packet = await fetchJson(record.click_href, 15_000);
    return { status: packet.status, ok: packet.status >= 200 && packet.status < 400, final_url: record.click_href };
  }
  const response = await fetch(record.click_href, {
    redirect: "manual",
    headers: { "User-Agent": "SWFIPN-FullUniverseMappingGate/1.0" },
  });
  return {
    status: response.status,
    location: response.headers.get("location") || "",
    ok: response.status >= 200 && response.status < 400,
  };
}

async function enumerateFamily(family, globalSeen) {
  fs.mkdirSync(outputDir, { recursive: true });
  const ndjsonPath = path.join(outputDir, `swfipn-full-universe-${runId}-${family.id}${shardCount > 1 ? `-shard-${shardIndex}-of-${shardCount}` : ""}.ndjson`);
  const stream = fs.createWriteStream(ndjsonPath);
  const familySeen = { keys: new Set(), sources: new Set(), clicks: new Set() };
  const failures = [];
  const samples = [];
  const failureSamples = [];
  const probeSamples = [];
  const pageFingerprints = new Set();
  let after = "";
  let pages = 0;
  let sourceTotal = 0;
  let firstSourceTotal = 0;
  let latestSourceTotal = 0;
  let rowsSeen = 0;
  let rowsInShard = 0;
  let rowsWritten = 0;
  let rowsPassed = 0;
  let rowsFailed = 0;
  let rowsWarned = 0;
  let cursorLoop = false;
  let terminalReason = "";
  let firstGeneratedAt = "";
  let lastGeneratedAt = "";
  const familyPageLimit = collectionPageLimit(family);

  while (true) {
    if (maxPages && pages >= maxPages) {
      terminalReason = `max_pages_${maxPages}`;
      if (!allowPartial) failures.push(`page_cap_hit:${maxPages}`);
      break;
    }
    const packet = await fetchJson(scanUrl(family.collection, familyPageLimit, after));
    pages += 1;
    if (packet.status >= 400 || packet.body?.status !== "ok") {
      failures.push(`scan_packet_failed:${packet.status}:${packet.body?.status || "missing"}`);
      terminalReason = "scan_packet_failed";
      break;
    }
    firstGeneratedAt ||= text(packet.body?.generated_at);
    lastGeneratedAt = text(packet.body?.generated_at);
    const data = dataFromPacket(packet);
    const rows = rowsFromPacket(packet);
    const packetSourceTotal = Number(data.source_total || 0);
    if (packetSourceTotal) {
      firstSourceTotal ||= packetSourceTotal;
      latestSourceTotal = packetSourceTotal;
      sourceTotal = packetSourceTotal;
    }
    const pageIds = [];
    for (const row of rows) {
      rowsSeen += 1;
      const id = family.idFromRow(row);
      if (id) pageIds.push(id);
      if (id ? !shardMatches(family.id, id) : shardIndex !== 0) continue;
      rowsInShard += 1;
      const record = validateRecord(family, row, familySeen);
      if (record.warnings?.length) rowsWarned += 1;
      if (samples.length < 5) samples.push(record);
      if (globalSeen) {
        const globalKey = `${record.family}:${record.id}`;
        if (record.id && globalSeen.keys.has(globalKey) && failureSamples.length < 50) {
          record.failures.push(`global_duplicate_key:${globalKey}`);
          record.ok = false;
        }
        if (record.id) globalSeen.keys.add(globalKey);
      }
      if ((probeAll || probeSamples.length < probeLimit) && probeLimit > 0) {
        const probe = await probeClickHref(record).catch((error) => ({ ok: false, error: error.message }));
        probeSamples.push({ family: record.family, id: record.id, click_href: record.click_href, ...probe });
        if (!probe.ok) {
          record.ok = false;
          record.failures.push(`probe_failed:${probe.status || probe.error || "unknown"}`);
        }
      }
      if (record.ok) {
        rowsPassed += 1;
      } else {
        rowsFailed += 1;
        if (failureSamples.length < 50) failureSamples.push(record);
      }
      stream.write(`${JSON.stringify(record)}\n`);
      rowsWritten += 1;
      if (maxRecords && rowsWritten >= maxRecords) {
        terminalReason = `max_records_${maxRecords}`;
        if (!allowPartial) failures.push(`record_cap_hit:${maxRecords}`);
        break;
      }
    }
    const fingerprint = `${after}->${data.next_after || ""}:${pageIds.slice(0, 3).join(",")}:${pageIds.slice(-3).join(",")}`;
    if (pageFingerprints.has(fingerprint)) {
      cursorLoop = true;
      failures.push(`cursor_loop:${fingerprint}`);
      terminalReason = "cursor_loop";
      break;
    }
    pageFingerprints.add(fingerprint);
    if (maxRecords && rowsWritten >= maxRecords) break;
    if (!data.has_more) {
      terminalReason = "has_more_false";
      break;
    }
    if (!data.next_after) {
      failures.push("has_more_true_missing_next_after");
      terminalReason = "missing_next_after";
      break;
    }
    if (pages === 1 || pages % 10 === 0) {
      console.error(`[full-universe] ${family.id}: page=${pages} rows=${rowsWritten}/${sourceTotal || "?"} after=${data.next_after}`);
    }
    if (String(data.next_after) === after) {
      cursorLoop = true;
      failures.push(`cursor_not_advancing:${after}`);
      terminalReason = "cursor_not_advancing";
      break;
    }
    after = String(data.next_after);
  }
  await new Promise((resolve) => stream.end(resolve));

  const ui = failOnUiTotalMismatch
    ? await visibleTotal(family.uiRoute)
    : {
        route: family.uiRoute,
        ok: true,
        skipped: true,
        total: 0,
        excerpt: "",
        failures: [],
        reason: "SWFIPN_UNIVERSE_FAIL_ON_UI_TOTAL_MISMATCH=0",
      };
  const warnings = [];
  if (!sourceTotal) failures.push("missing_source_total");
  if (firstSourceTotal && latestSourceTotal && firstSourceTotal !== latestSourceTotal) {
    const drift = `source_total_drift:${firstSourceTotal}->${latestSourceTotal}`;
    if (allowSourceTotalDrift || (rowsSeen === latestSourceTotal && rowsWritten === latestSourceTotal)) warnings.push(drift);
    else failures.push(drift);
  }
  const partialRun = Boolean(maxPages || maxRecords);
  if (rowsSeen !== sourceTotal && !partialRun) failures.push(`rows_seen_source_total_mismatch:${rowsSeen}:${sourceTotal}`);
  if (shardCount === 1 && rowsWritten !== sourceTotal && !partialRun) failures.push(`rows_written_source_total_mismatch:${rowsWritten}:${sourceTotal}`);
  if (ui.ok && ui.total !== sourceTotal && failOnUiTotalMismatch && !["live_open_only", "mixed_report_page"].includes(family.uiTotalScope || "")) failures.push(`ui_total_source_total_mismatch:${ui.total}:${sourceTotal}`);
  if (!ui.ok && failOnUiTotalMismatch && !["live_open_only", "mixed_report_page"].includes(family.uiTotalScope || "")) failures.push(`ui_total_unavailable:${ui.failures.join("|")}`);
  if (rowsFailed > 0) failures.push(`record_failures:${rowsFailed}`);
  if (cursorLoop) failures.push("cursor_loop_detected");

  return {
    id: family.id,
    collection: family.collection,
    section: family.section,
    endpoint: scanUrl(family.collection, familyPageLimit, ""),
    output: ndjsonPath,
    status: failures.length ? "fail" : "pass",
    generated_at_first: firstGeneratedAt,
    generated_at_last: lastGeneratedAt,
    source_total_first: firstSourceTotal,
    source_total_latest: latestSourceTotal,
    pages,
    page_limit: pageLimit,
    family_page_limit: familyPageLimit,
    terminal_reason: terminalReason,
    source_total: sourceTotal,
    ui_total: ui,
    ui_total_scope: family.uiTotalScope || "full_collection",
    partial_run: partialRun,
    rows_seen: rowsSeen,
    rows_in_shard: rowsInShard,
    rows_written: rowsWritten,
    rows_passed: rowsPassed,
    rows_failed: rowsFailed,
    rows_warned: rowsWarned,
    shard: { index: shardIndex, count: shardCount },
    samples,
    failure_samples: failureSamples,
    probe_samples: probeSamples,
    warnings,
    unique_counts: {
      keys: familySeen.keys.size,
      source_urls: familySeen.sources.size,
      click_hrefs: familySeen.clicks.size,
    },
    failures,
  };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(path.dirname(latestReceiptPath), { recursive: true });
  const startedAt = new Date().toISOString();
  const receipt = {
    schema_version: "swfipn.full_universe_mapping_gate.v1",
    generated_at: startedAt,
    run_id: runId,
    origin,
    backend_origin: backendOrigin,
    scope: "phase1_public_dashboard_swfi_auth_handoff",
    probe_mode: {
      enabled: probeLimit > 0,
      limit_per_family: probeLimit,
      probe_all: probeAll,
      note: "Default mode validates every record's click URL contract without issuing one SWFI.com HTTP request per record.",
    },
    shard: { index: shardIndex, count: shardCount },
    page_limit: pageLimit,
    collections: requestedCollectionIds,
    canonical_collections: canonicalCollections,
    status: "pass",
    totals: {
      source_total: 0,
      rows_seen: 0,
      rows_written: 0,
      rows_passed: 0,
      rows_failed: 0,
    },
    reports_contract: {
      status: families.some((family) => family.id === "reports") ? "covered_by_source_data_scan" : "blocked",
      reason: families.some((family) => family.id === "reports") ? "Reports are included through /api/source-data/scan/v1?collection=reports." : "No full report/source-record enumeration endpoint is configured in this repo.",
      acceptance_impact: families.some((family) => family.id === "reports") ? "included_in_full_universe_claim" : requireReportsContract ? "blocks_complete_product_universe_claim" : "excluded_by_operator_scope",
    },
    families: [],
    failures: [],
  };
  activeReceipt = receipt;

  const globalSeen = { keys: new Set() };
  for (const family of families) {
    activeFamily = family.id;
    console.error(`[full-universe] ${family.id}: start`);
    const result = await enumerateFamily(family, globalSeen);
    console.error(`[full-universe] ${family.id}: ${result.status} ${result.rows_written}/${result.source_total} rows, pages=${result.pages}`);
    receipt.families.push(result);
    receipt.totals.source_total += result.source_total || 0;
    receipt.totals.rows_seen += result.rows_seen || 0;
    receipt.totals.rows_written += result.rows_written || 0;
    receipt.totals.rows_passed += result.rows_passed || 0;
    receipt.totals.rows_failed += result.rows_failed || 0;
    if (result.failures.length) {
      receipt.status = "fail";
      receipt.failures.push({ family: result.id, failures: result.failures });
    }
  }
  activeFamily = "";
  if (requireReportsContract && !families.some((family) => family.id === "reports")) {
    receipt.status = "fail";
    receipt.failures.push({ family: "reports", failures: ["reports_contract_blocked"] });
  }
  if (missingCanonicalCollections.length && receipt.status === "pass") {
    receipt.status = "partial_pass";
    receipt.partial = {
      ...(receipt.partial || {}),
      missing_canonical_collections: missingCanonicalCollections,
      note: "Collection-filtered runs are not full-universe acceptance receipts.",
    };
  }
  if (allowPartial && (maxPages || maxRecords) && receipt.status === "pass") {
    receipt.status = "partial_pass";
    receipt.partial = {
      max_pages: maxPages || null,
      max_records: maxRecords || null,
      note: "Canary mode only. This is not a full-universe acceptance receipt.",
    };
  }
  receipt.completed_at = new Date().toISOString();
  receipt.elapsed_ms = Date.parse(receipt.completed_at) - Date.parse(receipt.generated_at);
  writeLatestReceipt(receipt);
  console.log(JSON.stringify({
    status: receipt.status,
    run_id: receipt.run_id,
    totals: receipt.totals,
    failures: receipt.failures.slice(0, 20),
    receipt: latestReceiptPath,
    outputs: receipt.families.map((family) => ({ family: family.id, output: family.output })),
  }, null, 2));
  if (receipt.status === "partial_pass" && !allowPartialExit) process.exit(1);
  if (!["pass", "partial_pass"].includes(receipt.status)) process.exit(1);
}

function writeInterruptedReceipt(signal) {
  const generatedAt = new Date().toISOString();
  const receipt = activeReceipt || {
    schema_version: "swfipn.full_universe_mapping_gate.v1",
    generated_at: generatedAt,
    run_id: runId,
    origin,
    backend_origin: backendOrigin,
    scope: "phase1_public_dashboard_swfi_auth_handoff",
    families: [],
    failures: [],
  };
  receipt.status = "blocked";
  receipt.interrupted_at = generatedAt;
  receipt.interrupted_signal = signal;
  receipt.active_family = activeFamily || null;
  receipt.failures = Array.isArray(receipt.failures) ? receipt.failures : [];
  receipt.failures.push({
    family: activeFamily || "run",
    failures: [`interrupted_before_full_universe_receipt:${signal}`],
  });
  writeLatestReceipt(receipt);
  console.error(`[full-universe] interrupted by ${signal}; wrote blocked receipt ${latestReceiptPath}`);
}

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    writeInterruptedReceipt(signal);
    process.exit(signal === "SIGINT" ? 130 : 143);
  });
}

run().catch((error) => {
  writeLatestReceipt({ schema_version: "swfipn.full_universe_mapping_gate.v1", status: "fail", generated_at: new Date().toISOString(), error: error.message });
  console.error(error);
  process.exit(1);
});
