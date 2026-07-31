#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-canonical-search-browser-gate-latest.json");

function loadPlaywright() {
  const marker = path.join(repoRoot, "node_modules", "playwright", "package.json");
  return createRequire(marker)("playwright");
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForOrigin(origin, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`static_server_exited_${child.exitCode}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
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

function fileSha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

async function runQuery(browser, origin, testCase) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const startedAt = Date.now();
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    await page.getByRole("textbox", { name: "Search query" }).fill(testCase.query);
    await page.getByTestId("smart-search-canonical-identity").waitFor({ timeout: 5_000 });
    await page.getByText(testCase.entity, { exact: true }).first().waitFor({ timeout: 25_000 });
    const entityMs = Date.now() - startedAt;
    await page.getByText(new RegExp(testCase.news), { exact: false }).first().waitFor({ timeout: 15_000 });
    const newsMs = Date.now() - startedAt;
    await page.getByText("No source-backed people relationship found.", { exact: true }).waitFor({ timeout: 30_000 });
    const body = await page.locator("body").innerText();
    const screenshotPath = path.join(outputDir, `swfipn-canonical-search-${testCase.id}-latest.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    return {
      id: testCase.id,
      pass: body.includes(testCase.entity)
        && body.includes(testCase.news)
        && testCase.forbidden.every((value) => !body.includes(value)),
      entity_ms: entityMs,
      news_ms: newsMs,
      entity: testCase.entity,
      news: testCase.news,
      forbidden_absent: testCase.forbidden.filter((value) => !body.includes(value)),
      screenshot: screenshotPath,
      screenshot_sha256: fileSha256(screenshotPath),
    };
  } finally {
    await page.close();
  }
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
    "--backend", process.env.SWFIPN_BACKEND_ORIGIN || "https://dashboard.swfi.com",
    "--backend-timeout", "12",
  ], { cwd: repoRoot, stdio: "ignore" });

  let browser;
  try {
    await waitForOrigin(origin, child);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const firstPaintPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await firstPaintPage.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    const firstPaintBody = await firstPaintPage.locator("body").innerText();
    const topAumFirstPaint = firstPaintBody.includes("Norway Government Pension Fund Global")
      && firstPaintBody.includes("TOP-RANKED AUM TOTAL");
    await firstPaintPage.close();

    const cases = [
      { id: "adia", query: "ADIA", entity: "Abu Dhabi Investment Authority", news: "ADIA and Mubadala Back EQT", forbidden: ["Kapadia", "Nadia"] },
      { id: "hkic", query: "Hong Kong Investment Corporation", entity: "Hong Kong Investment Corporation", news: "HKIC Supports Government Budget", forbidden: ["HealthKick", "MaRS HealthKick"] },
    ];
    const checks = [];
    for (const testCase of cases) checks.push(await runQuery(browser, origin, testCase));
    checks.unshift({ id: "top_aum_first_paint", pass: topAumFirstPaint });
    const receipt = {
      schema_version: "swfipn.canonical_search_browser_gate.v1",
      generated_at: new Date().toISOString(),
      evidence_class: "CANDIDATE_WITH_LIVE_SWFI_SOURCES_NOT_PRODUCTION_ACCEPTANCE",
      status: checks.every((check) => check.pass) ? "pass" : "fail",
      checked_scope: ["top_aum_first_paint", "adia_entity_news_people_semantics", "hkic_entity_news_people_semantics"],
      unchecked_scope: ["deployed_production", "stakeholder_acceptance", "Mongo_record_parity"],
      checks,
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ status: receipt.status, receipt: receiptPath, checks }, null, 2));
    if (receipt.status !== "pass") process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
