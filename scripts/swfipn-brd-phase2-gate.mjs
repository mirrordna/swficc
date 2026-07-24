#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const matrixPath = path.join(cwd, "docs/swfipn-brd-v1-3-acceptance-matrix.json");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-brd-phase2-acceptance-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const matrix = readJson(matrixPath);
const now = Date.now();

const results = matrix.requirements.map(evaluateRequirement);
const nonPassResults = results.filter((result) => result.status !== "pass");
const deferredResults = nonPassResults.filter((result) => result.priority === "P2" && result.status === "blocked");
const nonDeferredNonPassResults = nonPassResults.filter((result) => !(result.priority === "P2" && result.status === "blocked"));
const summary = {
  total: results.length,
  pass: results.filter((result) => result.status === "pass").length,
  fail: results.filter((result) => result.status === "fail").length,
  blocked: results.filter((result) => result.status === "blocked").length,
  deferred: deferredResults.length,
  non_deferred_not_passed: nonDeferredNonPassResults.length,
  stale: results.filter((result) => result.status === "stale").length,
  p0_not_passed: results.filter((result) => result.priority === "P0" && result.status !== "pass").length,
};

const status = summary.p0_not_passed === 0 && summary.fail === 0 && summary.stale === 0 && summary.non_deferred_not_passed === 0
  ? (summary.deferred === 0 ? "pass" : "pass_with_deferred_scope")
  : "fail";
const verdict = status === "pass" ? "go" : status === "pass_with_deferred_scope" ? "go_for_current_scope" : "no_go";

const receipt = {
  schema_version: "swfipn.brd_phase2_acceptance_receipt.v1",
  generated_at: new Date().toISOString(),
  status,
  verdict,
  target: process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/",
  brd_source: matrix.generated_from,
  matrix: path.relative(cwd, matrixPath),
  summary,
  results,
  blockers: results
    .filter((result) => result.priority === "P0" && result.status !== "pass")
    .map((result) => ({
      id: result.id,
      area: result.area,
      status: result.status,
      reason: result.reason,
      receipt: result.receipt || null
    }))
};

fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({
  status,
  verdict,
  receipt: receiptPath,
  summary,
  blockers: receipt.blockers
}, null, 2));

if (status === "fail") process.exit(1);

function evaluateRequirement(requirement) {
  const base = {
    id: requirement.id,
    priority: requirement.priority,
    area: requirement.area,
    requirement: requirement.requirement,
    brd_refs: requirement.brd_refs
  };

  const evidence = requirement.evidence || {};
  if (evidence.manual_status) {
    return {
      ...base,
      status: evidence.manual_status,
      reason: evidence.reason || "Manual status supplied by matrix."
    };
  }

  const receiptRel = evidence.receipt;
  if (!receiptRel) {
    return {
      ...base,
      status: evidence.missing_status || "blocked",
      reason: "No receipt configured for this requirement."
    };
  }

  const resolvedReceipt = path.join(cwd, receiptRel);
  if (!fs.existsSync(resolvedReceipt)) {
    return {
      ...base,
      status: evidence.missing_status || "blocked",
      receipt: receiptRel,
      reason: `Missing receipt ${receiptRel}.`
    };
  }

  let receipt;
  try {
    receipt = readJson(resolvedReceipt);
  } catch (error) {
    return {
      ...base,
      status: "fail",
      receipt: receiptRel,
      reason: `Receipt is not valid JSON: ${error.message}`
    };
  }

  const receiptStatus = receipt.status || receipt.verdict || "unknown";
  const allowed = evidence.allowed_statuses || ["pass"];
  if (!allowed.includes(receiptStatus)) {
    return {
      ...base,
      status: "fail",
      receipt: receiptRel,
      receipt_status: receiptStatus,
      generated_at: receipt.generated_at || null,
      reason: `Receipt status ${receiptStatus} is not in allowed statuses ${allowed.join(", ")}.`
    };
  }

  const generatedAt = receipt.generated_at ? Date.parse(receipt.generated_at) : NaN;
  if (evidence.max_age_hours && (!Number.isFinite(generatedAt) || now - generatedAt > evidence.max_age_hours * 60 * 60 * 1000)) {
    return {
      ...base,
      status: "stale",
      receipt: receiptRel,
      receipt_status: receiptStatus,
      generated_at: receipt.generated_at || null,
      max_age_hours: evidence.max_age_hours,
      reason: Number.isFinite(generatedAt)
        ? `Receipt is older than ${evidence.max_age_hours} hours.`
        : "Receipt has no generated_at timestamp."
    };
  }

  const failedChecks = [];
  for (const check of evidence.checks || []) {
    const value = getPath(receipt, check.path);
    if (!checkPasses(value, check)) {
      failedChecks.push({ ...check, actual: value === undefined ? null : value });
    }
  }
  if (failedChecks.length) {
    return {
      ...base,
      status: "fail",
      receipt: receiptRel,
      receipt_status: receiptStatus,
      generated_at: receipt.generated_at || null,
      reason: "Receipt check failed.",
      failed_checks: failedChecks
    };
  }

  return {
    ...base,
    status: "pass",
    receipt: receiptRel,
    receipt_status: receiptStatus,
    generated_at: receipt.generated_at || null,
    reason: "Current receipt satisfies matrix checks."
  };
}

function checkPasses(value, check) {
  switch (check.op) {
    case "equals":
      return value === check.value;
    case "lte":
      return typeof value === "number" && value <= check.value;
    case "gte":
      return typeof value === "number" && value >= check.value;
    case "empty_array":
      return Array.isArray(value) && value.length === 0;
    case "empty_or_zero":
      if (Array.isArray(value)) return value.length === 0;
      if (typeof value === "number") return value === 0;
      return value === undefined || value === null;
    case "truthy":
      return Boolean(value);
    default:
      throw new Error(`Unknown matrix check op: ${check.op}`);
  }
}

function getPath(object, dottedPath) {
  return dottedPath.split(".").reduce((current, key) => {
    if (current === undefined || current === null) return undefined;
    return current[key];
  }, object);
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
