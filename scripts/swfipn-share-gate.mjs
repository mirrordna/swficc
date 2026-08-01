#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-share-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const maxReceiptAgeMs = Number(process.env.SWFIPN_SHARE_MAX_RECEIPT_AGE_MS || 2 * 60 * 60 * 1000);
const manifestReceiptMaxAgeMs = Number(process.env.SWFIPN_SHARE_MANIFEST_MAX_RECEIPT_AGE_MS || 7 * 24 * 60 * 60 * 1000);
const requiredReceipts = [
  "swfipn-kp-acceptance-gate-latest.json",
  "swfipn-runtime-staleness-gate-latest.json",
  "swfipn-link-mapping-leakage-gate-latest.json",
  "swfipn-visible-link-escape-gate-latest.json",
  "swfipn-acceptance-criteria-gate-latest.json",
  "swfipn-strict-acceptance-deploy-latest.json",
  "swfipn-public-gc1-link-proof-latest.json",
  "swfipn-loop-collapse-latest.json",
];
const requiredScreenshots = [
  "swfipn-acceptance-desktop.png",
  "swfipn-acceptance-mobile.png",
  "swfipn-public-gc1-link-proof.png",
];
const forbiddenVisible = [
  "Endpoint:",
  "Source-backed fact",
  "Source-backed",
  "source-backed",
  "Data source:",
  "BRD V1.3",
  "Glass Box",
  "Command Box",
  "deterministic",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Mongo Record ID",
  "Runtime Source",
  "SWFIPN source detail",
  "Source packet:",
  "No internal record mapping",
  "citation-only",
  "Active Mirror",
  "source_gap",
  "schema_version",
];

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

function readJsonReceipt(file) {
  const absolute = path.join(outputDir, file);
  if (!fs.existsSync(absolute)) return { file, ok: false, failures: ["missing_receipt"] };
  try {
    const stat = fs.statSync(absolute);
    const body = JSON.parse(fs.readFileSync(absolute, "utf8"));
    const ageMs = Date.now() - stat.mtimeMs;
    const allowedAgeMs = file === "swfipn-record-manifest-scan-latest.json" ? manifestReceiptMaxAgeMs : maxReceiptAgeMs;
    const status = body.status || body.final_verdict || (body.collapse_detected === false ? "pass" : "");
    const failures = [];
    if (!["pass", "pass_with_quarantine", "complete", "go", "go_with_caveat"].includes(status)) failures.push(`status_${status || "missing"}`);
    if (ageMs > allowedAgeMs) failures.push(`stale_${Math.round(ageMs / 1000)}s`);
    const result = {
      file,
      ok: failures.length === 0,
      status,
      caveat: status === "pass_with_quarantine" ? {
        total_unreadable_delta: body.total_unreadable_delta || 0,
        data_quality_caveats: body.data_quality_caveats || [],
      } : null,
      mtime: stat.mtime.toISOString(),
      age_ms: Math.round(ageMs),
      max_age_ms: Math.round(allowedAgeMs),
      summary: body.summary,
      failures,
    };
    Object.defineProperty(result, "body", { value: body, enumerable: false });
    return result;
  } catch (error) {
    return { file, ok: false, failures: [`unreadable:${error.message}`] };
  }
}

function readScreenshot(file) {
  const absolute = path.join(outputDir, file);
  if (!fs.existsSync(absolute)) return { file, ok: false, failures: ["missing_screenshot"] };
  const stat = fs.statSync(absolute);
  const ageMs = Date.now() - stat.mtimeMs;
  const failures = [];
  if (stat.size < 20_000) failures.push(`screenshot_too_small:${stat.size}`);
  if (ageMs > maxReceiptAgeMs) failures.push(`stale_${Math.round(ageMs / 1000)}s`);
  return {
    file,
    ok: failures.length === 0,
    mtime: stat.mtime.toISOString(),
    age_ms: Math.round(ageMs),
    size: stat.size,
    failures,
  };
}

function allowDeployReceiptFreshnessViaRuntime(receipts) {
  const deploy = receipts.find((item) => item.file === "swfipn-strict-acceptance-deploy-latest.json");
  const runtime = receipts.find((item) => item.file === "swfipn-runtime-staleness-gate-latest.json");
  if (!deploy || !runtime || !deploy.failures?.length || !runtime.ok) return receipts;
  const onlyStale = deploy.failures.every((failure) => String(failure).startsWith("stale_"));
  const runtimeDeploy = runtime.body?.deploy_receipt || {};
  const runtimeMarker = runtime.body?.public_release_marker || {};
  const deployBody = deploy.body || {};
  const sameRelease = deployBody.release && deployBody.release === runtimeDeploy.release;
  const sameAsset = deployBody.asset_version && deployBody.asset_version === runtimeDeploy.asset_version && deployBody.asset_version === runtimeMarker.asset_version;
  const sameGit = deployBody.git_sha && deployBody.git_sha === runtimeDeploy.git_sha && deployBody.git_sha === runtimeMarker.git_sha;
  if (!onlyStale || !sameRelease || !sameAsset || !sameGit || runtimeMarker.ok !== true) return receipts;
  return receipts.map((item) => item === deploy ? {
    ...item,
    ok: true,
    freshness_attested_by: "swfipn-runtime-staleness-gate-latest.json",
    caveat: {
      ...(item.caveat || {}),
      stale_deploy_receipt_accepted_because_runtime_staleness_attests_same_release: true,
    },
    failures: [],
  } : item);
}

function isApprovedSwfiRecordHandoff(href) {
  try {
    const parsed = new URL(String(href || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    if ((parsed.searchParams.get("msg") || "") !== "auth") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect || /^https?:\/\//i.test(redirect)) return false;
    const redirectUrl = new URL(redirect, "https://www.swfi.com");
    const pathname = redirectUrl.pathname.replace(/\/?$/, "/");
    return /^\/v1\/(entities|people|transactions|compass)\/[a-f0-9]{24}\/$/i.test(pathname)
      || /^\/v1\/news\/\d{1,12}\/$/i.test(pathname);
  } catch {
    return false;
  }
}

function isAllowedSwfiLegacyArticleUrl(href) {
  try {
    const parsed = new URL(String(href || ""), origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname !== "/" && parsed.pathname !== "") return false;
    return /^\d+$/.test(parsed.searchParams.get("p") || "");
  } catch {
    return false;
  }
}

function isApprovedSwfiPlatformLink(href) {
  return isApprovedSwfiRecordHandoff(href) || isAllowedSwfiLegacyArticleUrl(href);
}

async function renderedPublicCheck() {
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({     headless: true,
    args: stableBrowserArgs(originHost),
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const result = { ok: true, url: origin, final_url: "", status: null, failures: [], counts: {} };
  try {
    const response = await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 45_000 });
    result.status = response?.status() || null;
    result.final_url = page.url();
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    if (!result.final_url.startsWith(origin.replace(/\/$/, ""))) result.failures.push(`wrong_final_url:${result.final_url}`);
    // Hydration markers must be phrases that ACTUALLY render post-hydration. "TOTAL AUM ENGAGED"
    // and "DEALS & TRANSACTIONS" were removed from the product (2026-07 rename), so the old list
    // never matched -> waitForBody always timed out at 20s and the link audit could read a
    // pre-hydration page (the source_links=0 flake). Verified present on live 2026-07-09:
    // "TOP-RANKED AUM TOTAL", "ACTIVE ALLOCATORS", "DISCLOSED DEAL VALUE".
    const body = await waitForBody(page, ["SWFI", "TOP-RANKED AUM TOTAL", "ACTIVE ALLOCATORS", "DISCLOSED DEAL VALUE"], 20_000);
    for (const text of forbiddenVisible) {
      if (body.includes(text)) result.failures.push(`forbidden_visible:${text}`);
    }
    result.counts.showing = (body.match(/Showing [^\n]+/g) || []).slice(0, 8);
    const linkAudit = await waitForLinkAudit(page, 40_000);
    result.counts.source_links = linkAudit.filter((link) => link.sourceState === "on-file" || link.sourcePath).length;
    result.counts.detail_links = linkAudit.filter((link) => /\/swficc\/(profiles|transactions|mandates|people|research)\/detail\//.test(link.href) || /\/(profiles|transactions|mandates|people|research)\/detail\//.test(link.dashboardTarget)).length;
    result.counts.approved_swfi_handoffs = linkAudit.filter((link) => isApprovedSwfiRecordHandoff(link.href) || isApprovedSwfiRecordHandoff(link.raw)).length;
    result.counts.approved_swfi_platform_links = linkAudit.filter((link) => isApprovedSwfiPlatformLink(link.href) || isApprovedSwfiPlatformLink(link.raw)).length;
    result.counts.raw_external_swfi_links = linkAudit.filter((link) => /^https?:\/\/(www\.)?swfi\.com/i.test(link.href) && !isApprovedSwfiPlatformLink(link.href)).length;
    result.counts.external_swfi_links = result.counts.raw_external_swfi_links;
    result.counts.mirror_record_links = result.counts.approved_swfi_handoffs + result.counts.detail_links;
    if (result.counts.source_links < 8) result.failures.push(`source_links_${result.counts.source_links}_lt_8`);
    if (result.counts.approved_swfi_platform_links < 8) result.failures.push(`approved_swfi_platform_links_${result.counts.approved_swfi_platform_links}_lt_8`);
    if (result.counts.raw_external_swfi_links > 0) result.failures.push(`raw_external_swfi_links_${result.counts.raw_external_swfi_links}_gt_0`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function stableBrowserArgs(host) {
  const args = ["--disable-gpu", "--disable-dev-shm-usage"];
  if (resolveIp) args.push(`--host-resolver-rules=MAP ${host} ${resolveIp}`);
  return args;
}

async function waitForBody(page, required, timeout) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    if (required.every((item) => lower.includes(item.toLowerCase())) && !/\bLoading\b/.test(body)) return body;
    try {
      await page.waitForTimeout(750);
    } catch {
      return body;
    }
  }
  return body;
}

async function waitForLinkAudit(page, timeout) {
  const start = Date.now();
  let lastAudit = [];
  while (Date.now() - start < timeout) {
    lastAudit = await page.evaluate(() => Array.from(document.querySelectorAll("a[href]")).map((a) => ({
      text: a.textContent?.trim().replace(/\s+/g, " ") || "",
      href: a.href,
      raw: a.getAttribute("href") || "",
      sourceState: a.getAttribute("data-source-state") || "",
      sourcePath: a.getAttribute("data-source-path") || "",
      dashboardTarget: a.getAttribute("data-dashboard-target") || "",
    }))).catch(() => lastAudit);
    const sourceLinks = lastAudit.filter((link) => link.sourceState === "on-file" || link.sourcePath).length;
    const approvedSwfiPlatformLinks = lastAudit.filter((link) => isApprovedSwfiPlatformLink(link.href) || isApprovedSwfiPlatformLink(link.raw)).length;
    // Early-return only once BOTH counts the gate actually asserts (source_links >= 8 AND
    // approved_swfi_platform_links >= 8, lines 198-199) are satisfied, so the audit never returns
    // mid-hydration with approved still < 8 and then fails.
    if (sourceLinks >= 8 && approvedSwfiPlatformLinks >= 8) return lastAudit;
    await page.waitForTimeout(500).catch(() => {});
  }
  return lastAudit;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipts = allowDeployReceiptFreshnessViaRuntime(requiredReceipts.map(readJsonReceipt));
  const screenshots = requiredScreenshots.map(readScreenshot);
  const public_render = await renderedPublicCheck();
  const failures = [
    ...receipts.filter((item) => !item.ok).map((item) => ({ type: "receipt", file: item.file, failures: item.failures })),
    ...screenshots.filter((item) => !item.ok).map((item) => ({ type: "screenshot", file: item.file, failures: item.failures })),
    ...(public_render.ok ? [] : [{ type: "public_render", failures: public_render.failures }]),
  ];
  const receipt = {
    schema_version: "swfipn.share_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    summary: {
      receipts: receipts.length,
      screenshots: screenshots.length,
      failures: failures.length,
      source_links: public_render.counts.source_links || 0,
      detail_links: public_render.counts.detail_links || 0,
      mirror_record_links: public_render.counts.mirror_record_links || 0,
      external_swfi_links: public_render.counts.external_swfi_links || 0,
    },
    sendable: failures.length === 0,
    share_url: origin,
    receipts,
    screenshots,
    public_render,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    sendable: receipt.sendable,
    share_url: receipt.share_url,
    summary: receipt.summary,
    receipt: receiptPath,
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
