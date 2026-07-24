#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { createJiti } from "jiti";

const { strategyEngineAnalysis, STRATEGY_ENGINE_VERSION } = await createJiti(import.meta.url, { tsconfigPaths: true })
  .import("../src/lib/strategyEngine.ts");

const peer = (id, name, strategy, allocations) => ({
  entity_id: id,
  name,
  type: "Sovereign Wealth Fund",
  source_url: `https://www.swfi.com/v1/entities/${id}`,
  modules: { strategy: { fields: { Strategy: strategy, ...allocations } } },
});
const packet = (data) => ({ status: "ok", fact: true, data });
const activity = (regions) => packet({ rows: regions.map((region, index) => ({ id: `${region}-${index}`, region })) });

const anchor = peer("598cdaa60124e9fd2d05b9af", "Anchor Fund", "Diversified long-horizon strategy", {
  "Public Equity": "40%",
  Infrastructure: "10%",
});
const peerA = peer("598cdaa60124e9fd2d05bd9b", "Peer A", "Global multi-asset strategy", {
  "Public Equity": "30%",
  Infrastructure: "20%",
  "Private Credit": "8%",
});
const peerB = peer("598cdaa50124e9fd2d05ac89", "Peer B", "Long-term real asset strategy", {
  "Public Equity": "20%",
  Infrastructure: "25%",
  "Private Credit": "12%",
});

const totals = {
  [anchor.entity_id]: packet({ total_transactions: 10 }),
  [peerA.entity_id]: packet({ total_transactions: 20 }),
  [peerB.entity_id]: packet({ total_transactions: 30 }),
};
const activities = {
  [anchor.entity_id]: activity(["North America"]),
  [peerA.entity_id]: activity(["Europe", "North America"]),
  [peerB.entity_id]: activity(["Europe"]),
};

const result = strategyEngineAnalysis([anchor, peerA, peerB], totals, activities);
const failures = [];
const check = (id, pass, evidence) => {
  if (!pass) failures.push({ id, evidence });
};

check("version", result.version === STRATEGY_ENGINE_VERSION, result.version);
check("anchor_and_peers", result.anchor === "Anchor Fund" && result.peerCount === 2, JSON.stringify(result));
check("allocation_position", result.signals.some((signal) => signal.id === "allocation-public-equity" && signal.detail.includes("40%") && signal.detail.includes("25%")), JSON.stringify(result.signals));
check("allocation_gap", result.signals.some((signal) => signal.id === "allocation-coverage-private-credit" && signal.state === "coverage-gap"), JSON.stringify(result.signals));
check("transaction_position", result.signals.some((signal) => signal.id === "transaction-activity-position" && signal.detail.includes("10") && signal.detail.includes("25")), JSON.stringify(result.signals));
check("regional_sample_boundary", result.signals.some((signal) => signal.id === "regional-sample-europe" && signal.detail.includes("not proof")), JSON.stringify(result.signals));
check("source_links", result.signals.every((signal) => signal.evidence.length > 0 && signal.evidence.every((item) => item.url.startsWith("https://www.swfi.com/v1/entities/"))), JSON.stringify(result.signals));
check("no_advice_claim", result.limitations.some((value) => value.includes("not investment advice")), JSON.stringify(result.limitations));
check("strategy_dimensions", result.dimensions.length === 9 && result.dimensions.some((item) => item.id === "decision-constraints" && item.state === "blocked") && result.dimensions.some((item) => item.id === "opportunity-fit" && item.state === "blocked"), JSON.stringify(result.dimensions));
check("research_actions", result.researchActions.some((item) => item.id === "capture-decision-constraints") && result.researchActions.some((item) => item.id === "join-exposure-contracts"), JSON.stringify(result.researchActions));

mkdirSync("output", { recursive: true });
const receipt = {
  schema_version: "swfipn.strategy_engine_test.v1",
  generated_at: new Date().toISOString(),
  pass: failures.length === 0,
  checks: 10,
  failures,
};
writeFileSync("output/swfipn-strategy-engine-test-latest.json", `${JSON.stringify(receipt, null, 2)}\n`);
console.log(JSON.stringify(receipt));
if (!receipt.pass) process.exitCode = 1;
