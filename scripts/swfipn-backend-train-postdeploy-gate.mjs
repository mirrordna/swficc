#!/usr/bin/env node
// Post-deploy acceptance gate for the backend train:
//   PR #3  top20 USD label integrity (fx blocker fix)
//   PR #4  broad-region crosswalk + entity country filter
//   PR #5  activity feed Phase A
// Repo: MirrorDNA-Reflection-Protocol/swfi2-final-backend
//
// EXPECTED TO FAIL until that train is deployed to the DigitalOcean
// target behind dashboard.swfi.com — this is the deploy-coupled flip of
// the interim expect-blocked checks. Once green, the expect-blocked AUM
// gate (untracked interim script) is superseded for FX state.

import fs from "node:fs";
import path from "node:path";
import { inspectAumRankingPacket } from "../src/lib/aumRankingContract.ts";

const repoRoot = process.cwd();
const sourceOrigin = process.env.SWFIPN_ORIGIN_BACKEND || "https://dashboard.swfi.com";
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-backend-train-postdeploy-gate-latest.json");
const checks = [];
const calls = [];

// Mirror of swfi2-final-backend src/swfi2_final/domain/region_crosswalk.py
// (canonical). Only membership is asserted here.
const MENA = new Set([
  "Algeria", "Bahrain", "Djibouti", "Egypt", "Iran", "Iraq", "Israel",
  "Jordan", "Kuwait", "Lebanon", "Libya", "Mauritania", "Morocco", "Oman",
  "Palestine", "Qatar", "Saudi Arabia", "Sudan", "Syria", "Tunisia",
  "United Arab Emirates", "Yemen",
]);

function check(id, pass, evidence = {}) {
  checks.push({ id, pass, evidence });
  if (!pass) throw new Error(`${id}: ${JSON.stringify(evidence)}`);
}

async function fetchJson(pathname, params = {}, timeout = 75_000) {
  const url = new URL(pathname, sourceOrigin);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, String(value));
  const started = Date.now();
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeout),
    headers: { Accept: "application/json", "User-Agent": "SWFIPN-BackendTrainPostdeployGate/1.0" },
  });
  const body = await response.json().catch(() => ({}));
  const result = { url: url.href, http: response.status, ms: Date.now() - started, body };
  calls.push({ url: result.url, http: result.http, ms: result.ms, status: body?.status, fact: body?.fact });
  return result;
}

const data = (result) => (result.body?.data && typeof result.body.data === "object" ? result.body.data : {});
const rowsOf = (result, key = "rows") => (Array.isArray(data(result)[key]) ? data(result)[key] : []);

let verdict = "fail";
try {
  // --- PR #3: top20 serves USD-proven values the dashboard contract accepts.
  const top = await fetchJson("/v1/swfi/top20", { limit: 250 });
  check("top20_http_ok", top.http === 200, { http: top.http });
  const contract = inspectAumRankingPacket(top.body, 250);
  check("top20_contract_state_ready", contract.state === "ready", { state: contract.state, issues: contract.issues.slice(0, 8) });
  check("top20_no_fx_provenance_issues", !contract.issues.some((issue) => issue.startsWith("fx_provenance_")), { issues: contract.issues.slice(0, 8) });
  const topRows = rowsOf(top);
  const mislabeled = topRows.filter((row) => row.aum_usd != null && String(row.aum_currency || "").toUpperCase() !== "USD" && row.aum_usd === row.aum);
  check("top20_no_native_values_labeled_usd", mislabeled.length === 0, { mislabeled: mislabeled.slice(0, 3).map((row) => row.name) });
  const usdRows = topRows.filter((row) => row.aum_usd != null);
  check("top20_usd_rows_carry_basis_and_source", usdRows.every((row) => row.aum_usd_basis && row.aum_usd_source), {
    missing: usdRows.filter((row) => !row.aum_usd_basis || !row.aum_usd_source).slice(0, 3).map((row) => row.name),
  });
  check("top20_default_scope_still_active_only", data(top).include_defunct === false && data(top).total === data(top).active_count, {
    include_defunct: data(top).include_defunct, total: data(top).total, active: data(top).active_count,
  });

  // --- PR #3: unsupported top20 params are disclosed, not silently dropped.
  const probed = await fetchJson("/v1/swfi/top20", { limit: 25, country: "Norway", sort: "name", page: 2 });
  const ignored = Array.isArray(data(probed).ignored_params) ? data(probed).ignored_params : null;
  check("top20_unsupported_params_disclosed", Array.isArray(ignored) && ["country", "page", "sort"].every((p) => ignored.includes(p)), { ignored });

  // --- PR #4: entity directory country filter is honored.
  const norway = await fetchJson("/api/source-data/search/v1", { collection: "entities", entity_type: "Sovereign Wealth Fund", country: "Norway", limit: 25, page: 1 });
  const norwayRows = rowsOf(norway).length ? rowsOf(norway) : rowsOf(norway, "results");
  check("entity_directory_country_filter_honored", norwayRows.length > 0 && norwayRows.every((row) => String(row.country || "") === "Norway"), {
    returned: norwayRows.length,
    countries: [...new Set(norwayRows.map((row) => row.country))].slice(0, 5),
  });

  // --- PR #4: broad region resolves to member countries.
  const mena = await fetchJson("/api/source-data/search/v1", { collection: "entities", entity_type: "Sovereign Wealth Fund", region: "MENA", limit: 25, page: 1 });
  const menaRows = rowsOf(mena).length ? rowsOf(mena) : rowsOf(mena, "results");
  const outsiders = menaRows.filter((row) => !MENA.has(String(row.country || "")) && String(row.region || "").toUpperCase() !== "MENA");
  check("broad_region_mena_resolves_to_member_countries", menaRows.length > 0 && outsiders.length === 0, {
    returned: menaRows.length,
    outsiders: outsiders.slice(0, 3).map((row) => `${row.name}:${row.country}`),
  });

  // --- PR #5: activity feed serves grouped, source-bound sections.
  const feed = await fetchJson("/v1/swfi/activity-feed", { limit: 10, days: 30 });
  check("activity_feed_http_ok_and_fact", feed.http === 200 && feed.body?.status === "ok", { http: feed.http, status: feed.body?.status });
  check("activity_feed_grouped_sections", Array.isArray(data(feed).deals) && Array.isArray(data(feed).mandates) && data(feed).identity_scope === "global", {
    sections: data(feed).sections, identity_scope: data(feed).identity_scope,
  });
  check("activity_feed_rows_are_source_bound", [...rowsOf(feed, "deals"), ...rowsOf(feed, "mandates")].every((row) => row.source_url), {});

  verdict = "pass";
} finally {
  fs.mkdirSync(outputDir, { recursive: true });
  const receipt = {
    schema_version: "swfipn.backend_train_postdeploy_gate.v1",
    origin: sourceOrigin,
    verdict,
    checks,
    calls,
    note: verdict === "pass"
      ? "Backend train (top20 USD integrity, region crosswalk + country filter, activity feed) verified against the deployed origin."
      : "Expected to fail until the swfi2-final-backend train (PR #3/#4/#5) is deployed to the DigitalOcean target.",
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: verdict, checks: checks.length, receipt: receiptPath }, null, 2));
}
