#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-latest-feedback-forensic-gate-latest.json");
const origin = (process.env.SWFIPN_ORIGIN || "https://dashboard.swfi.com/swficc/").replace(/\/$/, "/");
const apiOrigin = new URL(origin).origin;

const mongoEnvNames = [
  "SWFIPN_RECORD_PARITY_MONGO_URI",
  "SWFIPN_PARITY_MONGO_URI",
  "SWFI_MONGO_URI",
  "SWFI_MONGODB_URI",
  "SWFI_ATLAS_URI",
  "MONGODB_URI",
  "ATLAS_URI",
];

function apiUrl(route) {
  return new URL(route, apiOrigin).href;
}

function rows(packet) {
  const data = packet?.data || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data)) return data;
  return [];
}

function text(value) {
  return String(value ?? "").trim();
}

function numeric(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const raw = text(value).replace(/,/g, "");
  const unit = (raw.match(/([KMBT])\b/i) || [])[1]?.toUpperCase();
  const match = raw.match(/-?\d+(?:\.\d+)?/);
  if (!match) return 0;
  let parsed = Number(match[0]);
  if (!Number.isFinite(parsed)) return 0;
  if (unit === "K") parsed *= 1_000;
  if (unit === "M") parsed *= 1_000_000;
  if (unit === "B") parsed *= 1_000_000_000;
  if (unit === "T") parsed *= 1_000_000_000_000;
  return parsed;
}

function dateMs(value) {
  const parsed = Date.parse(text(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function rowDate(row) {
  return text(row.latest_transaction_date || row.activity_date || row.relevant_date || row.closed_at || row.announced_at || row.deadline || row.due_at || row.published_at || row.updated_at || row.last_updated || row.created_at || row.date);
}

async function fetchJson(route, attempts = 4) {
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(apiUrl(route), {
        signal: controller.signal,
        headers: { accept: "application/json", "user-agent": "swfipn-latest-feedback-forensic-gate/1.0" },
      });
      clearTimeout(timeout);
      const json = await response.json();
      return { response, json };
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 750 * (attempt + 1)));
    }
  }
  throw lastError;
}

function mongoEnvState() {
  return mongoEnvNames.map((name) => {
    const value = process.env[name] || "";
    if (!value) return { name, state: "unset" };
    try {
      const parsed = new URL(value);
      const host = parsed.hostname || "";
      const local = host === "127.0.0.1" || host === "localhost" || host === "::1" || host.endsWith(".local");
      return { name, state: "set", scheme: parsed.protocol.replace(":", ""), host, local };
    } catch {
      return { name, state: "set", parseable: false };
    }
  });
}

function matchesTerm(row, fields, term) {
  const needle = term.toLowerCase();
  return fields.map((field) => text(row[field])).join(" ").toLowerCase().includes(needle);
}

function capitalCuriosityCandidates({ sectorRows, transactionRows, mandateRows, newsRows }) {
  return sectorRows.map((sectorRow) => {
    const sector = text(sectorRow.name || sectorRow.value);
    const flowCount = numeric(sectorRow.count);
    const dealMatches = transactionRows.filter((row) => matchesTerm(row, ["sector", "industry"], sector));
    const mandateMatches = mandateRows.filter((row) => matchesTerm(row, ["strategy", "asset_class_or_strategy", "title", "name"], sector));
    const newsMatches = newsRows.filter((row) => matchesTerm(row, ["title", "name", "excerpt", "summary"], sector));
    const latestDeal = dealMatches.slice().sort((a, b) => dateMs(rowDate(b)) - dateMs(rowDate(a)))[0];
    const signalCount = [
      flowCount > 0,
      dealMatches.length > 0,
      mandateMatches.length > 0,
      newsMatches.length > 0,
    ].filter(Boolean).length;
    return {
      sector,
      source_lanes: signalCount,
      sector_flow_count: flowCount,
      loaded_recent_deals: dealMatches.length,
      open_mandates: mandateMatches.length,
      news_mentions: newsMatches.length,
      latest_activity_ms: latestDeal ? dateMs(rowDate(latestDeal)) : 0,
      latest_deal: latestDeal ? {
        title: text(latestDeal.title || latestDeal.name),
        date: rowDate(latestDeal),
        buyer: text(latestDeal.buyer_entity || latestDeal.institution),
      } : null,
      click: `/swficc/deals/?filter=${encodeURIComponent(sector)}`,
    };
  }).filter((row) => row.sector && row.source_lanes > 0)
    .sort((a, b) => b.source_lanes - a.source_lanes || b.latest_activity_ms - a.latest_activity_ms || b.sector_flow_count - a.sector_flow_count || a.sector.localeCompare(b.sector));
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const checks = [];
  const failures = [];
  const blocked = [];

  const [search, top20, allocators, transactions, sectorFlows, mandates, news, sectorDrilldown, industryDrilldown] = await Promise.all([
    fetchJson("/api/v1/public/search?q=PIF&limit=5"),
    fetchJson("/v1/swfi/top20?limit=25"),
    fetchJson("/api/allocator-activity/v1?days=90&limit=100&page=1&sort=latest_transaction_date&direction=desc"),
    fetchJson("/api/recent-transactions/v1?days=30&limit=50&page=1"),
    fetchJson("/api/sector-flows/v1?days=365"),
    fetchJson("/api/live-opportunities/v1?limit=25&page=1"),
    fetchJson("/api/source-intelligence/news/v1?limit=25"),
    fetchJson("/api/transaction-drilldown/v1?field=sector&value=Infrastructure&days=365&limit=8"),
    fetchJson("/api/transaction-drilldown/v1?field=industry&value=Infrastructure&days=3650&limit=8"),
  ]);

  const searchRows = rows(search.json);
  const firstSearch = text(searchRows[0]?.name || searchRows[0]?.title);
  checks.push({ id: "smart_search_pif_first_result", ok: /public investment fund/i.test(firstSearch), first_result: firstSearch });

  const topRows = rows(top20.json);
  const aumValues = topRows.map((row) => numeric(row.aum || row.assets || row.managed_assets));
  const aumDescending = aumValues.every((value, index) => index === 0 || aumValues[index - 1] >= value);
  checks.push({ id: "top_ranked_aum_descending", ok: aumDescending, sample: topRows.slice(0, 5).map((row) => ({ name: text(row.name), aum: numeric(row.aum || row.assets || row.managed_assets) })) });

  const allocatorRows = rows(allocators.json);
  const allocatorDates = allocatorRows.slice(0, 20).map((row) => rowDate(row));
  const allocatorLatestFirst = allocatorDates.every((value, index) => index === 0 || dateMs(allocatorDates[index - 1]) >= dateMs(value));
  checks.push({ id: "active_allocators_latest_activity_first", ok: allocatorLatestFirst, sample: allocatorRows.slice(0, 10).map((row) => ({ name: text(row.name), latest_transaction_date: rowDate(row), deal_count: numeric(row.deal_count || row.activity_count) })) });

  const sectorRows = rows(sectorDrilldown.json);
  const sectorExact = sectorRows.every((row) => /infrastructure/i.test(text(row.sector)));
  checks.push({ id: "deals_sector_filter_field_specific", ok: sectorRows.length > 0 && sectorExact, rows: sectorRows.length, sample: sectorRows.slice(0, 3).map((row) => ({ title: text(row.title || row.name), sector: text(row.sector), industry: text(row.industry) })) });

  const industryRows = rows(industryDrilldown.json);
  const industryExact = industryRows.every((row) => /infrastructure/i.test(text(row.industry)));
  checks.push({ id: "deals_industry_filter_field_specific", ok: industryRows.length > 0 && industryExact, rows: industryRows.length, sample: industryRows.slice(0, 3).map((row) => ({ title: text(row.title || row.name), sector: text(row.sector), industry: text(row.industry) })) });

  const candidates = capitalCuriosityCandidates({
    sectorRows: rows(sectorFlows.json),
    transactionRows: rows(transactions.json).slice(0, 25),
    mandateRows: rows(mandates.json),
    newsRows: rows(news.json),
  });
  checks.push({
    id: "capital_curiosity_radar_source_backed",
    ok: candidates.length > 0,
    method: "rank by source-lane breadth first, then latest matching deal date, then raw sector-flow count; no weighted scoring",
    basis: {
      sector_rows: rows(sectorFlows.json).length,
      transaction_rows: rows(transactions.json).length,
      rendered_transaction_window: 25,
      mandate_rows: rows(mandates.json).length,
      news_rows: rows(news.json).length,
    },
    candidates: candidates.slice(0, 8),
  });

  const mongo = mongoEnvState();
  const nonLocalMongo = mongo.find((item) => item.state === "set" && item.local === false);
  if (!nonLocalMongo) {
    blocked.push({
      id: "direct_mongo_forensic",
      reason: "no_non_local_mongo_uri_available_in_current_shell",
      env_state: mongo,
    });
  } else {
    checks.push({
      id: "direct_mongo_forensic_available",
      ok: true,
      env_name: nonLocalMongo.name,
      host: nonLocalMongo.host,
    });
  }

  for (const check of checks) {
    if (!check.ok) failures.push(check.id);
  }

  const receipt = {
    schema_version: "swfipn.latest_feedback_forensic_gate.v1",
    status: failures.length ? "fail" : blocked.length ? "pass_with_blocked_mongo" : "pass",
    generated_at: new Date().toISOString(),
    origin,
    checks,
    blocked,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, failures: failures.length, blocked: blocked.length, receipt: receiptPath }));
  if (failures.length) process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.latest_feedback_forensic_gate.v1",
    status: "error",
    generated_at: new Date().toISOString(),
    error: error.message,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
