#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const target = argValue("--target") || process.env.SWFIPN_TRUTH_AUDIT_TARGET || "public";
const level = argValue("--level") || process.env.SWFIPN_TRUTH_AUDIT_LEVEL || "smoke";
const failFast = hasArg("--fail-fast") || process.env.SWFIPN_TRUTH_AUDIT_FAIL_FAST === "1";
const generatedAt = new Date().toISOString();
const receiptPath = path.join(outputDir, "swfipn-product-truth-audit-latest.json");
const markdownPath = path.join(outputDir, "swfipn-product-truth-audit-latest.md");

const gates = [
  {
    id: "doctrine",
    level: "smoke",
    purpose: "PDF/doctrine route and packet contract.",
    scripts: { local: "doctrine:gate", public: "doctrine:gate:public" },
    receipt: "output/swfipn-doctrine-gate-latest.json",
  },
  {
    id: "source_truth",
    level: "smoke",
    purpose: "Provenance text, source-detail loops, and backend fact-source contract.",
    scripts: { local: "source-truth:gate", public: "source-truth:gate:public" },
    receipt: "output/swfipn-source-truth-gate-latest.json",
  },
  {
    id: "record_mirror",
    level: "smoke",
    purpose: "Record-class counts and sample source-to-internal detail routes.",
    scripts: { local: "record-mirror:gate", public: "record-mirror:gate:public" },
    receipt: "output/swfipn-record-mirror-gate-latest.json",
  },
  {
    id: "controls",
    level: "smoke",
    purpose: "Rendered counts, filters, sort controls, row limits, and pagination.",
    scripts: { local: "controls:proof", public: "controls:proof:public" },
    receipt: "output/swfipn-table-controls-proof-latest.json",
  },
  {
    id: "visual",
    level: "smoke",
    purpose: "Dashboard visual contract, source labels, screenshot evidence, console health, and overflow checks.",
    scripts: { local: "visual:gate", public: "visual:gate:public" },
    receipt: "output/swfipn-visual-gate-latest.json",
  },
  {
    id: "kp_acceptance",
    level: "smoke",
    purpose: "KP buyer feedback contract: integrated SWFI shell, no internal diagnostics, internal row navigation, and verified records.",
    scripts: { local: "kp:gate", public: "kp:gate:public" },
    receipt: "output/swfipn-kp-acceptance-gate-latest.json",
  },
  {
    id: "e2e",
    level: "smoke",
    purpose: "Core routes, searches, details, and key user controls.",
    scripts: { local: "e2e:gate", public: "e2e:gate:public" },
    receipt: "output/swfipn-e2e-gate-latest.json",
  },
  {
    id: "mirrorgraph_build",
    level: "full",
    purpose: "Build source-to-route-to-UI evidence graph.",
    scripts: { local: "mirrorgraph", public: "mirrorgraph" },
    receipt: "output/swfipn-route-mirrorgraph-latest.json",
  },
  {
    id: "mirrorgraph_gate",
    level: "full",
    purpose: "Verify source graph cases render the exact expected public product data.",
    scripts: { local: "mirrorgraph:gate", public: "mirrorgraph:gate:public" },
    receipt: "output/swfipn-mirrorgraph-gate-latest.json",
  },
  {
    id: "provable_terminal",
    level: "full",
    purpose: "Buyer-facing proof over record classes, widgets, rendered routes, and receipts.",
    scripts: { local: "provable:gate", public: "provable:gate:public" },
    receipt: "output/swfipn-provable-terminal-gate-latest.json",
  },
  {
    id: "pdf_verbatim",
    level: "full",
    purpose: "PDF/doctrine feature coverage and forbidden-placeholder checks.",
    scripts: { local: "pdf:verbatim", public: "pdf:verbatim:public" },
    receipt: "output/swfipn-pdf-feature-coverage-latest.json",
  },
  {
    id: "sitemap_data_map",
    level: "full",
    purpose: "Rendered sitemap data map and route/source inventory.",
    scripts: { local: "sitemap:data-map", public: "sitemap:data-map:public" },
    receipt: "output/swfipn-sitemap-data-map-latest.json",
  },
  {
    id: "proof_crawl",
    level: "full",
    purpose: "Depth-5 browser crawl, visible link clicks, forms, redirects, and self-contained link checks.",
    scripts: { local: "proof:crawl", public: "proof:crawl:public" },
    receipt: "output/swfipn-public-proof-crawl-latest.json",
  },
];

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function hasArg(name) {
  return process.argv.includes(name);
}

function shouldRun(gate) {
  if (level === "full") return true;
  return gate.level === "smoke";
}

function tail(value, max = 3000) {
  const text = String(value || "");
  return text.length > max ? text.slice(text.length - max) : text;
}

function readReceipt(filePath, startedAt = 0) {
  try {
    const absolute = path.join(repoRoot, filePath);
    const stat = fs.statSync(absolute);
    const body = JSON.parse(fs.readFileSync(absolute, "utf8"));
    return {
      ok: stat.mtimeMs >= startedAt,
      stale_for_gate: stat.mtimeMs < startedAt,
      mtime: stat.mtime.toISOString(),
      body,
    };
  } catch (error) {
    return { ok: false, missing_or_unreadable: true, error: error.message, body: null };
  }
}

function summarizeReceipt(receipt) {
  if (!receipt?.body) return { missing_or_unreadable: true, error: receipt?.error || "" };
  const body = receipt.body;
  return {
    status: body.status || "",
    summary: body.summary || undefined,
    failures: Array.isArray(body.failures) ? body.failures.slice(0, 12) : undefined,
    total_mirrorable_records: body.total_mirrorable_records || undefined,
    mtime: receipt.mtime,
    stale_for_gate: receipt.stale_for_gate || undefined,
  };
}

function runGate(gate) {
  const scriptName = gate.scripts[target] || gate.scripts.public;
  const startedAt = Date.now();
  const gateEnv = { ...process.env };
  if (gate.id === "controls") gateEnv.SWFIPN_TABLE_CONTROLS_LEVEL = level;
  if (gate.id === "e2e") gateEnv.SWFIPN_E2E_LEVEL = level;
  const result = spawnSync("npm", ["run", scriptName], {
    cwd: repoRoot,
    env: gateEnv,
    encoding: "utf8",
    timeout: Number(process.env.SWFIPN_TRUTH_AUDIT_GATE_TIMEOUT_MS || 1_200_000),
    maxBuffer: 40 * 1024 * 1024,
  });
  const finishedAt = Date.now();
  const receipt = readReceipt(gate.receipt, startedAt);
  const receiptStatus = receipt.body?.status || "";
  const ok = result.status === 0 && receipt.ok && ["pass", "complete"].includes(receiptStatus);
  return {
    id: gate.id,
    level: gate.level,
    purpose: gate.purpose,
    script: scriptName,
    ok,
    exit_code: result.status,
    signal: result.signal || "",
    duration_ms: finishedAt - startedAt,
    receipt: path.join(repoRoot, gate.receipt),
    receipt_summary: summarizeReceipt(receipt),
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr),
    error: result.error ? result.error.message : "",
  };
}

function renderMarkdown(receipt) {
  const lines = [
    "# SWFIPN Product Truth Audit",
    "",
    `- Status: ${receipt.status.toUpperCase()}`,
    `- Target: ${receipt.target}`,
    `- Level: ${receipt.level}`,
    `- Generated: ${receipt.generated_at}`,
    `- Gates run: ${receipt.summary.gates_run}`,
    `- Failures: ${receipt.summary.failures}`,
    "",
    "| Gate | Status | Duration | Receipt |",
    "| --- | --- | ---: | --- |",
  ];
  for (const gate of receipt.gates) {
    const status = gate.ok ? "PASS" : "FAIL";
    lines.push(`| ${gate.id} | ${status} | ${(gate.duration_ms / 1000).toFixed(1)}s | ${gate.receipt} |`);
  }
  if (receipt.failures.length) {
    lines.push("", "## Exceptions", "");
    for (const failure of receipt.failures) {
      lines.push(`### ${failure.id}`, "");
      lines.push(`- Script: \`${failure.script}\``);
      lines.push(`- Exit: \`${failure.exit_code ?? "unknown"}\``);
      if (failure.receipt_summary?.failures?.length) {
        lines.push("- Receipt failures:");
        for (const item of failure.receipt_summary.failures) {
          lines.push(`  - \`${JSON.stringify(item).slice(0, 500)}\``);
        }
      }
      if (failure.stderr_tail) {
        lines.push("", "```text", failure.stderr_tail.slice(-1200), "```");
      }
    }
  }
  return `${lines.join("\n")}\n`;
}

function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!["local", "public"].includes(target)) {
    console.error(`Invalid --target ${target}. Expected local or public.`);
    process.exit(2);
  }
  if (!["smoke", "full"].includes(level)) {
    console.error(`Invalid --level ${level}. Expected smoke or full.`);
    process.exit(2);
  }
  const selected = gates.filter(shouldRun);
  const results = [];
  for (const gate of selected) {
    console.error(`[swfipn-product-truth] start ${gate.id}`);
    const result = runGate(gate);
    console.error(`[swfipn-product-truth] ${result.ok ? "pass" : "fail"} ${gate.id} ${(result.duration_ms / 1000).toFixed(1)}s`);
    results.push(result);
    if (!result.ok && failFast) break;
  }
  const failures = results.filter((item) => !item.ok);
  const receipt = {
    schema_version: "swfipn.product_truth_audit.v1",
    generated_at: generatedAt,
    target,
    level,
    status: failures.length ? "fail" : "pass",
    summary: {
      gates_run: results.length,
      failures: failures.length,
      duration_ms: results.reduce((total, item) => total + item.duration_ms, 0),
    },
    gates: results,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  fs.writeFileSync(markdownPath, renderMarkdown(receipt));
  console.log(JSON.stringify({
    status: receipt.status,
    target,
    level,
    summary: receipt.summary,
    receipt: receiptPath,
    report: markdownPath,
    failures: failures.map((item) => ({ id: item.id, script: item.script, receipt: item.receipt })),
  }, null, 2));
  if (failures.length) process.exit(1);
}

run();
