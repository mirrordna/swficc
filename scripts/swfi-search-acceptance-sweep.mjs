#!/usr/bin/env node
// SWFI dashboard Smart Search acceptance sweep — BROWSER-DRIVEN (real frontend resolution).
//
// WHY browser-driven (2026-07-09): raw API probes give FALSE gaps. Resolution for acronyms
// happens CLIENT-SIDE (searchRelevance.ts acronymForName over the already-loaded top-AUM
// entities), so /api/v1/public/search and /api/source-data/search both MISS "KIA" while the
// real UI resolves it to Kuwait Investment Authority. Only driving the live UI is faithful.
// Two invariants (DO NOT change): (1) UI-driven — open the dialog, type, wait for the
// "Searching SWFI records..." spinner to clear; (2) read ONLY [role="dialog"] (reading
// document.body false-passes gaps because the dashboard behind the modal is full of fund names).
//
// Verdict per query: GAP when the search settles to "No matching SWFI records" (nothing in any
// category); WRONG when it returns records but the expected entity substring is absent; otherwise
// ok. Run against live before each client test round so we find gaps first. Exit 1 on any
// unexpected GAP (not in KNOWN_EMPTY) or any WRONG.
//
//   node scripts/swfi-search-acceptance-sweep.mjs
//   SWFI_DASH_URL=https://dashboard.swfi.com/swficc/ node scripts/swfi-search-acceptance-sweep.mjs

import { chromium } from "playwright";

const BASE = process.env.SWFI_DASH_URL || "https://dashboard.swfi.com/swficc/";

// Matrix: real SWFI top-AUM funds (from /v1/swfi/top20?limit=40, 2026-07-09) plus a few
// globally-known funds clients type by acronym. Each row: [acronym|null, fullName, expectSub].
// A client tests BOTH the acronym they type AND the full name; acronym===null => full name only
// (fund has no common acronym). expectSub is a distinctive substring that MUST appear in results.
const ENTITIES = [
  ["NBIM", "Norway Government Pension Fund Global", "Norway Government Pension"],
  ["SAFE", "SAFE Investment Company", "SAFE Investment Company"],
  ["CIC", "China Investment Corporation", "China Investment Corporation"],
  ["ADIA", "Abu Dhabi Investment Authority", "Abu Dhabi Investment Authority"],
  ["KIA", "Kuwait Investment Authority", "Kuwait Investment Authority"],
  ["GIC", "GIC Private Limited", "GIC Private Limited"],
  ["PIF", "Public Investment Fund", "Public Investment Fund"],
  ["Danantara", "Badan Pengelola Investasi Daya Anagata Nusantara", "Anagata Nusantara"],
  ["QIA", "Qatar Investment Authority", "Qatar Investment Authority"],
  ["HKMA", "Hong Kong Monetary Authority Investment Portfolio", "Hong Kong Monetary Authority"],
  [null, "Temasek Holdings", "Temasek Holdings"],
  ["NCSSF", "National Council for Social Security Fund", "Social Security Fund"],
  ["ICD", "Investment Corporation of Dubai", "Investment Corporation of Dubai"],
  [null, "Mubadala Investment Company", "Mubadala Investment Company"],
  ["TWF", "Turkiye Wealth Fund", "Turkiye Wealth Fund"],
  ["ADQ", "Abu Dhabi Developmental Holding Company", "Abu Dhabi Developmental Holding"],
  ["KIC", "Korea Investment Corporation", "Korea Investment Corporation"],
  [null, "Future Fund", "Future Fund"],
  ["NDFI", "National Development Fund of Iran", "National Development Fund of Iran"],
  ["AIMCo", "Alberta Investment Management Corporation", "Alberta Investment Management"],
  ["NWF", "National Welfare Fund", "National Welfare Fund"],
  ["EIA", "Emirates Investment Authority", "Emirates Investment Authority"],
  ["UTIMCO", "University of Texas Investment Management Company", "University of Texas Investment"],
  ["APFC", "Alaska Permanent Fund Corporation", "Alaska Permanent Fund"],
  ["LIA", "Libyan Investment Authority", "Libyan Investment Authority"],
  [null, "Samruk-Kazyna", "Samruk-Kazyna"],
  ["DIF", "Dubai Investment Fund", "Dubai Investment Fund"],
  ["SOFAZ", "State Oil Fund of Azerbaijan", "State Oil Fund of Azerbaijan"],
  ["BIA", "Brunei Investment Agency", "Brunei Investment Agency"],
  ["NMSIC", "New Mexico State Investment Council", "New Mexico State Investment Council"],
  ["NFRK", "Kazakhstan National Fund", "Kazakhstan National Fund"],
  ["TPSF", "Texas Permanent School Fund", "Texas Permanent School Fund"],
  [null, "Taiwan National Development Fund", "Taiwan National Development Fund"],
  ["OIA", "Oman Investment Authority", "Oman Investment Authority"],
  ["NZSF", "New Zealand Superannuation Fund", "New Zealand Superannuation Fund"],
  ["EIH", "Ethiopian Investment Holdings", "Ethiopian Investment Holdings"],
  [null, "Khazanah Nasional", "Khazanah Nasional"],
  [null, "National Wealth Fund, UK", "National Wealth Fund"],
  ["WSLIB", "Wyoming State Loan and Investment Board", "Wyoming State Loan"],
  [null, "Hong Kong Future Fund", "Hong Kong Future Fund"],
  // Globally-known funds clients type by acronym (not necessarily in the loaded top-AUM set):
  ["GPIF", "Government Pension Investment Fund Japan", "Government Pension Investment Fund"],
  ["CPPIB", "Canada Pension Plan Investment Board", "Canada Pension Plan"],
  ["CDPQ", "Caisse de depot et placement du Quebec", "Caisse de"],
  ["ISIF", "Ireland Strategic Investment Fund", "Ireland Strategic Investment"],
  ["CalPERS", "California Public Employees Retirement System", "California Public Employees"],
];

// Extra query dimensions clients use (Jaykesh 2026-07-07): industries/strategies, people,
// and countries. Industries/persons only assert "returns something" (exp ""); countries assert
// the flagship fund where one dominates the country (unambiguous ground truth).
const INDUSTRIES = ["Infrastructure", "Private Equity", "Real Estate", "Technology", "Healthcare"];
const PERSONS = ["Nicolai Tangen", "Yasir Al-Rumayyan", "Lim Chow Kiat", "Peng Chun"];
const COUNTRIES = [
  ["Norway", "Norway Government Pension"],
  ["Saudi Arabia", "Public Investment Fund"],
  ["Qatar", "Qatar Investment Authority"],
  ["Singapore", ""],
];

// Known/accepted empties (source-data gaps we DISCLOSE, not bugs) — keep this list honest.
const KNOWN_EMPTY = new Set([]); // e.g. add "Dubai Investment Fund" if searched and no source deals

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
  await page.waitForTimeout(300); // let the cleared input reset the dialog to baseline
  await input.type(q, { delay: 25 });
  // INVARIANTS (do not change): read ONLY [role="dialog"] (the dashboard behind it is full of
  // fund names and false-passes gaps), and wait for the live search to SETTLE before reading.
  // Settle = the debounce fired + the "Searching SWFI records..." spinner cleared + the dialog
  // text is STABLE across two samples. The stability gate kills a debounce race where the dialog
  // still shows the PREVIOUS query's results (so a fresh read false-flagged KIA as WRONG).
  await page.waitForTimeout(650); // cover the input debounce before checking the spinner
  await page
    .waitForFunction(() => {
      const d = document.querySelector('[role="dialog"]');
      return d && !/Searching SWFI records/i.test(d.innerText || "");
    }, { timeout: 9000 })
    .catch(() => {});
  const readDialog = () =>
    page.evaluate(() => {
      const d = document.querySelector('[role="dialog"]');
      return d ? d.innerText || "" : "";
    });
  let text = await readDialog();
  for (let i = 0; i < 4; i++) {
    await page.waitForTimeout(450);
    const next = await readDialog();
    if (next === text && !/Searching SWFI records/i.test(next)) break; // two identical, no spinner
    text = next;
  }
  await page.keyboard.press("Escape").catch(() => {});
  await page.waitForTimeout(250);
  return text;
}

// A compact one-line snippet of what the dialog actually showed (query echo stripped), for
// expected-vs-actual reporting on GAP/WRONG rows.
function actualSnippet(text, q) {
  let s = (text || "").replace(/\s+/g, " ").trim();
  const echo = q.replace(/\s+/g, " ").trim();
  if (echo && s.toLowerCase().startsWith(echo.toLowerCase())) s = s.slice(echo.length).trim();
  return s.length > 150 ? s.slice(0, 150) + "…" : s || "(empty dialog)";
}

function verdict(text, expectSub) {
  const empty = /No matching SWFI records/i.test(text);
  if (empty) return { ok: false, resolvedExpected: false };
  const resolvedExpected = expectSub ? text.toLowerCase().includes(expectSub.toLowerCase()) : true;
  return { ok: true, resolvedExpected };
}

async function loadDashboard(page) {
  // Resilient load: domcontentloaded (reliable) + best-effort networkidle so the top-AUM entity
  // packets that drive client-side acronym resolution are present. Retry 3x — the live site can
  // blip briefly (e.g. a concurrent deploy restart) and one blip shouldn't waste the whole sweep.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 45_000 });
      await page.waitForSelector('input[placeholder*="Search"], text=/Open Global Search|Search for contacts/i', { timeout: 15_000 }).catch(() => {});
      await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
      return true;
    } catch (e) {
      process.stderr.write(`  goto attempt ${attempt}/3 failed: ${e.message}\n`);
      await page.waitForTimeout(3000);
    }
  }
  return false;
}

(async () => {
  const browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 30_000 });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  if (!(await loadDashboard(page))) {
    console.error("harness error: dashboard did not load after 3 attempts —", BASE);
    await browser.close();
    process.exit(2);
  }
  await page.waitForTimeout(2600); // let dashboard packets load (client-side resolution set)

  const rows = [];
  const jobs = [
    ...ENTITIES.flatMap(([ac, full, exp]) => {
      const list = [{ q: full, kind: "fullname", exp }];
      if (ac) list.unshift({ q: ac, kind: "acronym", exp });
      return list;
    }),
    ...INDUSTRIES.map((t) => ({ q: t, kind: "industry", exp: "" })),
    ...PERSONS.map((p) => ({ q: p, kind: "person", exp: "" })),
    ...COUNTRIES.map(([c, exp]) => ({ q: c, kind: "country", exp })),
  ];
  let n = 0;
  for (const j of jobs) {
    n += 1;
    let text = "";
    try {
      text = await query(page, j.q);
    } catch (e) {
      rows.push({ ...j, ok: false, resolvedExpected: false, err: e.message, actual: "(harness error)" });
      process.stderr.write(`  ..${n}/${jobs.length} ERR ${j.q}\n`);
      continue;
    }
    const v = verdict(text, j.exp);
    rows.push({ ...j, ...v, actual: actualSnippet(text, j.q) });
    process.stderr.write(`  ..${n}/${jobs.length} ${!v.ok ? "GAP " : v.resolvedExpected === false ? "WRONG" : "ok  "} ${j.q}\n`);
  }
  await browser.close();

  const gaps = rows.filter((r) => !r.ok && !KNOWN_EMPTY.has(r.q));
  const wrong = rows.filter((r) => r.ok && r.resolvedExpected === false);
  const fundKinds = new Set(["acronym", "fullname"]);
  const fundGaps = gaps.filter((r) => fundKinds.has(r.kind));
  const dimGaps = gaps.filter((r) => !fundKinds.has(r.kind));

  console.log(`\nSWFI Smart Search sweep (browser-driven, live) — ${BASE}\n`);
  for (const r of rows) {
    const tag = r.err ? "ERR " : !r.ok ? "GAP " : r.resolvedExpected === false ? "WRONG" : "ok  ";
    console.log(`  [${tag}] ${r.kind.padEnd(9)} ${r.q}`);
  }

  console.log(`\n== ${rows.filter((r) => r.ok).length}/${rows.length} return records; ${gaps.length} unexpected gaps (${fundGaps.length} fund, ${dimGaps.length} dimension); ${wrong.length} resolve-mismatch ==`);

  console.log(`\nFUND GAPS (returns NOTHING — expected vs actual):`);
  if (!fundGaps.length) console.log("  none");
  for (const r of fundGaps) console.log(`  - ${r.q} (${r.kind})\n      expected: ~${r.exp || "(any record)"}\n      actual:   ${r.actual}`);

  console.log(`\nDIMENSION GAPS (industry/person/country returns NOTHING):`);
  if (!dimGaps.length) console.log("  none");
  for (const r of dimGaps) console.log(`  - ${r.q} (${r.kind})  actual: ${r.actual}`);

  console.log(`\nWRONG (returns records but NOT the expected entity — expected vs actual):`);
  if (!wrong.length) console.log("  none");
  for (const r of wrong) console.log(`  - ${r.q} (${r.kind})\n      expected: ~${r.exp}\n      actual:   ${r.actual}`);

  console.log(`\nGAPS:`, gaps.map((r) => `${r.q}(${r.kind})`).join(" | ") || "none");
  console.log("MISMATCH:", wrong.map((r) => `${r.q}(${r.kind})`).join(" | ") || "none");
  process.exit(gaps.length || wrong.length ? 1 : 0);
})().catch((e) => { console.error("harness error:", e.message); process.exit(2); });
