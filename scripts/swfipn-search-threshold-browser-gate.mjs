#!/usr/bin/env node
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-search-threshold-browser-gate-latest.json");

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

async function waitForOrigin(origin, child) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`static_server_exited_${child.exitCode}`);
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(5_000) });
      if (response.ok) return;
    } catch { /* retry until deadline */ }
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

function queryRequests(requests, value) {
  return requests.filter((href) => {
    const parsed = new URL(href);
    return parsed.searchParams.get("q") === value;
  });
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

  let browser;
  try {
    await waitForOrigin(origin, child);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const apiRequests = [];
    await page.route("**/*", async (route) => {
      const parsed = new URL(route.request().url());
      if (!parsed.pathname.startsWith("/api/") && !parsed.pathname.startsWith("/v1/")) {
        await route.continue();
        return;
      }
      apiRequests.push(parsed.href);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ status: "ok", fact: true, result_qualifier: "fact", data: { count: 0, rows: [], results: [] } }),
      });
    });

    const checks = [];
    const assertCheck = (id, pass, evidence) => {
      checks.push({ id, pass, evidence });
      if (!pass) throw new Error(`${id}: ${JSON.stringify(evidence)}`);
    };

    await page.goto(origin, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    const smartInput = page.getByRole("textbox", { name: "Search query" });
    let marker = apiRequests.length;
    await smartInput.fill("A");
    await page.waitForTimeout(450);
    assertCheck("smart_search_one_character_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));
    assertCheck("smart_search_one_character_prompt", await page.getByText("Enter at least 3 characters.", { exact: true }).isVisible(), { value: "A" });

    marker = apiRequests.length;
    await smartInput.fill("AB");
    await page.waitForTimeout(450);
    assertCheck("smart_search_two_characters_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));

    marker = apiRequests.length;
    await smartInput.fill("ABC");
    await page.waitForTimeout(650);
    const smartThree = queryRequests(apiRequests.slice(marker), "ABC");
    assertCheck("smart_search_three_characters_requests", smartThree.length >= 2, smartThree);

    for (const value of ["A", "AB", "ABC"]) {
      marker = apiRequests.length;
      await page.goto(`${origin}search/?q=${value}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(650);
      const sinceNavigation = apiRequests.slice(marker);
      const matching = queryRequests(sinceNavigation, value);
      assertCheck(`search_results_${value.length}_character_guard`, value.length < 3 ? sinceNavigation.length === 0 : matching.length >= 1, sinceNavigation);
    }

    await page.goto(`${origin}profiles/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Records" }).click();
    const filterInput = page.getByRole("searchbox", { name: "Filter" });
    marker = apiRequests.length;
    await filterInput.fill("A");
    await page.waitForTimeout(450);
    assertCheck("free_text_filter_one_character_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));

    marker = apiRequests.length;
    await filterInput.fill("AB");
    await page.waitForTimeout(450);
    assertCheck("free_text_filter_two_characters_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));

    marker = apiRequests.length;
    await filterInput.fill("ABC");
    await page.waitForTimeout(650);
    const filterThree = queryRequests(apiRequests.slice(marker), "ABC");
    assertCheck("free_text_filter_three_characters_requests", filterThree.length === 1, filterThree);

    await page.goto(`${origin}comparisons/`, { waitUntil: "networkidle" });
    const peerInput = page.getByTestId("competition-peer-search");
    marker = apiRequests.length;
    await peerInput.fill("A");
    await page.waitForTimeout(450);
    assertCheck("peer_search_one_character_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));

    marker = apiRequests.length;
    await peerInput.fill("AB");
    await page.waitForTimeout(450);
    assertCheck("peer_search_two_characters_no_request", apiRequests.slice(marker).length === 0, apiRequests.slice(marker));

    marker = apiRequests.length;
    await peerInput.fill("ABC");
    await page.waitForTimeout(650);
    const peerThree = queryRequests(apiRequests.slice(marker), "ABC");
    assertCheck("peer_search_three_characters_requests", peerThree.length === 1, peerThree);

    const receipt = {
      pass: checks.every((check) => check.pass),
      minimum_characters: 3,
      checked_surfaces: ["homepage_smart_search", "search_results_url", "server_backed_free_text_filter", "competition_peer_search"],
      checks,
    };
    fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
    console.log(JSON.stringify({ pass: receipt.pass, checks: checks.length, receipt: receiptPath }, null, 2));
  } finally {
    if (browser) await browser.close();
    await stopChild(child);
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
