#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { executeTool } from "./swfi-mcp-policy-gateway.mjs";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output", "swfi-mcp");
const auditPath = path.join(outputDir, "audit-gate-log.jsonl");
const receiptPath = path.join(repoRoot, "output", "swfi-mcp-audit-gate-latest.json");
const manifest = JSON.parse(fs.readFileSync(path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json"), "utf8"));

const sampleInputs = {
  search_institutions: { query: "PIF", limit: 3, page: 1 },
  get_institution_profile: { institution_id: "5e5713b876fb1e43b1bb71eb" },
  compare_entities: { institution_ids: ["5e5713b876fb1e43b1bb71eb", "5e39a581fcbe7e8ca723278c"], metrics: ["aum", "country"] },
  get_recent_transactions: { days: 90, limit: 3, page: 1 },
  get_live_rfps: { limit: 3, page: 1 },
  get_recent_fundraising: { days: 90, limit: 3 },
  get_top_entities_by_aum: { limit: 3 },
  get_source_provenance: { record_family: "entity", record_id: "5e5713b876fb1e43b1bb71eb" },
  create_content_draft: { title: "Draft", body: "Source-backed draft body.", evidence: [{ source: "dry-run://source" }] },
  update_unpublished_draft: { draft_id: "draft-test", changes: { title: "Updated" } },
  request_content_approval: { draft_id: "draft-test", approver: "KP", approval_scope: "content_review" },
  propose_record_correction: { record_family: "entity", record_id: "5e5713b876fb1e43b1bb71eb", field: "state", proposed_value: "New York", evidence: [{ source: "dry-run://source" }] },
  create_research_note: { title: "Note", note: "Internal source-backed note.", evidence: [{ source: "dry-run://source" }] },
};

const forbiddenAuditKeys = new Set(["raw_input", "raw_output", "record", "items", "service_token", "password", "secret"]);
const forbiddenAuditText = [/Source-backed draft body/i, /5e5713b876fb1e43b1bb71eb.*5e39a581fcbe7e8ca723278c/i];

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.rmSync(auditPath, { force: true });

  const failures = [];
  const executions = [];
  for (const tool of manifest.tools) {
    const input = sampleInputs[tool.name];
    if (!input) {
      failures.push(`missing_sample_input:${tool.name}`);
      continue;
    }
    const result = await executeTool(tool.name, input, {
      dryRun: true,
      callerRole: "swfi_audit_gate",
      auditLogPath: auditPath,
    });
    executions.push({ tool: tool.name, status: result.status, receipt: result.query_receipt });
  }

  const events = fs.existsSync(auditPath)
    ? fs.readFileSync(auditPath, "utf8").trim().split(/\n+/).filter(Boolean).map((line, index) => {
        try {
          return JSON.parse(line);
        } catch {
          failures.push(`audit_line_${index + 1}_invalid_json`);
          return null;
        }
      }).filter(Boolean)
    : [];

  if (events.length !== executions.length) failures.push(`audit_event_count:${events.length}_expected_${executions.length}`);

  const auditText = fs.existsSync(auditPath) ? fs.readFileSync(auditPath, "utf8") : "";
  for (const pattern of forbiddenAuditText) {
    if (pattern.test(auditText)) failures.push(`audit_raw_value_leak:${pattern.source}`);
  }

  const checks = events.map((event) => {
    const eventFailures = [];
    for (const key of ["schema_version", "generated_at", "tool", "status", "risk_tier", "mode", "caller_role", "input_hash", "query_receipt", "source_count", "item_count", "allowed"]) {
      if (event[key] === undefined || event[key] === "") eventFailures.push(`missing_${key}`);
    }
    for (const key of Object.keys(event)) {
      if (forbiddenAuditKeys.has(key)) eventFailures.push(`forbidden_key:${key}`);
    }
    if (!/^[a-f0-9]{64}$/.test(String(event.input_hash || ""))) eventFailures.push("input_hash_not_sha256");
    if (!String(event.query_receipt || "").startsWith("swfi-")) eventFailures.push("query_receipt_not_swfi_scoped");
    const manifestTool = manifest.tools.find((tool) => tool.name === event.tool);
    if (!manifestTool) eventFailures.push("tool_not_in_manifest");
    if (manifestTool?.mode === "read_only" && event.allowed !== true) eventFailures.push("read_tool_not_allowed");
    if (manifestTool?.mode === "controlled_mutation" && event.approval_required !== true) eventFailures.push("mutation_not_approval_logged");
    if (eventFailures.length) failures.push(...eventFailures.map((failure) => `${event.tool}:${failure}`));
    return { tool: event.tool, status: event.status, query_receipt: event.query_receipt, failures: eventFailures };
  });

  const receipt = {
    schema_version: "swfi.mcp_audit_gate.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    audit_log: auditPath,
    summary: {
      tools_executed: executions.length,
      audit_events: events.length,
      failures: failures.length,
    },
    checks,
    failures,
  };
  fs.mkdirSync(path.dirname(receiptPath), { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
