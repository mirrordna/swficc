#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-phase2-backend-acceptance-latest.json");

const appOrigin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(appOrigin).origin).replace(/\/$/, "");
const maxFreshAgeMs = Number(process.env.SWFIPN_PHASE2_MAX_FRESH_AGE_MS || 24 * 60 * 60 * 1000);
const timeoutMs = Number(process.env.SWFIPN_PHASE2_TIMEOUT_MS || 60_000);
const allocatorWindowDays = Number(process.env.SWFIPN_ALLOCATOR_WINDOW_DAYS || 90);
const dayMs = 24 * 60 * 60 * 1000;
const todayMs = currentUtcDateMs();

const contracts = [
  {
    id: "dashboard_metrics",
    label: "Dashboard Metrics",
    endpoint: "/api/swfi/dashboard-metrics/v1",
    source_collections: ["swfi.entities", "swfi.transactions", "swfi.compass"],
    allowed_fields: ["cards", "metrics", "rows", "count"],
    sort_fields: [],
    filter_fields: [],
    pagination_fields: [],
    freshness_receipt: "generated_at plus card-level factual qualifiers",
    minimum_rows: 0,
    validator: validateDashboardMetrics,
  },
  {
    id: "top_active_allocators",
    label: "Top Active Allocators",
    endpoint: `/api/allocator-activity/v1?days=${allocatorWindowDays}&limit=25&page=1&sort=deal_count&direction=desc`,
    source_collections: ["swfi.transactions", "swfi.entities", "swfi.entitiesAUM"],
    allowed_fields: ["name", "entity_type", "type", "country", "region", "deal_count", "total_deal_value", "total_deal_value_display", "latest_transaction_date", "aum", "aum_currency", "source_url", "latest_transaction_source_url", "deal_source_urls"],
    sort_fields: ["deal_count", "total_deal_value", "latest_transaction_date"],
    filter_fields: ["days", "q", "country", "region", "entity_type", "aum_min", "aum_max"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and transaction source URLs for sampled deals",
    minimum_rows: 5,
    validator: validateActiveAllocators,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "newest_transactions",
    label: "Newest Transactions",
    endpoint: "/api/recent-transactions/v1?days=90&limit=25&page=1",
    source_collections: ["swfi.transactions"],
    allowed_fields: ["title", "name", "institution", "buyer_entity", "seller_entity", "sector", "industry", "country", "region", "activity_date", "relevant_date", "announced_at", "closed_at", "completed_at", "capital_display", "amount_display", "currency", "source_url"],
    sort_fields: ["activity_date", "relevant_date", "announced_at", "closed_at", "completed_at"],
    filter_fields: ["days", "q", "country", "region", "industry", "date_from", "date_to"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and SWFI transaction source_url",
    minimum_rows: 5,
    validator: validateTransactions,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "recent_deals",
    label: "Recent Deals",
    endpoint: "/api/recent-transactions/v1?days=30&limit=25&page=1",
    source_collections: ["swfi.transactions"],
    allowed_fields: ["title", "name", "institution", "buyer_entity", "seller_entity", "sector", "industry", "country", "region", "activity_date", "relevant_date", "announced_at", "closed_at", "completed_at", "capital_display", "amount_display", "currency", "source_url"],
    sort_fields: ["activity_date", "relevant_date", "announced_at", "closed_at", "completed_at"],
    filter_fields: ["days", "q", "country", "region", "industry", "date_from", "date_to"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and SWFI transaction source_url",
    minimum_rows: 5,
    validator: validateTransactions,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "rfp_opportunities",
    label: "RFP Opportunities",
    endpoint: "/api/live-opportunities/v1?limit=25&page=1",
    source_collections: ["swfi.compass"],
    allowed_fields: ["title", "name", "type", "institution", "strategy", "asset_class_or_strategy", "investment_type", "country", "region", "deadline", "due_at", "posted_at", "relevant_date", "amount_display", "currency", "source_url"],
    sort_fields: ["deadline", "due_at", "posted_at"],
    filter_fields: ["q", "country", "region", "strategy", "date_from", "date_to"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and SWFI compass source_url",
    minimum_rows: 1,
    validator: validateRfps,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "market_activity",
    label: "Market Activity",
    endpoint: "/api/sector-flows/v1?days=365",
    source_collections: ["swfi.transactions"],
    allowed_fields: ["name", "value", "count", "capital", "capital_deployed", "capital_display"],
    sort_fields: ["count", "capital_deployed"],
    filter_fields: ["days", "region", "country", "industry"],
    pagination_fields: [],
    freshness_receipt: "generated_at and transaction facet basis",
    minimum_rows: 5,
    validator: validateMarketActivity,
  },
  {
    id: "institutions",
    label: "Institution List",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=25&page=1",
    source_collections: ["swfi.entities", "swfi.entitiesAUM"],
    allowed_fields: ["name", "slug", "type", "country", "region", "assets", "aum", "aum_currency", "aum_date", "source_url"],
    sort_fields: ["name", "aum", "country", "region", "type"],
    filter_fields: ["q", "country", "region", "entity_type", "aum_min", "aum_max"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and SWFI entity source_url",
    minimum_rows: 5,
    validator: validateEntities,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "people",
    label: "People",
    endpoint: "/api/source-data/search/v1?collection=people&limit=25&page=1",
    source_collections: ["swfi.people"],
    allowed_fields: ["name", "title", "institution", "country", "region", "source_url"],
    sort_fields: ["name", "institution", "country", "region"],
    filter_fields: ["q", "country", "region", "institution"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and SWFI people source_url",
    minimum_rows: 5,
    validator: validatePeople,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "intelligence",
    label: "News / Intelligence",
    endpoint: "/api/source-intelligence/news/v1?limit=25&page=1",
    source_collections: ["swfi.news", "swfi.cms_articles"],
    allowed_fields: ["legacy_post", "title", "name", "source", "published_at", "updated_at", "excerpt", "content"],
    sort_fields: ["published_at", "updated_at", "legacy_post"],
    filter_fields: ["q", "date_from", "date_to"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and legacy CMS/source identifier",
    minimum_rows: 5,
    validator: validateNews,
    pagination: true,
    search: "row-derived",
  },
  {
    id: "reports",
    label: "Reports",
    endpoint: "/api/reports/v1?limit=25&page=1",
    source_collections: ["swfi.reports"],
    allowed_fields: ["report_key", "title", "name", "type", "published_at", "updated_at", "thumbnail_url", "report_url"],
    sort_fields: ["published_at", "updated_at", "title", "type"],
    filter_fields: ["q", "type", "date_from", "date_to"],
    pagination_fields: ["limit", "page"],
    freshness_receipt: "generated_at and report asset source URL",
    minimum_rows: 5,
    validator: validateReports,
    pagination: true,
    search: "row-derived",
  },
];

const detailContracts = [
  { id: "entity_detail", list: "institutions", detailTemplate: "/api/profiles/{id}/v1", sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/entities\/[a-f0-9]{24}$/i, dataKey: "profile" },
  { id: "person_detail", list: "people", detailTemplate: "/api/people/{id}/v1", sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/people\/[a-f0-9]{24}$/i, dataKey: "record" },
  { id: "transaction_detail", list: "newest_transactions", detailTemplate: "/api/transactions/{id}/v1", sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i, dataKey: "record" },
  { id: "rfp_detail", list: "rfp_opportunities", detailTemplate: "/api/compass/{id}/v1", sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/compass\/[a-f0-9]{24}$/i, dataKey: "record" },
  { id: "intelligence_detail", list: "intelligence", legacy: true, detailTemplate: "/api/source-intelligence/news/detail/v1?legacy_id={id}", sourcePattern: /^\d+$/i, dataKey: "record" },
  { id: "report_detail", list: "reports", reportKey: true, detailTemplate: "/api/reports/{id}/v1", sourcePattern: /^[a-zA-Z0-9_-]{3,120}$/i, dataKey: "record" },
];

const publicRoutes = [
  "/",
  "/profiles/",
  "/people/",
  "/transactions/",
  "/deals/",
  "/allocators/",
  "/mandates/",
  "/research/",
  "/intelligence/",
  "/reports/",
];

const forbiddenUiPatterns = [
  /Active Mirror/i,
  /source_gap/i,
  /source gap/i,
  /object\s*id/i,
  /\bMongo\b/i,
  /\bbackend\b/i,
  /api\/[a-z0-9_-]+/i,
  /result_qualifier/i,
  /source_record_id/i,
  /schema_version/i,
  /undefined|null/i,
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function backendUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return new URL(endpoint, backendOrigin).href;
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), appOrigin).href;
}

function currentUtcDateMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseDateMs(value) {
  const text = cleanText(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function sourceRecordId(sourceUrl) {
  const text = cleanText(sourceUrl);
  if (/^\d+$/.test(text)) return text;
  try {
    const parsed = new URL(text);
    return parsed.pathname.split("/").filter(Boolean).pop() || "";
  } catch {
    return "";
  }
}

function rows(packet) {
  const data = packet?.data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (Array.isArray(data?.results)) return data.results;
  if (Array.isArray(data?.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

function count(packet) {
  const data = packet?.data || {};
  return Number(data.count ?? data.total ?? data.source_total ?? rows(packet).length ?? 0);
}

function record(packet, key) {
  const data = packet?.data || {};
  if (key === "rows") return rows(packet)[0];
  return data[key] || data.record || data.profile || rows(packet)[0];
}

function isFact(packet) {
  return packet?.status === "ok" && (packet.fact === true || (packet.state === "vault" && packet.result_qualifier === "fact" && !cleanText(packet.source_gap_reason)));
}

async function fetchJson(endpoint) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = backendUrl(endpoint);
    const response = await fetch(url, {
      headers: { Accept: "application/json", "X-SWFIPN-Public": "1" },
      signal: controller.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 1000) };
    }
    return { url, status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function generatedFreshness(packet) {
  const generatedAt = cleanText(packet?.generated_at);
  const parsed = Date.parse(generatedAt);
  if (!generatedAt || !Number.isFinite(parsed)) return { ok: false, failure: "generated_at_missing_or_invalid", generated_at: generatedAt };
  const ageMs = Date.now() - parsed;
  if (ageMs > maxFreshAgeMs) return { ok: false, failure: `generated_at_stale:${generatedAt}`, generated_at: generatedAt, age_ms: ageMs };
  return { ok: true, generated_at: generatedAt, age_ms: ageMs };
}

function standardPacketFailures(packet, minimumRows) {
  const failures = [];
  if (!isFact(packet)) failures.push(`packet_not_fact:${cleanText(packet?.status || packet?.result_qualifier || packet?.source_gap_reason || "missing")}`);
  if (cleanText(packet?.source_gap_reason)) failures.push(`source_gap_reason_present:${cleanText(packet.source_gap_reason).slice(0, 120)}`);
  const freshness = generatedFreshness(packet);
  if (!freshness.ok) failures.push(freshness.failure);
  if (minimumRows > 0 && rows(packet).length < minimumRows) failures.push(`rows_${rows(packet).length}_lt_${minimumRows}`);
  return failures;
}

function requireSourceUrl(row, pattern, label, failures) {
  const source = cleanText(row?.source_url || row?.swfi_url);
  if (!pattern.test(source)) failures.push(`${label}_missing_or_bad_source_url:${source || "missing"}`);
}

function dateFromRow(row, fields) {
  for (const field of fields) {
    const value = cleanText(row?.[field]);
    const ms = parseDateMs(value);
    if (Number.isFinite(ms)) return { field, value, ms };
  }
  return { field: "", value: "", ms: NaN };
}

function compareDateDescending(rowsToCheck, fields, failures, label) {
  for (let index = 0; index < rowsToCheck.length - 1; index += 1) {
    const current = dateFromRow(rowsToCheck[index], fields);
    const next = dateFromRow(rowsToCheck[index + 1], fields);
    if (Number.isFinite(current.ms) && Number.isFinite(next.ms) && current.ms < next.ms) {
      failures.push(`${label}_date_sort_violation:${cleanText(rowsToCheck[index].title || rowsToCheck[index].name)}->${cleanText(rowsToCheck[index + 1].title || rowsToCheck[index + 1].name)}`);
    }
  }
}

function validateDashboardMetrics(packet) {
  const failures = [];
  const cards = packet?.data?.cards || {};
  for (const key of ["institutions", "allocators", "rfps", "transactions"]) {
    const card = cards[key];
    if (!card) {
      failures.push(`card_missing:${key}`);
      continue;
    }
    if (numberValue(card.value) < 1) failures.push(`card_value_not_positive:${key}`);
    if (cleanText(card.qualifier) && cleanText(card.qualifier) !== "fact") failures.push(`card_not_fact:${key}:${cleanText(card.qualifier)}`);
  }
  return failures;
}

function allocatorInRankOrder(current, next) {
  const currentDeals = numberValue(current.deal_count ?? current.activity_count);
  const nextDeals = numberValue(next.deal_count ?? next.activity_count);
  if (currentDeals !== nextDeals) return currentDeals >= nextDeals;
  const currentValue = numberValue(current.total_deal_value);
  const nextValue = numberValue(next.total_deal_value);
  if (currentValue !== nextValue) return currentValue >= nextValue;
  return parseDateMs(current.latest_transaction_date || current.last_transaction_date || current.most_recent_activity_date) >= parseDateMs(next.latest_transaction_date || next.last_transaction_date || next.most_recent_activity_date);
}

function validateActiveAllocators(packet) {
  const failures = [];
  const sourceRows = rows(packet);
  const cutoff = todayMs - allocatorWindowDays * dayMs;
  sourceRows.forEach((row, index) => {
    const name = cleanText(row.name);
    if (!name) failures.push(`allocator_${index}_missing_name`);
    if (!cleanText(row.entity_type || row.type)) failures.push(`allocator_${name || index}_missing_entity_type`);
    if (!cleanText(row.country)) failures.push(`allocator_${name || index}_missing_country`);
    if (!cleanText(row.region)) failures.push(`allocator_${name || index}_missing_region`);
    if (numberValue(row.deal_count ?? row.activity_count) < 1) failures.push(`allocator_${name || index}_deal_count_lt_1`);
    if (row.total_deal_value === undefined) failures.push(`allocator_${name || index}_missing_total_deal_value`);
    const latest = parseDateMs(row.latest_transaction_date || row.last_transaction_date || row.most_recent_activity_date);
    if (!Number.isFinite(latest)) failures.push(`allocator_${name || index}_missing_latest_transaction_date`);
    if (Number.isFinite(latest) && latest < cutoff) failures.push(`allocator_${name}_latest_before_window`);
    if (Number.isFinite(latest) && latest > todayMs + dayMs) failures.push(`allocator_${name}_latest_future`);
    requireSourceUrl(row, /^https:\/\/www\.swfi\.com\/v1\/entities\/[a-f0-9]{24}$/i, `allocator_${name || index}`, failures);
    const dealSources = Array.isArray(row.deal_source_urls) ? row.deal_source_urls.map(cleanText).filter(Boolean) : [];
    if (!dealSources.length) failures.push(`allocator_${name || index}_missing_deal_source_urls`);
    if (!/^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i.test(cleanText(row.latest_transaction_source_url))) {
      failures.push(`allocator_${name || index}_missing_latest_transaction_source_url`);
    }
    dealSources.slice(0, 5).forEach((dealUrl) => {
      if (!/^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i.test(dealUrl)) failures.push(`allocator_${name || index}_bad_deal_source_url:${dealUrl}`);
    });
    if (index < sourceRows.length - 1 && !allocatorInRankOrder(row, sourceRows[index + 1])) {
      failures.push(`allocator_sort_violation:${name}->${cleanText(sourceRows[index + 1].name)}`);
    }
  });
  return failures;
}

function validateTransactions(packet) {
  const failures = [];
  const sourceRows = rows(packet);
  const dateFields = ["activity_date", "relevant_date", "announced_at", "closed_at", "completed_at"];
  sourceRows.forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    if (!cleanText(row.title || row.name)) failures.push(`transaction_${index}_missing_title`);
    if (!cleanText(row.buyer_entity || row.institution)) failures.push(`transaction_${label}_missing_buyer_or_institution`);
    requireSourceUrl(row, /^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i, `transaction_${label}`, failures);
    if (!Number.isFinite(dateFromRow(row, dateFields).ms)) failures.push(`transaction_${label}_missing_activity_date`);
  });
  compareDateDescending(sourceRows, dateFields, failures, "transaction");
  return failures;
}

function validateRfps(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    if (!cleanText(row.title || row.name)) failures.push(`rfp_${index}_missing_title`);
    if (!cleanText(row.institution)) failures.push(`rfp_${label}_missing_institution`);
    requireSourceUrl(row, /^https:\/\/www\.swfi\.com\/v1\/compass\/[a-f0-9]{24}$/i, `rfp_${label}`, failures);
    const due = dateFromRow(row, ["due_at", "deadline", "relevant_date"]);
    if (!Number.isFinite(due.ms)) failures.push(`rfp_${label}_missing_due_date`);
    if (Number.isFinite(due.ms) && due.ms < todayMs) failures.push(`rfp_${label}_expired:${due.value}`);
  });
  return failures;
}

function validateMarketActivity(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.name || row.value || index);
    if (!cleanText(row.name || row.value)) failures.push(`market_${index}_missing_label`);
    if (numberValue(row.count) < 1) failures.push(`market_${label}_count_lt_1`);
  });
  for (let index = 0; index < rows(packet).length - 1; index += 1) {
    if (numberValue(rows(packet)[index].count) < numberValue(rows(packet)[index + 1].count)) {
      failures.push(`market_count_sort_violation:${cleanText(rows(packet)[index].name)}->${cleanText(rows(packet)[index + 1].name)}`);
    }
  }
  return failures;
}

function validateEntities(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.name || index);
    if (!cleanText(row.name)) failures.push(`entity_${index}_missing_name`);
    if (!cleanText(row.type)) failures.push(`entity_${label}_missing_type`);
    if (!cleanText(row.country)) failures.push(`entity_${label}_missing_country`);
    requireSourceUrl(row, /^https:\/\/www\.swfi\.com\/v1\/entities\/[a-f0-9]{24}$/i, `entity_${label}`, failures);
  });
  return failures;
}

function validatePeople(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.name || index);
    if (!cleanText(row.name)) failures.push(`person_${index}_missing_name`);
    if (!cleanText(row.title)) failures.push(`person_${label}_missing_title`);
    if (!cleanText(row.institution)) failures.push(`person_${label}_missing_institution`);
    requireSourceUrl(row, /^https:\/\/www\.swfi\.com\/v1\/people\/[a-f0-9]{24}$/i, `person_${label}`, failures);
  });
  return failures;
}

function validateNews(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    if (!cleanText(row.title || row.name)) failures.push(`news_${index}_missing_title`);
    if (!cleanText(row.legacy_post)) failures.push(`news_${label}_missing_legacy_post`);
    if (!cleanText(row.excerpt || row.content)) failures.push(`news_${label}_missing_excerpt_or_content`);
  });
  return failures;
}

function validateReports(packet) {
  const failures = [];
  rows(packet).forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    if (!cleanText(row.title || row.name)) failures.push(`report_${index}_missing_title`);
    if (!/^[a-zA-Z0-9_-]{3,120}$/i.test(cleanText(row.report_key || row.report_id || row.id))) failures.push(`report_${label}_missing_report_key`);
    if (!cleanText(row.type)) failures.push(`report_${label}_missing_type`);
    if (!cleanText(row.published_at || row.updated_at)) failures.push(`report_${label}_missing_published_or_updated_date`);
    if (!/^https:\/\/assets\.swfi\.com\/reports\/[^?#]+\.pdf(?:[?#].*)?$/i.test(cleanText(row.report_url || row.source_url))) {
      failures.push(`report_${label}_missing_or_bad_report_asset_url`);
    }
  });
  compareDateDescending(rows(packet), ["published_at", "updated_at"], failures, "report");
  return failures;
}

async function inspectContract(contract) {
  const result = {
    id: contract.id,
    label: contract.label,
    endpoint: contract.endpoint,
    url: backendUrl(contract.endpoint),
    source_collections: contract.source_collections,
    allowed_fields: contract.allowed_fields,
    sort_fields: contract.sort_fields,
    filter_fields: contract.filter_fields,
    pagination_fields: contract.pagination_fields,
    freshness_receipt: contract.freshness_receipt,
    ok: false,
    failures: [],
    warnings: [],
    http_status: 0,
    row_count: 0,
    total_count: 0,
    generated_at: "",
    sample_keys: [],
  };
  const fetched = await fetchJson(contract.endpoint);
  result.http_status = fetched.status;
  result.packet = fetched.body;
  result.generated_at = cleanText(fetched.body?.generated_at);
  result.row_count = rows(fetched.body).length;
  result.total_count = count(fetched.body);
  result.sample_keys = Object.keys(rows(fetched.body)[0] || {}).sort();
  if (fetched.status !== 200) result.failures.push(`http_${fetched.status}`);
  result.failures.push(...standardPacketFailures(fetched.body, contract.minimum_rows));
  result.failures.push(...contract.validator(fetched.body));
  result.ok = result.failures.length === 0;
  delete result.packet;
  return { result, packet: fetched.body };
}

function withPage(endpoint, page) {
  const url = new URL(backendUrl(endpoint));
  url.searchParams.set("page", String(page));
  return `${url.pathname}${url.search}`;
}

function withSearch(endpoint, q) {
  const url = new URL(backendUrl(endpoint));
  url.searchParams.set("q", q);
  url.searchParams.set("page", "1");
  return `${url.pathname}${url.search}`;
}

async function inspectPaginationAndSearch(contract, firstPacket) {
  const result = {
    id: `${contract.id}_controls`,
    ok: true,
    failures: [],
    pagination_checked: false,
    search_checked: false,
  };
  if (contract.pagination && count(firstPacket) > 25) {
    result.pagination_checked = true;
    const second = await fetchJson(withPage(contract.endpoint, 2));
    const firstKey = cleanText(rows(firstPacket)[0]?.source_url || rows(firstPacket)[0]?.name || rows(firstPacket)[0]?.title);
    const secondKey = cleanText(rows(second.body)[0]?.source_url || rows(second.body)[0]?.name || rows(second.body)[0]?.title);
    if (second.status !== 200 || !isFact(second.body)) result.failures.push(`page2_not_fact_or_http_${second.status}`);
    if (!rows(second.body).length) result.failures.push("page2_empty");
    if (firstKey && secondKey && firstKey === secondKey) result.failures.push("page2_same_first_record_as_page1");
  }
  if (contract.search) {
    result.search_checked = true;
    const row = rows(firstPacket)[0] || {};
    const derivedQuery = contract.search === "row-derived"
      ? cleanText(row.name || row.title || row.institution).split(/\s+/).filter(Boolean)[0]
      : contract.search;
    if (!derivedQuery) {
      result.failures.push("search_query_not_derivable_from_first_row");
      result.ok = false;
      return result;
    }
    result.search_query = derivedQuery;
    const search = await fetchJson(withSearch(contract.endpoint, derivedQuery));
    if (search.status !== 200 || !isFact(search.body)) result.failures.push(`search_not_fact_or_http_${search.status}`);
    if (!rows(search.body).length) result.failures.push(`search_empty:${derivedQuery}`);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function inspectDetailResolution(detailContract, packetsByContract) {
  const listPacket = packetsByContract.get(detailContract.list);
  const sourceRow = rows(listPacket)[0] || {};
  const source = detailContract.legacy
    ? cleanText(sourceRow.legacy_post)
    : detailContract.reportKey
      ? cleanText(sourceRow.report_key || sourceRow.report_id || sourceRow.id)
      : cleanText(sourceRow.source_url || sourceRow.swfi_url);
  const sourceId = detailContract.legacy ? source : sourceRecordId(source);
  const resolvedSourceId = detailContract.reportKey ? source : sourceId;
  const endpoint = detailContract.detailTemplate.replace("{id}", encodeURIComponent(resolvedSourceId));
  const result = {
    id: detailContract.id,
    list_contract: detailContract.list,
    endpoint,
    url: backendUrl(endpoint),
    source_id: resolvedSourceId,
    ok: false,
    failures: [],
    http_status: 0,
    source_label: cleanText(sourceRow.name || sourceRow.title),
    detail_label: "",
  };
  if (!resolvedSourceId || !detailContract.sourcePattern.test(detailContract.legacy || detailContract.reportKey ? resolvedSourceId : source)) {
    result.failures.push(`bad_source_reference:${source || resolvedSourceId || "missing"}`);
    result.ok = false;
    return result;
  }
  const fetched = await fetchJson(endpoint);
  result.http_status = fetched.status;
  const detailRecord = record(fetched.body, detailContract.dataKey);
  result.detail_label = cleanText(detailRecord?.name || detailRecord?.title);
  if (fetched.status !== 200) result.failures.push(`http_${fetched.status}`);
  if (!isFact(fetched.body)) result.failures.push(`detail_not_fact:${cleanText(fetched.body?.status || fetched.body?.source_gap_reason || "missing")}`);
  if (!detailRecord) result.failures.push("detail_record_missing");
  if (result.source_label && result.detail_label && result.source_label !== result.detail_label) {
    const left = result.source_label.toLowerCase();
    const right = result.detail_label.toLowerCase();
    if (!left.includes(right) && !right.includes(left)) result.failures.push(`detail_label_mismatch:${result.source_label}->${result.detail_label}`);
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function inspectAllocatorSampleTransactions(allocatorPacket) {
  const result = {
    id: "active_allocator_sample_transactions",
    ok: true,
    failures: [],
    sampled: [],
    cutoff: new Date(todayMs - allocatorWindowDays * dayMs).toISOString().slice(0, 10),
  };
  const cutoff = todayMs - allocatorWindowDays * dayMs;
  for (const allocator of rows(allocatorPacket).slice(0, 3)) {
    const allocatorName = cleanText(allocator.name);
    const allocatorId = sourceRecordId(allocator.source_url || allocator.swfi_url);
    const dealIds = (Array.isArray(allocator.deal_source_urls) ? allocator.deal_source_urls : []).map(sourceRecordId).filter(Boolean).slice(0, 2);
    for (const dealId of dealIds) {
      const endpoint = `/api/transactions/${encodeURIComponent(dealId)}/v1`;
      const fetched = await fetchJson(endpoint);
      const item = { allocator: allocatorName, allocator_id: allocatorId, deal_id: dealId, endpoint, ok: true, failures: [] };
      const detail = record(fetched.body, "record") || {};
      const buyers = Array.isArray(detail.buyer_entities) ? detail.buyer_entities : [];
      const buyerIds = buyers.map((buyer) => sourceRecordId(buyer.source_url || buyer.swfi_url)).filter(Boolean);
      const buyerNames = buyers.map((buyer) => cleanText(buyer.name).toLowerCase()).filter(Boolean);
      const completed = dateFromRow(detail, ["closed_at", "completed_at", "completedAt", "activity_date", "relevant_date"]);
      if (fetched.status !== 200 || !isFact(fetched.body)) item.failures.push(`transaction_not_fact_or_http_${fetched.status}`);
      if (allocatorId ? !buyerIds.includes(allocatorId) : !buyerNames.includes(allocatorName.toLowerCase())) item.failures.push("allocator_not_buyer_or_acquirer");
      if (!Number.isFinite(completed.ms)) item.failures.push("transaction_missing_completed_or_activity_date");
      if (Number.isFinite(completed.ms) && (completed.ms < cutoff || completed.ms > todayMs + dayMs)) item.failures.push(`transaction_date_outside_window:${completed.value}`);
      item.ok = item.failures.length === 0;
      result.sampled.push(item);
      result.failures.push(...item.failures.map((failure) => `${allocatorName}:${dealId}:${failure}`));
    }
  }
  result.ok = result.failures.length === 0;
  return result;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final", "/Users/mirror-pro/repos/SWFI-Capital-Intelligence-OS/frontend"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function inspectPublicUi() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const desktop = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
  const results = [];
  try {
    for (const route of publicRoutes) {
      results.push(await inspectUiRoute(desktop, route, "desktop"));
    }
    for (const route of ["/", "/profiles/", "/transactions/", "/mandates/", "/people/"]) {
      results.push(await inspectUiRoute(mobile, route, "mobile"));
    }
  } finally {
    await desktop.close().catch(() => {});
    await mobile.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  return {
    id: "public_ui",
    ok: results.every((item) => item.ok),
    failures: results.flatMap((item) => item.ok ? [] : item.failures.map((failure) => `${item.viewport}:${item.route}:${failure}`)),
    routes: results,
  };
}

async function inspectUiRoute(context, route, viewport) {
  const page = await context.newPage();
  const result = { route, viewport, url: appUrl(route), ok: false, failures: [], link_count: 0, showing_text: "" };
  try {
      const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    result.http_status = response?.status() || 0;
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    if (route === "/") {
      await page.waitForFunction(() => document.body && document.body.innerText.length > 200, null, { timeout: timeoutMs });
    } else {
      await page.waitForFunction(() => /Showing\s+\d+\s+of\s+[\d,]+/i.test(document.body?.innerText || ""), null, { timeout: timeoutMs });
    }
    const snapshot = await page.evaluate(() => {
      const bodyText = document.body.innerText || "";
      const rowLinks = [...document.querySelectorAll('a[href]')]
        .map((anchor) => ({ text: (anchor.textContent || "").trim().replace(/\s+/g, " "), href: anchor.href }))
        .filter((link) => link.text && !String(link.href).includes("#"))
        .slice(0, 80);
      const showing = (bodyText.match(/Showing\s+[^\n]+/i) || [""])[0];
      return { bodyText, rowLinks, showing };
    });
    result.showing_text = snapshot.showing;
    result.link_count = snapshot.rowLinks.length;
    for (const pattern of forbiddenUiPatterns) {
      if (pattern.test(snapshot.bodyText)) result.failures.push(`forbidden_text:${pattern.source}`);
    }
    if (route !== "/" && !/Showing\s+\d+\s+of\s+[\d,]+/i.test(snapshot.bodyText)) result.failures.push("missing_showing_count");
    if (route !== "/" && snapshot.rowLinks.length < 3) result.failures.push(`too_few_links:${snapshot.rowLinks.length}`);
    const badHref = snapshot.rowLinks.find((link) => /undefined|null|source_gap|api\//i.test(link.href));
    if (badHref) result.failures.push(`bad_href:${badHref.href}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    result.ok = result.failures.length === 0;
    await page.close().catch(() => {});
  }
  return result;
}

function kpComparison() {
  return {
    status: "documented_difference",
    files_reviewed: [
      "/Users/mirror-pro/Downloads/ActiveAllocators.java",
      "/Users/mirror-pro/Downloads/swfimongotools/hi/ActiveAllocators.java",
      "/Users/mirror-pro/Downloads/swfimongotools/hi/TopActiveInvestors.java",
    ],
    finding: "The older ActiveAllocators.java ranks entities by recent AUM/managed-assets update timestamps. That is not the approved Phase 2 formula. TopActiveInvestors.java is closer because it counts transaction/Compass activity by institution, but Phase 2 is stricter: completed transactions only, buyer/acquirer side only, sorted by deal_count, total_deal_value, latest_transaction_date.",
    approved_phase2_formula: {
      source: "swfi.transactions joined to swfi.entities",
      participant_side: "buyer/acquirer only",
      time_window_days: allocatorWindowDays,
      invalid_records: "excluded by backend source contract",
      sort: ["deal_count desc", "total_deal_value desc", "latest_transaction_date desc"],
    },
  };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const started = new Date().toISOString();
  const modules = [];
  const controls = [];
  const packets = new Map();

  for (const contract of contracts) {
    const { result, packet } = await inspectContract(contract);
    modules.push(result);
    packets.set(contract.id, packet);
    controls.push(await inspectPaginationAndSearch(contract, packet));
  }

  const detail_resolution = [];
  for (const detailContract of detailContracts) {
    detail_resolution.push(await inspectDetailResolution(detailContract, packets));
  }

  const allocator_samples = await inspectAllocatorSampleTransactions(packets.get("top_active_allocators"));
  const public_ui = await inspectPublicUi();

  const matrix = [
    { id: "backend_contracts", ok: modules.every((item) => item.ok), failures: modules.flatMap((item) => item.ok ? [] : item.failures.map((failure) => `${item.id}:${failure}`)) },
    { id: "list_controls", ok: controls.every((item) => item.ok), failures: controls.flatMap((item) => item.ok ? [] : item.failures.map((failure) => `${item.id}:${failure}`)) },
    { id: "detail_resolution", ok: detail_resolution.every((item) => item.ok), failures: detail_resolution.flatMap((item) => item.ok ? [] : item.failures.map((failure) => `${item.id}:${failure}`)) },
    { id: "active_allocator_formula", ok: allocator_samples.ok && modules.find((item) => item.id === "top_active_allocators")?.ok, failures: allocator_samples.failures },
    { id: "public_ui_no_internal_leakage", ok: public_ui.ok, failures: public_ui.failures },
  ];

  const failures = matrix.flatMap((item) => item.ok ? [] : item.failures.map((failure) => ({ check: item.id, failure })));
  const receipt = {
    schema_version: "swfipn.phase2_backend_acceptance.v1",
    generated_at: new Date().toISOString(),
    started_at: started,
    app_origin: appOrigin,
    backend_origin: backendOrigin,
    status: failures.length ? "fail" : "pass",
    stage: failures.length ? "phase2_backend_contract_candidate_with_blockers" : "phase2_backend_contract_ready_for_swfi_validation",
    canonical_sources: {
      entities_institutions: "swfi.entities + swfi.entitiesAUM",
      people: "swfi.people",
      transactions_deals: "swfi.transactions",
      compass_rfps: "swfi.compass",
      news_intelligence: "swfi.news + swfi.cms_articles",
      reports: "swfi.reports via /api/reports/v1 and /api/reports/{report_key}/v1",
    },
    blocked_items: [],
    non_negotiables: {
      fake_data: "blocked",
      inferred_fallback_values: "blocked",
      frontend_mongodb_access: "blocked",
      server_side_data_only: "required",
      whitelisted_public_fields_only: "required",
      public_internal_diagnostics: "blocked",
      audit_receipts: "required internally",
      stale_data: "fail_closed",
    },
    contracts: modules,
    controls,
    detail_resolution,
    allocator_samples,
    public_ui,
    kp_comparison: kpComparison(),
    acceptance_matrix: matrix.map((item) => ({ id: item.id, status: item.ok ? "PASS" : "FAIL", failures: item.failures })),
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, stage: receipt.stage, failures: failures.slice(0, 20), receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.phase2_backend_acceptance.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    fatal: error.stack || error.message,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
