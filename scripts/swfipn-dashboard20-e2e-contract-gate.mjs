#!/usr/bin/env node
// SWFI Dashboard 2.0 E2E Verification Contract gate (team spec, 2026-07-08).
//
//   "A 200 response means 'reachable.' It does not mean 'approved.'"
//
// Three layers per page: (1) HTTP, (2) display contract, (3) behavior.
// Emits failure REASONS, not bare pass/fail. Pure checkers are exported so
// scripts/swfipn-section-dashboard-logic-test.mjs can fixture-test them under
// node; the browser run executes wherever Playwright + Chrome live (deploy
// lane), like every other gate in this repo.
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:3000/swficc/").replace(/\/+$/, "");
const OUT_PATH = process.env.SWFIPN_CONTRACT_OUT || path.join(repoRoot, "output", "swfipn-dashboard20-e2e-contract-latest.json");

// --- Condition 7: language must be user-facing, plain, specific -------------
// Banned as WHOLE labels; "View live mandates" is fine, bare "View" is not.
export const VAGUE_LABELS = ["more", "data", "misc", "unknown", "tbd", "test", "click here", "view", "click"];

export function vagueLabelIssue(label) {
  const clean = String(label || "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!clean) return "empty_label";
  return VAGUE_LABELS.includes(clean) ? "vague_label" : null;
}

// --- Condition 8: stale data must be hidden or labeled Historical -----------
export function staleDataIssue(textValue, now = Date.now()) {
  const currentYear = new Date(now).getFullYear();
  const years = (String(textValue || "").match(/\b20[0-4][0-9]\b/g) || []).map(Number);
  const stale = years.filter((year) => year <= currentYear - 2);
  if (!stale.length) return null;
  if (/historical|archive/i.test(String(textValue))) return null;
  return `stale_data_unlabeled:${Math.min(...stale)}`;
}

// --- Condition 2: every element must justify its presence -------------------
// el: { displayId, type, title, purpose, source, cta, ctaHref }
export function elementContractIssues(el) {
  const issues = [];
  if (!String(el.title || "").trim()) issues.push("missing_title");
  if (!String(el.purpose || "").trim()) issues.push("missing_purpose");
  if (!String(el.source || "").trim()) issues.push("missing_source");
  if (!String(el.cta || "").trim()) issues.push("missing_cta");
  if (el.type !== "control" && !String(el.ctaHref || "").trim()) issues.push("missing_cta_destination");
  return issues;
}

export function contractReadinessIssue(contractRequired, elementCount, readinessTimedOut = false) {
  if (!contractRequired) return null;
  if (readinessTimedOut) return "contract_readiness_timeout";
  return Number(elementCount) > 0 ? null : "no_contract_elements";
}

// --- Condition 4: every final path returns to SWFI core ---------------------
export function ctaDestinationIssue(href, origin = ORIGIN) {
  const value = String(href || "").trim();
  if (!value) return "missing_cta_destination";
  if (value.startsWith("#")) return null; // in-page anchor
  try {
    const resolved = new URL(value, `${origin}/`);
    const host = resolved.hostname.toLowerCase();
    if (host.endsWith("swfi.com")) return null; // platform core or sign-in
    const originHost = new URL(`${origin}/`).hostname.toLowerCase();
    if (host === originHost) return null; // preview layer; its rows chain onward
    if (host.endsWith("linkedin.com")) return null; // Paul-sanctioned 2026-07-06
    return `off_platform_destination:${host}`;
  } catch {
    return "unparseable_cta_destination";
  }
}

const PAGES = [
  { page: "/", contract: true, note: "home KPI cards carry executable display contracts and visible explanations" },
  { page: "/profiles/", contract: true },
  { page: "/people/", contract: true },
  { page: "/transactions/", contract: true },
  { page: "/deals/", contract: true },
  { page: "/allocators/", contract: true },
  { page: "/comparisons/", contract: true },
  { page: "/mandates/", contract: true },
  { page: "/intelligence/", contract: true },
  { page: "/aggregates/", contract: true },
  { page: "/reports/", contract: true },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  throw new Error("playwright_not_found");
}

async function auditPage(page, spec) {
  const url = `${ORIGIN}${spec.page}`;
  const failures = [];
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 120_000 }).catch(() => null);
  const httpStatus = response?.status() || 0;

  // Layer 1: HTTP — necessary, never sufficient.
  if (httpStatus >= 400 || httpStatus === 0) {
    failures.push({ displayId: "page", type: "page", issue: `http_${httpStatus}` });
    return { page: spec.page, status: "fail", httpStatus, reason: `Page did not respond cleanly (http ${httpStatus}).`, failures };
  }
  const contractReady = spec.contract
    ? await page.waitForSelector("[data-display-id]", { state: "attached", timeout: 60_000 }).then(() => true).catch(() => false)
    : (await page.waitForTimeout(4_000), true);
  await page.waitForFunction(() => !/Loading(?:…|\.{3})/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});

  // Layer 2: display contract.
  const elements = await page.evaluate(() => Array.from(document.querySelectorAll("[data-display-id]")).map((node) => ({
    displayId: node.getAttribute("data-display-id"),
    type: node.getAttribute("data-display-type") || node.tagName.toLowerCase(),
    title: node.getAttribute("data-title") || node.querySelector("h1,h2,h3,h4")?.textContent || "",
    purpose: node.getAttribute("data-purpose") || "",
    source: node.getAttribute("data-source") || "",
    cta: node.getAttribute("data-primary-cta") || "",
    ctaHref: node.getAttribute("data-cta-href") || "",
    requiresAuth: node.getAttribute("data-requires-auth") || "",
    text: (node.textContent || "").slice(0, 400),
  })));
  const readinessIssue = contractReadinessIssue(spec.contract, elements.length, !contractReady);
  if (readinessIssue) failures.push({ displayId: "page", type: "page", issue: readinessIssue });
  for (const el of elements) {
    for (const issue of elementContractIssues(el)) failures.push({ displayId: el.displayId, type: el.type, issue });
    const staleness = staleDataIssue(el.text);
    if (staleness) failures.push({ displayId: el.displayId, type: el.type, issue: staleness.split(":")[0], value: el.text.match(/\b20[0-4][0-9]\b/)?.[0] });
  }

  // Layer 3: behavior — CTA destinations resolve and stay on the chain.
  for (const el of elements) {
    if (!el.ctaHref || el.type === "control") continue;
    const issue = ctaDestinationIssue(el.ctaHref);
    if (issue) failures.push({ displayId: el.displayId, type: el.type, issue: issue.split(":")[0], value: el.ctaHref });
  }

  // Condition 5: no unauthenticated export.
  const exportLeaks = await page.evaluate(() => {
    const leaks = [];
    document.querySelectorAll("a[download]").forEach((node) => leaks.push({ label: node.textContent?.trim() || "download-link", kind: "download_attr" }));
    document.querySelectorAll("button").forEach((node) => {
      const label = node.textContent?.trim() || "";
      if (/export|download/i.test(label)) leaks.push({ label, kind: "export_button" });
    });
    return leaks;
  });
  for (const leak of exportLeaks) {
    failures.push({ displayId: leak.label, type: "button", issue: "unauthenticated_export_possible" });
  }

  // Condition 6: tables only as bounded analytical views.
  const rawDump = await page.evaluate(() => {
    const visibleTables = Array.from(document.querySelectorAll("table")).filter((table) => {
      const style = window.getComputedStyle(table);
      return table.querySelector("tbody tr")
        && style.display !== "none"
        && style.visibility !== "hidden"
        && table.getClientRects().length > 0;
    });
    return visibleTables.some((table) => {
      const frame = table.closest("[data-display-id], section, main") || document.body;
      return !/limited preview|ranking|top|visualization|records/i.test(frame.textContent || "");
    });
  });
  if (rawDump && spec.contract) failures.push({ displayId: "records-table", type: "table", issue: "raw_dump_unframed" });

  // Condition 7: language.
  const labels = await page.evaluate(() => Array.from(document.querySelectorAll("button, a"))
    .map((node) => node.textContent?.replace(/\s+/g, " ").trim() || "")
    .filter((label) => label && label.length <= 24));
  for (const label of [...new Set(labels)]) {
    if (vagueLabelIssue(label) === "vague_label") failures.push({ displayId: label, type: "label", issue: "vague_label" });
  }

  const status = failures.length ? "fail" : "pass";
  const reason = failures.length
    ? `Page returned ${httpStatus} but ${failures.length} contract check(s) failed: ${[...new Set(failures.map((f) => f.issue))].join(", ")}.`
    : `Page returned ${httpStatus} and every contract layer passed (${elements.length} contract elements).`;
  return { page: spec.page, status, httpStatus, reason, failures };
}

async function main() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ channel: process.env.SWFIPN_BROWSER_CHANNEL || "chrome" }).catch(() => chromium.launch());
  const context = await browser.newContext();
  const page = await context.newPage();
  const pages = [];
  for (const spec of PAGES) {
    pages.push(await auditPage(page, spec));
  }
  await browser.close();
  const failed = pages.filter((entry) => entry.status === "fail");
  const result = {
    schema_version: "swfipn.dashboard20_e2e_contract.v1",
    generated_at: new Date().toISOString(),
    origin: ORIGIN,
    doctrine: "A 200 response means reachable. It does not mean approved.",
    summary: { pages: pages.length, passed: pages.length - failed.length, failed: failed.length, failures: pages.reduce((sum, entry) => sum + entry.failures.length, 0) },
    pages,
  };
  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(result, null, 2)}\n`);
  console.log(`[dashboard20-contract] ${result.summary.passed}/${result.summary.pages} pages pass, ${result.summary.failures} failure(s) -> ${OUT_PATH}`);
  process.exit(failed.length ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error("[dashboard20-contract] crashed:", error?.message || error);
    process.exit(1);
  });
}
