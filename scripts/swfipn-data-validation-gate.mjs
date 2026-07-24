#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const ledgerPath = path.join(repoRoot, "docs", "swfipn-data-validation-ledger.json");
const receiptPath = path.join(outputDir, "swfipn-data-validation-gate-latest.json");
const reportPath = path.join(outputDir, "swfipn-data-validation-gate-latest.md");

const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(origin).origin).replace(/\/$/, "");
const liveFreshnessMaxMs = Number(process.env.SWFIPN_DATA_VALIDATION_LIVE_MAX_AGE_MS || 24 * 60 * 60 * 1000);
const defaultTimeoutMs = Number(process.env.SWFIPN_DATA_VALIDATION_TIMEOUT_MS || 45_000);
const todayMs = currentUtcDateMs();
const todayIso = new Date(todayMs).toISOString().slice(0, 10);
const dayMs = 24 * 60 * 60 * 1000;

const requiredModuleFields = [
  "id",
  "label",
  "frontend_routes",
  "endpoint",
  "data_source",
  "source_collections",
  "query_rule",
  "calculation_rule",
  "freshness",
  "duplicate_rule",
  "empty_state",
  "approved_business_logic",
];

const restrictedApiFieldNames = new Set([
  "_id",
  "id",
  "schema_version",
  "doctrine_id",
  "source_gap_reason",
  "source_filter",
  "source_contract",
  "provenance",
  "truth_state",
  "result_qualifier",
  "source_collection",
  "source_record_id",
  "entity_id",
  "institution_id",
  "buyer_entity_id",
  "seller_entity_id",
  "deal_ids",
  "aum_source_record_id",
]);

const restrictedValuePattern = /\b(?:Active Mirror|Mongo|SourceVault|ObjectId|backend identifier|stack trace)\b/i;

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function endpointUrl(endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return new URL(endpoint, backendOrigin).href;
}

function currentUtcDateMs() {
  const now = new Date();
  return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
}

function parseDateMs(value) {
  const text = String(value ?? "").trim();
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (!match) return NaN;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function numberValue(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function cleanText(value) {
  return String(value ?? "").trim();
}

function readLedger() {
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
  return {
    ...ledger,
    modules: Array.isArray(ledger.modules) ? ledger.modules : [],
    blocked_acceptance_items: Array.isArray(ledger.blocked_acceptance_items) ? ledger.blocked_acceptance_items : [],
  };
}

async function fetchJson(endpoint, { internal = false } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), defaultTimeoutMs);
  try {
    const url = endpointUrl(endpoint);
    const headers = internal
      ? { Accept: "application/json", "X-SWFIPN-Internal": "1" }
      : { Accept: "application/json", "X-SWFIPN-Public": "1" };
    const response = await fetch(url, { headers, signal: controller.signal });
    const text = await response.text();
    let body;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = { raw: text.slice(0, 1000) };
    }
    return { url, http_status: response.status, body };
  } finally {
    clearTimeout(timer);
  }
}

function packetData(packet) {
  return packet?.data && typeof packet.data === "object" ? packet.data : {};
}

function packetRows(packet) {
  const data = packetData(packet);
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  if (Array.isArray(data)) return data;
  return [];
}

function packetCount(packet) {
  const data = packetData(packet);
  return Number(data.count ?? data.total ?? data.source_total ?? packetRows(packet).length ?? 0);
}

function firstAvailableDate(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (cleanText(value)) return { field, value: cleanText(value), ms: parseDateMs(value) };
  }
  return { field: "", value: "", ms: NaN };
}

function rowKey(row) {
  return cleanText(row?.source_record_id || row?.entity_id || row?.id || row?.source_url || row?.name || row?.title);
}

function duplicateFailures(rows, module) {
  if (/intentional/i.test(module.duplicate_rule || "")) return [];
  const seen = new Set();
  const duplicates = [];
  for (const row of rows) {
    const key = rowKey(row);
    if (!key) continue;
    if (seen.has(key)) duplicates.push(key);
    seen.add(key);
  }
  return duplicates.length ? [`duplicate_rows:${duplicates.slice(0, 8).join("|")}`] : [];
}

function hasSwfiSource(row) {
  return /^https:\/\/www\.swfi\.com\/v1\//i.test(cleanText(row?.source_url || row?.swfi_url));
}

function hasSwfiArticleSource(row) {
  const source = cleanText(row?.source_url || row?.swfi_url || row?.url);
  if (/^https:\/\/(?:www|cms)\.swfi\.com\/\?p=\d+/i.test(source)) return true;
  if (/^https:\/\/www\.swfi\.com\/v1\/news\/[a-f0-9]{24}/i.test(source)) return true;
  if (/^\d+$/.test(cleanText(row?.legacy_post || row?.legacy_post_id || row?.post_id || row?.wordpress_id))) return true;
  return false;
}

function ledgerFailures(module) {
  const failures = [];
  for (const field of requiredModuleFields) {
    const value = module[field];
    const emptyArray = Array.isArray(value) && value.length === 0;
    if (value === undefined || value === null || cleanText(value) === "" || emptyArray) failures.push(`ledger_missing:${field}`);
  }
  if (module.freshness === "live" && !String(module.endpoint || "").startsWith("/")) failures.push("live_endpoint_not_same_origin");
  return failures;
}

function envelopeFailures(packet) {
  const failures = [];
  if (packet?.status !== "ok") failures.push(`packet_status_${packet?.status || "missing"}`);
  const factPacket = packet?.fact === true
    || (packet?.state === "vault" && packet?.result_qualifier === "fact" && !cleanText(packet?.source_gap_reason));
  if (!factPacket) failures.push(`packet_not_fact:${packet?.fact === true ? "fact_true" : cleanText(packet?.result_qualifier || packet?.state || "missing")}`);
  if (cleanText(packet?.source_gap_reason)) failures.push(`source_gap_reason_present:${cleanText(packet.source_gap_reason).slice(0, 80)}`);
  const generatedAt = Date.parse(packet?.generated_at || "");
  if (!Number.isFinite(generatedAt)) {
    failures.push("generated_at_missing_or_invalid");
  } else if (Date.now() - generatedAt > liveFreshnessMaxMs) {
    failures.push(`generated_at_stale:${packet.generated_at}`);
  }
  return failures;
}

function apiExposureFindings(value, prefix = "", depth = 0, findings = []) {
  if (findings.length >= 80 || depth > 7 || value === null || value === undefined) return findings;
  if (Array.isArray(value)) {
    value.slice(0, 20).forEach((item, index) => apiExposureFindings(item, `${prefix}[${index}]`, depth + 1, findings));
    return findings;
  }
  if (typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      if (restrictedApiFieldNames.has(key) || /(?:^|_)ids?$/.test(key)) {
        findings.push({ path: childPath, reason: "restricted_field_name" });
      }
      apiExposureFindings(child, childPath, depth + 1, findings);
      if (findings.length >= 80) break;
    }
    return findings;
  }
  if (typeof value === "string" && restrictedValuePattern.test(value)) {
    findings.push({ path: prefix, reason: "restricted_value" });
  }
  return findings;
}

function allocatorInRankOrder(current, next) {
  const currentDeals = numberValue(current.deal_count);
  const nextDeals = numberValue(next.deal_count);
  if (currentDeals !== nextDeals) return currentDeals >= nextDeals;
  const currentValue = numberValue(current.total_deal_value);
  const nextValue = numberValue(next.total_deal_value);
  if (currentValue !== nextValue) return currentValue >= nextValue;
  return parseDateMs(current.latest_transaction_date) >= parseDateMs(next.latest_transaction_date);
}

function validateDashboardMetrics(result, packet) {
  const cards = packetData(packet).cards || {};
  if (!cards || typeof cards !== "object" || Array.isArray(cards)) result.failures.push("cards_missing");
  const institutions = cards.institutions;
  if (!institutions) {
    result.failures.push("institutions_card_missing");
    return;
  }
  if (numberValue(institutions.value) < 1) result.failures.push(`institutions_value_${institutions.value}_lt_1`);
  if (cleanText(institutions.qualifier) !== "fact") result.failures.push(`institutions_qualifier_${cleanText(institutions.qualifier) || "missing"}`);
  if (!/swfi\.entities/i.test(cleanText(institutions.basis))) result.failures.push(`institutions_basis_not_swfi_entities:${cleanText(institutions.basis) || "missing"}`);
}

function validateActiveAllocators(result, packet) {
  const rows = packetRows(packet);
  const data = packetData(packet);
  const methodology = data.methodology && typeof data.methodology === "object" && !Array.isArray(data.methodology)
    ? data.methodology
    : {};
  const cutoff = todayMs - 90 * dayMs;
  result.business_rule = {
    expected_sort: ["deal_count desc", "total_deal_value desc", "latest_transaction_date desc"],
    cutoff: new Date(cutoff).toISOString().slice(0, 10),
    today: todayIso,
  };
  if (!/buyer\/acquirer|buyer.*acquirer/i.test(cleanText(methodology.participant_basis))) result.failures.push("allocator_methodology_missing_buyer_acquirer_basis");
  if (!/completed transaction date/i.test(cleanText(methodology.date_basis))) result.failures.push("allocator_methodology_missing_completed_date_basis");
  if (!/latest_transaction_source_url/i.test(cleanText(methodology.source_url_proof))) result.failures.push("allocator_methodology_missing_source_url_proof");
  if (packetCount(packet) < 1 || rows.length < 5) result.failures.push(`allocator_rows_${rows.length}_lt_5`);
  rows.forEach((row, index) => {
    const name = cleanText(row.name);
    const latest = parseDateMs(row.latest_transaction_date);
    const latestSource = cleanText(row.latest_transaction_source_url);
    if (!name) result.failures.push(`allocator_${index}_missing_name`);
    if (/\bBDO\b/i.test(name)) result.failures.push(`allocator_historical_leak_bdo:${index}`);
    if (numberValue(row.deal_count) < 1) result.failures.push(`allocator_${name || index}_deal_count_lt_1`);
    const dealSources = Array.isArray(row.deal_source_urls) ? row.deal_source_urls.map(cleanText).filter(Boolean) : [];
    if (dealSources.length < 1) result.failures.push(`allocator_${name || index}_missing_deal_source_urls`);
    if (!/^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}/i.test(latestSource)) {
      result.failures.push(`allocator_${name || index}_bad_latest_transaction_source_url:${latestSource || "missing"}`);
    }
    if (dealSources.length && latestSource && dealSources[0] !== latestSource) {
      result.failures.push(`allocator_${name || index}_latest_source_not_first_deal_source`);
    }
    for (const dealSource of dealSources.slice(0, 5)) {
      if (!/^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}/i.test(dealSource)) {
        result.failures.push(`allocator_${name || index}_bad_deal_source_url:${dealSource}`);
      }
    }
    if (!Number.isFinite(latest)) result.failures.push(`allocator_${name || index}_missing_latest_transaction_date`);
    if (Number.isFinite(latest) && latest < cutoff) result.failures.push(`allocator_${name}_latest_${row.latest_transaction_date}_before_${result.business_rule.cutoff}`);
    if (Number.isFinite(latest) && latest > todayMs) result.failures.push(`allocator_${name}_latest_${row.latest_transaction_date}_future`);
    if (!cleanText(row.entity_type || row.type)) result.failures.push(`allocator_${name || index}_missing_entity_type`);
    if (!cleanText(row.country)) result.failures.push(`allocator_${name || index}_missing_country`);
    if (!cleanText(row.region)) result.failures.push(`allocator_${name || index}_missing_region`);
    if (index < rows.length - 1 && !allocatorInRankOrder(row, rows[index + 1])) {
      result.failures.push(`allocator_sort_violation:${name || index}->${cleanText(rows[index + 1].name) || index + 1}`);
    }
  });
}

function validateRecentTransactions(result, packet) {
  const rows = packetRows(packet);
  const cutoff = todayMs - 30 * dayMs;
  result.business_rule = {
    activity_date_fields: ["activity_date", "relevant_date", "announced_at", "closed_at", "completed_at"],
    cutoff: new Date(cutoff).toISOString().slice(0, 10),
    today: todayIso,
  };
  if (packetCount(packet) < 1 || rows.length < 5) result.failures.push(`transaction_rows_${rows.length}_lt_5`);
  rows.forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    const activity = firstAvailableDate(row, result.business_rule.activity_date_fields);
    if (!cleanText(row.title || row.name)) result.failures.push(`transaction_${index}_missing_title`);
    if (!hasSwfiSource(row)) result.failures.push(`transaction_${label}_missing_swfi_source_url`);
    if (!cleanText(row.buyer_entity || row.institution)) result.failures.push(`transaction_${label}_missing_buyer_or_institution`);
    if (!Number.isFinite(activity.ms)) {
      result.failures.push(`transaction_${label}_missing_activity_date`);
    } else {
      if (activity.ms < cutoff) result.failures.push(`transaction_${label}_${activity.field}_${activity.value}_before_${result.business_rule.cutoff}`);
      if (activity.ms > todayMs) result.failures.push(`transaction_${label}_${activity.field}_${activity.value}_future`);
    }
    if (index < rows.length - 1) {
      const next = firstAvailableDate(rows[index + 1], result.business_rule.activity_date_fields);
      if (Number.isFinite(activity.ms) && Number.isFinite(next.ms) && activity.ms < next.ms) {
        result.failures.push(`transaction_sort_violation:${label}->${cleanText(rows[index + 1].title || rows[index + 1].name || index + 1)}`);
      }
    }
  });
}

function validateLiveRfps(result, packet) {
  const rows = packetRows(packet);
  if (packetCount(packet) < 1 || rows.length < 1) result.failures.push(`rfp_rows_${rows.length}_lt_1`);
  rows.forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    const due = firstAvailableDate(row, ["due_at", "deadline", "relevant_date"]);
    if (!cleanText(row.title || row.name)) result.failures.push(`rfp_${index}_missing_title`);
    if (!hasSwfiSource(row)) result.failures.push(`rfp_${label}_missing_swfi_source_url`);
    if (!Number.isFinite(due.ms)) {
      result.failures.push(`rfp_${label}_missing_due_date`);
    } else if (due.ms < todayMs) {
      result.failures.push(`rfp_${label}_${due.field}_${due.value}_before_${todayIso}`);
    }
  });
}

function validateSectorFlows(result, packet) {
  const rows = packetRows(packet);
  if (packetCount(packet) < 1 || rows.length < 1) result.failures.push(`sector_flow_rows_${rows.length}_lt_1`);
  rows.forEach((row, index) => {
    if (!cleanText(row.name || row.value)) result.failures.push(`sector_flow_${index}_missing_name`);
    if (numberValue(row.count) < 1) result.failures.push(`sector_flow_${cleanText(row.name || row.value) || index}_count_lt_1`);
    if (row.capital_deployed !== undefined && numberValue(row.capital_deployed) < 0) result.failures.push(`sector_flow_${cleanText(row.name || row.value) || index}_negative_capital`);
  });
}

function validateCompareEntities(result, packet) {
  const rows = packetRows(packet);
  if (packetCount(packet) < 1 || rows.length < 5) result.failures.push(`compare_rows_${rows.length}_lt_5`);
  rows.forEach((row, index) => {
    const name = cleanText(row.name || index);
    if (!cleanText(row.name)) result.failures.push(`compare_${index}_missing_name`);
    if (!cleanText(row.type)) result.failures.push(`compare_${name}_missing_entity_type`);
    if (!cleanText(row.country)) result.failures.push(`compare_${name}_missing_country`);
    if (!hasSwfiSource(row)) result.failures.push(`compare_${name}_missing_swfi_source_url`);
  });
}

function validateAumRankings(result, packet) {
  const rows = packetRows(packet);
  if (rows.length < 10) result.failures.push(`aum_rows_${rows.length}_lt_10`);
  rows.forEach((row, index) => {
    const name = cleanText(row.name || index);
    if (numberValue(row.aum || row.assets) <= 0) result.failures.push(`aum_${name}_missing_numeric_aum`);
    if (!cleanText(row.aum_currency || row.currency)) result.failures.push(`aum_${name}_missing_currency`);
    if (!cleanText(row.aum_date || row.as_of_date)) result.failures.push(`aum_${name}_missing_as_of_date`);
    if (!hasSwfiSource(row)) result.failures.push(`aum_${name}_missing_swfi_source_url`);
    if (index < rows.length - 1 && numberValue(row.aum || row.assets) < numberValue(rows[index + 1].aum || rows[index + 1].assets)) {
      result.failures.push(`aum_sort_violation:${name}->${cleanText(rows[index + 1].name) || index + 1}`);
    }
  });
}

function validateSourceIntelligenceNews(result, packet) {
  const rows = packetRows(packet);
  if (packetCount(packet) < 1 || rows.length < 5) result.failures.push(`news_rows_${rows.length}_lt_5`);
  rows.forEach((row, index) => {
    const label = cleanText(row.title || row.name || index);
    if (!cleanText(row.title || row.name)) result.failures.push(`news_${index}_missing_title`);
    if (!hasSwfiArticleSource(row)) result.failures.push(`news_${label}_missing_legacy_or_swfi_source_url`);
    if (/generated|fallback|placeholder/i.test(cleanText(row.source || row.status || row.provenance))) {
      result.failures.push(`news_${label}_generated_marker_present`);
    }
    const published = cleanText(row.published_at || row.date);
    if (published && !Number.isFinite(parseDateMs(published))) {
      result.failures.push(`news_${label}_invalid_published_at:${published}`);
    }
  });
}

function validateSearch(result, packet) {
  const rows = packetRows(packet);
  if (rows.length < 1) result.failures.push("search_rows_missing");
  rows.forEach((row, index) => {
    const name = cleanText(row.name || row.title || index);
    if (!cleanText(row.name || row.title)) result.failures.push(`search_${index}_missing_label`);
    if (!hasSwfiSource(row)) result.failures.push(`search_${name}_missing_swfi_source_url`);
  });
}

function runModuleBusinessChecks(result, module, packet) {
  if (module.id === "dashboard_total_institutions") validateDashboardMetrics(result, packet);
  if (module.id === "active_allocators") validateActiveAllocators(result, packet);
  if (module.id === "recent_transactions") validateRecentTransactions(result, packet);
  if (module.id === "live_rfps") validateLiveRfps(result, packet);
  if (module.id === "sector_market_activity") validateSectorFlows(result, packet);
  if (module.id === "compare_entities") validateCompareEntities(result, packet);
  if (module.id === "aum_rankings") validateAumRankings(result, packet);
  if (module.id === "source_intelligence_news") validateSourceIntelligenceNews(result, packet);
  if (module.id === "search") validateSearch(result, packet);
}

async function packetForBusinessChecks(module, publicPacket) {
  if (module.id !== "active_allocators") return publicPacket;
  const internalPacket = await fetchJson(module.endpoint, { internal: true });
  if (internalPacket.http_status >= 400 || !internalPacket.body || typeof internalPacket.body !== "object") {
    return publicPacket;
  }
  const publicData = packetData(publicPacket);
  const internalData = packetData(internalPacket.body);
  if (!internalData.methodology || typeof internalData.methodology !== "object" || Array.isArray(internalData.methodology)) {
    return publicPacket;
  }
  return {
    ...publicPacket,
    data: {
      ...publicData,
      methodology: internalData.methodology,
    },
  };
}

async function inspectModule(module) {
  const result = {
    id: module.id || "unknown",
    label: module.label || "",
    endpoint: module.endpoint || "",
    url: module.endpoint ? endpointUrl(module.endpoint) : "",
    freshness: module.freshness || "",
    ok: true,
    failures: ledgerFailures(module),
    warnings: [],
    row_count: 0,
    declared_source: module.data_source || "",
    query_rule: module.query_rule || "",
    calculation_rule: module.calculation_rule || "",
    duplicate_rule: module.duplicate_rule || "",
    api_exposure: { ok: true, findings: [] },
  };

  if (!module.endpoint) {
    result.ok = false;
    return result;
  }

  try {
    const packet = await fetchJson(module.endpoint);
    result.http_status = packet.http_status;
    if (packet.http_status >= 400) result.failures.push(`http_${packet.http_status}`);
    if (!packet.body || typeof packet.body !== "object") {
      result.failures.push("json_body_missing");
      result.ok = false;
      return result;
    }

    result.failures.push(...envelopeFailures(packet.body));
    const rows = packetRows(packet.body);
    result.row_count = rows.length;
    result.packet_count = packetCount(packet.body);
    result.generated_at = packet.body.generated_at || "";
    result.source_receipt = packet.body.source_receipt || packet.body.provenance || {};

    if (module.freshness === "live" && !packet.body.generated_at) result.failures.push("live_packet_missing_generated_at");
    if (rows.length) result.failures.push(...duplicateFailures(rows, module));
    const businessPacket = await packetForBusinessChecks(module, packet.body);
    runModuleBusinessChecks(result, module, businessPacket);

    const exposureFindings = apiExposureFindings(packet.body).slice(0, 30);
    result.api_exposure = {
      ok: exposureFindings.length === 0,
      findings: exposureFindings,
    };
    if (exposureFindings.length) {
      result.failures.push(`public_api_restricted_fields:${exposureFindings.slice(0, 12).map((item) => `${item.path}:${item.reason}`).join("|")}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  }

  result.ok = result.failures.length === 0;
  return result;
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN Data Validation Gate",
    "",
    `- Status: ${receipt.status.toUpperCase()}`,
    `- Origin: ${receipt.origin}`,
    `- Backend origin: ${receipt.backend_origin}`,
    `- Generated: ${receipt.generated_at}`,
    `- Today: ${receipt.today}`,
    `- Modules: ${receipt.summary.modules}`,
    `- Failed modules: ${receipt.summary.failed_modules}`,
    `- Contract blockers: ${receipt.summary.contract_blockers}`,
    "",
    "| Module | Status | Source | Query Rule | Calculation Rule |",
    "| --- | --- | --- | --- | --- |",
  ];

  for (const moduleResult of receipt.modules) {
    lines.push(`| ${escapeCell(moduleResult.label || moduleResult.id)} | ${moduleResult.ok ? "PASS" : "FAIL"} | ${escapeCell(moduleResult.declared_source)} | ${escapeCell(moduleResult.query_rule)} | ${escapeCell(moduleResult.calculation_rule)} |`);
  }

  if (receipt.failures.length) {
    lines.push("", "## Failures", "");
    for (const failure of receipt.failures) {
      lines.push(`- ${failure.id}: ${failure.failures.join("; ")}`);
    }
  }

  if (receipt.blocked_acceptance_items.length) {
    lines.push("", "## Blocked Acceptance Items", "");
    for (const item of receipt.blocked_acceptance_items) {
      lines.push(`- ${item.id}: ${item.reason}`);
    }
  }

  lines.push("", "## Contract", "");
  lines.push("Wrong numbers, out-of-window rows, broken source rules, restricted public API exposure, or internal technical leakage are blockers.");
  return `${lines.join("\n")}\n`;
}

function escapeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const ledger = readLedger();
  const modules = [];
  for (const moduleSpec of ledger.modules) {
    modules.push(await inspectModule(moduleSpec));
  }

  const failedModules = modules.filter((module) => !module.ok);
  const blockedAcceptanceItems = ledger.blocked_acceptance_items.map((item) => ({ ...item, ok: false }));
  const status = failedModules.length ? "fail" : blockedAcceptanceItems.length ? "blocked" : "pass";
  const receipt = {
    schema_version: "swfipn.data_validation_gate.v1",
    origin,
    backend_origin: backendOrigin,
    fact_rail: ledger.fact_rail || "",
    provenance_rail: ledger.provenance_rail || "",
    generated_at: new Date().toISOString(),
    today: todayIso,
    status,
    summary: {
      modules: modules.length,
      failed_modules: failedModules.length,
      contract_blockers: blockedAcceptanceItems.length,
      api_exposure_failures: modules.filter((module) => !module.api_exposure.ok).length,
    },
    modules,
    blocked_acceptance_items: blockedAcceptanceItems,
    failures: [
      ...failedModules.map((module) => ({ id: module.id, endpoint: module.endpoint, failures: module.failures })),
      ...blockedAcceptanceItems.map((item) => ({ id: item.id, failures: [item.reason] })),
    ],
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdown(receipt));
  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    receipt: receiptPath,
    report: reportPath,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
