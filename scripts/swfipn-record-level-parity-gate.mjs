#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-record-level-parity-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(origin).origin).replace(/\/$/, "");
const sampleLimit = clampInt(process.env.SWFIPN_RECORD_PARITY_SAMPLE || "8", 1, 50);
const collectionsToRun = envList("SWFIPN_RECORD_PARITY_COLLECTIONS", ["entities", "people", "transactions", "compass"]);
const mongoDatabase = process.env.SWFIPN_RECORD_PARITY_MONGO_DB || "swfi";
const requestTimeoutMs = clampInt(process.env.SWFIPN_RECORD_PARITY_TIMEOUT_MS || "45000", 5_000, 180_000);
const maxRetries = clampInt(process.env.SWFIPN_RECORD_PARITY_RETRIES || "4", 1, 8);

const specs = {
  entities: {
    sourceSection: "entities",
    endpoint: (limit) => `/api/source-data/search/v1?collection=entities&limit=${limit}&page=1`,
    fields: [
      stringField("name", ["name"]),
      stringField("type", ["type"]),
      stringField("country", ["country"]),
      stringField("region", ["region"]),
      {
        id: "assets",
        kind: "number",
        live: (row) => liveValue(row, ["assets", "aum"]),
        source: (doc) => sourceNumberValue(doc, ["assets", "managedAssets"]),
        zeroNullEquivalent: true,
      },
    ],
  },
  people: {
    sourceSection: "people",
    endpoint: (limit) => `/api/source-data/search/v1?collection=people&limit=${limit}&page=1`,
    fields: [
      {
        id: "name",
        kind: "string",
        live: (row) => text(row.name),
        source: (doc) => [doc.firstName, doc.middleName, doc.lastName, doc.suffix].map(text).filter(Boolean).join(" "),
        allowIncludes: true,
      },
      stringField("country", ["country"]),
      stringField("region", ["region"]),
    ],
  },
  transactions: {
    sourceSection: "transactions",
    endpoint: (limit) => `/api/transactions/v1?limit=${limit}&page=1`,
    fields: [
      stringField("name", ["name", "title"]),
      stringField("country", ["country"]),
      stringField("region", ["region"]),
      stringField("industry", ["industry"]),
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
    endpoint: (limit) => `/api/source-data/search/v1?collection=compass&limit=${limit}&page=1`,
    fields: [
      stringField("name", ["name", "title"]),
      stringField("type", ["type"]),
      stringField("institution", ["institution"], ["entityName"]),
      stringField("country", ["country"]),
      stringField("region", ["region"]),
      stringField("investment_type", ["investment_type", "strategy", "asset_class_or_strategy"], ["investmentType"]),
      numberField("amount", ["amount", "value"], ["amount"], { zeroNullEquivalent: true }),
      dateField("due_at", ["due_at", "deadline", "relevant_date"], ["dueAt"]),
      dateField("posted_at", ["posted_at"], ["postedAt"]),
    ],
  },
};

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function clampInt(value, min, max) {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed)) return min;
  return Math.max(min, Math.min(max, parsed));
}

function envList(name, fallback) {
  const items = String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
}

function backendUrl(pathname) {
  return `${backendOrigin}${pathname}`;
}

function text(value) {
  return String(value ?? "").trim();
}

function normalizedText(value) {
  return text(value)
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .replace(/[’]/g, "'")
    .toLowerCase();
}

function isDisclosureGap(value) {
  return /^(not disclosed|undisclosed|n\/a|null|none|unknown)?$/i.test(text(value));
}

function firstArrayItem(value) {
  return Array.isArray(value) && value.length ? value[0] : undefined;
}

function sourceValue(doc, fields) {
  for (const field of fields) {
    const value = doc?.[field];
    if (value !== undefined && value !== null && text(value) !== "") return value;
  }
  return undefined;
}

function sourceNumberValue(doc, fields) {
  let zeroValue;
  for (const field of fields) {
    const value = doc?.[field];
    if (value === undefined || value === null || text(value) === "") continue;
    const numeric = scalarNumber(value);
    if (numeric !== 0 && !Number.isNaN(numeric)) return value;
    if (zeroValue === undefined) zeroValue = value;
  }
  return zeroValue;
}

function liveValue(row, fields) {
  for (const field of fields) {
    const value = row?.[field];
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
    const parsed = new URL(String(value || ""));
    const match = parsed.pathname.match(new RegExp(`/v1/${expectedSection}/([a-f0-9]{24})/?$`, "i"));
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function idFromRow(row, spec) {
  return text(row.id || row.source_record_id || row.entity_id || row.person_id || row.transaction_id || row.compass_id)
    || idFromSourceUrl(row.source_url || row.swfi_url, spec.sourceSection);
}

function packetRows(body) {
  const data = body?.data || {};
  if (Array.isArray(data.rows)) return data.rows;
  if (Array.isArray(data.results)) return data.results;
  if (Array.isArray(data.items)) return data.items;
  return [];
}

function packetCount(body) {
  const data = body?.data || {};
  return Number(data.count ?? data.total ?? data.source_total ?? packetRows(body).length ?? 0);
}

async function sleep(ms) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJsonWithRetry(pathname) {
  const url = backendUrl(pathname);
  const attempts = [];
  for (let attempt = 1; attempt <= maxRetries; attempt += 1) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), requestTimeoutMs);
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "User-Agent": "swfipn-record-level-parity-gate/1.0",
          "X-SWFIPN-Public": "1",
        },
      });
      const raw = await response.text();
      let body;
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { raw: raw.slice(0, 500) };
      }
      const okPacket = response.ok && (body.status === "ok" || body.fact === true || packetRows(body).length > 0);
      attempts.push({
        attempt,
        http_status: response.status,
        packet_status: body.status || "",
        rows: packetRows(body).length,
        count: packetCount(body),
        elapsed_ms: Date.now() - started,
        ok: okPacket,
      });
      if (okPacket) return { url, body, attempts };
    } catch (error) {
      attempts.push({ attempt, error: error.message, elapsed_ms: Date.now() - started, ok: false });
    } finally {
      clearTimeout(timer);
    }
    await sleep(500 * attempt);
  }
  return { url, body: null, attempts };
}

function loadMongoUri() {
  if (process.env.SWFIPN_RECORD_PARITY_MONGO_URI) {
    return { uri: process.env.SWFIPN_RECORD_PARITY_MONGO_URI, source: "env:SWFIPN_RECORD_PARITY_MONGO_URI" };
  }
  for (const [name, value] of [
    ["ATLAS_URI", process.env.ATLAS_URI],
    ["SWFI_ATLAS_URI", process.env.SWFI_ATLAS_URI],
    ["SWFI_MONGODB_URI", process.env.SWFI_MONGODB_URI],
    ["MONGODB_URI", process.env.MONGODB_URI],
    ["SWFI_MONGO_URI", process.env.SWFI_MONGO_URI],
  ]) {
    if (value && usableMongoUri(value)) return { uri: value, source: `env:${name}` };
  }
  return { uri: "", source: "" };
}

function usableMongoUri(value) {
  if (/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_RECORD_PARITY_ALLOW_LOCAL_MONGO || ""))) return true;
  try {
    const parsed = new URL(value);
    return !/^(127\.0\.0\.1|localhost|0\.0\.0\.0)$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function fetchMongoDocs(idsByCollection, mongoUri) {
  const safeIds = Object.fromEntries(Object.entries(idsByCollection).map(([collection, ids]) => [
    collection,
    Array.from(new Set(ids.filter((id) => /^[a-f0-9]{24}$/i.test(id)))),
  ]));
  const js = `
const uri = process.env.SWFIPN_PARITY_MONGO_URI;
const dbName = process.env.SWFIPN_PARITY_MONGO_DB || "swfi";
const idsByCollection = JSON.parse(process.env.SWFIPN_PARITY_IDS || "{}");
const conn = new Mongo(uri);
const db = conn.getDB(dbName);
const out = {};
for (const [collection, ids] of Object.entries(idsByCollection)) {
  out[collection] = [];
  const objectIds = ids.map((id) => ObjectId(id));
  const docs = db.getCollection(collection).find({ _id: { $in: objectIds } }).toArray();
  for (const doc of docs) out[collection].push(EJSON.serialize(doc));
}
print(JSON.stringify(out));
`;
  const result = spawnSync("mongosh", ["--quiet", "--nodb", "--eval", js], {
    env: {
      ...process.env,
      SWFIPN_PARITY_MONGO_URI: mongoUri,
      SWFIPN_PARITY_MONGO_DB: mongoDatabase,
      SWFIPN_PARITY_IDS: JSON.stringify(safeIds),
    },
    encoding: "utf8",
    timeout: requestTimeoutMs,
    maxBuffer: 50 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`mongosh_failed:${result.stderr.trim().slice(0, 500)}`);
  }
  const trimmed = result.stdout.trim();
  const parsed = JSON.parse(trimmed || "{}");
  const byCollection = {};
  for (const [collection, docs] of Object.entries(parsed)) {
    byCollection[collection] = new Map((Array.isArray(docs) ? docs : []).map((doc) => [doc?._id?.$oid || "", doc]));
  }
  return byCollection;
}

function scalarDate(value) {
  if (value && typeof value === "object" && value.$date) return String(value.$date).slice(0, 10);
  return text(value).slice(0, 10);
}

function scalarNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (value && typeof value === "object" && value.$numberLong) return Number(value.$numberLong);
  const parsed = Number(String(value ?? "").replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : NaN;
}

function compareField(field, row, doc) {
  const live = field.live(row);
  const source = field.source(doc);
  if (field.skipIfDisclosureGap && (isDisclosureGap(live) || isDisclosureGap(source))) {
    return { field: field.id, status: "skipped", reason: "disclosure_gap", live: text(live), source: text(source) };
  }
  if (field.kind === "number") {
    const liveNum = scalarNumber(live);
    const sourceNum = scalarNumber(source);
    if (field.zeroNullEquivalent && ((Number.isNaN(liveNum) && sourceNum === 0) || (liveNum === 0 && Number.isNaN(sourceNum)))) {
      return { field: field.id, status: "allowed_normalization", reason: "zero_null_equivalent", live: text(live), source: text(source) };
    }
    if (Number.isNaN(liveNum) && Number.isNaN(sourceNum)) return { field: field.id, status: "skipped", reason: "both_missing" };
    if (liveNum === sourceNum) return { field: field.id, status: "match", live: liveNum, source: sourceNum };
    return { field: field.id, status: "mismatch", live: text(live), source: text(source) };
  }
  if (field.kind === "date") {
    const liveDate = scalarDate(live);
    const sourceDate = scalarDate(source);
    if (!liveDate && !sourceDate) return { field: field.id, status: "skipped", reason: "both_missing" };
    if (liveDate === sourceDate) return { field: field.id, status: "match", live: liveDate, source: sourceDate };
    return { field: field.id, status: "mismatch", live: liveDate, source: sourceDate };
  }
  const liveText = normalizedText(live);
  const sourceText = normalizedText(source);
  if (!liveText && !sourceText) return { field: field.id, status: "skipped", reason: "both_missing" };
  if (liveText === sourceText) return { field: field.id, status: "match", live: text(live), source: text(source) };
  if (field.allowIncludes && liveText && sourceText && (liveText.includes(sourceText) || sourceText.includes(liveText))) {
    return { field: field.id, status: "allowed_normalization", reason: "name_variant", live: text(live), source: text(source) };
  }
  return { field: field.id, status: "mismatch", live: text(live), source: text(source) };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const failures = [];
  const liveCollections = {};
  const idsByCollection = {};

  for (const collection of collectionsToRun) {
    const spec = specs[collection];
    if (!spec) {
      failures.push({ id: "unknown_collection", collection });
      continue;
    }
    const live = await fetchJsonWithRetry(spec.endpoint(sampleLimit));
    const rows = packetRows(live.body);
    const idRows = rows
      .map((row) => ({ id: idFromRow(row, spec), row }))
      .filter((item) => /^[a-f0-9]{24}$/i.test(item.id));
    liveCollections[collection] = {
      endpoint: live.url.replace(backendOrigin, ""),
      attempts: live.attempts,
      count: live.body ? packetCount(live.body) : 0,
      rows_returned: rows.length,
      ids_extracted: idRows.length,
      sampled_ids: idRows.map((item) => item.id),
    };
    if (!live.body) failures.push({ id: "live_api_unavailable", collection, attempts: live.attempts });
    if (!idRows.length) failures.push({ id: "no_record_ids_extracted", collection, rows_returned: rows.length });
    idsByCollection[collection] = idRows.map((item) => item.id);
    liveCollections[collection].sample_rows = idRows;
  }

  const mongo = loadMongoUri();
  if (!mongo.uri) {
    failures.push({ id: "mongo_uri_unavailable", hint: "Set SWFIPN_RECORD_PARITY_MONGO_URI, ATLAS_URI, or SWFI_ATLAS_URI from a governed secret. Local helper files and localhost Mongo are intentionally ignored." });
  }

  let mongoDocs = {};
  if (mongo.uri) {
    try {
      mongoDocs = fetchMongoDocs(idsByCollection, mongo.uri);
    } catch (error) {
      failures.push({ id: "mongo_lookup_failed", error: error.message });
    }
  }

  const collectionResults = {};
  for (const collection of collectionsToRun) {
    const spec = specs[collection];
    if (!spec) continue;
    const live = liveCollections[collection] || {};
    const docMap = mongoDocs[collection] || new Map();
    const records = [];
    for (const item of live.sample_rows || []) {
      if (!mongo.uri || failures.some((failure) => failure.id === "mongo_lookup_failed")) {
        records.push({ id: item.id, status: "blocked", reason: mongo.uri ? "mongo_lookup_failed" : "mongo_uri_unavailable" });
        continue;
      }
      const doc = docMap.get(item.id);
      if (!doc) {
        records.push({ id: item.id, status: "missing_source_record" });
        failures.push({ id: "missing_source_record", collection, record_id: item.id });
        continue;
      }
      const comparisons = spec.fields.map((field) => compareField(field, item.row, doc));
      const mismatches = comparisons.filter((comparison) => comparison.status === "mismatch");
      if (mismatches.length) failures.push({ id: "field_mismatch", collection, record_id: item.id, mismatches });
      records.push({
        id: item.id,
        status: mismatches.length ? "fail" : "pass",
        source_url: text(item.row.source_url || item.row.swfi_url),
        comparisons,
      });
    }
    collectionResults[collection] = {
      count: live.count || 0,
      rows_returned: live.rows_returned || 0,
      ids_extracted: live.ids_extracted || 0,
      source_records_found: records.filter((record) => record.status === "pass" || record.status === "fail").length,
      blocked: records.filter((record) => record.status === "blocked").length,
      field_failures: records.filter((record) => record.status === "fail").length,
      records,
    };
  }

  for (const [collection, live] of Object.entries(liveCollections)) delete live.sample_rows;

  const receipt = {
    status: failures.length ? "fail" : "pass",
    generated_at: new Date().toISOString(),
    scope: "record-level live API to Mongo parity by _id",
    origin,
    backend_origin: backendOrigin,
    mongo: {
      database: mongoDatabase,
      source: mongo.source ? mongo.source.replace(/mongodb(?:\+srv)?:\/\/[^"'\s)]+/i, "mongodb://REDACTED") : "",
      uri_redacted: true,
    },
    sample_limit: sampleLimit,
    collections_requested: collectionsToRun,
    live_collections: liveCollections,
    collection_results: collectionResults,
    rules: {
      zero_null_equivalent: "Allowed for numeric unknown values such as assets/AUM/amount.",
      disclosure_gap: "Not disclosed / blank values are skipped rather than treated as drift.",
      person_name_variant: "First/middle/last name variants are allowed when one contains the other.",
    },
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    receipt: receiptPath,
    collections: Object.fromEntries(Object.entries(collectionResults).map(([collection, result]) => [
      collection,
      {
        count: result.count,
        checked: result.records.length,
        source_records_found: result.source_records_found,
        blocked: result.blocked,
        field_failures: result.field_failures,
      },
    ])),
    transient_retries: Object.fromEntries(Object.entries(liveCollections).map(([collection, result]) => [
      collection,
      Math.max(0, (result.attempts || []).length - 1),
    ])),
    failures: failures.slice(0, 20),
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    status: "fail",
    generated_at: new Date().toISOString(),
    error: error.message,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
