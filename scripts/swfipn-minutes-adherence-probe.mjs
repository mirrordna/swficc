#!/usr/bin/env node
// Letter-by-letter minutes adherence probe (minutes 2026-07-03; Paul
// 2026-07-06: "Go again letter by letter slowly and with great detail").
// Complements the kp/acceptance/leakage/escape gates with the
// minutes-specific behaviors they don't cover. Receipt:
// output/swfipn-minutes-adherence-latest.json — one entry per minutes item
// probed, each with its live evidence.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";

const require = createRequire("/Users/mirror-pro/repos/swfireskin/package.json");
const { chromium } = require("playwright");

const ORIGIN = process.env.MINUTES_PROBE_ORIGIN || "https://dashboard.swfi.com";
const results = [];
const record = (item, requirement, pass, evidence) => results.push({ item, requirement, pass, evidence: String(evidence).slice(0, 300) });

async function json(url) {
  const response = await fetch(url, { headers: { accept: "application/json" } });
  return { status: response.status, body: await response.json().catch(() => ({})) };
}

// --- API-level probes -------------------------------------------------
const searchFirst = async (query, limit) => {
  const { body } = await json(`${ORIGIN}/api/v1/public/search?q=${encodeURIComponent(query)}&limit=${limit}`);
  const rows = body?.data?.rows || body?.data?.results || [];
  return rows[0]?.name || "";
};

const pif = await searchFirst("PIF", 5);
record("E/2", "search: PIF resolves", pif === "Public Investment Fund", `first=${pif}`);
const abu3 = await searchFirst("Abu Dhabi", 3);
const abu10 = await searchFirst("Abu Dhabi", 10);
record("E/2", "search: Abu Dhabi first result limit-independent (ADIA)", abu3 === "Abu Dhabi Investment Authority" && abu3 === abu10, `limit3=${abu3} limit10=${abu10}`);
const zurich = await searchFirst("Zurich Insurance Group", 5);
record("E/2", "search: Zurich Insurance Group resolves", zurich.includes("Zurich Insurance"), `first=${zurich}`);

const universe = await json(`${ORIGIN}/api/source-router/v1?intent=top_swf_aum&limit=250`);
const universeRows = universe.body?.data?.rows || [];
record("H/G-reconcile", "full SWF universe served (186, incl. AUM-less at tail)", universeRows.length === 186 && universe.body?.data?.total === 186, `rows=${universeRows.length} total=${universe.body?.data?.total}`);
const tail = universeRows[universeRows.length - 1] || {};
record("H", "AUM-less funds carry no invented values", universeRows.length === 186 ? (tail.aum === null || tail.aum === undefined) : false, `tail=${tail.name} aum=${tail.aum}`);

const facets = await json(`${ORIGIN}/api/source-data/facets/v1?collection=entities`);
record("D", "list charts computed over the WHOLE collection (facets api)", facets.body?.status === "ok" && (facets.body?.data?.total || 0) > 100000, `total=${facets.body?.data?.total}`);

// --- rendered probes --------------------------------------------------
// System Chrome (channel) — the ms-playwright browser cache was found
// empty mid-session 2026-07-06; the system browser needs no download.
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1560, height: 1200 } });
const textOf = async () => page.evaluate(() => document.body.innerText);

await page.goto(`${ORIGIN}/swficc/`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(8000);
const home = await textOf();
record("B/1", "SWFIPN base serving", /Here's your intelligence and pipeline overview\./.test(home), "home tagline present");
record("H/8", "banned 'TOTAL AUM ENGAGED' absent", !/TOTAL AUM ENGAGED/i.test(home), "grep home text");
record("H", "USD AUM headline present", /TOP-RANKED AUM TOTAL/i.test(home), "label present");
record("F/7", "map explain present", /Click a country or row/i.test(home), "explain string");
record("F", "no 'Loading' stuck after settle", !/Loading…/.test(home), "post-settle grep");
const mapCanvas = await page.locator('div[aria-label*="World map"] canvas').count();
record("map", "living map engine rendering (canvas)", mapCanvas > 0, `canvas=${mapCanvas}`);

await page.goto(`${ORIGIN}/swficc/mandates/?filter=Active%20Fixed%20Income`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
const firstAnchor = page.locator("table a").first();
const anchorVisible = await firstAnchor.isVisible().catch(() => false);
const anchorHref = (await firstAnchor.getAttribute("href").catch(() => "")) || "";
record("F/G (Paul bug)", "filter arrival lands on Data view with VISIBLE record links", anchorVisible && anchorHref.includes("swfi.com/v1/signin/"), `visible=${anchorVisible} href=${anchorHref.slice(0, 60)}`);

await page.goto(`${ORIGIN}/swficc/comparisons/`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
const comparisons = await textOf();
record("I/10", "peer group disclosed + same-type", /Peer group: .+ comparisons stay within one entity type/.test(comparisons), "peer line");
record("K/12", "Investment Strategy row renders", /Investment Strategy/.test(comparisons), "strategy row");

await page.goto(`${ORIGIN}/swficc/allocators/`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
const allocators = await textOf();
record("visual-law", "allocators page has visualization", /Allocator Activity Visualization/i.test(allocators), "viz title");

await page.goto(`${ORIGIN}/swficc/alerts/`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
const alerts = await textOf();
record("visual-law", "alerts is a live deadline strip", /RFP deadlines approaching/.test(alerts) && /Due in 30 days/.test(alerts), "strip labels");

await page.goto(`${ORIGIN}/swficc/reports/`, { waitUntil: "networkidle", timeout: 90_000 }).catch(() => {});
await page.waitForTimeout(5000);
const reports = await textOf();
record("visual-law", "reports opens on its visualization", /Updated from SWFI/.test(reports), "viz marker default");

// J: detail routes
await page.goto(`${ORIGIN}/swficc/profiles/detail/?name=No+Pointer+Sample`, { waitUntil: "domcontentloaded", timeout: 60_000 }).catch(() => {});
await page.waitForURL((url) => url.hostname === "www.swfi.com" && url.searchParams.get("s") !== null, { timeout: 30_000 }).catch(() => {});
record("J/6", "name-only detail forwards to swfi public search", page.url().includes("www.swfi.com/?s="), page.url().slice(0, 90));

const receipt = { generated_at: new Date().toISOString(), origin: ORIGIN, pass: results.every((row) => row.pass), failing: results.filter((row) => !row.pass).length, results };
mkdirSync("output", { recursive: true });
writeFileSync("output/swfipn-minutes-adherence-latest.json", JSON.stringify(receipt, null, 2));
console.log(JSON.stringify({ pass: receipt.pass, failing: receipt.failing, total: results.length }, null, 1));
for (const row of results.filter((r) => !r.pass)) console.log("FAIL", row.item, row.requirement, "->", row.evidence);
await browser.close();
