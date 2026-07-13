#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const contractPath = path.join(repoRoot, "schemas", "swfi-data-quality-contract.json");
const mcpManifestPath = path.join(repoRoot, "schemas", "swfi-mcp-tools.manifest.json");
const validationLedgerPath = path.join(repoRoot, "docs", "swfipn-data-validation-ledger.json");
const receiptPath = path.join(outputDir, "swfi-data-quality-contract-gate-latest.json");

const forbiddenPublicFields = new Set([
  "_id",
  "object_id",
  "mongo_id",
  "source_gap",
  "source_gap_reason",
  "backend_name",
  "api_endpoint",
  "model_name",
  "service_token",
  "stack_trace",
]);

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function run() {
  const failures = [];
  const contract = readJson(contractPath);
  const mcpManifest = readJson(mcpManifestPath);
  const validationLedger = readJson(validationLedgerPath);
  const rules = Array.isArray(contract.field_rules) ? contract.field_rules : [];
  const modules = Array.isArray(validationLedger.modules) ? validationLedger.modules : [];
  const tools = Array.isArray(mcpManifest.tools) ? mcpManifest.tools : [];

  for (const field of ["schema_version", "owner", "principles", "field_rules"]) {
    if (!contract[field]) failures.push(`contract_missing:${field}`);
  }

  const requiredRuleIds = [
    "state_canonicalization",
    "money_numeric_sorting",
    "date_iso_format",
    "source_receipt_required",
    "public_field_whitelist",
  ];
  for (const id of requiredRuleIds) {
    if (!rules.some((rule) => rule.id === id)) failures.push(`missing_rule:${id}`);
  }

  const ruleChecks = rules.map((rule) => {
    const ruleFailures = [];
    for (const field of ["id", "scope", "fields", "severity", "rule", "acceptance"]) {
      if (!rule[field] || (Array.isArray(rule[field]) && rule[field].length === 0)) ruleFailures.push(`missing_${field}`);
    }
    if (!["critical", "high", "medium", "low"].includes(String(rule.severity))) ruleFailures.push("invalid_severity");
    if (rule.id === "state_canonicalization") {
      const examples = Array.isArray(rule.examples) ? rule.examples : [];
      const hasNy = examples.some((example) => example.raw === "NY" && example.canonical === "New York");
      const hasNewYorkState = examples.some((example) => example.raw === "New York State" && example.canonical === "New York");
      if (!hasNy || !hasNewYorkState) ruleFailures.push("missing_state_examples_from_msci_feedback");
    }
    failures.push(...ruleFailures.map((failure) => `${rule.id || "unknown_rule"}:${failure}`));
    return { id: rule.id, severity: rule.severity, failures: ruleFailures };
  });

  const moduleChecks = modules.map((module) => {
    const moduleFailures = [];
    for (const field of ["id", "endpoint", "source_collections", "freshness", "approved_business_logic"]) {
      if (!module[field] || (Array.isArray(module[field]) && module[field].length === 0)) moduleFailures.push(`missing_${field}`);
    }
    const sourceCollections = Array.isArray(module.source_collections) ? module.source_collections : [];
    if (sourceCollections.some((source) => !String(source).startsWith("swfi."))) moduleFailures.push("source_collection_not_swfi_scoped");
    failures.push(...moduleFailures.map((failure) => `${module.id || "unknown_module"}:${failure}`));
    return { id: module.id, endpoint: module.endpoint, failures: moduleFailures };
  });

  const toolChecks = tools.map((tool) => {
    const toolFailures = [];
    if (tool.provenance_required !== true) toolFailures.push("provenance_not_required");
    if (tool.receipt_required !== true) toolFailures.push("receipt_not_required");
    if (!Array.isArray(tool.allowed_sources) || tool.allowed_sources.length === 0) toolFailures.push("missing_allowed_sources");
    if (!Array.isArray(tool.allowed_endpoints) || tool.allowed_endpoints.length === 0) toolFailures.push("missing_allowed_endpoints");
    const forbiddenFields = new Set([...(mcpManifest.common_forbidden_fields || []), ...(tool.forbidden_fields || [])]);
    for (const field of forbiddenPublicFields) {
      if (!forbiddenFields.has(field)) toolFailures.push(`forbidden_field_not_blocked:${field}`);
    }
    failures.push(...toolFailures.map((failure) => `${tool.name || "unknown_tool"}:${failure}`));
    return { name: tool.name, mode: tool.mode, failures: toolFailures };
  });

  const receipt = {
    schema_version: "swfi.data_quality_contract_gate.v1",
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      rules: rules.length,
      modules: modules.length,
      mcp_tools: tools.length,
      failures: failures.length,
    },
    rule_checks: ruleChecks,
    module_checks: moduleChecks,
    tool_checks: toolChecks,
    failures,
  };

  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (failures.length) process.exit(1);
}

run();
