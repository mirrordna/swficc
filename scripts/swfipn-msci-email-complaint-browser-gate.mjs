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
      if (parsed.pathname === "/api/institution-types/v1") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(packet([
            { name: "Sovereign Wealth Fund", count: 200 },
            { name: "Public Pension", count: 100 },
          ])),
        });
        return;
      }
      if (parsed.pathname === "/api/source-data/search/v1" && parsed.searchParams.get("collection") === "entities" && parsed.searchParams.get("entity_type")) {
        const entityType = parsed.searchParams.get("entity_type") || "";
        const row = {
          _id: "507f1f77bcf86cd799439011",
          name: "Canonical exact-type result",
          entity_type: entityType,
          type: entityType,
          country: "United States",
          region: "North America",
          defunct: false,
          entity_status: "active",
          source_url: "https://www.swfi.com/v1/entities/507f1f77bcf86cd799439011",
        };
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({
            status: "ok",
            fact: true,
            result_qualifier: "fact",
            data: {
              collection: "entities",
              count: 1,
              rows: [row],
              results: [row],
              page: Number(parsed.searchParams.get("page") || 1),
              requested_limit: Number(parsed.searchParams.get("limit") || 25),
              has_more: false,
              filters: {
                query: parsed.searchParams.get("q") || "",
                entity_type: entityType,
                entity_type_match: parsed.searchParams.get("entity_type_match"),
                region: parsed.searchParams.get("region") || "",
                include_defunct: false,
              },
            },
          }),
        });
        return;
      }
      if (parsed.pathname === "/api/live-opportunities/v1") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify(packet([
            {
              title: "Source-backed RFP partition record",
              type: "RFP",
              record_type: "Not disclosed",
              institution: "RFP institution",
              due_at: "2026-09-15",
              source_url: "https://www.swfi.com/v1/rfps/101",
            },
            {
              title: "Source-backed Opportunity partition record",
              type: "Opportunity",
              institution: "Opportunity institution",
              due_at: "2026-09-30",
              source_url: "https://www.swfi.com/v1/opportunities/202",
            },
            {
              title: "Source-backed non-RFP partition record",
              type: "Manager Search",
              institution: "Manager search institution",
              due_at: "2026-10-15",
              source_url: "https://www.swfi.com/v1/opportunities/303",
            },
          ])),
        });
        return;
      }
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
    checks.push({
      id: "home_kpi_semantics_visible_and_executable",
      ok: await page.locator("[data-display-id^='home-kpi-']").count() > 0
        && await page.getByText(/Sum of comparable USD AUM for the currently loaded top-ranked active sovereign wealth funds/i).isVisible(),
    });
    await page.getByRole("button", { name: "RFPs", exact: true }).click();
    const rfpPartitionVisible = await page.getByRole("link", { name: "Source-backed RFP partition record", exact: true }).isVisible();
    await page.getByRole("button", { name: "Opportunities", exact: true }).click();
    const opportunityPartitionVisible = await page.getByRole("link", { name: "Source-backed Opportunity partition record", exact: true }).isVisible();
    const nonRfpPartitionVisible = await page.getByRole("link", { name: "Source-backed non-RFP partition record", exact: true }).isVisible();
    checks.push({
      id: "home_combined_compass_packet_partitions_canonical_type",
      ok: rfpPartitionVisible && opportunityPartitionVisible && nonRfpPartitionVisible,
      observed: {
        rfp_partition_visible: rfpPartitionVisible,
        canonical_type_overrode_stale_alias: rfpPartitionVisible,
        opportunity_partition_visible: opportunityPartitionVisible,
        disclosed_non_rfp_partition_visible: nonRfpPartitionVisible,
      },
    });

    await page.goto(`${origin}profiles/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Records", exact: true }).click();
    const profileRequestMarker = requests.length;
    await page.getByTestId("entity-type-filter").selectOption("Sovereign Wealth Fund");
    await page.getByTestId("entity-type-apply").click();
    await page.waitForTimeout(500);
    const profileRequests = requests.slice(profileRequestMarker)
      .map((href) => new URL(href))
      .filter((url) => url.pathname === "/api/source-data/search/v1" && url.searchParams.get("collection") === "entities");
    checks.push({
      id: "canonical_entity_type_drives_exact_source_request",
      ok: profileRequests.some((url) => url.searchParams.get("entity_type") === "Sovereign Wealth Fund" && url.searchParams.get("entity_type_match") === "exact")
        && profileRequests.some((url) => url.searchParams.get("limit") === "25" && url.searchParams.get("page") === "1")
        && await page.getByText(/Source count and pagination use the same exact predicate/i).isVisible()
        && await page.getByText("Showing 1 of 1", { exact: false }).first().isVisible(),
      observed_requests: profileRequests.map((url) => url.href),
    });

    await page.goto(`${origin}mandates/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Records", exact: true }).click();
    checks.push({
      id: "mandate_source_filters_visible",
      ok: await page.getByTestId("mandates-record-type-filter").isVisible()
        && await page.getByTestId("mandates-country-filter").isVisible()
        && await page.getByTestId("mandates-region-filter").isVisible()
        && await page.getByTestId("mandates-postedFrom-filter").isVisible()
        && await page.getByTestId("mandates-dueTo-filter").isVisible()
        && await page.getByText("There is no undefined Period filter.", { exact: false }).isVisible(),
    });
    const mandateRequestMarker = requests.length;
    await page.getByTestId("source-table-filter").fill("energy transition");
    await page.getByTestId("mandates-record-type-filter").selectOption("opportunity");
    await page.getByTestId("mandates-country-filter").fill("United States");
    await page.getByTestId("mandates-region-filter").fill("North America");
    await page.getByTestId("mandates-postedFrom-filter").fill("2026-08-01");
    await page.getByTestId("mandates-postedTo-filter").fill("2026-08-31");
    await page.getByTestId("mandates-dueFrom-filter").fill("2026-09-01");
    await page.getByTestId("mandates-dueTo-filter").fill("2026-10-31");
    await page.getByTestId("mandates-apply-filters").click();
    await page.waitForTimeout(750);
    const mandateRequests = requests.slice(mandateRequestMarker)
      .map((href) => new URL(href))
      .filter((url) => url.pathname === "/api/live-opportunities/v1");
    const composedMandateRequest = mandateRequests.find((url) =>
      url.searchParams.get("record_type") === "opportunity"
      && url.searchParams.get("q") === "energy transition"
      && url.searchParams.get("country") === "United States"
      && url.searchParams.get("region") === "North America"
      && url.searchParams.get("posted_from") === "2026-08-01"
      && url.searchParams.get("posted_to") === "2026-08-31"
      && url.searchParams.get("due_from") === "2026-09-01"
      && url.searchParams.get("due_to") === "2026-10-31");
    checks.push({
      id: "mandate_filters_drive_composed_source_request",
      ok: Boolean(composedMandateRequest),
      observed_requests: mandateRequests.map((url) => url.href),
    });
    await page.getByTestId("mandates-dueFrom-filter").fill("2026-11-01");
    await page.getByTestId("mandates-dueTo-filter").fill("2026-10-31");
    await page.getByTestId("mandates-apply-filters").click();
    checks.push({
      id: "mandate_reversed_date_validation_visible",
      ok: await page.getByTestId("mandates-filter-help").getByText("Due from cannot be after due to.", { exact: true }).isVisible(),
    });

    await page.goto(`${origin}allocators/`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "Records", exact: true }).click();
    checks.push({
      id: "allocator_source_filters_visible",
      ok: await page.getByTestId("allocator-country-filter").isVisible()
        && await page.getByTestId("allocator-region-filter").isVisible()
        && await page.getByTestId("allocator-entityType-filter").isVisible()
        && await page.getByTestId("allocator-aumMin-filter").isVisible()
        && await page.getByTestId("allocator-aumMax-filter").isVisible()
        && await page.getByText(/AUM bounds exclude non-USD and undisclosed AUM; no FX conversion is applied/i).isVisible(),
    });
    const allocatorRequestMarker = requests.length;
    await page.getByTestId("source-table-filter").fill("public pension");
    await page.getByTestId("allocator-country-filter").fill("United States");
    await page.getByTestId("allocator-region-filter").fill("North America");
    await page.getByTestId("allocator-entityType-filter").fill("Public Pension");
    await page.getByTestId("allocator-aumMin-filter").fill("1000000");
    await page.getByTestId("allocator-aumMax-filter").fill("5000000");
    await page.getByTestId("allocator-apply-exact-filters").click();
    await page.waitForTimeout(750);
    const allocatorRequests = requests.slice(allocatorRequestMarker)
      .map((href) => new URL(href))
      .filter((url) => url.pathname === "/api/allocator-activity/v1");
    const composedAllocatorRequest = allocatorRequests.find((url) =>
      url.searchParams.get("q") === "public pension"
      && url.searchParams.get("country") === "United States"
      && url.searchParams.get("region") === "North America"
      && url.searchParams.get("entity_type") === "Public Pension"
      && url.searchParams.get("aum_min") === "1000000"
      && url.searchParams.get("aum_max") === "5000000");
    checks.push({
      id: "allocator_filters_drive_composed_source_request",
      ok: Boolean(composedAllocatorRequest),
      observed_requests: allocatorRequests.map((url) => url.href),
    });
    await page.getByTestId("allocator-aumMin-filter").fill("6000000");
    await page.getByTestId("allocator-aumMax-filter").fill("5000000");
    await page.getByTestId("allocator-apply-exact-filters").click();
    checks.push({
      id: "allocator_reversed_aum_validation_visible",
      ok: await page.getByTestId("allocator-filter-help").getByText("Minimum AUM cannot exceed maximum AUM.", { exact: true }).isVisible(),
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
