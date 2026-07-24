#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-ml-loop-registry-latest.json");
const reportPath = path.join(outputDir, "swfipn-ml-loop-registry-latest.md");
const generatedAt = new Date().toISOString();
const mode = process.env.SWFIPN_ML_LOOP_MODE || "gate";
const level = process.env.SWFIPN_ML_LOOP_LEVEL || "smoke";
const freshnessMs = Number(process.env.SWFIPN_ML_LOOP_FRESHNESS_MS || 24 * 60 * 60 * 1000);

const receipts = {
  sourceTruth: "output/swfipn-source-truth-gate-latest.json",
  doctrine: "output/swfipn-doctrine-gate-latest.json",
  visual: "output/swfipn-visual-gate-latest.json",
  e2e: "output/swfipn-e2e-gate-latest.json",
  controls: "output/swfipn-table-controls-proof-latest.json",
  recordMirror: "output/swfipn-record-mirror-gate-latest.json",
  proofCrawl: "output/swfipn-public-proof-crawl-latest.json",
  sitemapDataMap: "output/swfipn-sitemap-data-map-latest.json",
  productTruth: "output/swfipn-product-truth-audit-latest.json",
  mirrorgraph: "output/swfipn-mirrorgraph-gate-latest.json",
};

const loops = [
  {
    id: "failure_classifier",
    family: "supervised_classifier",
    purpose: "Classify failing receipts into data, route, visual, runtime, source, auth, or controls slices.",
    signals: ["productTruth", "sourceTruth", "visual", "e2e", "controls"],
    gate: "No broad fix is allowed; first failure class must produce one patch slice.",
  },
  {
    id: "route_risk_ranker",
    level: "full",
    family: "ranking_model",
    purpose: "Rank routes by buyer risk using failures, edge count, forms, source links, and detail coverage.",
    signals: ["proofCrawl", "e2e", "sitemapDataMap"],
    gate: "High-risk routes must be exercised before a test link is sent.",
  },
  {
    id: "source_gap_detector",
    level: "full",
    family: "anomaly_detector",
    purpose: "Detect UI facts without source URLs, source pages without internal records, and source loops.",
    signals: ["sourceTruth", "recordMirror", "sitemapDataMap"],
    gate: "Sourceless product claims fail readiness.",
  },
  {
    id: "legacy_url_resolver",
    level: "full",
    family: "entity_resolution",
    purpose: "Map legacy SWFI URLs and CMS IDs to SWFIPN detail routes.",
    signals: ["sourceTruth", "recordMirror", "proofCrawl"],
    gate: "Legacy URLs must resolve to an internal record or an explicit reviewed exception.",
  },
  {
    id: "visual_contract_regressor",
    family: "visual_regression",
    purpose: "Detect missing dashboard visuals, internal diagnostics, console issues, and responsive overflow.",
    signals: ["visual"],
    gate: "A route cannot pass on HTTP alone; required visual sections must render on desktop and mobile.",
  },
  {
    id: "table_controls_auditor",
    family: "interaction_model",
    purpose: "Verify sort, filter, pagination, visible counts, and row reachability where applicable.",
    signals: ["controls", "e2e"],
    gate: "Tables with data must expose reachability and controls.",
  },
  {
    id: "money_number_normalizer",
    family: "feature_parser",
    purpose: "Normalize K/M/B/T, currencies, commas, and nulls before ranking or sorting amounts/AUM.",
    signals: ["controls", "e2e"],
    gate: "Money columns cannot sort as strings.",
  },
  {
    id: "entity_resolution_loop",
    level: "full",
    family: "record_linkage",
    purpose: "Match names, IDs, slugs, SWFI source URLs, and backend records into one canonical route.",
    signals: ["recordMirror", "sitemapDataMap", "proofCrawl"],
    gate: "Clickable entity names must land on entity-specific detail pages, not list self-loops.",
  },
  {
    id: "search_relevance_loop",
    family: "retrieval_evaluator",
    purpose: "Check that search returns typed query evidence, relevant categories, and clickable internal results.",
    signals: ["e2e", "controls"],
    gate: "Search pages must show result counts and clickable results.",
  },
  {
    id: "provenance_depth_loop",
    level: "full",
    family: "graph_walk",
    purpose: "Walk record to source to related records and score whether the chain is replayable.",
    signals: ["mirrorgraph", "proofCrawl", "sourceTruth"],
    gate: "A citation page without a mapped record is a failure unless explicitly reviewed.",
  },
  {
    id: "freshness_drift_loop",
    family: "time_series_monitor",
    purpose: "Detect stale receipts, stale backend fact source, stale build assets, and old crawl results.",
    signals: ["productTruth", "sourceTruth", "visual"],
    gate: "Receipts older than the freshness window cannot support a readiness claim.",
  },
  {
    id: "auth_boundary_loop",
    level: "full",
    family: "policy_classifier",
    purpose: "Classify public vs authenticated navigation and detect wrong external redirects.",
    signals: ["proofCrawl", "sitemapDataMap", "e2e"],
    gate: "Product navigation must stay inside SWFIPN unless explicitly a provenance/source action.",
  },
  {
    id: "dashboard_relevance_loop",
    family: "ranking_model",
    purpose: "Rank dashboard rows by source-backed recency, relevance, user value, and clickability.",
    signals: ["sourceTruth", "visual", "recordMirror"],
    gate: "Dashboard rows must be meaningful, source-backed, and linked to the correct product page.",
  },
  {
    id: "feedback_triage_loop",
    level: "full",
    family: "text_classifier",
    purpose: "Turn Prem/Paul feedback into defects, doctrine gaps, design gaps, source gaps, or enhancements.",
    signals: ["productTruth", "proofCrawl", "visual"],
    gate: "Feedback becomes a bounded failing test before another redesign.",
  },
  {
    id: "pixel_truth_queue",
    level: "full",
    family: "multimodal_retrieval",
    purpose: "Queue PDFs, annual reports, tables, and layout-heavy pages for screenshot-tile evidence extraction.",
    signals: ["sourceTruth", "sitemapDataMap"],
    gate: "Layout-heavy facts require visual evidence when text extraction confidence is low.",
  },
  {
    id: "contradiction_engine",
    family: "consistency_checker",
    purpose: "Compare backend values, visible UI values, source URLs, and extracted evidence for conflicts.",
    signals: ["sourceTruth", "recordMirror", "controls", "visual"],
    gate: "Conflicting facts must go to review instead of being rendered as certain.",
  },
  {
    id: "deployment_canary_loop",
    family: "canary_classifier",
    purpose: "Compare local build, Docker container, public route, screenshots, and receipts before sharing a URL.",
    signals: ["productTruth", "visual", "e2e"],
    gate: "Public readiness requires browser proof plus container/public parity.",
  },
  {
    id: "copy_leak_detector",
    family: "safety_classifier",
    purpose: "Detect internal diagnostics, object IDs, source packets, and implementation language in buyer UI.",
    signals: ["visual", "sourceTruth", "doctrine"],
    gate: "Internal diagnostics cannot appear in the buyer surface.",
  },
  {
    id: "record_coverage_sampler",
    level: "full",
    family: "active_learning_sampler",
    purpose: "Choose the next records to test by class, source host, age, null fields, money fields, and link depth.",
    signals: ["recordMirror", "sitemapDataMap", "proofCrawl"],
    gate: "Sampling must target high-risk classes instead of only happy-path records.",
  },
  {
    id: "repair_priority_ranker",
    level: "full",
    family: "cost_impact_ranker",
    purpose: "Rank the next fix by buyer impact, doctrine severity, blast radius, and verification cost.",
    signals: ["productTruth", "proofCrawl", "visual", "controls"],
    gate: "The next action is the smallest highest-impact failing slice.",
  },
];

function readJson(filePath) {
  const absolute = path.join(repoRoot, filePath);
  try {
    const stat = fs.statSync(absolute);
    return {
      ok: true,
      file: filePath,
      mtime: stat.mtime.toISOString(),
      age_ms: Math.round(Date.now() - stat.mtimeMs),
      body: JSON.parse(fs.readFileSync(absolute, "utf8")),
    };
  } catch (error) {
    return { ok: false, file: filePath, error: error.message };
  }
}

function statusOf(receipt) {
  if (!receipt.ok) return "missing";
  return String(receipt.body.status || receipt.body.result || receipt.body.summary?.status || "unknown").toLowerCase();
}

function failuresOf(receipt) {
  if (!receipt.ok) return [{ id: "missing_receipt", file: receipt.file, error: receipt.error }];
  const body = receipt.body;
  if (Array.isArray(body.failures)) return body.failures;
  if (Array.isArray(body.gates)) {
    return body.gates.filter((gate) => gate.ok === false);
  }
  return [];
}

function routeRisk(receipt) {
  if (!receipt.ok) return 10;
  const summary = receipt.body.summary || {};
  let risk = 0;
  risk += Number(summary.failures || 0) * 10;
  risk += Number(summary.self_contained_link_failures || 0) * 10;
  risk += Number(summary.console_issues || 0) * 5;
  risk += Number(summary.page_errors || 0) * 8;
  return risk;
}

function assessLoop(loop, loaded) {
  const signalReceipts = loop.signals.map((name) => ({ name, receipt: loaded[name] }));
  const missing = signalReceipts.filter((item) => !item.receipt?.ok).map((item) => item.name);
  const failing = signalReceipts
    .filter((item) => item.receipt?.ok && !["pass", "complete", "ok"].includes(statusOf(item.receipt)))
    .map((item) => ({ name: item.name, status: statusOf(item.receipt), failures: failuresOf(item.receipt).slice(0, 5) }));
  const stale = signalReceipts
    .filter((item) => item.receipt?.ok && item.receipt.age_ms > freshnessMs)
    .map((item) => ({ name: item.name, age_ms: item.receipt.age_ms, mtime: item.receipt.mtime }));
  const risk = missing.length * 15
    + failing.length * 25
    + stale.length * 8
    + signalReceipts.reduce((total, item) => total + routeRisk(item.receipt || { ok: false }), 0);
  return {
    id: loop.id,
    level: loop.level || "smoke",
    family: loop.family,
    purpose: loop.purpose,
    gate: loop.gate,
    ok: missing.length === 0 && failing.length === 0 && stale.length === 0,
    stale,
    risk_score: risk,
    signals: loop.signals,
    missing,
    failing,
  };
}

function nextExperiment(results) {
  const failing = results.filter((item) => !item.ok).sort((a, b) => b.risk_score - a.risk_score)[0];
  if (!failing) {
    return "No repair experiment. Expand active-learning samples only after current proof remains green.";
  }
  if (failing.missing.length) return `Run missing receipts for ${failing.id}: ${failing.missing.join(", ")}`;
  if (failing.stale.length) return `Refresh stale receipts for ${failing.id}: ${failing.stale.map((item) => item.name).join(", ")}`;
  return `Patch first failing loop ${failing.id}; inspect ${failing.failing.map((item) => item.name).join(", ")}.`;
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN ML Loop Registry",
    "",
    `- Status: ${receipt.status.toUpperCase()}`,
    `- Mode: ${receipt.mode}`,
    `- Level: ${receipt.level}`,
    `- Generated: ${receipt.generated_at}`,
    `- Loops: ${receipt.summary.loops}`,
    `- Failing loops: ${receipt.summary.failing}`,
    `- Next experiment: ${receipt.next_experiment}`,
    "",
    "| Loop | Family | Status | Risk |",
    "| --- | --- | --- | ---: |",
  ];
  for (const loop of receipt.loops) {
    lines.push(`| ${loop.id} | ${loop.family} | ${loop.ok ? "PASS" : "FAIL"} | ${loop.risk_score} |`);
  }
  const failures = receipt.loops.filter((loop) => !loop.ok);
  if (failures.length) {
    lines.push("", "## Failing Loops", "");
    for (const loop of failures) {
      lines.push(`### ${loop.id}`, "");
      lines.push(`- Gate: ${loop.gate}`);
      if (loop.missing.length) lines.push(`- Missing: ${loop.missing.join(", ")}`);
      if (loop.failing.length) lines.push(`- Failing receipts: ${loop.failing.map((item) => `${item.name}:${item.status}`).join(", ")}`);
    }
  }
  lines.push("", "## Mutation Policy", "");
  lines.push("These loops classify, rank, queue, and gate. They do not deploy, restart production, train models, or write product data.");
  return `${lines.join("\n")}\n`;
}

function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!["smoke", "full"].includes(level)) {
    console.error(`Invalid SWFIPN_ML_LOOP_LEVEL ${level}. Expected smoke or full.`);
    process.exit(2);
  }
  const loaded = Object.fromEntries(Object.entries(receipts).map(([name, file]) => [name, readJson(file)]));
  const selectedLoops = loops.filter((loop) => level === "full" || (loop.level || "smoke") === "smoke");
  const results = selectedLoops.map((loop) => assessLoop(loop, loaded));
  const failing = results.filter((item) => !item.ok);
  const receipt = {
    schema_version: "swfipn.ml_loop_registry.v1",
    generated_at: generatedAt,
    mode,
    level,
    status: failing.length ? "fail" : "pass",
    summary: {
      loops: results.length,
      failing: failing.length,
      stale: results.filter((item) => item.stale.length).length,
      highest_risk: results.slice().sort((a, b) => b.risk_score - a.risk_score).slice(0, 5).map((item) => ({
        id: item.id,
        risk_score: item.risk_score,
      })),
    },
    next_experiment: nextExperiment(results),
    receipts,
    loops: results,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(reportPath, renderMarkdown(receipt));
  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    next_experiment: receipt.next_experiment,
    receipt: receiptPath,
    report: reportPath,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run();
