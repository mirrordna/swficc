#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-brd-open-infra-blockers-latest.json");
const mongoIndexReceipt = readJson(path.join(outputDir, "swfipn-mongo-indexes-latest.json"));
const cdnReceipt = readJson(path.join(outputDir, "swfipn-cdn-static-assets-gate-latest.json"));
const npmAuditReceipt = readJson(path.join(outputDir, "npm-audit-high-latest.json"));
const ciCdReceipt = readJson(path.join(outputDir, "swfipn-ci-cd-gate-latest.json"));
const runtimePreflightReceipt = readJson(path.join(outputDir, "swfipn-phase2-runtime-preflight-latest.json"));
const sendgridReceipt = readJson(path.join(outputDir, "swfipn-sendgrid-email-brd-gate-latest.json"));
const searchReceipt = readJson(path.join(outputDir, "swfipn-global-search-brd-gate-latest.json"));
const repeatedSearchReceipt = readJson(path.join(outputDir, "swfipn-search-gate-repeated-latest.json"));
const redisReceipt = readJson(path.join(outputDir, "swfipn-redis-cache-gate-latest.json"));
const npmVulnerabilities = npmAuditReceipt?.metadata?.vulnerabilities || {};
const npmHighClean = Number(npmVulnerabilities.high || 0) === 0 && Number(npmVulnerabilities.critical || 0) === 0;
const ciConfigured = ciCdReceipt?.status === "configured_pending_remote_run" || ciCdReceipt?.status === "pass";
const ciRemoteRunProven = Boolean(ciCdReceipt?.summary?.remote_ci_run_proven);
const repeatedSearchSummaries = Array.isArray(repeatedSearchReceipt?.summaries) ? repeatedSearchReceipt.summaries : [];
const searchSummary = repeatedSearchSummaries.length
  ? summarizeRepeatedSearch(repeatedSearchSummaries)
  : searchReceipt?.summary || {};
const searchPass = repeatedSearchReceipt
  ? repeatedSearchReceipt.status === "pass"
  : searchReceipt?.status === "pass";
const autocompleteProven = typeof searchSummary.autocomplete_ms === "number"
  && typeof searchSummary.autocomplete_target_ms === "number"
  && searchSummary.autocomplete_ms <= searchSummary.autocomplete_target_ms;
const resultsPageProven = typeof searchSummary.results_page_ms === "number"
  && typeof searchSummary.results_target_ms === "number"
  && searchSummary.results_page_ms <= searchSummary.results_target_ms;
const searchApiDurationMs = Array.isArray(searchReceipt?.network)
  ? Math.max(0, ...searchReceipt.network
      .filter((item) => item && item.status === 200 && typeof item.duration_ms === "number")
      .map((item) => item.duration_ms))
  : null;
const mongoFailureTypes = Array.isArray(mongoIndexReceipt?.failures)
  ? mongoIndexReceipt.failures.map((failure) => String(failure?.type || ""))
  : [];
const mongoFailureMessages = Array.isArray(mongoIndexReceipt?.failures)
  ? mongoIndexReceipt.failures.map((failure) => String(failure?.message || ""))
  : [];
const mongoUnauthorized = mongoFailureTypes.includes("OperationFailure")
  && mongoFailureMessages.some((message) => /not authorized|createIndexes/i.test(message));

const items = [
  {
    brd_id: 52,
    item: "Mongo indexes",
    state: mongoIndexReceipt?.status === "pass" ? "applied_and_receipt_backed"
      : mongoIndexReceipt?.status === "pass_dry_run" ? "script_ready_dry_run_verified"
        : mongoUnauthorized ? "mongo_user_not_authorized_for_createIndexes"
        : "not_verified",
    evidence: "output/swfipn-mongo-indexes-latest.json",
    finish_command: "SWFIPN_DB_INDEX_APPLY=1 MONGODB_URI='<write-uri>' npm run db:indexes",
    remaining_external_input: mongoIndexReceipt?.status === "pass" ? null
      : mongoUnauthorized ? "MongoDB user with createIndexes privilege on swfi database"
        : "write-capable MongoDB URI",
  },
  {
    brd_id: 21,
    item: "SendGrid email",
    state: sendgridReceipt?.status === "pass" ? "sendgrid_delivery_proven"
      : sendgridReceipt?.status === "blocked" ? "code_complete_target_runtime_missing_sendgrid_config"
        : "code_complete_env_gated_not_configured_here",
    evidence: "output/swfipn-sendgrid-email-brd-gate-latest.json; output/swfipn-phase2-runtime-preflight-latest.json",
    finish_command: "set SWFI2_SENDGRID_API_KEY + SWFI2_SENDGRID_FROM_EMAIL on target runtime, then npm run brd:sendgrid-email:gate:public",
    remaining_external_input: sendgridReceipt?.status === "pass" ? null
      : runtimePreflightReceipt?.summary?.blockers?.includes("only_non_swfi_sendgrid_candidate_found_do_not_claim_sendgrid")
        ? "SWFI-specific SendGrid API key and approved from address on target runtime"
        : "SendGrid API key and approved from address",
  },
  {
    brd_id: 7,
    item: "Search <300ms",
    state: searchPass ? "search_sla_proven"
      : autocompleteProven && !resultsPageProven ? "autocomplete_sla_proven_results_page_sla_failed"
        : "performance_gate_exists_but_sla_not_proven_currently",
    evidence: repeatedSearchReceipt
      ? "output/swfipn-search-gate-repeated-latest.json; output/swfipn-global-search-brd-gate-latest.json"
      : "output/swfipn-global-search-brd-gate-latest.json",
    latest_measurement: {
      autocomplete_ms: searchSummary.autocomplete_ms ?? null,
      autocomplete_target_ms: searchSummary.autocomplete_target_ms ?? null,
      results_page_ms: searchSummary.results_page_ms ?? null,
      results_target_ms: searchSummary.results_target_ms ?? null,
      max_search_api_duration_ms: searchApiDurationMs,
      failures: searchSummary.failures || [],
    },
    finish_command: "optimize search results route/API until npm run brd:search:gate:public passes; create Atlas Search index if API duration is the bottleneck",
    remaining_external_input: searchPass ? null
      : autocompleteProven && !resultsPageProven
        ? `full search results page under ${searchSummary.results_target_ms || 800}ms; latest ${searchSummary.results_page_ms || "unmeasured"}ms`
        : "current passing search SLA receipt",
  },
  {
    brd_id: 53,
    item: "Redis cache",
    state: redisReceipt?.status === "pass" ? "redis_runtime_proven"
      : redisReceipt?.status === "configured_pending_deploy" ? "redis_code_and_compose_configured_runtime_unproven"
        : "not_provisioned_not_wired_as_redis",
    evidence: "output/swfipn-redis-cache-gate-latest.json",
    finish_command: "provision Redis, add runtime env, wire KPI/search/aggregation cache, then run cache acceptance gate",
    remaining_external_input: redisReceipt?.status === "pass" ? null
      : redisReceipt?.status === "configured_pending_deploy"
        ? "deploy Redis-enabled compose release and prove runtime Redis PONG"
        : "Redis endpoint/credentials or approved managed Redis service",
  },
  {
    brd_id: 54,
    item: "CDN",
    state: cdnReceipt?.status === "pass" && npmHighClean && ciConfigured
      ? ciRemoteRunProven ? "cdn_zero_high_npm_and_ci_cd_proven" : "cdn_zero_high_npm_and_ci_cd_configured_remote_run_unproven"
      : cdnReceipt?.status === "pass" && npmHighClean
        ? "cdn_static_assets_and_zero_high_npm_proven_ci_cd_unproven"
      : "cloudflare_dns_tooling_exists_cdn_acceptance_not_proven",
    evidence: "output/swfipn-cdn-static-assets-gate-latest.json; output/npm-audit-high-latest.json; output/swfipn-ci-cd-gate-latest.json",
    finish_command: "push workflow or trigger workflow_dispatch, then attach current successful CI run receipt and rerun npm run brd:infra:blockers",
    remaining_external_input: cdnReceipt?.status === "pass" && npmHighClean && ciConfigured && !ciRemoteRunProven
      ? "current successful remote CI run receipt"
      : cdnReceipt?.status === "pass" && npmHighClean ? "CI/CD automated testing gate proof" : "Cloudflare/CDN proof and zero-high npm audit receipt",
  },
];

const openItems = items.filter((item) => item.remaining_external_input);
const receipt = {
  schema_version: "swfipn.brd_open_infra_blockers.v1",
  generated_at: new Date().toISOString(),
  status: openItems.length ? "open_external_inputs_required" : "pass",
  no_secret_values_written: true,
  summary: {
    total: items.length,
    open: openItems.length,
    closed: items.length - openItems.length,
  },
  items,
};

fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, summary: receipt.summary }, null, 2));
if (receipt.status !== "pass") process.exitCode = 2;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

function summarizeRepeatedSearch(summaries) {
  const maxNumber = (key) => Math.max(0, ...summaries.map((summary) => Number(summary?.[key] || 0)));
  const firstNumber = (key) => summaries.find((summary) => typeof summary?.[key] === "number")?.[key] ?? null;
  return {
    autocomplete_ms: maxNumber("autocomplete_ms"),
    autocomplete_target_ms: firstNumber("autocomplete_target_ms"),
    results_page_ms: maxNumber("results_page_ms"),
    results_target_ms: firstNumber("results_target_ms"),
    failures: summaries.flatMap((summary) => Array.isArray(summary?.failures) ? summary.failures : []),
    repeated_runs: summaries.length,
    repeated_passes: repeatedSearchReceipt?.passes ?? null,
    repeated_fails: repeatedSearchReceipt?.fails ?? null,
  };
}
