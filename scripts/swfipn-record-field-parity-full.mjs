#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-record-field-parity-full-latest.json");
const statePath = path.join(outputDir, "swfipn-record-field-parity-full-state.json");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");
const serviceToken = text(process.env.SWFIPN_BACKEND_TOKEN || process.env.SWFI2_API_TOKEN);
const mongoDatabase = process.env.SWFIPN_RECORD_PARITY_MONGO_DB || "swfi";
const pageLimit = clampInt(process.env.SWFIPN_FIELD_PARITY_LIMIT || "500", 1, 5000);
const maxPages = clampInt(process.env.SWFIPN_FIELD_PARITY_MAX_PAGES || "0", 0, 1_000_000);
const collectionsToRun = envList("SWFIPN_FIELD_PARITY_COLLECTIONS", ["entities", "people", "transactions", "compass"]);
const requestTimeoutMs = clampInt(process.env.SWFIPN_FIELD_PARITY_TIMEOUT_MS || "90000", 5_000, 300_000);
const allowPartialExit = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_ALLOW_PARTIAL_EXIT || ""));
const fromMappingSnapshot = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_FIELD_PARITY_FROM_MAPPING || ""));
const mappingReceiptPath = path.join(outputDir, "swfipn-full-universe-mapping-latest.json");

const specs = {
  entities: {
    sourceSection: "entities",
    mongoCollection: "entities",
    fields: [
      stringField("name", ["name"], ["name"]),
      stringField("type", ["type"], ["type"]),
      stringField("country", ["country"], ["country"]),
      stringField("region", ["region"], ["region"]),
      {
        ...numberField("assets", ["assets", "aum"], ["assets"], { zeroNullEquivalent: true }),
        source: (doc) => firstPositiveNumberValue(doc, ["assets", "managedAssets"]),
      },
    ],
  },
  people: {
    sourceSection: "people",
    mongoCollection: "people",
    fields: [
      {
        id: "name",
        kind: "string",
        live: (row) => text(row.name),
        source: (doc) => [doc.firstName, doc.middleName, doc.lastName, doc.suffix].map(text).filter(Boolean).join(" ") || text(doc.name),
        allowIncludes: true,
      },
      stringField("country", ["country"], ["country"]),
      stringField("region", ["region"], ["region"]),
    ],
  },
  transactions: {
    sourceSection: "transactions",
    mongoCollection: "transactions",
    mongoProjection: {
      _id: 1,
      name: 1,
      title: 1,
      country: 1,
      region: 1,
      industry: 1,
      investmentType: 1,
      amount: 1,
      announcedAt: 1,
      closedAt: 1,
      buyerEntities: { $slice: 1 },
      sellerEntities: { $slice: 1 },
    },
    fields: [
      stringField("name", ["name", "title"], ["name", "title"]),
      stringField("country", ["country"], ["country"]),
      stringField("region", ["region"], ["region"]),
      stringField("industry", ["industry"], ["industry"]),
      stringField("investment_type", ["investment_type"], ["investmentType"]),
      numberField("amount", ["amount", "capital", "value"], ["amount"], { zeroNullEquivalent: true }),
      dateField("closed_at", ["closed_at", "activity_date", "relevant_date"], ["closedAt", "announcedAt"]),
      {
        id: "buyer_entity",
        kind: "string",
        live: (row) => text(row.buyer_entity || row.institution),
        source: (doc) => text(firstArrayItem(doc.buyerEntities)?.name),
        skipIfDisclosureGap: true,
      },
      {
        id: "seller_entity",
        kind: "string",
        live: (row) => text(row.seller_entity),
        source: (doc) => text(firstArrayItem(doc.sellerEntities)?.name),
        skipIfDisclosureGap: true,
      },
    ],
  },
  compass: {
    sourceSection: "compass",
    mongoCollection: "compass",
    fields: [
      stringField("name", ["name", "title"], ["name", "title"]),
      stringField("type", ["type"], ["type"]),
      stringField("institution", ["institution"], ["entityName"]),
      stringField("country", ["country"], ["country"]),
      stringField("region", ["region"], ["region"]),
      stringField("investment_type", ["investment_type", "strategy", "asset_class_or_strategy"], ["investmentType"]),
      numberField("amount", ["amount", "value"], ["amount"], { zeroNullEquivalent: true }),
      dateField("due_at", ["due_at", "deadline", "relevant_date"], ["dueAt"]),
      dateField("posted_at", ["posted_at"], ["postedAt"]),
    ],
  },
};

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function envList(name, fallback) {
  const items = String(process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return text(value).replace(/&amp;/g, "&").replace(/\s+/g, " ").replace(/[’]/g, "'").toLowerCase();
}

function isDisclosureGap(value) {
  return /^(not disclosed|undisclosed|n\/a|null|none|unknown)?$/i.test(text(value));
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length ? value[0] : undefined;
}

function liveValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return undefined;
}

function sourceValue(doc, fields) {
  for (const field of fields) {
    const value = doc?.[field];
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return undefined;
}

function stringField(id, liveFields, sourceFields = liveFields) {
  return {
    id,
    kind: "string",
    live: (row) => liveValue(row, liveFields),
    source: (doc) => sourceValue(doc, sourceFields),
    skipIfDisclosureGap: true,
  };
}

function numberField(id, liveFields, sourceFields = liveFields, options = {}) {
  return {
    id,
    kind: "number",
    live: (row) => liveValue(row, liveFields),
    source: (doc) => sourceValue(doc, sourceFields),
    ...options,
  };
}

function dateField(id, liveFields, sourceFields = liveFields) {
  return {
    id,
    kind: "date",
    live: (row) => liveValue(row, liveFields),
    source: (doc) => sourceValue(doc, sourceFields),
    skipIfDisclosureGap: true,
  };
}

function idFromSourceUrl(value, expectedSection) {
  try {
    const parsed = new URL(text(value));
    const match = parsed.pathname.match(new RegExp(`/v1/${expectedSection}/([a-f0-9]{24})/?$`, "i"));
    return match ? match[1].toLowerCase() : "";
  } catch {
    return "";
  }
}

function rowId(row, spec) {
  return text(row.id || row.source_record_id || row.entity_id || row.person_id || row.transaction_id || row.compass_id).toLowerCase()
    || idFromSourceUrl(row.source_url || row.swfi_url, spec.sourceSection);
}

function scalarDate(value) {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  if (value && typeof value === "object" && value.$date) {
    if (typeof value.$date === "string") return value.$date.slice(0, 10);
    if (value.$date && typeof value.$date === "object" && value.$date.$numberLong) {
      const millis = Number(value.$date.$numberLong);
      if (Number.isFinite(millis)) return new Date(millis).toISOString().slice(0, 10);
    }
  }
  return text(value).slice(0, 10);
}

function scalarNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && value.$numberLong) return Number(value.$numberLong);
  if (value && typeof value === "object" && value.$numberDouble) return Number(value.$numberDouble);
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function firstPositiveNumberValue(doc, fields) {
  let fallback;
  for (const field of fields) {
    const value = doc?.[field];
    if (value === undefined || value === null || text(value) === "") continue;
    if (fallback === undefined) fallback = value;
    const parsed = scalarNumber(value);
    if (Number.isFinite(parsed) && parsed > 0) return value;
  }
  return fallback;
}

function compareField(field, row, doc) {
  const live = field.live(row);
  const source = field.source(doc);
  if (field.skipIfDisclosureGap && (isDisclosureGap(live) || isDisclosureGap(source))) {
    return { field: field.id, status: "skipped", reason: "disclosure_gap" };
  }
  if (field.kind === "number") {
    const liveNum = scalarNumber(live);
    const sourceNum = scalarNumber(source);
    if (field.zeroNullEquivalent && ((Number.isNaN(liveNum) && sourceNum === 0) || (liveNum === 0 && Number.isNaN(sourceNum)))) {
      return { field: field.id, status: "allowed_normalization", reason: "zero_null_equivalent" };
    }
    if (Number.isNaN(liveNum) && Number.isNaN(sourceNum)) return { field: field.id, status: "skipped", reason: "both_missing" };
    if (liveNum === sourceNum) return { field: field.id, status: "match" };
    if (Number.isFinite(liveNum) && Number.isFinite(sourceNum) && Math.abs(liveNum - sourceNum) < 1) {
      return { field: field.id, status: "allowed_normalization", reason: "sub_dollar_numeric_precision" };
    }
    return { field: field.id, status: "mismatch", live: text(live), source: text(source) };
  }
  if (field.kind === "date") {
    const liveDate = scalarDate(live);
    const sourceDate = scalarDate(source);
    if (!liveDate && !sourceDate) return { field: field.id, status: "skipped", reason: "both_missing" };
    if (liveDate === sourceDate) return { field: field.id, status: "match" };
    return { field: field.id, status: "mismatch", live: liveDate, source: sourceDate };
  }
  const liveText = normalizedText(live);
  const sourceText = normalizedText(source);
  if (!liveText && !sourceText) return { field: field.id, status: "skipped", reason: "both_missing" };
  if (liveText === sourceText) return { field: field.id, status: "match" };
  if (field.allowIncludes && liveText && sourceText && (liveText.includes(sourceText) || sourceText.includes(liveText))) {
    return { field: field.id, status: "allowed_normalization", reason: "name_variant" };
  }
  return { field: field.id, status: "mismatch", live: text(live), source: text(source) };
}

function scanUrl(collection, limit, after) {
  const params = new URLSearchParams({ collection, limit: String(limit) });
  if (after) params.set("after", after);
  return `${backendOrigin}/api/source-data/scan/v1?${params.toString()}`;
}

async function fetchJson(url, maxRetries = 8) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "swfipn-record-field-parity-full/1.0",
          ...(serviceToken ? { Authorization: `Bearer ${serviceToken}`, "X-SWFIPN-Internal": "1" } : { "X-SWFIPN-Public": "1" }),
        },
      });
      const raw = await response.text();
      let body;
      try {
        body = JSON.parse(raw || "{}");
      } catch {
        body = { raw: raw.slice(0, 500) };
      }
      if ((response.status === 429 || response.status >= 500) && attempt < maxRetries) {
        await sleep(2_000 * attempt);
        continue;
      }
      return { status: response.status, body };
    } catch (error) {
      lastError = error;
      if (attempt < maxRetries) {
        await sleep(2_000 * attempt);
        continue;
      }
    } finally {
      clearTimeout(timer);
    }
  }
  return { status: 0, body: { status: "fetch_failed", error: lastError?.message || "fetch_failed" } };
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function packetRows(body) {
  const data = body?.data || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  return [];
}

function loadMongoUri() {
  const rejected = [];
  for (const [name, value] of [
    ["SWFIPN_RECORD_PARITY_MONGO_URI", process.env.SWFIPN_RECORD_PARITY_MONGO_URI],
    ["ATLAS_URI", process.env.ATLAS_URI],
    ["SWFI_ATLAS_URI", process.env.SWFI_ATLAS_URI],
    ["SWFI_MONGODB_URI", process.env.SWFI_MONGODB_URI],
    ["MONGODB_URI", process.env.MONGODB_URI],
  ]) {
    if (value && isAllowedMongoUri(value)) return { uri: value, source: `env:${name}` };
    if (value) rejected.push({ source: `env:${name}`, reason: "local_mongo_uri_rejected" });
  }
  return { uri: "", source: "", rejected };
}

function isAllowedMongoUri(value) {
  if (/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_RECORD_PARITY_ALLOW_LOCAL_MONGO || ""))) return true;
  try {
    const parsed = new URL(value);
    const host = parsed.hostname.toLowerCase();
    return !["localhost", "127.0.0.1", "::1", "0.0.0.0"].includes(host);
  } catch {
    return false;
  }
}

function fetchMongoDocs(collection, ids, mongoUri, projection = null) {
  const cleanIds = [...new Set(ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)))];
  const js = `
const uri = process.env.SWFIPN_PARITY_MONGO_URI;
const dbName = process.env.SWFIPN_PARITY_MONGO_DB || "swfi";
const collection = process.env.SWFIPN_PARITY_COLLECTION;
const ids = JSON.parse(process.env.SWFIPN_PARITY_IDS || "[]");
const projection = JSON.parse(process.env.SWFIPN_PARITY_PROJECTION || "null");
const conn = new Mongo(uri);
const db = conn.getDB(dbName);
const objectIds = ids.map((id) => ObjectId(id));
const cursor = projection
  ? db.getCollection(collection).find({ _id: { $in: objectIds } }, projection)
  : db.getCollection(collection).find({ _id: { $in: objectIds } });
const docs = cursor.toArray();
print(JSON.stringify(docs.map((doc) => EJSON.serialize(doc))));
`;
  const result = spawnSync("mongosh", ["--quiet", "--nodb", "--eval", js], {
    env: {
      ...process.env,
      SWFIPN_PARITY_MONGO_URI: mongoUri,
      SWFIPN_PARITY_MONGO_DB: mongoDatabase,
      SWFIPN_PARITY_COLLECTION: collection,
      SWFIPN_PARITY_IDS: JSON.stringify(cleanIds),
      SWFIPN_PARITY_PROJECTION: projection ? JSON.stringify(projection) : "null",
    },
    encoding: "utf8",
    timeout: requestTimeoutMs,
    maxBuffer: 100 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`mongosh_failed:${result.stderr.trim().slice(0, 500)}`);
  const docs = JSON.parse(result.stdout.trim() || "[]");
  return new Map(docs.map((doc) => [doc?._id?.$oid || "", doc]));
}

function emptyState() {
  return {
    collections: Object.fromEntries(Object.keys(specs).map((key) => [key, {
      count: 0,
      checked: 0,
      matched: 0,
      mismatched: 0,
      missing_source_record: 0,
      blocked: 0,
      after: "",
      pages: 0,
    }])),
    failures: [],
  };
}

function loadState() {
  if (process.env.SWFIPN_RESET_STATE === "1") return emptyState();
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath, "utf8"));
    return { ...emptyState(), ...parsed, collections: { ...emptyState().collections, ...(parsed.collections || {}) } };
  } catch {
    return emptyState();
  }
}

function saveState(state) {
  fs.writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`);
}

async function runCollection(collection, spec, mongoUri, state) {
  let after = state.collections[collection].after || "";
  let keepGoing = true;
  while (keepGoing) {
    state.collections[collection].pages += 1;
    const page = state.collections[collection].pages;
    console.error(`[field-parity] ${collection}: page=${page} after=${after || "START"}`);
    const packet = await fetchJson(scanUrl(collection, pageLimit, after));
    if (packet.status !== 200 || packet.body?.status !== "ok") {
      state.collections[collection].blocked += 1;
      state.failures.push({ collection, id: "scan_failed", reason: `http_${packet.status}_${packet.body?.status || "missing"}` });
      break;
    }
    const data = packet.body?.data || {};
    const rows = packetRows(packet.body);
    if (state.collections[collection].count === 0) state.collections[collection].count = Number(data.source_total || data.count || 0);
    if (!rows.length) break;
    const idRows = rows.map((row) => ({ id: rowId(row, spec), row })).filter((item) => /^[a-f0-9]{24}$/i.test(item.id));
    let docs;
    try {
      docs = fetchMongoDocs(spec.mongoCollection, idRows.map((item) => item.id), mongoUri, spec.mongoProjection);
    } catch (error) {
      state.collections[collection].blocked += idRows.length;
      state.failures.push({ collection, id: "mongo_lookup_failed", reason: error.message });
      break;
    }
    for (const item of idRows) {
      state.collections[collection].checked += 1;
      const doc = docs.get(item.id);
      if (!doc) {
        state.collections[collection].missing_source_record += 1;
        state.failures.push({ collection, id: item.id, reason: "missing_source_record" });
        continue;
      }
      const comparisons = spec.fields.map((field) => compareField(field, item.row, doc));
      const mismatches = comparisons.filter((comparison) => comparison.status === "mismatch");
      if (mismatches.length) {
        state.collections[collection].mismatched += 1;
        if (state.failures.length < 1000) state.failures.push({ collection, id: item.id, reason: "field_mismatch", mismatches });
      } else {
        state.collections[collection].matched += 1;
      }
    }
    const nextAfter = data.next_after;
    if ((maxPages && page >= maxPages) || !data.has_more || !nextAfter || String(nextAfter) === String(after)) {
      keepGoing = false;
    } else {
      after = String(nextAfter);
      state.collections[collection].after = after;
    }
    saveState(state);
  }
}

function loadMappingReceipt() {
  const receipt = JSON.parse(fs.readFileSync(mappingReceiptPath, "utf8"));
  if (receipt.status !== "pass") throw new Error(`mapping_receipt_not_pass:${receipt.status || "missing"}`);
  return receipt;
}

async function runSnapshotCollection(family, spec, mongoUri, state) {
  const collection = family.id;
  const filePath = text(family.output);
  state.collections[collection].count = Number(family.rows_written || family.rows_seen || family.source_total || 0);
  if (!filePath || !fs.existsSync(filePath)) {
    state.collections[collection].blocked += state.collections[collection].count || 1;
    state.failures.push({ collection, id: "snapshot_missing", reason: `missing_mapping_ndjson:${filePath || "missing"}` });
    return;
  }

  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: stream, crlfDelay: Infinity });
  let batch = [];
  let lineNumber = 0;

  async function flush() {
    if (!batch.length) return;
    state.collections[collection].pages += 1;
    const page = state.collections[collection].pages;
    console.error(`[field-parity:snapshot] ${collection}: batch=${page} checked=${state.collections[collection].checked}`);
    let docs;
    try {
      docs = fetchMongoDocs(spec.mongoCollection, batch.map((item) => item.id), mongoUri, spec.mongoProjection);
    } catch (error) {
      state.collections[collection].blocked += batch.length;
      state.failures.push({ collection, id: "mongo_lookup_failed", reason: error.message });
      batch = [];
      return;
    }
    for (const item of batch) {
      state.collections[collection].checked += 1;
      const doc = docs.get(item.id);
      if (!doc) {
        state.collections[collection].missing_source_record += 1;
        state.failures.push({ collection, id: item.id, reason: "missing_source_record" });
        continue;
      }
      const comparisons = spec.fields.map((field) => compareField(field, item.row, doc));
      const mismatches = comparisons.filter((comparison) => comparison.status === "mismatch");
      if (mismatches.length) {
        state.collections[collection].mismatched += 1;
        if (state.failures.length < 1000) state.failures.push({ collection, id: item.id, reason: "field_mismatch", mismatches });
      } else {
        state.collections[collection].matched += 1;
      }
    }
    batch = [];
  }

  for await (const line of rl) {
    lineNumber += 1;
    const clean = line.trim();
    if (!clean) continue;
    let record;
    try {
      record = JSON.parse(clean);
    } catch (error) {
      state.collections[collection].blocked += 1;
      state.failures.push({ collection, id: `line_${lineNumber}`, reason: `snapshot_parse_error:${error.message}` });
      continue;
    }
    const id = text(record.id).toLowerCase();
    const sourceFields = record.source_fields && typeof record.source_fields === "object" ? record.source_fields : null;
    if (!/^[a-f0-9]{24}$/i.test(id)) {
      state.collections[collection].blocked += 1;
      state.failures.push({ collection, id: id || `line_${lineNumber}`, reason: "snapshot_invalid_id" });
      continue;
    }
    if (!sourceFields) {
      state.collections[collection].blocked += 1;
      state.failures.push({ collection, id, reason: "snapshot_source_fields_missing" });
      continue;
    }
    batch.push({ id, row: { ...sourceFields, id, source_url: record.source_url } });
    if (batch.length >= pageLimit) await flush();
  }
  await flush();
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const mongo = loadMongoUri();
  const state = loadState();
  if (!mongo.uri) {
    const receipt = {
      status: "blocked",
      generated_at: new Date().toISOString(),
      reason: "mongo_uri_unavailable",
      detail: "No governed non-local Mongo URI is available for full field parity. Localhost Mongo URIs are rejected unless SWFIPN_RECORD_PARITY_ALLOW_LOCAL_MONGO=1.",
      rejected_sources: mongo.rejected || [],
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath }, null, 2));
    process.exit(1);
  }
  if (fromMappingSnapshot) {
    const mapping = loadMappingReceipt();
    const familyById = new Map((mapping.families || []).map((family) => [family.id, family]));
    for (const collection of collectionsToRun) {
      const spec = specs[collection];
      const family = familyById.get(collection);
      if (!spec || !family) continue;
      await runSnapshotCollection(family, spec, mongo.uri, state);
    }
  } else {
    for (const collection of collectionsToRun) {
      const spec = specs[collection];
      if (!spec) continue;
      await runCollection(collection, spec, mongo.uri, state);
    }
  }
  const partialRun = Boolean(maxPages || process.env.SWFIPN_FIELD_PARITY_COLLECTIONS);
  for (const collection of Object.keys(state.collections)) {
    const item = state.collections[collection];
    if (item.checked > item.count) item.count = item.checked;
  }
  const failed = Object.values(state.collections).reduce((sum, item) => sum + item.mismatched + item.missing_source_record + item.blocked, 0);
  const totalChecked = Object.values(state.collections).reduce((sum, item) => sum + item.checked, 0);
  const totalCount = Object.values(state.collections).reduce((sum, item) => sum + item.count, 0);
  const receipt = {
    status: failed ? "fail" : partialRun ? "partial_pass" : totalChecked === totalCount && totalCount > 0 ? "pass" : "fail",
    generated_at: new Date().toISOString(),
    scope: fromMappingSnapshot
      ? "full required-field parity from frozen SWFIPN mapping snapshot to Mongo by source id"
      : "full required-field parity from SWFIPN source API to Mongo by source id",
    verification_mode: fromMappingSnapshot ? "frozen_mapping_source_fields_to_projected_mongo" : "live_scan_to_projected_mongo",
    mapping_receipt: fromMappingSnapshot ? "output/swfipn-full-universe-mapping-latest.json" : "",
    partial_run: partialRun,
    partial_reason: maxPages ? `max_pages_${maxPages}` : process.env.SWFIPN_FIELD_PARITY_COLLECTIONS ? `collections_${process.env.SWFIPN_FIELD_PARITY_COLLECTIONS}` : "",
    backend_origin: backendOrigin,
    mongo: {
      database: mongoDatabase,
      source: mongo.source,
      uri_redacted: true,
    },
    page_limit: pageLimit,
    collections_requested: collectionsToRun,
    totals: { count: totalCount, checked: totalChecked, failed },
    collections: Object.fromEntries(Object.entries(state.collections).map(([key, value]) => {
      const copy = { ...value };
      delete copy.after;
      return [key, copy];
    })),
    failures: state.failures.slice(0, 1000),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, totals: receipt.totals, receipt: receiptPath }, null, 2));
  if (receipt.status === "fail" || (receipt.status === "partial_pass" && !allowPartialExit)) process.exit(1);
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
