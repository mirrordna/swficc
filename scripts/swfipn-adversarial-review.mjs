#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-adversarial-review-latest.json");
const maxAgeHours = Number(process.env.SWFIPN_ADVERSARIAL_MAX_AGE_HOURS || 24);

const REQUIRED_RECEIPTS = {
  contract: "swfipn-brd-contract-truth-gate-latest.json",
  sourceDestinationManifest: "swfipn-source-destination-manifest-latest.json",
  mapping: "swfipn-full-universe-mapping-latest.json",
  detail: "swfipn-full-universe-map-gate-latest.json",
  detailBatch: "swfipn-detail-batch-parity-latest.json",
  fieldParity: "swfipn-record-field-parity-full-latest.json",
  routeParity: "swfipn-route-parity-full-latest.json",
  routeStatistical: "swfipn-route-parity-statistical-latest.json",
  visual: "swfipn-visual-gate-latest.json",
};

function readJson(file) {
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

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function addBlocker(blockers, id, evidence) {
  blockers.push({ id, ...evidence });
}

function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipts = Object.fromEntries(Object.entries(REQUIRED_RECEIPTS).map(([key, file]) => [key, readJson(file)]));
  const blockers = [];

  for (const [key, receipt] of Object.entries(receipts)) {
    if (key === "contract") continue;
    if (key === "detail" && receipts.detailBatch.exists) continue;
    if (!receipt.exists) addBlocker(blockers, `${key}_missing`, { receipt: receipt.file, error: receipt.error });
    else if (receipt.stale) addBlocker(blockers, `${key}_stale`, { receipt: receipt.file, age_hours: receipt.age_hours, max_age_hours: maxAgeHours });
  }

  const mappingTotal = number(receipts.mapping.body?.totals?.rows_seen);
  const manifestRows = number(receipts.sourceDestinationManifest.body?.totals?.rows);
  if (mappingTotal <= 0) addBlocker(blockers, "mapping_total_missing", { receipt: receipts.mapping.file });
  if (manifestRows !== mappingTotal) {
    addBlocker(blockers, "manifest_rows_do_not_match_mapping_total", {
      manifest_rows: manifestRows,
      mapping_total: mappingTotal,
      receipt: receipts.sourceDestinationManifest.file,
    });
  }

  if (receipts.detailBatch.exists) {
    const detailBatch = receipts.detailBatch.body || {};
    if (receipts.detailBatch.status !== "pass") addBlocker(blockers, "detail_batch_not_pass", { status: receipts.detailBatch.status, receipt: receipts.detailBatch.file });
    if (number(detailBatch.totals?.expected_rows) !== mappingTotal) addBlocker(blockers, "detail_batch_expected_not_mapping_total", { expected_rows: number(detailBatch.totals?.expected_rows), mapping_total: mappingTotal, receipt: receipts.detailBatch.file });
    if (number(detailBatch.totals?.checked) !== mappingTotal) addBlocker(blockers, "detail_batch_not_exhaustive", { checked: number(detailBatch.totals?.checked), mapping_total: mappingTotal, receipt: receipts.detailBatch.file });
    if (number(detailBatch.totals?.failed) !== 0) addBlocker(blockers, "detail_batch_failed_records", { failed: number(detailBatch.totals?.failed), receipt: receipts.detailBatch.file });
  } else {
    const detailCollections = receipts.detail.body?.collections || {};
    const detailRendered = Object.values(detailCollections).reduce((sum, item) => sum + number(item.rendered), 0);
    const detailFailed = Object.values(detailCollections).reduce((sum, item) => sum + number(item.failed), 0);
    if (receipts.detail.status !== "pass") addBlocker(blockers, "detail_rendering_not_full_pass", { status: receipts.detail.status, receipt: receipts.detail.file });
    if (detailRendered !== mappingTotal) addBlocker(blockers, "detail_rendering_not_exhaustive", { rendered: detailRendered, mapping_total: mappingTotal, receipt: receipts.detail.file });
    if (detailFailed !== 0) addBlocker(blockers, "detail_rendering_failed_records", { failed: detailFailed, receipt: receipts.detail.file });
  }

  const field = receipts.fieldParity.body || {};
  if (receipts.fieldParity.status !== "pass") addBlocker(blockers, "field_parity_not_full_pass", { status: receipts.fieldParity.status, receipt: receipts.fieldParity.file });
  if (field.partial_run === true) addBlocker(blockers, "field_parity_is_partial", { partial_reason: field.partial_reason || "unknown", receipt: receipts.fieldParity.file });
  if (number(field.totals?.checked) !== number(field.totals?.count)) {
    addBlocker(blockers, "field_parity_not_exhaustive", {
      checked: number(field.totals?.checked),
      count: number(field.totals?.count),
      receipt: receipts.fieldParity.file,
    });
  }
  if (number(field.totals?.failed) !== 0) addBlocker(blockers, "field_parity_failed_records", { failed: number(field.totals?.failed), receipt: receipts.fieldParity.file });
  const fieldCollections = field.collections || {};
  const mappingFamilies = Object.fromEntries((receipts.mapping.body?.families || []).map((family) => [family.id, family]));
  for (const id of ["entities", "people", "transactions", "compass"]) {
    const fieldCount = number(fieldCollections[id]?.count);
    const mappingCount = number(mappingFamilies[id]?.rows_seen || mappingFamilies[id]?.source_total);
    if (fieldCount && mappingCount && fieldCount !== mappingCount) {
      addBlocker(blockers, "field_parity_mapping_count_drift", {
        collection: id,
        field_count: fieldCount,
        mapping_count: mappingCount,
        field_receipt: receipts.fieldParity.file,
        mapping_receipt: receipts.mapping.file,
      });
    }
  }

  const routeTested = number(receipts.routeParity.body?.summary?.links_tested);
  const routeExpected = number(receipts.routeParity.body?.summary?.expected_links_to_test);
  if (receipts.routeParity.status !== "pass") addBlocker(blockers, "route_parity_not_pass", { status: receipts.routeParity.status, receipt: receipts.routeParity.file });
  if (routeExpected <= 0) addBlocker(blockers, "browser_route_parity_expected_count_missing", { links_tested: routeTested, expected_links_to_test: routeExpected, receipt: receipts.routeParity.file });
  if (routeTested !== routeExpected) addBlocker(blockers, "browser_visible_route_parity_not_exhaustive", { links_tested: routeTested, expected_links_to_test: routeExpected, receipt: receipts.routeParity.file });
  if (receipts.routeStatistical.status !== "pass") addBlocker(blockers, "route_statistical_not_pass", { status: receipts.routeStatistical.status, receipt: receipts.routeStatistical.file });

  const visual = receipts.visual.body || {};
  if (receipts.visual.status !== "pass") addBlocker(blockers, "visual_baseline_not_pass", { status: receipts.visual.status, receipt: receipts.visual.file });
  if (!(visual.visual_baseline === true || visual.baseline === true || visual.baseline_mode === true)) {
    addBlocker(blockers, "visual_receipt_is_not_baseline", { receipt: receipts.visual.file });
  }

  const contract = receipts.contract.body || {};
  if (contract.status === "pass" && blockers.length) {
    addBlocker(blockers, "contract_pass_contradicted_by_adversarial_blockers", { receipt: receipts.contract.file });
  }

  const receipt = {
    schema_version: "swfipn.adversarial_review.v1",
    generated_at: new Date().toISOString(),
    status: blockers.length ? "fail" : "pass",
    verdict: blockers.length ? "reject" : "accept",
    max_age_hours: maxAgeHours,
    reviewed_receipts: Object.fromEntries(Object.entries(receipts).map(([key, receipt]) => [key, {
      file: receipt.file,
      exists: receipt.exists,
      status: receipt.status,
      generated_at: receipt.generated_at || null,
      age_hours: receipt.age_hours,
      stale: receipt.stale,
    }])),
    scope: {
      target: process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/",
      mapping_total: mappingTotal,
      rule: "Fresh-context adversarial review must try to disprove full universe parity before acceptance.",
    },
    blockers,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    verdict: receipt.verdict,
    blockers: blockers.map((blocker) => blocker.id),
    receipt: receiptPath,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

main();
