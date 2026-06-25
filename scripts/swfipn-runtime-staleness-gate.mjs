#!/usr/bin/env node
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-runtime-staleness-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const deployReceiptPath = path.join(outputDir, "swfipn-strict-acceptance-deploy-latest.json");
const assetReceiptPath = path.join(outputDir, "swfipn-asset-version-latest.json");
const remoteHost = process.env.SWFIPN_RUNTIME_REMOTE_HOST || "hetzner";
const remoteCheck = process.env.SWFIPN_RUNTIME_REMOTE_CHECK !== "0";
const maxReleaseAgeHours = Number(process.env.SWFIPN_MAX_RELEASE_AGE_HOURS || 72);
const routeSpecs = [
  { key: "home", route: "/", releaseFile: "out/index.html", required: ["KPI CARDS", "Top Active Allocators", "Newest Transactions"] },
  { key: "comparisons", route: "/comparisons/", releaseFile: "out/comparisons/index.html", required: ["Peer Comparisons", "Current Peer Set"] },
];
const forbiddenVisible = [
  "Source gap",
  "Endpoint:",
  "Source-backed fact",
  "Source Record ID",
  "Truth State",
  "Result Qualifier",
  "Mongo Record ID",
  "Runtime Source",
  "SWFIPN source detail",
  "Source packet:",
  "Active Mirror",
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

function urlFor(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function releaseMarkerUrl() {
  return new URL(`swficc-release.json?qa=${Date.now()}`, origin).href;
}

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

function normalizeHtmlForReleaseHash(html) {
  return html
    .replace(/<script defer src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js[^<]*<\/script>\s*/g, "")
    .replace(/<script src="https:\/\/static\.cloudflareinsights\.com\/beacon\.min\.js[^<]*<\/script>\s*/g, "");
}

function readDeployReceipt() {
  if (!fs.existsSync(deployReceiptPath)) return { ok: false, failures: ["missing_deploy_receipt"] };
  try {
    const receipt = JSON.parse(fs.readFileSync(deployReceiptPath, "utf8"));
    const failures = [];
    if (receipt.status !== "pass") failures.push(`deploy_status_${receipt.status || "missing"}`);
    if (!receipt.release) failures.push("missing_release");
    if (receipt.release && path.resolve(receipt.release) === path.resolve(repoRoot) && process.env.SWFIPN_RUNTIME_ALLOW_LOCAL_DEPLOY_RECEIPT !== "1") {
      failures.push("deploy_receipt_points_to_local_repo");
    }
    if (receipt.release && !String(receipt.release).startsWith("/opt/swfipn-acceptance/releases/") && process.env.SWFIPN_RUNTIME_ALLOW_NON_DO_RELEASE !== "1") {
      failures.push(`deploy_release_not_do_release:${receipt.release}`);
    }
    if (!receipt.asset_version) failures.push("missing_asset_version");
    return { ok: failures.length === 0, receipt, failures };
  } catch (error) {
    return { ok: false, failures: [`unreadable_deploy_receipt:${error.message}`] };
  }
}

async function fetchJsonUrl(url) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      Accept: "application/json",
      "Cache-Control": "no-cache",
      Pragma: "no-cache",
    },
  });
  const text = await response.text();
  let json = null;
  try {
    json = JSON.parse(text || "null");
  } catch {
    json = { raw: text.slice(0, 500) };
  }
  return { status: response.status, headers: Object.fromEntries(response.headers.entries()), text, json };
}

async function readPublicReleaseMarker(deploy, assetReceipt) {
  const failures = [];
  const url = releaseMarkerUrl();
  try {
    const { status, headers, json } = await fetchJsonUrl(url);
    if (status !== 200) failures.push(`release_marker_http_${status}`);
    if (json?.schema_version !== "swfipn.release_marker.v1") failures.push(`release_marker_schema_${json?.schema_version || "missing"}`);
    if (!json?.asset_version) failures.push("release_marker_missing_asset_version");
    if (!json?.git_sha || json.git_sha === "unknown") failures.push("release_marker_missing_git_sha");
    if (deploy.ok && deploy.receipt?.asset_version && json?.asset_version !== deploy.receipt.asset_version) {
      failures.push(`release_marker_version_mismatch_deploy:${json.asset_version}!=${deploy.receipt.asset_version}`);
    } else if (!deploy.ok && assetReceipt.ok && assetReceipt.version && json?.asset_version !== assetReceipt.version) {
      failures.push(`release_marker_version_mismatch_local_asset:${json.asset_version}!=${assetReceipt.version}`);
    }
    if (deploy.ok && deploy.receipt?.git_sha && deploy.receipt.git_sha !== "unknown" && json?.git_sha !== deploy.receipt.git_sha) {
      failures.push(`release_marker_git_mismatch_deploy:${json.git_sha}!=${deploy.receipt.git_sha}`);
    }
    const generated = Date.parse(String(json?.generated_at || ""));
    const ageHours = Number.isFinite(generated) ? (Date.now() - generated) / 36e5 : Infinity;
    if (!Number.isFinite(ageHours)) failures.push("release_marker_missing_generated_at");
    if (ageHours > maxReleaseAgeHours) failures.push(`release_marker_stale_${ageHours.toFixed(1)}h`);
    return {
      ok: failures.length === 0,
      url,
      status,
      cache_control: headers["cache-control"] || "",
      cf_cache_status: headers["cf-cache-status"] || "",
      marker: json,
      age_hours: Number.isFinite(ageHours) ? Number(ageHours.toFixed(2)) : null,
      failures,
    };
  } catch (error) {
    return { ok: false, url, status: 0, marker: null, failures: [`release_marker_fetch_failed:${error.message}`] };
  }
}

function readAssetReceipt() {
  if (!fs.existsSync(assetReceiptPath)) return { ok: false, failures: ["missing_asset_receipt"] };
  try {
    const receipt = JSON.parse(fs.readFileSync(assetReceiptPath, "utf8"));
    const version = String(receipt.version || "").trim();
    const failures = [];
    if (receipt.status !== "pass") failures.push(`asset_status_${receipt.status || "missing"}`);
    if (!version) failures.push("missing_asset_version");
    return { ok: failures.length === 0, version, receipt, failures };
  } catch (error) {
    return { ok: false, failures: [`unreadable_asset_receipt:${error.message}`] };
  }
}

function remoteSha(file) {
  const result = spawnSync("ssh", [remoteHost, "sha256sum", file], {
    cwd: repoRoot,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) {
    return {
      ok: false,
      file,
      error: result.error?.message || result.stderr.trim() || `exit_${result.status}`,
    };
  }
  return { ok: true, file, sha256: result.stdout.trim().split(/\s+/)[0] || "" };
}

function localSha(file) {
  try {
    return { ok: true, file, sha256: sha256(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, file, error: error.message };
  }
}

function chunkRefs(html) {
  const refs = [];
  const pattern = /(\/swficc\/_next\/static\/chunks\/[^"'\\\]\s<>]+?\.(?:js|css))(?:\?v=([0-9A-Za-z_-]+))?/g;
  for (const match of html.matchAll(pattern)) {
    refs.push({ path: match[1], version: match[2] || "" });
  }
  return refs;
}

async function waitForBody(page, required, timeout = 90_000) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const ready = required.every((item) => lower.includes(item.toLowerCase()));
    if (ready && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function inspectRoute(browser, spec, deploy, publicMarker) {
  const page = await browser.newPage({ viewport: { width: spec.route === "/" ? 1440 : 1366, height: 1000 } });
  const chunkResponses = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (!url.includes("/_next/static/chunks/")) return;
    const headers = await response.allHeaders().catch(() => ({}));
    chunkResponses.push({
      url,
      status: response.status(),
      cf_cache_status: headers["cf-cache-status"] || "",
      age: headers.age || "",
      last_modified: headers["last-modified"] || "",
    });
  });

  const result = {
    route: spec.route,
    url: urlFor(spec.route),
    ok: true,
    failures: [],
    status: null,
    final_url: "",
    public_sha256: "",
    release_sha256: "",
    public_matches_release: false,
    asset_version: publicMarker.marker?.asset_version || deploy.receipt?.asset_version || "",
    release_marker_sha256: publicMarker.marker?.route_hashes?.[spec.key] || "",
    chunk_refs: 0,
    chunk_responses: [],
    unversioned_chunks: [],
    wrong_version_chunks: [],
    forbidden_visible: [],
  };

  try {
    const response = await page.goto(result.url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    result.status = response?.status() || null;
    result.final_url = page.url();
    if (!response || response.status() >= 400) result.failures.push(`http_${response?.status() || "missing"}`);
    const html = await response.text();
    const releaseComparableHtml = normalizeHtmlForReleaseHash(html);
    result.public_sha256 = sha256(releaseComparableHtml);
    const refs = chunkRefs(html);
    result.chunk_refs = refs.length;
    result.unversioned_chunks = refs.filter((ref) => !ref.version).slice(0, 20);
    result.wrong_version_chunks = refs.filter((ref) => ref.version && ref.version !== result.asset_version).slice(0, 20);
    if (!refs.length) result.failures.push("no_chunk_refs");
    if (result.unversioned_chunks.length) result.failures.push(`unversioned_chunks_${result.unversioned_chunks.length}`);
    if (result.wrong_version_chunks.length) result.failures.push(`wrong_version_chunks_${result.wrong_version_chunks.length}`);

    if (result.release_marker_sha256) {
      result.public_matches_release_marker = result.public_sha256 === result.release_marker_sha256;
      if (!result.public_matches_release_marker) result.failures.push("public_html_mismatch_release_marker");
    } else {
      result.failures.push(`release_marker_missing_route_hash:${spec.key}`);
    }

    if (remoteCheck && deploy.receipt?.release) {
      const releaseFile = `${deploy.receipt.release}/${spec.releaseFile}`;
      const release = remoteSha(releaseFile);
      if (!release.ok) {
        result.failures.push(`remote_release_sha_unavailable:${release.error}`);
      } else {
        result.release_sha256 = release.sha256;
        result.public_matches_release = result.public_sha256 === result.release_sha256;
        if (!result.public_matches_release) result.failures.push("public_html_mismatch_release");
      }
    }

    const body = await waitForBody(page, spec.required);
    for (const text of forbiddenVisible) {
      if (body.includes(text)) result.forbidden_visible.push(text);
    }
    if (result.forbidden_visible.length) result.failures.push(`forbidden_visible_${result.forbidden_visible.length}`);

    await page.waitForTimeout(500);
    const domChunks = await page.evaluate(() => Array.from(document.querySelectorAll("script[src],link[href]"))
      .map((node) => node.getAttribute("src") || node.getAttribute("href") || "")
      .filter((value) => value.includes("/_next/static/chunks/")));
    const performanceChunks = await page.evaluate(() => performance.getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((value) => value.includes("/_next/static/chunks/")));
    const loadedChunks = [...new Set([...domChunks, ...performanceChunks, ...chunkResponses.map((item) => item.url)])];
    const loadedUnversioned = loadedChunks.filter((value) => !value.includes("?v="));
    const loadedWrongVersion = loadedChunks.filter((value) => value.includes("?v=") && !value.includes(`?v=${result.asset_version}`));
    result.chunk_responses = chunkResponses;
    if (loadedUnversioned.length) result.failures.push(`loaded_unversioned_chunks_${loadedUnversioned.length}`);
    if (loadedWrongVersion.length) result.failures.push(`loaded_wrong_version_chunks_${loadedWrongVersion.length}`);
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }

  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const deploy = readDeployReceipt();
  const assetReceipt = readAssetReceipt();
  const publicMarker = await readPublicReleaseMarker(deploy, assetReceipt);
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  });
  const checks = [];
  try {
    if (!deploy.ok) {
      checks.push({ id: "deploy_receipt", ok: false, failures: deploy.failures });
    }
    if (!assetReceipt.ok) {
      checks.push({ id: "asset_receipt", ok: false, failures: assetReceipt.failures });
    }
    if (!publicMarker.ok) {
      checks.push({ id: "public_release_marker", ok: false, failures: publicMarker.failures });
    }
    if (publicMarker.ok) {
      for (const spec of routeSpecs) {
        checks.push(await inspectRoute(browser, spec, deploy, publicMarker));
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  const failures = checks.filter((check) => !check.ok).map((check) => ({
    id: check.id || `route:${check.route}`,
    route: check.route,
    failures: check.failures,
  }));
  const receipt = {
    schema_version: "swfipn.runtime_staleness_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: failures.length ? "fail" : "pass",
    remote_check: remoteCheck,
    remote_host: remoteCheck ? remoteHost : "",
    public_release_marker: {
      ok: publicMarker.ok,
      url: publicMarker.url,
      status: publicMarker.status,
      asset_version: publicMarker.marker?.asset_version || "",
      generated_at: publicMarker.marker?.generated_at || "",
      git_sha: publicMarker.marker?.git_sha || "",
      git_dirty: publicMarker.marker?.git_dirty === true,
      age_hours: publicMarker.age_hours,
      cache_control: publicMarker.cache_control || "",
      cf_cache_status: publicMarker.cf_cache_status || "",
      failures: publicMarker.failures || [],
    },
    asset_receipt: {
      ok: assetReceipt.ok,
      asset_version: assetReceipt.version || "",
      failures: assetReceipt.failures || [],
    },
    deploy_receipt: {
      ok: deploy.ok,
      release: deploy.receipt?.release || "",
      asset_version: deploy.receipt?.asset_version || "",
      git_sha: deploy.receipt?.git_sha || "",
      git_dirty: deploy.receipt?.git_dirty === true,
      failures: deploy.failures || [],
    },
    summary: {
      checks: checks.length,
      failures: failures.length,
      routes: routeSpecs.length,
    },
    checks,
    failures,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    summary: receipt.summary,
    release: receipt.deploy_receipt.release,
    asset_version: receipt.deploy_receipt.asset_version,
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
