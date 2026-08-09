#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-msci-email-complaint-browser-gate-latest.json");
const runDir = path.join(outputDir, "msci-email-complaint-browser-gate-runs");

function writeReceipt(receipt) {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });
  const runPath = path.join(runDir, `${receipt.generated_at.replace(/[:.]/g, "-")}.json`);
  const serialized = `${JSON.stringify(receipt, null, 2)}\n`;
  fs.writeFileSync(runPath, serialized, { flag: "wx" });
  fs.writeFileSync(receiptPath, serialized);
  return runPath;
}

function loadPlaywright() {
  return createRequire(path.join(repoRoot, "node_modules", "playwright", "package.json"))("playwright");
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function waitForOrigin(origin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`static_server_exited_${child.exitCode}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch { /* retry */ }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("static_server_readiness_timeout");
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function packet(rows = []) {
  return {
    status: "ok",
    fact: true,
    result_qualifier: "fact",
    data: { count: rows.length, rows, results: rows },
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  if (!fs.existsSync(path.join(repoRoot, "out", "index.html"))) {
    throw new Error("built_static_export_missing: run npm run build first");
  }

  const port = await reservePort();
  const origin = `http://127.0.0.1:${port}/swficc/`;
  const child = spawn("python3", [
    path.join(repoRoot, "scripts", "serve-static-with-headers.py"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--root", path.join(repoRoot, "out"),
    "--backend", "https://dashboard.swfi.com",
  ], { cwd: repoRoot, stdio: "ignore" });

  const checks = [];
  const requests = [];
  let browser;
  try {
    await waitForOrigin(origin, child);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });

    await page.route("**/*", async (route) => {
      const parsed = new URL(route.request().url());
      if (!parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/v1/")) {
        await route.continue();
        return;
      }
      requests.push(parsed.href);
      if (parsed.pathname === "/api/source-intelligence/news/v1") {
        const query = parsed.searchParams.get("q") || "";
        const newsRows = query === "HKIC"
          ? [{ id: "hkic-news", title: "HKIC expands its institutional investment program", published_at: "2026-08-01", source_url: "https://www.swfi.com/v1/news/1" }]
          : query === "ADIA"
            ? [{ id: "adia-news", title: "ADIA increases its private markets allocation", published_at: "2026-08-02", source_url: "https://www.swfi.com/v1/news/2" }]
            : [];
        await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet(newsRows)) });
        return;
      }
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(packet()) });
    });

    await page.goto(origin, { waitUntil: "networkidle" });
    checks.push({
      id: "top_ranked_aum_visible",
      ok: await page.getByText("Top Ranked AUM", { exact: true }).isVisible(),
    });

    const scenarios = [
      {
        id: "hkic",
        query: "Hong Kong Investment Corporation",
        expectedQueries: ["Hong Kong Investment Corporation", "HKIC"],
        expectedTitle: "HKIC expands its institutional investment program",
      },
      {
        id: "adia",
        query: "Abu Dhabi Investment Authority",
        expectedQueries: ["Abu Dhabi Investment Authority", "ADIA"],
        expectedTitle: "ADIA increases its private markets allocation",
      },
    ];

    for (const scenario of scenarios) {
      for (let run = 1; run <= 2; run += 1) {
        const marker = requests.length;
        const started = Date.now();
        await page.goto(`${origin}search/?q=${encodeURIComponent(scenario.query)}&category=news`, { waitUntil: "networkidle" });
        await page.getByText(scenario.expectedTitle, { exact: true }).waitFor({ state: "visible", timeout: 10_000 });
        const elapsedMs = Date.now() - started;
        const observedQueries = requests.slice(marker)
          .map((href) => new URL(href))
          .filter((url) => url.pathname === "/api/source-intelligence/news/v1")
          .map((url) => url.searchParams.get("q"))
          .filter(Boolean);
        checks.push({
          id: `${scenario.id}_news_search_run_${run}`,
          ok: scenario.expectedQueries.every((query) => observedQueries.includes(query)) && elapsedMs < 10_000,
          expected_queries: scenario.expectedQueries,
          observed_queries: observedQueries,
          elapsed_ms: elapsedMs,
          visible_title: scenario.expectedTitle,
        });
      }
    }

    const failures = checks.filter((check) => !check.ok).map((check) => check.id);
    const receipt = {
      schema_version: "swfipn.msci_email_complaint_browser_gate.v1",
      status: failures.length ? "fail" : "pass",
      generated_at: new Date().toISOString(),
      checked_scope: "local production build with deterministic intercepted source packets; two consecutive runs per institution",
      unchecked_scope: ["live production", "live source completeness", "customer ETL"],
      checks,
      failures,
      bad_news: ["A local browser PASS is not a production PASS."],
    };
    const immutableReceipt = writeReceipt(receipt);
    console.log(JSON.stringify({ status: receipt.status, checks: checks.length, failures, receipt: receiptPath, immutable_receipt: immutableReceipt }, null, 2));
    if (failures.length) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
  }
}

main().catch((error) => {
  writeReceipt({ schema_version: "swfipn.msci_email_complaint_browser_gate.v1", status: "error", generated_at: new Date().toISOString(), error: error.message });
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
