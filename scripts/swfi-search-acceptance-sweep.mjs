#!/usr/bin/env node
// SWFI dashboard Smart Search acceptance sweep — BROWSER-DRIVEN (real frontend resolution).
//
// WHY browser-driven (2026-07-09): raw API probes give FALSE gaps. Resolution for acronyms
// happens CLIENT-SIDE (searchRelevance.ts acronymForName over the already-loaded top-AUM
// entities), so /api/v1/public/search and /api/source-data/search both MISS "KIA" while the
// real UI resolves it to Kuwait Investment Authority. Only driving the live UI is faithful.
//
// Verdict per query: GAP when the search settles to "No matching SWFI records" (nothing in any
// category); otherwise OK (surfaces at least one record). Run against live before each client
// test round so we find gaps first. Exit 1 if any UNEXPECTED gap (not in KNOWN_EMPTY).
//
//   node scripts/swfi-search-acceptance-sweep.mjs
//   SWFI_DASH_URL=https://dashboard.swfi.com/swficc/ node scripts/swfi-search-acceptance-sweep.mjs

import { chromium } from "playwright";

const BASE = process.env.SWFI_DASH_URL || "https://dashboard.swfi.com/swficc/";

// Matrix: each major SWF/allocator by the ACRONYM a client types AND its full name.
// Extend freely — this is the standing check. (acronym, fullName, expectedEntitySubstring)
const ENTITIES = [
  ["NBIM", "Norway Government Pension Fund Global", "Norway Government Pension"],
  ["KIA", "Kuwait Investment Authority", "Kuwait Investment Authority"],
  ["KIC", "Korea Investment Corporation", "Korea Investment Corporation"],
  ["GIC", "GIC Private Limited", "GIC Private Limited"],
  ["ADIA", "Abu Dhabi Investment Authority", "Abu Dhabi Investment Authority"],
  ["PIF", "Public Investment Fund", "Public Investment Fund"],
  ["QIA", "Qatar Investment Authority", "Qatar Investment Authority"],
  ["CIC", "China Investment Corporation", "China Investment Corporation"],
  ["Temasek", "Temasek Holdings", "Temasek Holdings"],
  ["Mubadala", "Mubadala Investment Company", "Mubadala Investment Company"],
  ["AIMCo", "Alberta Investment Management Corporation", "Alberta Investment Management"],
  ["ICD", "Investment Corporation of Dubai", "Investment Corporation of Dubai"],
];
// Industry / thematic queries clients use (Jaykesh 2026-07-07).
const THEMES = ["Infrastructure", "Private Equity"];

// Known/accepted empties (source-data gaps we DISCLOSE, not bugs) — keep this list honest.
const KNOWN_EMPTY = new Set([]); // e.g. add "Dubai Investment Fund" if searched and no source deals

const SETTLE_MS = 2600;

async function openSearch(page) {
  const input = page.locator('input[placeholder*="Search"]').first();
  if (await input.count()) return input;
  // trigger the palette
  await page.getByText(/Open Global Search|Search for contacts/i).first().click({ timeout: 4000 }).catch(() => {});
  await page.keyboard.press("Meta+K").catch(() => {});
  await page.waitForTimeout(400);
  return page.locator('input[placeholder*="Search"]').first();
}

async function query(page, q) {
  const input = await openSearch(page);
  await input.click({ timeout: 5000 }).catch(() => {});
  await input.fill("").catch(() => {});
  await input.type(q, { delay: 25 });
  // Read ONLY the search dialog (not the dashboard behind it — that leaks "Norway…" etc into
  // the text and false-passes), and wait for the live search to SETTLE (spinner gone) before
  // reading — otherwise we capture "Searching SWFI records..." and mis-read a gap as ok.
  await page.waitForTimeout(500);
  await page
    .waitForFunction(() => {
      const d = document.querySelector('[role="dialog"]');
      return d && !/Searching SWFI records/i.test(d.innerText || "");
    }, { timeout: 9000 })
    .catch(() => {});
  await page.waitForTimeout(400);
  const text = await page.evaluate(() => {
    const d = document.querySelector('[role="dialog"]');
    return d ? d.innerText || "" : "";
  });
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
  return text;
}

function verdict(text, expectSub) {
  const empty = /No matching SWFI records/i.test(text);
  if (empty) return { ok: false, resolvedExpected: false };
  const resolvedExpected = expectSub ? text.toLowerCase().includes(expectSub.toLowerCase()) : true;
  return { ok: true, resolvedExpected };
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 45_000 });
  await page.waitForTimeout(2600); // let dashboard packets load (client-side resolution set)

  const rows = [];
  const jobs = [
    ...ENTITIES.flatMap(([ac, full, exp]) => [
      { q: ac, kind: "acronym", exp },
      { q: full, kind: "fullname", exp },
    ]),
    ...THEMES.map((t) => ({ q: t, kind: "theme", exp: "" })),
  ];
  for (const j of jobs) {
    let text = "";
    try { text = await query(page, j.q); } catch (e) { rows.push({ ...j, ok: false, err: e.message }); continue; }
    const v = verdict(text, j.exp);
    rows.push({ ...j, ...v });
  }
  await browser.close();

  console.log(`SWFI Smart Search sweep (browser-driven, live) — ${BASE}\n`);
  for (const r of rows) {
    const tag = r.err ? "ERR " : !r.ok ? "GAP " : r.resolvedExpected === false ? "WRONG" : "ok  ";
    console.log(`  [${tag}] ${r.kind.padEnd(8)} ${r.q}${r.exp && r.resolvedExpected === false ? `  (expected ~${r.exp})` : ""}${r.err ? "  " + r.err : ""}`);
  }
  const gaps = rows.filter((r) => !r.ok && !KNOWN_EMPTY.has(r.q));
  const wrong = rows.filter((r) => r.ok && r.resolvedExpected === false);
  console.log(`\n== ${rows.filter((r) => r.ok).length}/${rows.length} return records; ${gaps.length} unexpected gaps; ${wrong.length} resolve-mismatch ==`);
  console.log("GAPS:", gaps.map((r) => `${r.q}(${r.kind})`).join(" | ") || "none");
  console.log("MISMATCH:", wrong.map((r) => r.q).join(" | ") || "none");
  process.exit(gaps.length || wrong.length ? 1 : 0);
})().catch((e) => { console.error("harness error:", e.message); process.exit(2); });
