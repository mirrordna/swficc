#!/usr/bin/env node
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { chromium } from "playwright";

const cwd = process.cwd();
const configuredOrigin = String(process.env.SWFIPN_ORIGIN || "").trim();
const liveTarget = Boolean(configuredOrigin);
const sourceBackendOrigin = new URL(
  String(process.env.SWFIPN_BACKEND_ORIGIN || (liveTarget ? configuredOrigin : "https://dashboard.swfi.com")),
).origin;
let origin = normalizeOrigin(configuredOrigin || "http://127.0.0.1/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-section-visualization-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

function candidateIdentity() {
  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).trim();
  const gitDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf8" }).trim());
  let assetVersion = "";
  try {
    assetVersion = String(JSON.parse(fs.readFileSync(path.join(outputDir, "swfipn-asset-version-latest.json"), "utf8")).version || "").trim();
  } catch {
    // Missing asset identity remains explicit in the receipt.
  }
  return { git_sha: gitSha, git_dirty: gitDirty, asset_version: assetVersion || null };
}

const ROUTES = [
  { id: "entities", route: "/profiles/", selector: "[data-brd-section-visualization='profiles']", required: ["Institution Data Visualization", "Total in SWFI", "Items in View", "Leading Category", "Highlighted SWFI Pages"] },
  { id: "people", route: "/people/", selector: "[data-brd-section-visualization='people']", required: ["People Data Visualization", "Total in SWFI", "Items in View", "Leading Category", "Highlighted SWFI Pages"] },
  { id: "transactions", route: "/transactions/", selector: "[data-brd-section-visualization='transactions']", required: ["Transaction Data Visualization", "Total in SWFI", "Items in View", "Leading Category", "Highlighted SWFI Pages"] },
  { id: "deals", route: "/deals/", selector: "[data-brd-section-visualization='deals']", required: ["Transaction Data Visualization", "Total in SWFI", "Items in View", "Leading Category", "Highlighted SWFI Pages"] },
  { id: "compass", route: "/mandates/", selector: "[data-brd-compass-visualization='true']", required: ["Compass RFP Analytics", "RFPs by Investment Type", "RFPs by Region", "RFPs Posted Per Month"] },
  { id: "reports", route: "/reports/", selector: "[data-brd-reports-visualization='true']", required: ["Reports / League Tables Visualization", "Reports by Type", "Market Activity by Sector", "League Tables"] },
];

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

async function waitForOrigin(targetOrigin, child) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (child && child.exitCode !== null) throw new Error(`static_server_exited_${child.exitCode}`);
    try {
      const response = await fetch(targetOrigin, { signal: AbortSignal.timeout(1_000) });
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

async function main() {
  let child = null;
  if (!liveTarget) {
    if (!fs.existsSync(path.join(cwd, "out", "index.html"))) {
      throw new Error("built_static_export_missing: run npm run build first");
    }
    const port = await reservePort();
    origin = `http://127.0.0.1:${port}/swficc/`;
    child = spawn("python3", [
      path.join(cwd, "scripts", "serve-static-with-headers.py"),
      "--host", "127.0.0.1",
      "--port", String(port),
      "--root", path.join(cwd, "out"),
      "--backend", sourceBackendOrigin,
      "--backend-timeout", "12",
    ], { cwd, stdio: "ignore" });
  }
  let browser;
  try {
    await waitForOrigin(origin, child);
    browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  const checks = [];
  for (const spec of ROUTES) {
    checks.push(await checkRoute(page, spec));
  }

  const failures = checks.flatMap((check) => check.failures.map((failure) => `${check.id}:${failure}`));
  if (consoleErrors.length) failures.push("console_errors_present");
  const testedReleaseGitSha = liveTarget ? String(process.env.SWFIPN_RELEASE_GIT_SHA || "").trim() : "";
  const testedReleaseAssetVersion = liveTarget ? String(process.env.SWFIPN_RELEASE_ASSET_VERSION || "").trim() : "";
  const releaseIdentityPinned = !liveTarget
    || (/^[a-f0-9]{40}$/i.test(testedReleaseGitSha) && Boolean(testedReleaseAssetVersion));
  const candidate = liveTarget ? null : candidateIdentity();
  if (!releaseIdentityPinned) failures.push("live_target_release_identity_unpinned");
  const status = failures.length ? "fail" : "pass";
  const receipt = {
    schema_version: "swfipn.section_visualization_brd_gate.v1",
    generated_at: new Date().toISOString(),
    evidence_class: liveTarget
      ? "LIVE_TARGET_SURFACE_BEHAVIOR_NOT_GLOBAL_ACCEPTANCE"
      : "CANDIDATE_WITH_LIVE_SWFI_SOURCES_NOT_PRODUCTION_ACCEPTANCE",
    origin,
    target_mode: liveTarget ? "live" : "local_candidate",
    source_backend_origin: sourceBackendOrigin,
    tested_release_git_sha: testedReleaseGitSha || null,
    tested_release_asset_version: testedReleaseAssetVersion || null,
    release_identity_pinned: releaseIdentityPinned,
    candidate_identity: candidate,
    status,
    unchecked_scope: liveTarget
      ? ["stakeholder_acceptance", "Mongo_record_parity", "global_release_acceptance"]
      : ["deployed_production", "stakeholder_acceptance", "Mongo_record_parity"],
    bad_news: releaseIdentityPinned ? [] : ["live_target_release_identity_unpinned"],
    summary: {
      routes: checks.length,
      passed_routes: checks.filter((check) => check.status === "pass").length,
      failed_routes: checks.filter((check) => check.status !== "pass").length,
      chart_filter_links: checks.reduce((sum, check) => sum + check.chart_filter_links, 0),
      signin_export_links: checks.reduce((sum, check) => sum + check.signin_export_links, 0),
      export_csv_buttons: checks.reduce((sum, check) => sum + check.export_csv_buttons, 0),
      export_png_buttons: checks.reduce((sum, check) => sum + check.export_png_buttons, 0),
      console_errors: consoleErrors.slice(0, 10),
      failures,
    },
    checks,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
    console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
    if (status === "fail") process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
  }
}

async function checkRoute(page, spec) {
  const url = appUrl(spec.route);
  const screenshot = path.join(outputDir, `swfipn-section-visualization-${spec.id}.png`);
  const failures = [];
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 });
  const visualizationButton = page.getByRole("button", { name: "Visualization" }).first();
  await visualizationButton.waitFor({ state: "visible", timeout: 30_000 }).catch(() => null);
  if (await visualizationButton.count()) {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await visualizationButton.click({ timeout: 15_000 });
      const opened = await page.waitForSelector(spec.selector, { timeout: 5_000 }).then(() => true).catch(() => false);
      if (opened) break;
      await page.waitForTimeout(1000);
    }
  } else {
    failures.push("missing_visualization_button");
  }
  await page.waitForSelector(spec.selector, { timeout: 30_000 }).catch(() => failures.push("missing_visualization_panel"));
  await page.waitForFunction((selector) => {
    const panel = document.querySelector(selector);
    if (!panel) return false;
    return panel.querySelectorAll("a[href*='filter=']").length > 0 || panel.querySelectorAll("svg").length > 0;
  }, spec.selector, { timeout: 30_000 }).catch(() => null);
  await page.screenshot({ path: screenshot, fullPage: true });

  const body = await page.locator("body").innerText();
  const panelText = await page.locator(spec.selector).innerText({ timeout: 10_000 }).catch(() => "");
  const normalizedBody = body.toLocaleLowerCase("en-US");
  const missing = spec.required.filter((item) => !normalizedBody.includes(item.toLocaleLowerCase("en-US")));
  // Dashboard 2.0 P05: exports are sign-in gated — the gate asserts the
  // sign-in export link instead of public download buttons.
  const signinExportLinks = await page.locator(`${spec.selector} a`, { hasText: "Sign in on SWFI to export" }).count();
  const { chartFilterLinks, svgCount } = await page.evaluate((selector) => {
    const panel = document.querySelector(selector);
    return {
      chartFilterLinks: panel?.querySelectorAll("a[href*='filter=']").length || 0,
      svgCount: panel?.querySelectorAll("svg").length || 0,
    };
  }, spec.selector);
  const internalLeaks = ["Active Mirror", "source_gap", "backend_http", "undefined", "null", "Loaded Rows", "Top Loaded Records"].filter((needle) => panelText.includes(needle));

  if ((response?.status() || 0) >= 400) failures.push(`http_${response?.status() || 0}`);
  if (missing.length) failures.push(`missing_text:${missing.join("|")}`);
  if (signinExportLinks < 1) failures.push("missing_signin_gated_export");
  if (chartFilterLinks < 1) failures.push("missing_clickable_chart_filters");
  if (chartFilterLinks < 1 && svgCount < 1) failures.push("missing_chart_visual");
  if (internalLeaks.length) failures.push(`internal_leaks:${internalLeaks.join("|")}`);

  return {
    id: spec.id,
    route: spec.route,
    url,
    status: failures.length ? "fail" : "pass",
    missing,
    chart_filter_links: chartFilterLinks,
    signin_export_links: signinExportLinks,
    export_csv_buttons: 0,
    export_png_buttons: 0,
    svg_count: svgCount,
    screenshot,
    failures,
  };
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
