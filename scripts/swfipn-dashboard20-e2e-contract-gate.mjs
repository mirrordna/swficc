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
import { createHash } from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ORIGIN = (process.env.SWFIPN_ORIGIN || "http://127.0.0.1:3000/swficc/").replace(/\/+$/, "");
const OUT_PATH = process.env.SWFIPN_CONTRACT_OUT || path.join(repoRoot, "output", "swfipn-dashboard20-e2e-contract-latest.json");
const CANDIDATE_SHA = String(process.env.SWFIPN_CANDIDATE_SHA || "").trim();
const WORKFLOW_RUN_ID = String(process.env.SWFIPN_WORKFLOW_RUN_ID || "").trim();
const RELEASE_MARKER_URL = String(process.env.SWFIPN_RELEASE_MARKER_URL || "").trim();
const REQUIRE_RELEASE_PROVENANCE = process.env.SWFIPN_REQUIRE_RELEASE_PROVENANCE === "1";

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
  { page: "/", contract: false, note: "home panels carry explains; data-attribute tagging is a follow-up pass" },
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

async function captureReleaseMarker() {
  const provenanceConfigured = Boolean(CANDIDATE_SHA || WORKFLOW_RUN_ID || RELEASE_MARKER_URL);
  if (!REQUIRE_RELEASE_PROVENANCE && !provenanceConfigured) return null;
  if (!/^[0-9a-f]{40}$/.test(CANDIDATE_SHA)) throw new Error("invalid_candidate_sha");
  if (!/^[1-9][0-9]{0,19}$/.test(WORKFLOW_RUN_ID)) throw new Error("invalid_workflow_run_id");
  if (RELEASE_MARKER_URL !== "https://dashboard.swfi.com/swficc/swficc-release.json") {
    throw new Error("invalid_release_marker_url");
  }
  if (ORIGIN !== "https://dashboard.swfi.com/swficc") throw new Error("invalid_dashboard_contract_origin");

  const requestUrl = new URL(RELEASE_MARKER_URL);
  requestUrl.searchParams.set("qa_run", WORKFLOW_RUN_ID);
  const response = await fetch(requestUrl, {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`release_marker_http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const marker = JSON.parse(bytes.toString("utf8"));
  if (marker.schema_version !== "swfipn.release_marker.v1") throw new Error("release_marker_schema_mismatch");
  if (marker.git_sha !== CANDIDATE_SHA) throw new Error("release_marker_candidate_mismatch");
  if (marker.asset_version !== CANDIDATE_SHA.slice(0, 7)) throw new Error("release_marker_asset_mismatch");
  if (marker.git_dirty !== false) throw new Error("release_marker_dirty");
  return {
    url: RELEASE_MARKER_URL,
    schema_version: marker.schema_version,
    git_sha: marker.git_sha,
    asset_version: marker.asset_version,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

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
  await page.waitForTimeout(4_000);
  await page.waitForFunction(() => !/Loading…/.test(document.body.innerText), null, { timeout: 60_000 }).catch(() => {});

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
  if (spec.contract && elements.length === 0) {
    failures.push({ displayId: "page", type: "page", issue: "no_contract_elements" });
  }
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
  const releaseMarker = await captureReleaseMarker();
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
    candidate_sha: CANDIDATE_SHA || null,
    workflow_run_id: WORKFLOW_RUN_ID || null,
    release_marker: releaseMarker,
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
