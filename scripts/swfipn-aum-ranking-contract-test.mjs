#!/usr/bin/env node
import assert from "node:assert/strict";
import { inspectAumRankingPacket } from "../src/lib/aumRankingContract.ts";

function row({
  rank,
  id,
  name,
  aum,
  currency,
  aumUsd,
  source,
}) {
  return {
    rank,
    entity_id: id,
    name,
    type: "Sovereign Wealth Fund",
    country: "Test country",
    defunct: false,
    entity_status: "active",
    aum,
    aum_currency: currency,
    aum_usd: aumUsd,
    aum_source: source,
    aum_date: source === "entitiesAUM" ? "2026-03-31" : "",
    source_url: `https://www.swfi.com/v1/entities/${id}`,
  };
}

const validPacket = {
  status: "ok",
  fact: true,
  data: {
    include_defunct: false,
    entity_status_scope: "active_only",
    count_basis: "ranked_entity_status_scope",
    aum_history_status: "available",
    total: 2,
    returned: 2,
    source_total_count: 2,
    active_count: 2,
    defunct_count: 0,
    total_assets_usd: 2000,
    total_assets_usd_currency: "USD",
    rows: [
      row({
        rank: 1,
        id: "1".repeat(24),
        name: "Verified USD Master",
        aum: 2500,
        currency: "NOK",
        aumUsd: 2000,
        source: "entitiesAUM",
      }),
      row({
        rank: 2,
        id: "2".repeat(24),
        name: "Native Only",
        aum: 3000,
        currency: "NOK",
        aumUsd: null,
        source: "entitiesAUM",
      }),
    ],
  },
};
validPacket.data.rows[0].aum_usd_source = "entities.assets";

const validResult = inspectAumRankingPacket(validPacket, 25);
assert.equal(validResult.state, "ready");
assert.deepEqual(validResult.issues, []);
assert.equal(validResult.rows.length, 2);

const unprovenFxPacket = structuredClone(validPacket);
delete unprovenFxPacket.data.rows[0].aum_usd_source;
const unprovenFxResult = inspectAumRankingPacket(unprovenFxPacket, 25);
assert.equal(unprovenFxResult.state, "invalid");
assert.ok(unprovenFxResult.issues.includes("fx_provenance_1"));
assert.equal(unprovenFxResult.rows.length, 0);

const missingLifecyclePacket = structuredClone(validPacket);
missingLifecyclePacket.data.total = null;
const missingLifecycleResult = inspectAumRankingPacket(missingLifecyclePacket, 25);
assert.equal(missingLifecycleResult.state, "invalid");
assert.ok(missingLifecycleResult.issues.includes("lifecycle_counts_missing"));

const undatedHistoryPacket = structuredClone(validPacket);
undatedHistoryPacket.data.rows[0].aum_date = "";
const undatedHistoryResult = inspectAumRankingPacket(undatedHistoryPacket, 25);
assert.equal(undatedHistoryResult.state, "invalid");
assert.ok(undatedHistoryResult.issues.includes("aum_date_1"));

console.log(JSON.stringify({
  pass: true,
  evidence_class: "NOT_ACCEPTANCE",
  reason: "Pure contract-unit coverage; candidate API and browser evidence remain required.",
  checks: {
    comparable_usd_then_native_tail: "PASS",
    unproven_cross_currency_conversion: "REJECTED",
    null_lifecycle_count: "REJECTED",
    undated_native_history: "REJECTED",
  },
}, null, 2));
