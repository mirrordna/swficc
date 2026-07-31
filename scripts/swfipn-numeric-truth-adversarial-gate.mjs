#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const output = path.join(root, "output");
const receiptPath = path.join(output, "swfipn-numeric-truth-adversarial-latest.json");
const origin = String(process.env.SWFIPN_BACKEND_ORIGIN || "https://dashboard.swfi.com").replace(/\/+$/, "");
const parityPath = path.resolve(process.env.SWFIPN_NUMERIC_PARITY_RECEIPT || path.join(output, "swfipn-record-level-parity-gate-latest.json"));

const clean = (value) => String(value ?? "").trim();
const finite = (value) => Number.isFinite(Number(value)) ? Number(value) : null;
const packetRows = (packet) => Array.isArray(packet?.data?.rows)
  ? packet.data.rows
  : Array.isArray(packet?.data?.results) ? packet.data.results : [];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function audit(packet) {
  const allRows = packetRows(packet);
  const disclosed = allRows.filter((row) => (finite(row.aum_usd) || 0) > 0);
  const declaredTotal = finite(packet?.data?.total_assets_usd);
  const calculatedTotal = disclosed.reduce((sum, row) => sum + finite(row.aum_usd), 0);
  const urls = disclosed.map((row) => clean(row.source_url)).filter(Boolean);
  const duplicates = [...new Set(urls.filter((url, index) => urls.indexOf(url) !== index))];
  const missing = {
    source_url: disclosed.filter((row) => !clean(row.source_url)).map((row) => clean(row.name)),
    currency: disclosed.filter((row) => !clean(row.aum_currency)).map((row) => clean(row.name)),
    as_of_date: disclosed.filter((row) => !clean(row.aum_date || row.as_of_date)).map((row) => clean(row.name)),
    usd_basis: disclosed.filter((row) => !clean(row.aum_usd_basis)).map((row) => clean(row.name)),
    usd_source: disclosed.filter((row) => !clean(row.aum_usd_source)).map((row) => clean(row.name)),
  };
  const inversions = disclosed.flatMap((row, index) => {
    if (!index) return [];
    const previous = disclosed[index - 1];
    return finite(previous.aum_usd) < finite(row.aum_usd)
      ? [{ before: clean(previous.name), after: clean(row.name) }]
      : [];
  });
  const conflicts = disclosed
    .filter((row) => clean(row.aum_history_conflict))
    .map((row) => ({ name: clean(row.name), marker: clean(row.aum_history_conflict) }));
  const totalMatches = declaredTotal !== null && Math.abs(declaredTotal - calculatedTotal) < 0.01;
  const contractFailures = [
    !allRows.length ? "rows_missing" : "",
    !totalMatches ? "declared_total_mismatch" : "",
    duplicates.length ? "duplicate_source_record" : "",
    inversions.length ? "rank_order_inversion" : "",
    missing.source_url.length ? "source_url_missing" : "",
    missing.currency.length ? "currency_missing" : "",
    missing.usd_basis.length ? "usd_basis_missing" : "",
    missing.usd_source.length ? "usd_source_missing" : "",
  ].filter(Boolean);
  const evidenceWarnings = [
    missing.as_of_date.length ? "aum_as_of_date_missing" : "",
    conflicts.length ? "aum_history_conflict_present" : "",
  ].filter(Boolean);
  return {
    rows: allRows.length,
    disclosed_rows: disclosed.length,
    undisclosed_rows: allRows.length - disclosed.length,
    declared_total_usd: declaredTotal,
    calculated_total_usd: calculatedTotal,
    total_matches: totalMatches,
    missing,
    duplicate_source_urls: duplicates,
    rank_inversions: inversions,
    conflicts,
    contract_failures: contractFailures,
    evidence_warnings: evidenceWarnings,
  };
}

function mutation(id, source, alter, expected) {
  const packet = structuredClone(source);
  alter(packet);
  const result = audit(packet);
  return {
    id,
    pass: result.contract_failures.includes(expected) || result.evidence_warnings.includes(expected),
    expected_failure: expected,
    observed: [...result.contract_failures, ...result.evidence_warnings],
  };
}

function mongoParity() {
  if (!fs.existsSync(parityPath)) return { status: "UNPROVEN", reason: "parity_receipt_missing", path: parityPath };
  try {
    const receipt = JSON.parse(fs.readFileSync(parityPath, "utf8"));
    const generated = Date.parse(clean(receipt.generated_at));
    const age = Number.isFinite(generated) ? Date.now() - generated : Number.POSITIVE_INFINITY;
    if (receipt.status !== "pass") return { status: "UNPROVEN", reason: `parity_status_${clean(receipt.status) || "missing"}`, path: parityPath };
    if (age > 6 * 60 * 60 * 1000) return { status: "UNPROVEN", reason: "parity_receipt_stale", age_ms: age, path: parityPath };
    if (!/Mongo parity/i.test(clean(receipt.scope))) return { status: "UNPROVEN", reason: "parity_scope_mismatch", path: parityPath };
    return { status: "PASS", generated_at: receipt.generated_at, age_ms: age, path: parityPath };
  } catch (error) {
    return { status: "UNPROVEN", reason: "parity_receipt_invalid", error: error.message, path: parityPath };
  }
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const response = await fetch(`${origin}/v1/swfi/top20?limit=200`, {
    headers: { accept: "application/json", "user-agent": "swfipn-numeric-truth-adversarial-gate/1.0" },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`top20_http_${response.status}`);
  const raw = await response.text();
  const packet = JSON.parse(raw);
  const baseline = audit(packet);
  const probes = [
    mutation("changed_value_without_total_update", packet, (p) => { p.data.rows[0].aum_usd += 1; }, "declared_total_mismatch"),
    mutation("duplicate_source_record", packet, (p) => { p.data.rows[1].source_url = p.data.rows[0].source_url; }, "duplicate_source_record"),
    mutation("rank_inversion", packet, (p) => { p.data.rows[1].aum_usd = p.data.rows[0].aum_usd + 1; }, "rank_order_inversion"),
    mutation("currency_removed", packet, (p) => { p.data.rows[0].aum_currency = ""; }, "currency_missing"),
    mutation("fresh_packet_with_undated_fact", packet, (p) => {
      p.generated_at = new Date().toISOString();
      p.data.rows[0].aum_date = "";
    }, "aum_as_of_date_missing"),
    mutation("usd_lineage_removed", packet, (p) => { p.data.rows[0].aum_usd_source = ""; }, "usd_source_missing"),
  ];
  const parity = mongoParity();
  const mutationPass = probes.every((probe) => probe.pass);
  const complete = !baseline.contract_failures.length
    && !baseline.evidence_warnings.length
    && parity.status === "PASS";
  const status = !mutationPass || baseline.contract_failures.length ? "fail" : complete ? "pass" : "watch";
  const receipt = {
    schema_version: "swfipn.numeric_truth_adversarial.v1",
    generated_at: new Date().toISOString(),
    status,
    source_truth_verdict: complete ? "MATCH" : baseline.contract_failures.length ? "MISMATCH" : "UNPROVEN",
    promotion_eligible: complete,
    checked_scope: [
      "top20_response_arithmetic",
      "top20_rank_order",
      "top20_currency_and_lineage_presence",
      "top20_temporal_coverage",
      "in_memory_adversarial_mutation_detection",
    ],
    unchecked_scope: parity.status === "PASS" ? [] : ["fresh_direct_API_to_Mongo_record_parity"],
    origin,
    response_sha256: sha256(raw),
    baseline,
    mongo_parity: parity,
    mutations: probes,
    bad_news: [
      ...baseline.contract_failures,
      ...baseline.evidence_warnings,
      ...(parity.status === "PASS" ? [] : [parity.reason]),
    ],
    claim_boundary: "Arithmetic and lineage checks do not establish Mongo parity. Packet generated_at is transport freshness and never substitutes for a missing AUM as-of date.",
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status,
    source_truth_verdict: receipt.source_truth_verdict,
    promotion_eligible: receipt.promotion_eligible,
    receipt: receiptPath,
    contract_failures: baseline.contract_failures,
    evidence_warnings: baseline.evidence_warnings,
    mongo_parity: parity,
    mutation_pass: mutationPass,
  }, null, 2));
  if (status === "fail") process.exitCode = 1;
}

main().catch((error) => {
  fs.mkdirSync(output, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    schema_version: "swfipn.numeric_truth_adversarial.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    source_truth_verdict: "UNPROVEN",
    error: error.message,
  }, null, 2)}\n`);
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
