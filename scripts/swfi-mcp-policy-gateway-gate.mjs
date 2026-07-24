#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { executeTool } from "./swfi-mcp-policy-gateway.mjs";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfi-mcp-policy-gateway-gate-latest.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json"), "utf8"));

const sampleInputs = {
  search_institutions: { query: "PIF", limit: 5, page: 1 },
  get_institution_profile: { institution_id: "5e5713b876fb1e43b1bb71eb" },
  compare_entities: { institution_ids: ["5e5713b876fb1e43b1bb71eb", "5e39a581fcbe7e8ca723278c"], metrics: ["aum", "country", "type"] },
  get_recent_transactions: { days: 90, limit: 5, page: 1 },
  get_live_rfps: { limit: 5, page: 1 },
  get_recent_fundraising: { days: 90, limit: 5 },
  get_top_entities_by_aum: { limit: 5 },
  get_source_provenance: { record_family: "entity", record_id: "5e5713b876fb1e43b1bb71eb" },
  create_content_draft: { title: "Draft", body: "Source-backed draft body.", evidence: [{ source: "dry-run://source" }] },
  update_unpublished_draft: { draft_id: "draft-test", changes: { title: "Updated" } },
  request_content_approval: { draft_id: "draft-test", approver: "KP", approval_scope: "content_review" },
  propose_record_correction: { record_family: "entity", record_id: "5e5713b876fb1e43b1bb71eb", field: "state", proposed_value: "New York", evidence: [{ source: "dry-run://source" }] },
  create_research_note: { title: "Note", note: "Internal source-backed note.", evidence: [{ source: "dry-run://source" }] },
};

const requiredFields = ["data_timestamp", "source_lineage", "confidence", "missing_data_warning", "query_receipt", "receipt"];
const forbiddenText = ["_id", "mongo_id", "source_gap", "backend_name", "service_token", "stack_trace"];

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const failures = [];
  const checks = [];

  for (const tool of manifest.tools) {
    const input = sampleInputs[tool.name];
    if (!input) {
      failures.push(`missing_sample_input:${tool.name}`);
      continue;
    }
    const result = await executeTool(tool.name, input, { dryRun: true, callerRole: "swfi_operator" });
    const serialized = JSON.stringify(result);
    const check = {
      tool: tool.name,
      expected_mode: tool.mode,
      status: result.status,
      query_receipt: result.query_receipt,
      failures: [],
    };
    for (const field of requiredFields) {
      if (result[field] === undefined) check.failures.push(`missing_result_field:${field}`);
    }
    for (const text of forbiddenText) {
      if (serialized.includes(`"${text}"`)) check.failures.push(`forbidden_field_leak:${text}`);
    }
    if (tool.mode === "read_only" && result.status !== "ok") check.failures.push(`read_tool_not_ok:${result.status}`);
    if (tool.mode === "controlled_mutation" && result.status !== "approval_required") check.failures.push(`mutation_not_approval_required:${result.status}`);
    if (tool.mode === "controlled_mutation" && result.approval_required !== true) check.failures.push("mutation_missing_approval_required_flag");
    if (!String(result.query_receipt || "").startsWith("swfi-")) check.failures.push("receipt_id_not_swfi_scoped");
    if (!Array.isArray(result.source_lineage)) check.failures.push("source_lineage_not_array");
    if (check.failures.length) failures.push(...check.failures.map((failure) => `${tool.name}:${failure}`));
    checks.push(check);
  }

  const receipt = {
    schema_version: "swfi.mcp_policy_gateway_gate.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      tools_checked: checks.length,
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
