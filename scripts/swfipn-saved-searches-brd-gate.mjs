#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-saved-searches-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const origin = new URL(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || process.env.SWFIPN_API_ORIGIN || "https://swfipn.activemirror.ai").origin;
const serviceToken = loadServiceToken();
const timeoutMs = Number(process.env.SWFIPN_SAVED_SEARCH_TIMEOUT_MS || 15000);

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const userId = `acceptance-${Date.now()}@swfi.test`;
  let savedId = "";

  if (!serviceToken) {
    blockers.push("service_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks });
  }

  const unauthCreate = await fetchJson("/api/v1/saved-searches", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ name: "Unauth probe", section: "entity" }),
  });
  checks.push(summarize("unauthenticated_create", unauthCreate));
  if (unauthCreate.status !== 401) failures.push(`unauthenticated_create_expected_401_got_${unauthCreate.status}`);

  const created = await fetchJson("/api/v1/saved-searches", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      name: "Asia Infrastructure Deals > $100M",
      section: "transaction",
      query_string: "Norway",
      filters: { region: ["Asia"], sector: ["Infrastructure"], min_amount: 100000000 },
      result_url: "/v1/transactions/search?region=Asia&sector=Infrastructure&q=Norway",
      alert_enabled: true,
      alert_frequency: "Daily Digest",
    }),
  });
  checks.push(summarize("create", created));
  savedId = typeof created.body?.data?.item?.id === "string" ? created.body.data.item.id : "";
  if (created.status !== 200) failures.push(`create_http_${created.status}`);
  if (created.body?.status !== "ok") failures.push(`create_status_${created.body?.status || "missing"}`);
  if (!savedId) failures.push("create_missing_saved_search_id");
  if (created.body?.provenance?.source !== "swfi2_product_contract") failures.push("create_wrong_source_contract");
  if (!String(created.body?.data?.item?.filters_summary || "").includes("Query: Norway")) failures.push("create_missing_plain_english_summary");
  if (created.body?.data?.item?.linked_alert_enabled !== true) failures.push("create_missing_linked_alert_enabled");
  if (created.body?.data?.item?.linked_alert_channel !== "in_app") failures.push("create_missing_in_app_linked_alert_channel");
  if (created.body?.data?.linked_alert?.linked_alert_enabled !== true) failures.push("create_missing_linked_alert_contract");

  const listed = await fetchJson("/api/v1/saved-searches?limit=10&offset=0", { headers: authHeaders(userId) });
  checks.push(summarize("list_same_user", listed));
  if (listed.status !== 200) failures.push(`list_http_${listed.status}`);
  if (!listed.body?.data?.items?.some?.((item) => item?.id === savedId)) failures.push("list_missing_created_item");

  const otherUser = await fetchJson("/api/v1/saved-searches?limit=10&offset=0", { headers: authHeaders(`other-${userId}`) });
  checks.push(summarize("list_other_user", otherUser));
  if (otherUser.status !== 200) failures.push(`other_user_list_http_${otherUser.status}`);
  if (otherUser.body?.data?.items?.some?.((item) => item?.id === savedId)) failures.push("user_isolation_failed");

  if (savedId) {
    const rejectedPatch = await fetchJson(`/api/v1/saved-searches/${encodeURIComponent(savedId)}`, {
      method: "PATCH",
      headers: authHeaders(userId),
      body: JSON.stringify({ filters: { region: ["Europe"] } }),
    });
    checks.push(summarize("patch_requires_alert_confirmation", rejectedPatch));
    if (rejectedPatch.status !== 409) failures.push(`patch_confirmation_expected_409_got_${rejectedPatch.status}`);

    const patched = await fetchJson(`/api/v1/saved-searches/${encodeURIComponent(savedId)}`, {
      method: "PATCH",
      headers: authHeaders(userId),
      body: JSON.stringify({ name: "Norway deals", filters: { region: ["Europe"] }, confirm_alert_update: true }),
    });
    checks.push(summarize("patch_confirmed", patched));
    if (patched.status !== 200) failures.push(`patch_http_${patched.status}`);
    if (patched.body?.data?.item?.name !== "Norway deals") failures.push("patch_name_not_updated");
    if (patched.body?.data?.item?.linked_alert_enabled !== true) failures.push("patch_missing_linked_alert_enabled");
    if (patched.body?.data?.linked_alert?.linked_alert_enabled !== true) failures.push("patch_missing_linked_alert_contract");

    const results = await fetchJson(`/api/v1/saved-searches/${encodeURIComponent(savedId)}/results?limit=2&offset=0`, {
      headers: authHeaders(userId),
    });
    checks.push(summarize("rerun_results", results));
    if (results.status !== 200) failures.push(`results_http_${results.status}`);
    if (results.body?.data?.current_results?.status !== "ok") failures.push(`results_current_status_${results.body?.data?.current_results?.status || "missing"}`);
    if (!String(results.body?.data?.refresh_rule || "").includes("read fresh")) failures.push("results_missing_refresh_rule");
    if (!results.body?.data?.item?.last_used_at) failures.push("results_missing_last_used_at");

    const delivery = await fetchJson(`/api/v1/saved-searches/${encodeURIComponent(savedId)}/alert-deliveries/test`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ event_title: "Saved search BRD alert delivery proof", event_type: "saved_search" }),
    });
    checks.push(summarize("linked_alert_delivery_test", delivery));
    const linkedDelivery = delivery.body?.data?.linked_alert_delivery || {};
    if (delivery.status !== 200) failures.push(`linked_alert_delivery_http_${delivery.status}`);
    if (delivery.body?.status !== "ok") failures.push(`linked_alert_delivery_status_${delivery.body?.status || "missing"}`);
    if (linkedDelivery.delivered_count !== 1) failures.push(`linked_alert_delivery_expected_1_delivered_got_${linkedDelivery.delivered_count ?? "missing"}`);
    if (linkedDelivery.blocked_count !== 0) failures.push(`linked_alert_delivery_expected_0_blocked_got_${linkedDelivery.blocked_count ?? "missing"}`);
    if (linkedDelivery.failed_count !== 0) failures.push(`linked_alert_delivery_expected_0_failed_got_${linkedDelivery.failed_count ?? "missing"}`);
    if (linkedDelivery.email_delivery_claimed !== false) failures.push("linked_alert_delivery_claimed_email");
    if (linkedDelivery.sendgrid_onboarding_claimed !== false) failures.push("linked_alert_delivery_claimed_sendgrid");
    if (!hasReceipt(delivery.body, "in_app", "delivered")) failures.push("linked_alert_delivery_missing_in_app_receipt");
    if (linkedDelivery.current_results_summary?.status !== "ok") failures.push(`linked_alert_delivery_current_results_${linkedDelivery.current_results_summary?.status || "missing"}`);
    if (!delivery.body?.data?.item?.linked_alert_last_fired_at) failures.push("linked_alert_delivery_missing_last_fired_at");

    const deleted = await fetchJson(`/api/v1/saved-searches/${encodeURIComponent(savedId)}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    });
    checks.push(summarize("delete", deleted));
    if (deleted.status !== 200) failures.push(`delete_http_${deleted.status}`);
    if (deleted.body?.data?.linked_alert_deleted !== true) failures.push("delete_missing_linked_alert_delete");

    const relisted = await fetchJson("/api/v1/saved-searches?limit=10&offset=0", { headers: authHeaders(userId) });
    checks.push(summarize("relist_after_delete", relisted));
    if (relisted.status !== 200) failures.push(`relist_http_${relisted.status}`);
    if (relisted.body?.data?.items?.some?.((item) => item?.id === savedId)) failures.push("delete_did_not_remove_from_active_list");
  }

  const allText = checks.map((check) => JSON.stringify(check)).join("\n");
  for (const forbidden of ["source_doc_ids", "buyer_entity", "amount_display", "swfi_live_", "key_hash"]) {
    if (allText.includes(forbidden)) failures.push(`forbidden_receipt_value_${forbidden}`);
  }

  return writeReceipt({
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    blockers,
    failures,
    checks,
    saved_search_id: savedId,
    user_isolation_checked: true,
    no_fact_rows_persisted_in_receipt: true,
    saved_search_alert_delivery_integrated: true,
    linked_alert_delivery_receipt_written: true,
    email_delivery_claimed: false,
    sendgrid_onboarding_claimed: false,
  });
}

function jsonHeaders() {
  return { Accept: "application/json", "Content-Type": "application/json" };
}

function authHeaders(userId) {
  return {
    ...jsonHeaders(),
    Authorization: `Bearer ${serviceToken}`,
    "X-SWFI-User-Id": userId,
    "X-SWFIPN-Internal": "1",
  };
}

async function fetchJson(pathname, options = {}) {
  const url = new URL(pathname, `${origin}/`).href;
  const response = await fetchWithTimeout(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  let body = null;
  try {
    body = JSON.parse(text || "null");
  } catch {
    body = { raw: text.slice(0, 240) };
  }
  return { url, status: response.status, headers: pickHeaders(response.headers), body, text };
}

async function fetchWithTimeout(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function summarize(label, response) {
  return {
    label,
    url: response.url,
    status: response.status,
    headers: response.headers,
    body_summary: summarizeBody(response.body),
  };
}

function summarizeBody(body) {
  const data = body && typeof body === "object" ? body.data : null;
  const item = data && typeof data === "object" ? data.item : null;
  return {
    status: body?.status || null,
    schema_version: body?.schema_version || null,
    source: body?.provenance?.source || null,
    item_id: item?.id || null,
    item_section: item?.section || null,
    item_name: item?.name || null,
    item_alert_enabled: typeof item?.alert_enabled === "boolean" ? item.alert_enabled : null,
    item_linked_alert_enabled: typeof item?.linked_alert_enabled === "boolean" ? item.linked_alert_enabled : null,
    item_linked_alert_channel: item?.linked_alert_channel || null,
    item_last_used_at_present: Boolean(item?.last_used_at),
    item_linked_alert_last_fired_at_present: Boolean(item?.linked_alert_last_fired_at),
    count: typeof data?.count === "number" ? data.count : null,
    total: typeof data?.total === "number" ? data.total : null,
    current_result_status: data?.current_results?.status || null,
    current_result_collection: data?.current_results?.collection || null,
    linked_alert_enabled: typeof data?.linked_alert?.linked_alert_enabled === "boolean" ? data.linked_alert.linked_alert_enabled : null,
    linked_alert_deleted: typeof data?.linked_alert_deleted === "boolean" ? data.linked_alert_deleted : null,
    delivery: summarizeDelivery(data?.linked_alert_delivery),
    detail: body?.detail || null,
  };
}

function summarizeDelivery(delivery) {
  if (!delivery || typeof delivery !== "object") return null;
  const receipts = Array.isArray(delivery.delivery_receipts) ? delivery.delivery_receipts : [];
  return {
    delivered_count: typeof delivery.delivered_count === "number" ? delivery.delivered_count : null,
    blocked_count: typeof delivery.blocked_count === "number" ? delivery.blocked_count : null,
    failed_count: typeof delivery.failed_count === "number" ? delivery.failed_count : null,
    channel: delivery.channel || null,
    email_delivery_claimed: typeof delivery.email_delivery_claimed === "boolean" ? delivery.email_delivery_claimed : null,
    sendgrid_onboarding_claimed: typeof delivery.sendgrid_onboarding_claimed === "boolean" ? delivery.sendgrid_onboarding_claimed : null,
    current_results_status: delivery.current_results_summary?.status || null,
    receipt_statuses: receipts.map((receipt) => `${receipt.channel}:${receipt.status}`),
  };
}

function hasReceipt(body, channel, status) {
  const receipts = body?.data?.linked_alert_delivery?.delivery_receipts;
  return Array.isArray(receipts) && receipts.some((receipt) => receipt?.channel === channel && receipt?.status === status);
}

function pickHeaders(headers) {
  const picked = {};
  for (const name of ["content-type", "server", "cf-ray", "retry-after"]) {
    const value = headers.get(name);
    if (value) picked[name.replaceAll("-", "_")] = value;
  }
  return picked;
}

function writeReceipt(receipt) {
  const fullReceipt = {
    schema_version: "swfipn.saved_searches_brd_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: origin,
    no_secret_values_written: true,
    ...receipt,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(fullReceipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: fullReceipt.status,
    receipt: receiptPath,
    summary: {
      failures: fullReceipt.failures || [],
      blockers: fullReceipt.blockers || [],
      saved_search_id: fullReceipt.saved_search_id || "",
      user_isolation_checked: Boolean(fullReceipt.user_isolation_checked),
      saved_search_alert_delivery_integrated: Boolean(fullReceipt.saved_search_alert_delivery_integrated),
      linked_alert_delivery_receipt_written: Boolean(fullReceipt.linked_alert_delivery_receipt_written),
      no_secret_values_written: true,
    },
  }, null, 2));
  if (fullReceipt.status === "fail") process.exit(1);
}

function loadServiceToken() {
  for (const envName of ["SWFIPN_BACKEND_TOKEN", "SWFI2_API_TOKEN"]) {
    const value = String(process.env[envName] || "").trim();
    if (value) return value;
  }
  return keychainLookup(
    envList("SWFIPN_SERVICE_TOKEN_KEYCHAIN_SERVICES", [
      "swfi2-api-token",
      "swfipn-backend-token",
      "SWFIPN_BACKEND_TOKEN",
      "SWFI2_API_TOKEN",
    ])
  ).trim();
}

function keychainLookup(services) {
  if (!/^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_AUTH_USE_KEYCHAIN || "1"))) return "";
  const accounts = envList("SWFI_KEYCHAIN_SECRET_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"]);
  for (const account of accounts) {
    for (const service of services) {
      try {
        const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        });
        if (value) return value;
      } catch {
        // Try the next Keychain service/account.
      }
    }
  }
  return "";
}

function envList(name, fallback) {
  const raw = String(process.env[name] || "");
  const items = raw.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length ? items : fallback;
}

main().catch((error) => {
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    schema_version: "swfipn.saved_searches_brd_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: origin,
    status: "fail",
    error: error.message,
    no_secret_values_written: true,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
