#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-brd-contract-truth-gate-latest.json");
const maxAgeHours = Number(process.env.SWFIPN_CONTRACT_MAX_AGE_HOURS || 24);

const contractFloor = [
  "NEVER_EVER_LIE",
  "VOLUNTEER_BAD_NEWS",
  "NO_ASSUMPTIONS",
  "NO_GUESSING",
  "source-backed",
  "NO_HARDCODING",
];

const receiptSpecs = {
  sourceDestinationManifest: "swfipn-source-destination-manifest-latest.json",
  mapping: "swfipn-full-universe-mapping-latest.json",
  exhaustiveDetail: "swfipn-full-universe-map-gate-latest.json",
  detailBatch: "swfipn-detail-batch-parity-latest.json",
  recordParityFull: "swfipn-record-field-parity-full-latest.json",
  recordParity: "swfipn-record-level-parity-gate-latest.json",
  routeParity: "swfipn-route-parity-full-latest.json",
  routeParityStatistical: "swfipn-route-parity-statistical-latest.json",
  visual: "swfipn-visual-gate-latest.json",
  adversarial: "swfipn-adversarial-review-latest.json",
};

function readReceipt(file) {
  const fullPath = path.join(outputDir, file);
  try {
    const body = JSON.parse(fs.readFileSync(fullPath, "utf8"));
    const generatedAt = body.generated_at || body.completed_at || "";
    const ageHours = generatedAt ? (Date.now() - Date.parse(generatedAt)) / 36e5 : Infinity;
    return {
      file: `output/${file}`,
      exists: true,
      body,
      status: String(body.status || body.final_verdict || "").toLowerCase(),
      generated_at: generatedAt,
      age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
      stale: !Number.isFinite(ageHours) || ageHours > maxAgeHours,
    };
  } catch (error) {
    return {
      file: `output/${file}`,
      exists: false,
      status: "missing",
      error: error.message,
      stale: true,
    };
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function passFail(id, label, checks, evidence) {
  const failures = checks.filter((check) => !check.ok).map((check) => check.failure);
  return {
    id,
    label,
    status: failures.length ? "UNPROVEN" : "PASS",
    evidence,
    failures,
  };
}

function mappingLayer(receipt) {
  const body = receipt.body || {};
  const totals = body.totals || {};
  const families = asArray(body.families);
  return passFail("mapping_coverage", "Full source universe mapping coverage", [
    { ok: receipt.exists, failure: "mapping_receipt_missing" },
    { ok: receipt.status === "pass", failure: `mapping_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `mapping_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: body.scope === "phase1_public_dashboard_swfi_auth_handoff", failure: `mapping_scope_unexpected_${body.scope || "missing"}` },
    { ok: number(totals.rows_failed) === 0, failure: `mapping_rows_failed_${number(totals.rows_failed)}` },
    { ok: number(totals.rows_seen) > 0 && number(totals.rows_seen) === number(totals.rows_passed), failure: `mapping_rows_seen_${number(totals.rows_seen)}_rows_passed_${number(totals.rows_passed)}` },
    { ok: families.every((family) => family.partial_run === false), failure: "mapping_contains_partial_family_run" },
    { ok: families.every((family) => number(family.shard?.count || 1) === 1), failure: "mapping_contains_sharded_partial_family_run" },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
    scope: body.scope || "",
    totals,
  });
}

function sourceDestinationManifestLayer(receipt, mappingReceipt) {
  const body = receipt.body || {};
  const totals = body.totals || {};
  const mappingTotal = number(mappingReceipt.body?.totals?.rows_seen);
  return passFail("source_destination_manifest", "Source/destination manifest covers every mapped source record", [
    { ok: receipt.exists, failure: "source_destination_manifest_receipt_missing" },
    { ok: receipt.status === "pass", failure: `source_destination_manifest_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `source_destination_manifest_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: mappingTotal > 0, failure: "mapping_total_missing_for_manifest_comparison" },
    { ok: number(totals.rows) === mappingTotal, failure: `manifest_rows_${number(totals.rows)}_ne_mapping_total_${mappingTotal}` },
    { ok: number(totals.failed) === 0, failure: `manifest_failed_${number(totals.failed)}` },
    { ok: number(totals.missing_destination) === 0, failure: `manifest_missing_destination_${number(totals.missing_destination)}` },
    { ok: body.claim?.parity === "UNPROVEN", failure: "manifest_must_not_claim_full_parity" },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
    manifest: body.source_manifest || "",
    manifest_sha256: body.source_manifest_sha256 || "",
    mapping_total: mappingTotal,
    totals,
    claim: body.claim || null,
  });
}

function exhaustiveDetailLayer(receipt, batchReceipt, mappingReceipt) {
  if (batchReceipt.exists) {
    const body = batchReceipt.body || {};
    const mappingTotal = number(mappingReceipt.body?.totals?.rows_seen);
    return passFail("exhaustive_record_detail_rendering", "Every mapped record detail/API route renders", [
      { ok: batchReceipt.exists, failure: "detail_batch_receipt_missing" },
      { ok: batchReceipt.status === "pass", failure: `detail_batch_status_${batchReceipt.status || "missing"}` },
      { ok: !batchReceipt.stale, failure: `detail_batch_receipt_stale_${batchReceipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
      { ok: mappingTotal > 0, failure: "mapping_total_missing_for_detail_batch_comparison" },
      { ok: number(body.totals?.expected_rows) === mappingTotal, failure: `detail_batch_expected_${number(body.totals?.expected_rows)}_ne_mapping_total_${mappingTotal}` },
      { ok: number(body.totals?.checked) === mappingTotal, failure: `detail_batch_checked_${number(body.totals?.checked)}_ne_mapping_total_${mappingTotal}` },
      { ok: number(body.totals?.failed) === 0, failure: `detail_batch_failed_${number(body.totals?.failed)}` },
      { ok: body.verification_mode === "frozen_manifest_to_backend_detail_batch", failure: `detail_batch_verification_mode_${body.verification_mode || "missing"}` },
    ], {
      receipt: batchReceipt.file,
      generated_at: batchReceipt.generated_at,
      mapping_total: mappingTotal,
      totals: body.totals || null,
      collections: body.collections || null,
      verification_mode: body.verification_mode || "",
    });
  }
  const body = receipt.body || {};
  const collections = body.collections || {};
  const mappingTotal = number(mappingReceipt.body?.totals?.rows_seen);
  const renderedTotal = Object.values(collections).reduce((sum, item) => sum + number(item.rendered), 0);
  const failedTotal = Object.values(collections).reduce((sum, item) => sum + number(item.failed), 0);
  return passFail("exhaustive_record_detail_rendering", "Every mapped record detail/API route renders", [
    { ok: receipt.exists, failure: "exhaustive_detail_receipt_missing" },
    { ok: receipt.status === "pass", failure: `exhaustive_detail_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `exhaustive_detail_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: mappingTotal > 0, failure: "mapping_total_missing_for_detail_comparison" },
    { ok: renderedTotal === mappingTotal, failure: `rendered_${renderedTotal}_ne_mapping_total_${mappingTotal}` },
    { ok: failedTotal === 0, failure: `detail_failed_${failedTotal}` },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
    mapping_total: mappingTotal,
    rendered_total: renderedTotal,
    failed_total: failedTotal,
    collections,
  });
}

function recordParityLayer(fullReceipt, sampledReceipt) {
  const receipt = fullReceipt.exists ? fullReceipt : sampledReceipt;
  const body = receipt.body || {};
  if (fullReceipt.exists) {
    const collections = Object.entries(body.collections || {});
    const incomplete = collections.filter(([, result]) => number(result.checked) !== number(result.count));
    const failed = number(body.totals?.failed);
    return passFail("field_data_parity", "Every source record required field matches mirror/backend value", [
      { ok: receipt.exists, failure: "record_field_parity_full_receipt_missing" },
      { ok: receipt.status === "pass", failure: `record_field_parity_full_status_${receipt.status || "missing"}` },
      { ok: !receipt.stale, failure: `record_field_parity_full_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
      { ok: body.partial_run !== true, failure: `record_field_parity_full_is_partial:${body.partial_reason || "unknown"}` },
      { ok: number(body.totals?.count) > 0, failure: "record_field_parity_full_total_missing" },
      { ok: number(body.totals?.checked) === number(body.totals?.count), failure: `record_field_parity_full_checked_${number(body.totals?.checked)}_ne_count_${number(body.totals?.count)}` },
      { ok: incomplete.length === 0, failure: `record_field_parity_full_incomplete:${incomplete.map(([name, result]) => `${name}:${number(result.checked)}/${number(result.count)}`).join(",")}` },
      { ok: failed === 0, failure: `record_field_parity_full_failed_${failed}` },
    ], {
      receipt: receipt.file,
      generated_at: receipt.generated_at,
      full_receipt: true,
      totals: body.totals || null,
      collections: Object.fromEntries(collections.map(([name, result]) => [name, {
        count: number(result.count),
        checked: number(result.checked),
        matched: number(result.matched),
        mismatched: number(result.mismatched),
        missing_source_record: number(result.missing_source_record),
        blocked: number(result.blocked),
      }])),
    });
  }
  const bodySampled = sampledReceipt.body || {};
  const results = bodySampled.collection_results || {};
  const collections = Object.entries(results);
  const sampledCollections = collections.filter(([, result]) => number(result.records?.length) < number(result.count));
  const fieldFailures = collections.reduce((sum, [, result]) => sum + number(result.field_failures), 0);
  return passFail("field_data_parity", "Every source record required field matches mirror/backend value", [
    { ok: receipt.exists, failure: "record_parity_receipt_missing" },
    { ok: receipt.status === "pass", failure: `record_parity_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `record_parity_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: collections.length > 0, failure: "record_parity_no_collection_results" },
    { ok: sampledCollections.length === 0, failure: `record_parity_is_sampled:${sampledCollections.map(([name, result]) => `${name}:${number(result.records?.length)}/${number(result.count)}`).join(",")}` },
    { ok: fieldFailures === 0, failure: `record_parity_field_failures_${fieldFailures}` },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
    sample_limit: bodySampled.sample_limit,
    collections: Object.fromEntries(collections.map(([name, result]) => [name, {
      count: number(result.count),
      checked: number(result.records?.length),
      field_failures: number(result.field_failures),
      blocked: number(result.blocked),
    }])),
  });
}

function browserRouteLayer(fullRouteReceipt, statisticalReceipt, mappingReceipt) {
  const full = fullRouteReceipt.body || {};
  const stat = statisticalReceipt.body || {};
  const mappingTotal = number(mappingReceipt.body?.totals?.rows_seen);
  const tested = number(full.summary?.links_tested);
  const expected = number(full.summary?.expected_links_to_test);
  return passFail("browser_route_parity", "Browser route/link parity for every visible dashboard link, backed by full-universe manifest/detail parity", [
    { ok: fullRouteReceipt.exists, failure: "route_parity_full_receipt_missing" },
    { ok: fullRouteReceipt.status === "pass", failure: `route_parity_full_status_${fullRouteReceipt.status || "missing"}` },
    { ok: !fullRouteReceipt.stale, failure: `route_parity_full_receipt_stale_${fullRouteReceipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: statisticalReceipt.exists, failure: "route_parity_statistical_receipt_missing" },
    { ok: statisticalReceipt.status === "pass", failure: `route_parity_statistical_status_${statisticalReceipt.status || "missing"}` },
    { ok: !statisticalReceipt.stale, failure: `route_parity_statistical_receipt_stale_${statisticalReceipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: mappingTotal > 0, failure: "mapping_total_missing_for_route_comparison" },
    { ok: expected > 0, failure: `browser_visible_route_expected_missing:${expected}` },
    { ok: tested === expected, failure: `browser_visible_route_tested_${tested}_ne_expected_${expected}` },
  ], {
    full_receipt: fullRouteReceipt.file,
    statistical_receipt: statisticalReceipt.file,
    full_summary: full.summary || null,
    statistical_summary: stat.summary || null,
    mapping_total: mappingTotal,
  });
}

function visualLayer(receipt) {
  const body = receipt.body || {};
  return passFail("visual_baseline", "Visual baseline has current PASS receipt", [
    { ok: receipt.exists, failure: "visual_receipt_missing" },
    { ok: receipt.status === "pass", failure: `visual_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `visual_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
    { ok: body.baseline === true || body.baseline_mode === true || body.visual_baseline === true, failure: "visual_gate_is_not_a_baseline_receipt" },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
    summary: body.summary || null,
  });
}

function adversarialLayer(receipt) {
  return passFail("adversarial_review", "Fresh adversarial review receipt", [
    { ok: receipt.exists, failure: "adversarial_review_receipt_missing" },
    { ok: receipt.status === "pass", failure: `adversarial_review_status_${receipt.status || "missing"}` },
    { ok: !receipt.stale, failure: `adversarial_review_receipt_stale_${receipt.age_hours ?? "unknown"}h_gt_${maxAgeHours}h` },
  ], {
    receipt: receipt.file,
    generated_at: receipt.generated_at,
  });
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipts = Object.fromEntries(Object.entries(receiptSpecs).map(([key, file]) => [key, readReceipt(file)]));
  const layers = [
    sourceDestinationManifestLayer(receipts.sourceDestinationManifest, receipts.mapping),
    mappingLayer(receipts.mapping),
    exhaustiveDetailLayer(receipts.exhaustiveDetail, receipts.detailBatch, receipts.mapping),
    recordParityLayer(receipts.recordParityFull, receipts.recordParity),
    browserRouteLayer(receipts.routeParity, receipts.routeParityStatistical, receipts.mapping),
    visualLayer(receipts.visual),
    adversarialLayer(receipts.adversarial),
  ];
  const unproven = layers.filter((layer) => layer.status !== "PASS");
  const receipt = {
    schema_version: "swfipn.brd_contract_truth_gate.v1",
    generated_at: new Date().toISOString(),
    status: unproven.length ? "fail" : "pass",
    full_universe_parity_status: unproven.length ? "UNPROVEN" : "PASS",
    contract: {
      frozen_spec: "BRD v1.3 + Feedback 2026-06-27 -> docs/ACCEPTANCE_CONTRACT.md",
      floor: contractFloor,
      no_assumptions: true,
      no_guessing: true,
      no_hardcoding: true,
    },
    max_age_hours: maxAgeHours,
    summary: {
      layers: layers.length,
      pass: layers.filter((layer) => layer.status === "PASS").length,
      unproven: unproven.length,
    },
    layers,
    bad_news_first: unproven.map((layer) => ({ id: layer.id, failures: layer.failures })),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    full_universe_parity_status: receipt.full_universe_parity_status,
    summary: receipt.summary,
    receipt: receiptPath,
    bad_news_first: receipt.bad_news_first,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main();
