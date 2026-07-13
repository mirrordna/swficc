#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const manifestPath = path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json");
const outputDir = path.join(repoRoot, "output", "swfi-mcp");
const defaultBackendOrigin = "https://swfipn.activemirror.ai";

const args = parseArgs(process.argv.slice(2));
const manifest = readJson(manifestPath);
const commonForbidden = new Set([...(manifest.common_forbidden_fields || [])]);

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (args.list) {
    const tools = manifest.tools.map((tool) => ({
      name: tool.name,
      mode: tool.mode,
      risk_tier: tool.risk_tier,
      approval_required: tool.approval?.required === true,
    }));
    console.log(JSON.stringify({ status: "ok", tools }, null, 2));
    return;
  }

  const toolName = String(args.tool || "");
  if (!toolName) throw new Error("missing --tool");
  const input = parseInput(args.input || "{}");
  const result = await executeTool(toolName, input, {
    dryRun: Boolean(args["dry-run"]),
    callerRole: String(args.role || "swfi_operator"),
    backendOrigin: String(args.backend || process.env.SWFIPN_BACKEND_ORIGIN || defaultBackendOrigin).replace(/\/$/, ""),
  });
  console.log(JSON.stringify(result, null, 2));
  if (result.status !== "ok" && result.status !== "approval_required") process.exit(1);
}

export async function executeTool(toolName, input, options = {}) {
  const tool = manifest.tools.find((candidate) => candidate.name === toolName);
  if (!tool) return failure(toolName, "unknown_tool", input, options);

  const validation = validateInput(tool.input_schema || {}, input);
  if (validation.length) return failure(toolName, `invalid_input:${validation.join("|")}`, input, options, tool);

  if (tool.mode !== "read_only") {
    return approvalRequired(tool, input, options);
  }

  const endpoint = endpointFor(tool.name, input, tool);
  if (!endpoint) return failure(tool.name, "endpoint_not_mapped", input, options, tool);

  let rawData;
  if (options.dryRun) {
    rawData = dryRunPacket(tool, input, endpoint);
  } else {
    rawData = await fetchBackendPacket(options.backendOrigin || defaultBackendOrigin, endpoint);
  }

  const sanitized = stripForbiddenFields(rawData, forbiddenSet(tool));
  const missingWarning = missingDataWarning(sanitized);
  const receipt = queryReceipt(tool, input, endpoint, options, sanitized, missingWarning);

  return {
    status: "ok",
    tool: tool.name,
    risk_tier: tool.risk_tier,
    mode: tool.mode,
    data: normalizedData(tool, sanitized),
    data_timestamp: timestampFromPacket(sanitized),
    source_lineage: sourceLineage(tool, sanitized, endpoint),
    confidence: confidenceFor(sanitized),
    missing_data_warning: missingWarning,
    query_receipt: receipt.id,
    receipt,
  };
}

function endpointFor(toolName, input, tool) {
  const limit = clampInt(input.limit, 1, 25, 25);
  const page = clampInt(input.page, 1, 1000000, 1);
  const params = new URLSearchParams();
  const firstEndpoint = String(tool.allowed_endpoints?.[0] || "");

  if (toolName === "search_institutions") {
    params.set("collection", "entities");
    params.set("limit", String(limit));
    params.set("page", String(page));
    params.set("q", String(input.query || ""));
    addFilterParams(params, input.filters);
    return `/api/source-data/search/v1?${params.toString()}`;
  }
  if (toolName === "get_institution_profile") {
    return `/api/profiles/${encodeURIComponent(input.institution_id)}/v1`;
  }
  if (toolName === "compare_entities") {
    const ids = Array.isArray(input.institution_ids) ? input.institution_ids : [];
    params.set("collection", "entities");
    params.set("limit", String(Math.min(ids.length || 2, 10)));
    params.set("page", "1");
    params.set("ids", ids.join(","));
    if (Array.isArray(input.metrics)) params.set("metrics", input.metrics.join(","));
    return `/api/source-data/search/v1?${params.toString()}`;
  }
  if (toolName === "get_recent_transactions") {
    params.set("days", String(clampInt(input.days, 1, 365, 90)));
    params.set("limit", String(limit));
    params.set("page", String(page));
    addFilterParams(params, input.filters);
    return `/api/recent-transactions/v1?${params.toString()}`;
  }
  if (toolName === "get_live_rfps") {
    params.set("limit", String(limit));
    params.set("page", String(page));
    addFilterParams(params, input.filters);
    return `/api/live-opportunities/v1?${params.toString()}`;
  }
  if (toolName === "get_recent_fundraising") {
    params.set("limit", String(limit));
    params.set("page", "1");
    params.set("q", "fundraising");
    if (input.days) params.set("days", String(clampInt(input.days, 1, 365, 90)));
    return `/api/source-intelligence/news/v1?${params.toString()}`;
  }
  if (toolName === "get_top_entities_by_aum") {
    params.set("collection", "entities");
    params.set("sort", "aum");
    params.set("direction", "desc");
    params.set("limit", String(limit));
    params.set("page", "1");
    for (const key of ["entity_type", "country", "region"]) {
      if (input[key]) params.set(key, String(input[key]));
    }
    return `/api/source-data/search/v1?${params.toString()}`;
  }
  if (toolName === "get_source_provenance") {
    const id = encodeURIComponent(input.record_id);
    const family = String(input.record_family || "");
    if (family === "entity") return `/api/profiles/${id}/v1`;
    if (family === "person") return `/api/people/${id}/v1`;
    if (family === "transaction") return `/api/transactions/${id}/v1`;
    if (family === "compass") return `/api/compass/${id}/v1`;
    if (family === "news") return `/api/source-intelligence/news/detail/v1?legacy_id=${id}`;
    if (family === "report") return `/api/reports/${id}/v1`;
    return "";
  }

  return firstEndpoint || "";
}

function dryRunPacket(tool, input, endpoint) {
  const generatedAt = new Date().toISOString();
  const source = tool.allowed_sources?.[0] || "swfi.unknown";
  const baseRow = {
    name: input.query || input.institution_id || input.record_id || tool.name,
    type: "dry_run_preview",
    country: "Not disclosed",
    region: "Not disclosed",
    source_url: "dry-run://source",
    provenance: [{ source, source_url: "dry-run://source", generated_at: generatedAt }],
  };
  const rows = tool.name === "get_institution_profile"
    ? []
    : tool.name === "get_source_provenance"
      ? []
      : [baseRow];
  return {
    status: "ok",
    fact: true,
    generated_at: generatedAt,
    data: {
      endpoint,
      count: rows.length,
      rows,
      record: tool.name === "get_institution_profile" ? baseRow : undefined,
      provenance: tool.name === "get_source_provenance" ? baseRow.provenance : undefined,
    },
  };
}

async function fetchBackendPacket(backendOrigin, endpoint) {
  const url = new URL(endpoint, backendOrigin);
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "X-SWFI-Agent-Gateway": "1",
    },
  });
  if (!response.ok) {
    return {
      status: "unavailable",
      fact: false,
      generated_at: new Date().toISOString(),
      unavailable_reason: `backend_http_${response.status}`,
      data: { rows: [], count: 0 },
    };
  }
  return await response.json();
}

function normalizedData(tool, packet) {
  const data = objectValue(packet.data);
  if (tool.output_schema?.required?.includes("record")) {
    return { record: objectValue(data.record || data.profile || data.item || data) };
  }
  if (tool.output_schema?.required?.includes("provenance")) {
    return {
      provenance: data.provenance || {
        source_lineage: data.source_lineage || sourceLineage(tool, packet, ""),
        source_url: sourceUrlFromPacket(packet),
      },
    };
  }
  const items = arrayValue(data.rows || data.items || data.results || (Array.isArray(data) ? data : []));
  const result = { items };
  if (tool.output_schema?.required?.includes("total")) result.total = numberValue(data.total ?? data.count ?? items.length);
  if (tool.output_schema?.required?.includes("ranking_basis")) result.ranking_basis = "SWFI-approved source field ranking";
  if (tool.output_schema?.required?.includes("comparison_basis")) result.comparison_basis = "Whitelisted source-backed fields only";
  return result;
}

function queryReceipt(tool, input, endpoint, options, packet, missingWarning) {
  const payload = {
    tool: tool.name,
    risk_tier: tool.risk_tier,
    mode: tool.mode,
    caller_role: options.callerRole || "swfi_operator",
    endpoint,
    dry_run: Boolean(options.dryRun),
    input_hash: sha256(stableJson(input)),
    data_timestamp: timestampFromPacket(packet),
    source_lineage: sourceLineage(tool, packet, endpoint),
    missing_data_warning: missingWarning,
  };
  return {
    id: `swfi-agent-${sha256(stableJson(payload)).slice(0, 16)}`,
    generated_at: new Date().toISOString(),
    ...payload,
  };
}

function approvalRequired(tool, input, options) {
  const receipt = {
    id: `swfi-approval-${sha256(stableJson({ tool: tool.name, input, at: new Date().toISOString() })).slice(0, 16)}`,
    generated_at: new Date().toISOString(),
    tool: tool.name,
    risk_tier: tool.risk_tier,
    mode: tool.mode,
    caller_role: options.callerRole || "swfi_operator",
    approval: tool.approval,
    input_hash: sha256(stableJson(input)),
    blocked_action: "controlled_mutation_requires_approval",
  };
  return {
    status: "approval_required",
    tool: tool.name,
    risk_tier: tool.risk_tier,
    mode: tool.mode,
    approval_required: true,
    approval: tool.approval,
    data_timestamp: receipt.generated_at,
    source_lineage: [],
    confidence: "REVIEW_REQUIRED",
    missing_data_warning: "No production mutation executed. Approval artifact required.",
    query_receipt: receipt.id,
    receipt,
  };
}

function failure(toolName, reason, input, options, tool = null) {
  const generatedAt = new Date().toISOString();
  const receipt = {
    id: `swfi-fail-${sha256(stableJson({ toolName, reason, input, generatedAt })).slice(0, 16)}`,
    generated_at: generatedAt,
    tool: toolName,
    risk_tier: tool?.risk_tier || "unknown",
    caller_role: options.callerRole || "swfi_operator",
    reason,
    input_hash: sha256(stableJson(input)),
  };
  return {
    status: "blocked",
    tool: toolName,
    reason,
    data_timestamp: generatedAt,
    source_lineage: [],
    confidence: "MISSING_OR_STALE",
    missing_data_warning: reason,
    query_receipt: receipt.id,
    receipt,
  };
}

function validateInput(schema, input) {
  const failures = [];
  const required = Array.isArray(schema.required) ? schema.required : [];
  for (const key of required) {
    if (input[key] === undefined || input[key] === null || input[key] === "") failures.push(`missing_${key}`);
  }
  const properties = objectValue(schema.properties);
  for (const [key, rule] of Object.entries(properties)) {
    if (input[key] === undefined || input[key] === null) continue;
    const value = input[key];
    if (rule.type === "string" && typeof value !== "string") failures.push(`${key}_not_string`);
    if (rule.type === "integer" && (!Number.isInteger(Number(value)))) failures.push(`${key}_not_integer`);
    if (rule.type === "array" && !Array.isArray(value)) failures.push(`${key}_not_array`);
    if (rule.type === "object" && (typeof value !== "object" || Array.isArray(value))) failures.push(`${key}_not_object`);
    if (rule.pattern && typeof value === "string" && !(new RegExp(rule.pattern).test(value))) failures.push(`${key}_pattern_mismatch`);
    if (rule.minimum !== undefined && Number(value) < rule.minimum) failures.push(`${key}_below_minimum`);
    if (rule.maximum !== undefined && Number(value) > rule.maximum) failures.push(`${key}_above_maximum`);
    if (rule.minItems !== undefined && Array.isArray(value) && value.length < rule.minItems) failures.push(`${key}_too_few_items`);
    if (rule.maxItems !== undefined && Array.isArray(value) && value.length > rule.maxItems) failures.push(`${key}_too_many_items`);
    if (rule.enum && !rule.enum.includes(value)) failures.push(`${key}_invalid_enum`);
  }
  return failures;
}

function stripForbiddenFields(value, forbidden) {
  if (Array.isArray(value)) return value.map((item) => stripForbiddenFields(item, forbidden));
  if (!value || typeof value !== "object") return value;
  const clean = {};
  for (const [key, child] of Object.entries(value)) {
    if (forbidden.has(key) || forbidden.has(key.toLowerCase())) continue;
    clean[key] = stripForbiddenFields(child, forbidden);
  }
  return clean;
}

function forbiddenSet(tool) {
  const set = new Set(commonForbidden);
  for (const field of tool.forbidden_fields || []) {
    set.add(field);
    set.add(String(field).toLowerCase());
  }
  return set;
}

function sourceLineage(tool, packet, endpoint) {
  const data = objectValue(packet.data);
  const generatedAt = timestampFromPacket(packet);
  const fromPacket = arrayValue(data.source_lineage || data.provenance || packet.source_lineage);
  if (fromPacket.length) return fromPacket;
  return (tool.allowed_sources || []).map((source) => ({
    source,
    endpoint,
    generated_at: generatedAt,
  }));
}

function sourceUrlFromPacket(packet) {
  const data = objectValue(packet.data);
  const record = objectValue(data.record || data.profile || data.item);
  return String(record.source_url || record.swfi_url || data.source_url || data.swfi_url || "");
}

function timestampFromPacket(packet) {
  return String(packet.generated_at || packet.timestamp || packet.data?.generated_at || new Date().toISOString());
}

function confidenceFor(packet) {
  if (packet.status === "ok" && packet.fact === true) return "SOURCE_RECORD";
  return "MISSING_OR_STALE";
}

function missingDataWarning(packet) {
  if (packet.status !== "ok" || packet.fact !== true) return String(packet.unavailable_reason || "Source packet unavailable or not factual.");
  const data = objectValue(packet.data);
  const rows = arrayValue(data.rows || data.items || data.results);
  if (rows.length === 0 && !data.record && !data.profile && !data.provenance) return "No rows returned by source packet.";
  return "";
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}

function parseInput(value) {
  if (typeof value !== "string") return {};
  if (value.startsWith("@")) return readJson(path.resolve(repoRoot, value.slice(1)));
  return JSON.parse(value);
}

function addFilterParams(params, filters) {
  if (!filters || typeof filters !== "object" || Array.isArray(filters)) return;
  for (const [key, value] of Object.entries(filters)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
}

function clampInt(value, min, max, fallback) {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash("sha256").update(String(value)).digest("hex");
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
