#!/usr/bin/env node
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire("/Users/mirror-pro/repos/swfireskin/package.json");
const { chromium } = require("playwright");

const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:4317").replace(/\/swficc\/?$/, "").replace(/\/$/, "");
const PAGE_URL = `${ORIGIN}/swficc/comparisons/`;
const checks = [];

function check(id, pass, evidence) {
  checks.push({ id, status: pass ? "PASS" : "FAIL", evidence: String(evidence || "").slice(0, 600) });
}

function dataRows(packet) {
  return packet?.data?.rows || packet?.data?.results || [];
}

function entityId(row) {
  const direct = row?.entity_id || row?.source_record_id || row?.id || "";
  if (/^[a-f0-9]{24}$/i.test(String(direct))) return String(direct);
  return String(row?.source_url || row?.swfi_url || "").match(/\/v1\/entities\/([a-f0-9]{24})/i)?.[1] || "";
}

async function json(path) {
  const response = await fetch(`${ORIGIN}${path}`, { headers: { accept: "application/json", "X-SWFIPN-Public": "1" } });
  if (!response.ok) throw new Error(`${path}: HTTP ${response.status}`);
  return response.json();
}

const sourcePacket = await json("/api/source-data/search/v1?collection=entities&limit=100&page=1");
const sourceRows = dataRows(sourcePacket).filter((row) => entityId(row) && row?.name && row?.type);
if (sourceRows.length < 5) throw new Error(`Entity candidate source returned only ${sourceRows.length} usable rows`);

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
page.setDefaultTimeout(90_000);

try {
  await page.goto(PAGE_URL, { waitUntil: "domcontentloaded", timeout: 90_000 });
  const workbench = page.getByTestId("competition-analysis");
  await workbench.waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="competition-candidate"][data-competition-selected="true"]').length >= 2);

  const initialSelected = await workbench.locator('[data-testid="competition-candidate"][data-competition-selected="true"]').evaluateAll((items) => items.map((item) => item.getAttribute("data-competition-name")));
  const initialRows = initialSelected.map((name) => sourceRows.find((row) => row.name === name)).filter(Boolean);
  const peerType = initialRows[0]?.type || "";
  check("default_like_for_like_set", initialRows.length >= 2 && initialRows.every((row) => row.type === peerType), `${initialSelected.join(" | ")} :: ${peerType}`);

  const sameTypeCandidate = sourceRows.find((row) => row.type === peerType && !initialSelected.includes(row.name));
  if (!sameTypeCandidate) throw new Error(`No additional ${peerType} candidate found`);
  const search = page.getByTestId("competition-peer-search");
  await search.fill(sameTypeCandidate.name);
  const addCandidate = workbench.locator(`[data-testid="competition-candidate"][data-competition-name="${sameTypeCandidate.name.replaceAll('"', '\\"')}"]`);
  await addCandidate.waitFor({ state: "visible" });
  check("search_returns_source_candidate", await addCandidate.getAttribute("data-peer-type-match") === "true", sameTypeCandidate.name);
  await addCandidate.click();
  await page.waitForFunction((name) => document.querySelector(`[data-testid="competition-candidate"][data-competition-name="${CSS.escape(name)}"]`)?.getAttribute("data-competition-selected") === "true", sameTypeCandidate.name);
  check("add_institution", await workbench.locator('[data-testid="competition-candidate"][data-competition-selected="true"]').count() === 4, `added=${sameTypeCandidate.name}`);

  const differentTypeCandidate = sourceRows.find((row) => row.type !== peerType && !initialSelected.includes(row.name));
  if (!differentTypeCandidate) throw new Error("No different-type candidate found");
  await search.fill(differentTypeCandidate.name);
  const rejectedCandidate = workbench.locator(`[data-testid="competition-candidate"][data-competition-name="${differentTypeCandidate.name.replaceAll('"', '\\"')}"]`);
  await rejectedCandidate.waitFor({ state: "visible" });
  check(
    "same_type_guard",
    await rejectedCandidate.isDisabled() && await rejectedCandidate.getAttribute("data-peer-type-match") === "false",
    `${differentTypeCandidate.name} (${differentTypeCandidate.type}) rejected from ${peerType}`,
  );

  await search.fill(sameTypeCandidate.name);
  await addCandidate.waitFor({ state: "visible" });
  const selectedCardsForAdded = await workbench.locator(`[data-testid="competition-candidate"][data-competition-name="${sameTypeCandidate.name.replaceAll('"', '\\"')}"][data-competition-selected="true"]`).count();
  const matchingHeaders = await workbench.locator(`[data-testid="competition-profile-link"][data-competition-name="${sameTypeCandidate.name.replaceAll('"', '\\"')}"]`).count();
  check("duplicate_prevention_and_four_peer_cap", selectedCardsForAdded === 1 && matchingHeaders === 1, `selected_cards=${selectedCardsForAdded} columns=${matchingHeaders}`);

  await workbench.locator(`[data-testid="competition-remove-peer"][data-competition-name="${sameTypeCandidate.name.replaceAll('"', '\\"')}"]`).click();
  await page.waitForFunction((name) => ![...document.querySelectorAll('[data-testid="competition-profile-link"]')].some((item) => item.getAttribute("data-competition-name") === name), sameTypeCandidate.name);
  check("remove_institution", await workbench.locator('[data-testid="competition-profile-link"]').count() === 3, `removed=${sameTypeCandidate.name}`);

  const firstMakeAnchor = workbench.getByRole("button", { name: "Make anchor" }).first();
  const anchorContainer = firstMakeAnchor.locator("..");
  const nextAnchorName = (await anchorContainer.innerText()).replace(/Make anchor|Remove/g, "").trim();
  await firstMakeAnchor.click();
  await page.waitForFunction((name) => document.querySelector('[aria-label="Selected comparison institutions"]')?.textContent?.includes(`Anchor: ${name}`), nextAnchorName);
  check("anchor_change", (await workbench.locator('th span').filter({ hasText: "Anchor" }).count()) === 1, `anchor=${nextAnchorName}`);

  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("ids")?.split(",").length === 3);
  const shareUrl = page.url();
  const shareIds = new URL(shareUrl).searchParams.get("ids")?.split(",") || [];
  check("shareable_entity_id_state", shareIds.length === 3 && shareIds.every((id) => /^[a-f0-9]{24}$/i.test(id)), shareUrl);
  await page.reload({ waitUntil: "domcontentloaded", timeout: 90_000 });
  await page.getByTestId("competition-analysis").waitFor({ state: "visible" });
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="competition-profile-link"]').length === 3);
  check("share_state_restoration", await page.getByTestId("competition-analysis").locator('[data-testid="competition-profile-link"]').count() === 3, shareIds.join(","));

  const restoredWorkbench = page.getByTestId("competition-analysis");
  await page.waitForFunction(() => (document.querySelector('[data-testid="competition-analysis"]')?.textContent || "").includes("Transaction totals: 3 of 3"));
  const headers = await restoredWorkbench.locator('[data-testid="competition-comparison-table"] thead th').allTextContents();
  const anchorName = headers[1].replace(/Anchor$/i, "").trim();
  const anchorRow = sourceRows.find((row) => row.name === anchorName) || { name: anchorName, source_url: `https://www.swfi.com/v1/entities/${shareIds[0]}` };
  const anchorId = entityId(anchorRow) || shareIds[0];
  const transactionPacket = await json(`/api/entity-transactions/v1?entity_id=${encodeURIComponent(anchorId)}&limit=1`);
  const expectedTransactions = Number(transactionPacket?.data?.total_transactions);
  const transactionRow = restoredWorkbench.locator('[data-testid="competition-comparison-table"] tbody tr').filter({ has: page.getByText("Total Transactions", { exact: true }) });
  const transactionText = await transactionRow.locator("td").nth(1).innerText();
  check("exact_transaction_total_parity", Number.isFinite(expectedTransactions) && transactionText.includes(expectedTransactions.toLocaleString("en-US")), `api=${expectedTransactions} ui=${transactionText}`);

  const profilePacket = await json(`/api/profiles/${encodeURIComponent(anchorId)}/v1`);
  const strategyFields = profilePacket?.data?.profile?.modules?.strategy?.fields || {};
  const allocationKeys = ["Public Equity", "Fixed Income", "Private Equity", "Private Credit", "Real Estate", "Infrastructure", "Hedge Funds", "Natural Resources", "Cash", "Other"];
  const firstAllocationKey = allocationKeys.find((key) => strategyFields[key] && strategyFields[key] !== "Not disclosed");
  const allocationRow = restoredWorkbench.locator('[data-testid="competition-comparison-table"] tbody tr').filter({ has: page.getByText("Asset Allocation", { exact: true }) });
  const allocationText = await allocationRow.locator("td").nth(1).innerText();
  const allocationParity = firstAllocationKey
    ? allocationText.includes(firstAllocationKey)
    : allocationText.includes("Not disclosed");
  check("profile_allocation_parity", allocationParity, `field=${firstAllocationKey || "none"} ui=${allocationText.slice(0, 240)}`);

  const firstProfileHref = await restoredWorkbench.getByTestId("competition-profile-link").first().getAttribute("href");
  check("swfi_profile_handoff", /https:\/\/www\.swfi\.com\/v1\/signin\//.test(firstProfileHref || ""), firstProfileHref);

  const strategyEngine = restoredWorkbench.getByTestId("strategy-engine");
  await strategyEngine.waitFor({ state: "visible" });
  const strategyText = (await strategyEngine.innerText()).replace(/\s+/g, " ").trim();
  const strategyVersion = await strategyEngine.getByTestId("strategy-engine-version").innerText();
  const dimensions = await strategyEngine.locator("[data-strategy-dimension]").count();
  const sourceLinks = await strategyEngine.getByRole("link", { name: /^Source:/ }).count();
  check("strategy_engine_versioned_and_evidence_linked", strategyVersion === "swfi.strategy-engine.v1" && dimensions === 9 && sourceLinks > 0, `version=${strategyVersion} dimensions=${dimensions} source_links=${sourceLinks}`);
  check(
    "strategy_engine_honest_decision_boundary",
    /not investment advice or portfolio optimization/i.test(strategyText)
      && /mandate, risk & liquidity constraints blocked/i.test(strategyText)
      && /cannot conclude from current inputs/i.test(strategyText),
    strategyText.slice(0, 600),
  );

  mkdirSync("output", { recursive: true });
  await page.screenshot({ path: "output/swfipn-competition-analysis-desktop-latest.png", fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  const overflow = await page.evaluate(() => ({ viewport: window.innerWidth, document: document.documentElement.scrollWidth }));
  check("mobile_horizontal_containment", overflow.document <= overflow.viewport, JSON.stringify(overflow));

  await page.screenshot({ path: "output/swfipn-competition-analysis-mobile-latest.png", fullPage: true });
} finally {
  await browser.close();
}

const receipt = {
  generated_at: new Date().toISOString(),
  origin: ORIGIN,
  source: "Premjit Key Enhancements High Impact PN page 12 section 8.2.3",
  pass: checks.every((item) => item.status === "PASS"),
  checks,
};
mkdirSync("output", { recursive: true });
writeFileSync("output/swfipn-competition-analysis-latest.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ pass: receipt.pass, checks: checks.length, failing: checks.filter((item) => item.status === "FAIL").map((item) => item.id) }, null, 2));
if (!receipt.pass) process.exitCode = 1;
