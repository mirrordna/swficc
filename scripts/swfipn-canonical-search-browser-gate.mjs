#!/usr/bin/env node
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-canonical-search-browser-gate-latest.json");
const entityBudgetMs = 5_000;
const liveEntityBudgetMs = 8_000;
const newsBudgetMs = 8_000;
const resultCategories = ["Entities", "RFPs & Opportunities", "Transactions", "News & Articles", "People"];
const requiredPopulatedCategories = ["Entities", "Transactions", "News & Articles", "People"];

function candidateIdentity() {
  let gitSha = String(process.env.SWFIPN_CANDIDATE_GIT_SHA || "").trim();
  let gitDirty = /^(1|true|yes)$/i.test(String(process.env.SWFIPN_CANDIDATE_GIT_DIRTY || ""));
  if (!gitSha) {
    try {
      gitSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repoRoot, encoding: "utf8" }).trim();
      gitDirty = Boolean(execFileSync("git", ["status", "--porcelain"], { cwd: repoRoot, encoding: "utf8" }).trim());
    } catch {
      gitSha = "unknown";
      gitDirty = true;
    }
  }
  let assetVersion = "";
  try {
    assetVersion = String(JSON.parse(fs.readFileSync(path.join(outputDir, "swfipn-asset-version-latest.json"), "utf8")).version || "").trim();
  } catch {
    // Missing asset identity remains explicit in the receipt.
  }
  return { git_sha: gitSha, git_dirty: gitDirty, asset_version: assetVersion || null };
}

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
    if (child && child.exitCode !== null) throw new Error(`static_server_exited_${child.exitCode}`);
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

async function timedVisibility(locator, startedAt, timeout) {
  try {
    await locator.waitFor({ state: "visible", timeout });
    return { present: true, ms: Date.now() - startedAt };
  } catch {
    return { present: false, ms: Date.now() - startedAt };
  }
}

function normalizedResultIdentity(value) {
  try {
    const parsed = new URL(value);
    const target = ["/v1/signin", "/v1/signin/"].includes(parsed.pathname)
      ? new URL(parsed.searchParams.get("redirect") || "/", parsed.origin)
      : parsed;
    target.hash = "";
    const sorted = new URLSearchParams([...target.searchParams.entries()].sort(([left], [right]) => left.localeCompare(right)));
    const query = sorted.toString();
    return `${target.hostname.toLowerCase()}${target.pathname.replace(/\/$/, "") || "/"}${query ? `?${query}` : ""}`;
  } catch {
    return "";
  }
}

async function orderedResultSet(page) {
  const categories = {};
  for (const category of resultCategories) {
    const section = page.locator("section").filter({
      has: page.getByRole("heading", { name: category, exact: true }),
    }).first();
    const rawRows = await section.locator("a").evaluateAll((anchors) => anchors.map((anchor) => {
      const spans = [...anchor.querySelectorAll("span")];
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      return {
        label: clean(spans[0]?.textContent),
        detail: clean(spans[1]?.textContent),
        href: anchor.getAttribute("href") || "",
      };
    })).catch(() => []);
    categories[category] = rawRows.map((row) => ({
      label: row.label,
      detail: row.detail,
      source_identity: normalizedResultIdentity(row.href),
    }));
  }
  const canonical = JSON.stringify(categories);
  return {
    categories,
    counts: Object.fromEntries(resultCategories.map((category) => [category, categories[category].length])),
    fingerprint_sha256: createHash("sha256").update(canonical).digest("hex"),
  };
}

async function waitForSearchLanes(page, networkTrace, timeout = 30_000) {
  const requiredPaths = [
    "/api/v1/public/search",
    "/api/source-data/search/v1",
    "/api/source-intelligence/news/v1",
    "/api/people/search/v1",
    "/api/entity-transactions/v1",
  ];
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const responsePaths = networkTrace
      .filter((event) => event.event === "response" && event.status >= 200 && event.status < 300)
      .map((event) => event.path);
    const missing = requiredPaths.filter((required) => !responsePaths.some((observed) => observed.startsWith(required)));
    const searching = await page.getByText("Searching this category…", { exact: true }).count();
    if (!missing.length && searching === 0) {
      return { settled: true, required_paths: requiredPaths, missing_paths: [] };
    }
    await page.waitForTimeout(100);
  }
  const responsePaths = networkTrace
    .filter((event) => event.event === "response" && event.status >= 200 && event.status < 300)
    .map((event) => event.path);
  return {
    settled: false,
    required_paths: requiredPaths,
    missing_paths: requiredPaths.filter((required) => !responsePaths.some((observed) => observed.startsWith(required))),
  };
}

async function runQuery(browser, origin, testCase) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const startedAt = Date.now();
  const networkTrace = [];
  const relevantPath = (value) => /\/api\/(?:v1\/public\/search|source-data\/search\/v1|source-intelligence\/news\/v1|people\/search\/v1|entity-transactions\/v1)/.test(value);
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (!relevantPath(url.pathname)) return;
    const headers = response.headers();
    networkTrace.push({
      event: "response",
      at_ms: Date.now() - startedAt,
      path: `${url.pathname}${url.search}`,
      status: response.status(),
      cache_control: headers["cache-control"] || null,
      proxy_cache: headers["x-swfipn-proxy-cache"] || null,
      search_render: headers["x-swfipn-search-render"] || null,
    });
  });
  page.on("requestfailed", (request) => {
    const url = new URL(request.url());
    if (!relevantPath(url.pathname)) return;
    networkTrace.push({
      event: "request_failed",
      at_ms: Date.now() - startedAt,
      path: `${url.pathname}${url.search}`,
      error: request.failure()?.errorText || "unknown",
    });
  });
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-dashboard-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    await page.getByRole("textbox", { name: "Search query" }).fill(testCase.query);
    const entitySection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "Entities", exact: true }),
    }).first();
    const peopleSection = page.locator("section").filter({
      has: page.getByRole("heading", { name: "People", exact: true }),
    }).first();
    const liveEntityLink = entitySection.getByText(testCase.entity, { exact: true }).first();
    // Observe independent lanes concurrently. Serial awaits incorrectly attribute
    // a slow people/news lane to an entity that may already be visible.
    const [canonicalIdentity, liveEntity, newsResult, peopleResult] = await Promise.all([
      timedVisibility(page.getByTestId("smart-search-canonical-identity"), startedAt, 5_000),
      timedVisibility(liveEntityLink, startedAt, 25_000),
      timedVisibility(page.getByText(new RegExp(testCase.news), { exact: false }).first(), startedAt, 15_000),
      timedVisibility(peopleSection.locator('a[href*="%2Fv1%2Fpeople%2F"], a[href*="/v1/people/"]').first(), startedAt, 30_000),
    ]);
    const entityMs = canonicalIdentity.ms;
    const liveEntityMs = liveEntity.ms;
    const newsMs = newsResult.ms;
    const canonicalSourceLink = page.getByTestId("smart-search-canonical-source-link");
    const canonicalSourceHref = canonicalIdentity.present && await canonicalSourceLink.count()
      ? await canonicalSourceLink.evaluate((node) => (
          node.getAttribute("href")
          || node.querySelector("a")?.getAttribute("href")
          || ""
        ))
      : "";
    const liveEntityPresent = liveEntity.present;
    const liveEntityHref = liveEntityPresent
      ? await liveEntityLink.evaluate((node) => node.closest("a")?.getAttribute("href") || "")
      : "";
    const sourceLinkMatchesLiveResult = Boolean(canonicalSourceHref)
      && normalizeComparableUrl(canonicalSourceHref) === normalizeComparableUrl(liveEntityHref);
    const laneSettlement = await waitForSearchLanes(page, networkTrace);
    const resultSet = await orderedResultSet(page);
    const resultSetComplete = requiredPopulatedCategories.every((category) => resultSet.counts[category] > 0);
    const resultSourcesComplete = Object.values(resultSet.categories)
      .flat()
      .every((row) => Boolean(row.source_identity));
    const body = await page.locator("body").innerText();
    const peopleSectionText = await peopleSection.innerText().catch(() => "");
    const screenshotPath = path.join(outputDir, `swfipn-canonical-search-${testCase.id}-latest.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    const modalNetworkTrace = [...networkTrace];
    const modalPublicSearchNotSharedCacheable = modalNetworkTrace
      .filter((event) => event.path?.startsWith("/api/v1/public/search"))
      .every((event) => String(event.cache_control || "").startsWith("no-store"));
    networkTrace.length = 0;
    const fullPageStartedAt = Date.now();
    await Promise.all([
      page.waitForURL(/\/search\/?(?:\?|$)/, { timeout: 10_000 }),
      page.getByRole("link", { name: "View all results", exact: true }).click(),
    ]);
    const fullPageSettlement = await waitForSearchLanes(page, networkTrace, 35_000);
    await page.locator('[data-search-results-ready="true"]').waitFor({ state: "attached", timeout: 35_000 });
    const freshnessReceipt = page.getByTestId("search-source-freshness");
    const freshnessVisible = await freshnessReceipt.isVisible().catch(() => false);
    const sourceGeneratedAt = freshnessVisible
      ? await freshnessReceipt.getAttribute("data-source-generated-at")
      : null;
    const sourceOldestGeneratedAt = freshnessVisible
      ? await freshnessReceipt.getAttribute("data-source-oldest-generated-at")
      : null;
    const sourcePacketCount = freshnessVisible
      ? Number(await freshnessReceipt.getAttribute("data-source-packet-count") || 0)
      : 0;
    const sourceFreshnessCurrent = freshnessVisible
      ? await freshnessReceipt.getAttribute("data-source-freshness-current") === "true"
      : false;
    const sourceFreshnessSpanMs = freshnessVisible
      ? Number(await freshnessReceipt.getAttribute("data-source-freshness-span-ms") || Number.NaN)
      : Number.NaN;
    const expectedPerson = peopleSectionText.split("\n").filter(Boolean)[1] || "__missing_person__";
    const detailedPeopleResult = await timedVisibility(
      page.getByText(expectedPerson, { exact: true }).first(),
      fullPageStartedAt,
      5_000,
    );
    const detailedBody = await page.locator("body").innerText();
    const detailedEntityLink = page.getByRole("link", { name: testCase.entity, exact: true }).first();
    const detailedEntityPresent = await detailedEntityLink.isVisible().catch(() => false);
    const detailedEntityRow = detailedEntityPresent
      ? await detailedEntityLink.locator("xpath=ancestor::tr[1]").innerText().catch(() => "")
      : "";
    const detailedNewsPresent = detailedBody.includes(testCase.news);
    const detailedPeoplePresent = detailedPeopleResult.present;
    const detailedAumPass = !testCase.aumDisplay || detailedEntityRow.includes(testCase.aumDisplay);
    const detailedForbiddenAbsent = testCase.forbidden.every((value) => !detailedBody.includes(value));
    const detailedNewsRequests = networkTrace.filter((event) => event.path?.startsWith("/api/source-intelligence/news/v1"));
    const detailedNewsQueryBound = detailedNewsRequests.length > 0
      && detailedNewsRequests.every((event) => /[?&]q=/.test(event.path));
    const detailedPublicSearchNotSharedCacheable = networkTrace
      .filter((event) => event.path?.startsWith("/api/v1/public/search"))
      .every((event) => String(event.cache_control || "").startsWith("no-store"));
    const detailedScreenshotPath = path.join(outputDir, `swfipn-canonical-search-${testCase.id}-view-all-latest.png`);
    await page.screenshot({ path: detailedScreenshotPath, fullPage: true });
    return {
      id: testCase.id,
      pass: canonicalIdentity.present
        && liveEntityPresent
        && newsResult.present
        && peopleResult.present
        && body.includes(testCase.entity)
        && body.includes(testCase.news)
        && testCase.forbidden.every((value) => !body.includes(value))
        && entityMs <= newsMs
        && entityMs <= entityBudgetMs
        && liveEntityMs <= liveEntityBudgetMs
        && newsMs <= newsBudgetMs
        && sourceLinkMatchesLiveResult
        && modalPublicSearchNotSharedCacheable
        && laneSettlement.settled
        && resultSetComplete
        && resultSourcesComplete
        && fullPageSettlement.settled
        && freshnessVisible
        && Boolean(sourceGeneratedAt)
        && Boolean(sourceOldestGeneratedAt)
        && sourcePacketCount > 0
        && sourceFreshnessCurrent
        && Number.isFinite(sourceFreshnessSpanMs)
        && detailedEntityPresent
        && detailedNewsPresent
        && detailedPeoplePresent
        && detailedAumPass
        && detailedForbiddenAbsent
        && detailedNewsQueryBound
        && detailedPublicSearchNotSharedCacheable,
      entity_ms: entityMs,
      live_entity_ms: liveEntityMs,
      news_ms: newsMs,
      performance_budget_ms: { canonical_entity: entityBudgetMs, live_entity: liveEntityBudgetMs, news: newsBudgetMs },
      performance_pass: entityMs <= entityBudgetMs && liveEntityPresent && liveEntityMs <= liveEntityBudgetMs && newsMs <= newsBudgetMs,
      canonical_source_href: canonicalSourceHref,
      live_entity_href: liveEntityHref,
      canonical_identity_present: canonicalIdentity.present,
      live_entity_result_present: liveEntityPresent,
      news_result_present: newsResult.present,
      people_result_present: peopleResult.present,
      people_section_text: peopleSectionText,
      source_link_matches_live_result: sourceLinkMatchesLiveResult,
      public_search_not_shared_cacheable: modalPublicSearchNotSharedCacheable,
      search_lanes_settled: laneSettlement.settled,
      search_lane_settlement: laneSettlement,
      deterministic_result_set: resultSet.categories,
      deterministic_result_counts: resultSet.counts,
      deterministic_result_fingerprint_sha256: resultSet.fingerprint_sha256,
      deterministic_result_set_complete: resultSetComplete,
      deterministic_result_sources_complete: resultSourcesComplete,
      network_trace: modalNetworkTrace.sort((left, right) => left.at_ms - right.at_ms),
      detailed_results: {
        elapsed_ms: Date.now() - fullPageStartedAt,
        search_lanes_settled: fullPageSettlement.settled,
        search_lane_settlement: fullPageSettlement,
        source_freshness_visible: freshnessVisible,
        source_generated_at: sourceGeneratedAt,
        source_oldest_generated_at: sourceOldestGeneratedAt,
        source_packet_count: sourcePacketCount,
        source_freshness_current: sourceFreshnessCurrent,
        source_freshness_span_ms: sourceFreshnessSpanMs,
        entity_present: detailedEntityPresent,
        entity_row: detailedEntityRow,
        news_present: detailedNewsPresent,
        people_present: detailedPeoplePresent,
        expected_aum: testCase.aumDisplay || null,
        aum_pass: detailedAumPass,
        forbidden_absent: detailedForbiddenAbsent,
        news_requests_query_bound: detailedNewsQueryBound,
        public_search_not_shared_cacheable: detailedPublicSearchNotSharedCacheable,
        network_trace: networkTrace.sort((left, right) => left.at_ms - right.at_ms),
        screenshot: detailedScreenshotPath,
        screenshot_sha256: fileSha256(detailedScreenshotPath),
      },
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

function normalizeComparableUrl(value) {
  try {
    const parsed = new URL(value);
    if (["/v1/signin", "/v1/signin/"].includes(parsed.pathname)) {
      const redirect = parsed.searchParams.get("redirect") || "";
      if (redirect.startsWith("/")) return new URL(redirect, parsed.origin).href.replace(/\/$/, "");
    }
    parsed.hash = "";
    parsed.search = "";
    return parsed.href.replace(/\/$/, "");
  } catch {
    return "";
  }
}

async function runRapidReplacement(browser, origin) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.locator('[data-dashboard-ready="true"]').waitFor({ state: "attached", timeout: 30_000 });
    await page.getByRole("button", { name: "Open Global Search" }).click();
    const input = page.getByRole("textbox", { name: "Search query" });
    await input.fill("ADIA");
    await page.waitForTimeout(40);
    await input.fill("Hong Kong Investment Corporation");
    await page.getByText("Hong Kong Investment Corporation", { exact: true }).first().waitFor({ timeout: 25_000 });
    const body = await page.locator("body").innerText();
    return {
      id: "rapid_query_replacement",
      pass: body.includes("Matched institution: Hong Kong Investment Corporation")
        && !body.includes("Matched institution: Abu Dhabi Investment Authority")
        && !body.includes("Kapadia")
        && !body.includes("Nadia"),
      final_query: await input.inputValue(),
    };
  } finally {
    await page.close();
  }
}

async function main() {
  fs.mkdirSync(outputDir, { recursive: true });
  const configuredOrigin = String(process.env.SWFIPN_ORIGIN || "").trim();
  const requestedTargetMode = String(process.env.SWFIPN_TARGET_MODE || "").trim().toLowerCase();
  const liveTarget = Boolean(configuredOrigin) && requestedTargetMode !== "candidate";
  const sourceBackendOrigin = new URL(
    String(process.env.SWFIPN_BACKEND_ORIGIN || (liveTarget ? configuredOrigin : "https://dashboard.swfi.com")),
  ).origin;
  let child = null;
  let origin;
  if (configuredOrigin) {
    origin = `${configuredOrigin.replace(/\/+$/, "")}/`;
  } else {
    if (!fs.existsSync(path.join(repoRoot, "out", "index.html"))) {
      throw new Error("built_static_export_missing: run npm run build first");
    }
    const port = await reservePort();
    origin = `http://127.0.0.1:${port}/swficc/`;
    child = spawn("python3", [
      path.join(repoRoot, "scripts", "serve-static-with-headers.py"),
      "--host", "127.0.0.1",
      "--port", String(port),
      "--root", path.join(repoRoot, "out"),
      "--backend", sourceBackendOrigin,
      "--backend-timeout", "12",
    ], { cwd: repoRoot, stdio: "ignore" });
  }

  let browser;
  try {
    await waitForOrigin(origin, child);
    const { chromium } = loadPlaywright();
    browser = await chromium.launch({ headless: true });
    const firstPaintPage = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    await firstPaintPage.goto(origin, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await firstPaintPage.locator("[data-dashboard-ready]").waitFor({ state: "attached", timeout: 5_000 });
    const firstPaintBody = await firstPaintPage.locator("body").innerText();
    const firstPaintAssertions = {
      norway_row: firstPaintBody.includes("Norway Government Pension Fund Global"),
      aum_total_label: firstPaintBody.includes("TOP-RANKED AUM TOTAL"),
      aum_date_coverage: /\d+\/\d+ dated/.test(firstPaintBody),
      refresh_scope_label: firstPaintBody.includes("Dashboard refreshed"),
    };
    const topAumFirstPaint = Object.values(firstPaintAssertions).every(Boolean);
    await firstPaintPage.close();

    const cases = [
      { id: "adia", query: "ADIA", entity: "Abu Dhabi Investment Authority", news: "ADIA and Mubadala Back EQT", aumDisplay: "$1.13T", forbidden: ["Kapadia", "Nadia"] },
      { id: "hkic", query: "Hong Kong Investment Corporation", entity: "Hong Kong Investment Corporation", news: "HKIC Supports Government Budget", forbidden: ["HealthKick", "MaRS HealthKick"] },
    ];
    const checks = [];
    for (const testCase of cases) checks.push(await runQuery(browser, origin, testCase));
    checks.push(await runRapidReplacement(browser, origin));
    checks.unshift({ id: "top_aum_first_paint", pass: topAumFirstPaint, assertions: firstPaintAssertions });
    const testedReleaseGitSha = liveTarget ? String(process.env.SWFIPN_RELEASE_GIT_SHA || "").trim() : "";
    const testedReleaseAssetVersion = liveTarget ? String(process.env.SWFIPN_RELEASE_ASSET_VERSION || "").trim() : "";
    const releaseIdentityPinned = !liveTarget
      || (/^[a-f0-9]{40}$/i.test(testedReleaseGitSha) && Boolean(testedReleaseAssetVersion));
    const candidate = liveTarget ? null : candidateIdentity();
    const receipt = {
      schema_version: "swfipn.canonical_search_browser_gate.v2",
      generated_at: new Date().toISOString(),
      evidence_class: liveTarget
        ? "LIVE_TARGET_SURFACE_BEHAVIOR_NOT_GLOBAL_ACCEPTANCE"
        : "CANDIDATE_WITH_LIVE_SWFI_SOURCES_NOT_PRODUCTION_ACCEPTANCE",
      target_origin: origin,
      target_mode: liveTarget ? "live" : (configuredOrigin ? "remote_candidate" : "local_candidate"),
      source_backend_origin: sourceBackendOrigin,
      tested_release_git_sha: testedReleaseGitSha || null,
      tested_release_asset_version: testedReleaseAssetVersion || null,
      release_identity_pinned: releaseIdentityPinned,
      candidate_identity: candidate,
      status: checks.every((check) => check.pass) && releaseIdentityPinned ? "pass" : "fail",
      checked_scope: [
        "top_aum_first_paint",
        "adia_entity_news_people_semantics",
        "hkic_entity_news_people_semantics",
        "adia_view_all_enriched_aum_and_query_bound_news",
        "hkic_view_all_query_bound_news_and_people",
        "detailed_search_source_freshness_receipt",
        "public_search_no_shared_stale_cache",
        ...(liveTarget ? ["live_target_browser_behavior"] : []),
      ],
      unchecked_scope: liveTarget
        ? ["stakeholder_acceptance", "Mongo_record_parity", "global_release_acceptance"]
        : ["deployed_production", "stakeholder_acceptance", "Mongo_record_parity"],
      bad_news: releaseIdentityPinned ? [] : ["live_target_release_identity_unpinned"],
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
