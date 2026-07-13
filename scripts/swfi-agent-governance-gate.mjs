#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfi-agent-governance-gate-latest.json");

const requiredFiles = [
  "docs/SWFI_AGENT_GOVERNANCE.md",
  "schemas/swfi-mcp-tools.schema.json",
  "schemas/swfi-mcp-tools.manifest.json",
  "skills/swfi/SKILL.md",
  "skills/swfi/schema.graphql",
  "skills/swfi/queries.md",
  "skills/swfi/mutations.md",
  "skills/swfi/auth-and-roles.md",
  "skills/swfi/errors-and-limits.md",
  "skills/swfi/provenance-rules.md",
  "skills/swfi/stakeholder-approval.md",
  "skills/swfi/publishing-rules.md",
  "skills/swfi/recipes.md",
];

const requiredTools = [
  "search_institutions",
  "get_institution_profile",
  "compare_entities",
  "get_recent_transactions",
  "get_live_rfps",
  "get_recent_fundraising",
  "get_top_entities_by_aum",
  "get_source_provenance",
  "create_content_draft",
  "update_unpublished_draft",
  "request_content_approval",
  "propose_record_correction",
  "create_research_note",
];

const requiredOutputFields = [
  "data_timestamp",
  "source_lineage",
  "confidence",
  "missing_data_warning",
  "query_receipt",
];

const blockedActions = [
  "publish_content",
  "send_outbound_email",
  "modify_production_records",
  "delete_records",
  "bulk_mutation",
  "release_private_data",
  "alter_access_controls",
];

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(repoRoot, relativePath));
}

function outputRequired(schema) {
  return Array.isArray(schema?.required) ? schema.required : [];
}

function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const failures = [];

  for (const file of requiredFiles) {
    if (!fileExists(file)) failures.push(`missing_file:${file}`);
  }

  if (failures.length === 0) {
    const doc = readText("docs/SWFI_AGENT_GOVERNANCE.md");
    const skill = readText("skills/swfi/SKILL.md");
    const manifest = readJson("schemas/swfi-mcp-tools.manifest.json");

    if (!/operationally and commercially separate from ActiveMirrorOS/i.test(doc)) {
      failures.push("doc_missing_swfi_amos_separation");
    }
    if (!/No raw MongoDB access by agents/i.test(doc)) failures.push("doc_missing_no_raw_mongo_rule");
    if (!/No autonomous publishing/i.test(doc)) failures.push("doc_missing_no_autonomous_publishing");
    if (!/SWFI is separate from ActiveMirrorOS/i.test(skill)) failures.push("skill_missing_separation_rule");
    if (!/Default to read-only/i.test(skill)) failures.push("skill_missing_read_only_default");

    if (manifest.owner !== "SWFI") failures.push("manifest_owner_not_swfi");
    if (!/isolated from ActiveMirrorOS/i.test(manifest.separation_rule || "")) failures.push("manifest_missing_separation_rule");

    for (const action of blockedActions) {
      if (!manifest.blocked_actions?.includes(action)) failures.push(`blocked_action_missing:${action}`);
    }

    const toolNames = new Set((manifest.tools || []).map((tool) => tool.name));
    for (const tool of requiredTools) {
      if (!toolNames.has(tool)) failures.push(`tool_missing:${tool}`);
    }

    const seen = new Set();
    for (const tool of manifest.tools || []) {
      if (seen.has(tool.name)) failures.push(`tool_duplicate:${tool.name}`);
      seen.add(tool.name);

      if (!tool.risk_tier) failures.push(`tool_missing_risk_tier:${tool.name}`);
      if (!tool.input_schema || typeof tool.input_schema !== "object") failures.push(`tool_missing_input_schema:${tool.name}`);
      if (!tool.output_schema || typeof tool.output_schema !== "object") failures.push(`tool_missing_output_schema:${tool.name}`);
      if (tool.provenance_required !== true) failures.push(`tool_provenance_not_required:${tool.name}`);
      if (tool.receipt_required !== true) failures.push(`tool_receipt_not_required:${tool.name}`);
      if (!Array.isArray(tool.forbidden_fields) || tool.forbidden_fields.length === 0) failures.push(`tool_forbidden_fields_missing:${tool.name}`);
      if (!Array.isArray(tool.allowed_sources) || tool.allowed_sources.length === 0) failures.push(`tool_allowed_sources_missing:${tool.name}`);
      if (!Array.isArray(tool.allowed_endpoints) || tool.allowed_endpoints.length === 0) failures.push(`tool_allowed_endpoints_missing:${tool.name}`);

      const required = outputRequired(tool.output_schema);
      for (const field of requiredOutputFields) {
        if (!required.includes(field)) failures.push(`tool_output_missing_${field}:${tool.name}`);
      }

      if (tool.mode === "read_only" && tool.approval?.required !== false) {
        failures.push(`read_tool_requires_unexpected_approval:${tool.name}`);
      }
      if (tool.mode === "controlled_mutation" && tool.approval?.required !== true) {
        failures.push(`mutation_tool_missing_approval:${tool.name}`);
      }
      if (tool.mode === "controlled_mutation" && tool.approval?.approval_artifact_required !== true) {
        failures.push(`mutation_tool_missing_approval_artifact:${tool.name}`);
      }
      if (tool.mode === "human_only") {
        failures.push(`human_only_tool_should_not_be_exposed:${tool.name}`);
      }
    }
  }

  const receipt = {
    schema_version: "swfi.agent_governance_gate.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      required_files: requiredFiles.length,
      required_tools: requiredTools.length,
      failures: failures.length,
    },
    files: requiredFiles,
    required_tools: requiredTools,
    failures,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run();
