#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-refresh-graph-frame-gate-latest.json");
const screenshotPath = path.join(outputDir, "swfipn-refresh-graph-frame.png");
const configuredOrigin = process.env.SWFIPN_ORIGIN?.trim() || "";

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
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

async function waitForOrigin(origin, child, output) {
  const deadline = Date.now() + 10_000;
  let lastError = "server_not_ready";
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`static_server_exited_${child.exitCode}: ${output().slice(-1_000)}`);
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
      lastError = `http_${response.status}`;
    } catch (error) {
      lastError = error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`static_server_readiness_timeout: ${lastError}; ${output().slice(-1_000)}`);
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

async function startLocalHarness() {
  const staticRoot = path.join(repoRoot, "out");
  const indexPath = path.join(staticRoot, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`built_static_export_missing: ${indexPath}; run npm run build first`);
  }
  const port = Number(process.env.SWFIPN_REFRESH_GRAPH_GATE_PORT || 0) || await reservePort();
  const backend = (process.env.SWFIPN_BACKEND_ORIGIN || "https://dashboard.swfi.com").replace(/\/$/, "");
  const origin = `http://127.0.0.1:${port}/swficc/`;
  const chunks = [];
  const child = spawn("python3", [
    path.join(repoRoot, "scripts", "serve-static-with-headers.py"),
    "--host", "127.0.0.1",
    "--port", String(port),
    "--root", staticRoot,
    "--backend", backend,
  ], {
    cwd: repoRoot,
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const capture = (chunk) => {
    chunks.push(String(chunk));
    if (chunks.length > 40) chunks.shift();
  };
  child.stdout.on("data", capture);
  child.stderr.on("data", capture);
  const output = () => chunks.join("");
  try {
    await waitForOrigin(origin, child, output);
  } catch (error) {
    await stopChild(child);
    throw error;
  }
  return {
    origin,
    backend,
    pid: child.pid,
    stop: () => stopChild(child),
  };
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const harness = configuredOrigin ? null : await startLocalHarness();
  const origin = normalizeOrigin(configuredOrigin || harness.origin);
  let browser;
  let gateFailed = false;
  try {
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    // Hold data packets long enough to inspect the static/SSR and hydration frame.
    // The production bug lived only in this interval and disappeared once the map
    // canvas mounted, so a post-load screenshot alone could never catch it.
    await page.route("**/*", async (route) => {
      const url = new URL(route.request().url());
      const isDashboardData = url.pathname.includes("/api/") || url.pathname.includes("/v1/swfi/top20");
      if (isDashboardData) await new Promise((resolve) => setTimeout(resolve, 900));
      await route.continue();
    });

    await page.addInitScript(() => {
    window.__swfiRefreshGraphFrames = [];
    const capture = () => {
      const panel = document.querySelector("#institution-overview");
      if (!panel) return;
      const loading = panel.querySelector('[data-map-loading-state="true"]');
      const canvas = panel.querySelector("canvas");
      const text = panel.textContent?.replace(/\s+/g, " ").trim() || "";
      const panelRect = panel.getBoundingClientRect();
      const loadingRect = loading?.getBoundingClientRect();
      const frame = {
        at_ms: Math.round(performance.now()),
        disclosed_fallback_visible: text.includes("Showing disclosed market activity instead"),
        loading_present: Boolean(loading),
        canvas_present: Boolean(canvas),
        loading_position: loading ? getComputedStyle(loading).position : "",
        loading_inside_panel: loadingRect
          ? loadingRect.top >= panelRect.top - 1
            && loadingRect.left >= panelRect.left - 1
            && loadingRect.right <= panelRect.right + 1
            && loadingRect.bottom <= panelRect.bottom + 1
          : null,
      };
      const previous = window.__swfiRefreshGraphFrames.at(-1);
      if (!previous
        || previous.disclosed_fallback_visible !== frame.disclosed_fallback_visible
        || previous.loading_present !== frame.loading_present
        || previous.canvas_present !== frame.canvas_present
        || previous.loading_position !== frame.loading_position
        || previous.loading_inside_panel !== frame.loading_inside_panel) {
        window.__swfiRefreshGraphFrames.push(frame);
      }
    };
    const observer = new MutationObserver(capture);
    const start = () => {
      observer.observe(document, { childList: true, subtree: true, characterData: true, attributes: true });
      capture();
      requestAnimationFrame(capture);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start, { once: true });
    else start();
    });

    const response = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.locator('[data-map-loading-state="true"]').waitFor({ state: "visible", timeout: 5_000 });
    await page.screenshot({ path: screenshotPath });
    await page.locator("#institution-overview canvas").first().waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForTimeout(100);

    const frames = await page.evaluate(() => window.__swfiRefreshGraphFrames || []);
    const pendingFrames = frames.filter((frame) => frame.loading_present && !frame.canvas_present);
    const disclosedFrames = frames.filter((frame) => frame.disclosed_fallback_visible && !frame.canvas_present);
    const escapedFrames = pendingFrames.filter((frame) => frame.loading_inside_panel !== true || ["absolute", "fixed"].includes(frame.loading_position));
    const finalState = await page.evaluate(() => ({
      canvas_present: Boolean(document.querySelector("#institution-overview canvas")),
      loading_present: Boolean(document.querySelector('#institution-overview [data-map-loading-state="true"]')),
      disclosed_fallback_visible: document.querySelector("#institution-overview")?.textContent?.includes("Showing disclosed market activity instead") || false,
    }));

    const failures = [];
    if (!response || response.status() >= 400) failures.push(`http_${response?.status() || "missing"}`);
    if (!pendingFrames.length) failures.push("pending_graph_frame_not_observed");
    if (disclosedFrames.length) failures.push("disclosed_fallback_visible_before_graph");
    if (escapedFrames.length) failures.push("pending_graph_frame_escaped_panel_bounds");
    if (!finalState.canvas_present) failures.push("graph_canvas_missing_after_load");
    if (finalState.loading_present) failures.push("pending_graph_frame_not_removed");
    if (finalState.disclosed_fallback_visible) failures.push("disclosed_fallback_remained_after_graph");

    const receipt = {
      schema_version: "swfipn.refresh_graph_frame_gate.v1",
      status: failures.length ? "fail" : "pass",
      generated_at: new Date().toISOString(),
      origin,
      harness: harness ? { mode: "self_started_static_export", pid: harness.pid, backend: harness.backend } : { mode: "configured_origin" },
      http_status: response?.status() || 0,
      checks: {
        pending_frame_observed: pendingFrames.length > 0,
        no_disclosed_fallback_before_graph: disclosedFrames.length === 0,
        pending_frame_bounded_to_panel: escapedFrames.length === 0,
        graph_populated: finalState.canvas_present,
        pending_frame_removed: !finalState.loading_present,
      },
      frames,
      console_errors: consoleErrors,
      screenshot: screenshotPath,
      failures,
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ status: receipt.status, failures, receipt: receiptPath, screenshot: screenshotPath }));
    gateFailed = failures.length > 0;
  } finally {
    await browser?.close();
    await harness?.stop();
  }
  if (gateFailed) process.exitCode = 1;
}

main().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    schema_version: "swfipn.refresh_graph_frame_gate.v1",
    status: "error",
    generated_at: new Date().toISOString(),
    origin: configuredOrigin || "self_started_static_export",
    error: error.message,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
