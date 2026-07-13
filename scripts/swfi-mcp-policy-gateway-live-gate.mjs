#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { executeTool } from "./swfi-mcp-policy-gateway.mjs";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfi-mcp-policy-gateway-live-gate-latest.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json"), "utf8"));
const backendOrigin = String(process.env.SWFIPN_BACKEND_ORIGIN || "https://swfipn.activemirror.ai").replace(/\/$/, "");

const sampleInputs = {
  search_institutions: { query: "PIF", limit: 5, page: 1 },
  get_institution_profile: { institution_id: "5e5713b876fb1e43b1bb71eb" },
  compare_entities: { institution_ids: ["5e5713b876fb1e43b1bb71eb", "5e39a581fcbe7e8ca723278c"], metrics: ["aum", "country", "type"] },
  get_recent_transactions: { days: 90, limit: 5, page: 1 },
  get_live_rfps: { limit: 5, page: 1 },
  get_recent_fundraising: { days: 90, limit: 5 },
  get_top_entities_by_aum: { limit: 5 },
  get_source_provenance: { record_family: "entity", record_id: "5e5713b876fb1e43b1bb71eb" },
};

const forbiddenText = ["\"_id\"", "\"mongo_id\"", "\"source_gap\"", "\"backend_name\"", "\"service_token\"", "\"stack_trace\""];

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const checks = [];
  const failures = [];

  for (const tool of manifest.tools.filter((candidate) => candidate.mode === "read_only")) {
    const result = await executeTool(tool.name, sampleInputs[tool.name], {
      dryRun: false,
      callerRole: "swfi_live_gate",
      backendOrigin,
    });
    const serialized = JSON.stringify(result);
    const check = {
      tool: tool.name,
      status: result.status,
      confidence: result.confidence,
      missing_data_warning: result.missing_data_warning,
      query_receipt: result.query_receipt,
      failures: [],
    };

    if (result.status !== "ok") check.failures.push(`status_not_ok:${result.status}`);
    if (!result.query_receipt) check.failures.push("missing_query_receipt");
    if (!Array.isArray(result.source_lineage) || result.source_lineage.length === 0) check.failures.push("missing_source_lineage");
    if (result.confidence !== "SOURCE_RECORD") check.failures.push(`not_source_record:${result.confidence}`);
    if (result.missing_data_warning) check.failures.push("missing_data_warning_present");
    for (const forbidden of forbiddenText) {
      if (serialized.includes(forbidden)) check.failures.push(`forbidden_field_leak:${forbidden.replaceAll("\"", "")}`);
    }

    if (check.failures.length) failures.push(...check.failures.map((failure) => `${tool.name}:${failure}`));
    checks.push(check);
  }

  const receipt = {
    schema_version: "swfi.mcp_policy_gateway_live_gate.v1",
    generated_at: new Date().toISOString(),
    backend_origin: backendOrigin,
    status: failures.length ? "fail" : "pass",
    summary: {
      read_tools_checked: checks.length,
      failures: failures.length,
    },
    checks,
    failures,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
