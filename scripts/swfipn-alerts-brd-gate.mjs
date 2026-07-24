#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-alerts-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const origin = new URL(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || process.env.SWFIPN_API_ORIGIN || "https://swfipn.activemirror.ai").origin;
const serviceToken = loadServiceToken();
const timeoutMs = Number(process.env.SWFIPN_ALERTS_TIMEOUT_MS || 15000);

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const userId = `alerts-${Date.now()}@swfi.test`;
  let alertId = "";
  let webhookAlertId = "";

  if (!serviceToken) {
    blockers.push("service_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks });
  }

  const unauthCreate = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: jsonHeaders(),
    body: JSON.stringify({ alert_name: "Unauth probe", alert_type: "transaction" }),
  });
  checks.push(summarize("unauthenticated_create", unauthCreate));
  if (unauthCreate.status !== 401) failures.push(`unauthenticated_create_expected_401_got_${unauthCreate.status}`);

  const invalidWebhook = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: "Invalid webhook",
      alert_type: "transaction",
      delivery_channels: ["webhook"],
      webhook_url: "http://example.com/hook",
      criteria: {},
    }),
  });
  checks.push(summarize("invalid_webhook_rejected", invalidWebhook));
  if (invalidWebhook.status !== 400) failures.push(`invalid_webhook_expected_400_got_${invalidWebhook.status}`);

  const webhookReady = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: "Webhook receipt",
      alert_type: "transaction",
      delivery_channels: ["webhook", "in_app"],
      webhook_url: `${origin}/api/v1/alerts/webhook-test-sink`,
      criteria: {},
    }),
  });
  checks.push(summarize("webhook_delivery_receipts", webhookReady));
  webhookAlertId = typeof webhookReady.body?.data?.item?.id === "string" ? webhookReady.body.data.item.id : "";
  if (webhookReady.status !== 200) failures.push(`webhook_ready_expected_200_got_${webhookReady.status}`);
  if (!webhookAlertId) failures.push("webhook_ready_missing_alert_id");
  if (!hasReceipt(webhookReady.body, "webhook", "delivered")) failures.push("webhook_ready_missing_webhook_delivery_receipt");
  if (!hasReceipt(webhookReady.body, "in_app", "delivered")) failures.push("webhook_ready_missing_in_app_delivery_receipt");

  const entityAumMissing = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: "AUM change",
      alert_type: "entity_aum",
      delivery_channels: ["email"],
      criteria: { change_threshold_pct: 5 },
    }),
  });
  checks.push(summarize("entity_aum_requires_entity_ids", entityAumMissing));
  if (entityAumMissing.status !== 400) failures.push(`entity_aum_missing_expected_400_got_${entityAumMissing.status}`);

  const created = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: "ADIA infrastructure deals",
      alert_type: "transaction",
      delivery_channels: ["email", "in_app"],
      frequency: "Immediate",
      criteria: { buyer_entity_ids: ["5e39"], sectors: ["Infrastructure"], min_amount_usd: 100000000 },
    }),
  });
  checks.push(summarize("create", created));
  alertId = typeof created.body?.data?.item?.id === "string" ? created.body.data.item.id : "";
  if (created.status !== 200) failures.push(`create_http_${created.status}`);
  if (created.body?.status !== "ok") failures.push(`create_status_${created.body?.status || "missing"}`);
  if (!alertId) failures.push("create_missing_alert_id");
  if (created.body?.provenance?.source !== "swfi2_product_contract") failures.push("create_wrong_source_contract");
  if (created.body?.data?.item?.alert_type !== "transaction") failures.push("create_wrong_alert_type");
  if (!["delivery_worker_available", "email_pending_sendgrid"].includes(created.body?.data?.item?.delivery_worker_status)) failures.push("create_missing_delivery_worker_status");
  if (!String(created.body?.data?.item?.delivery_claim || "").includes("Email delivery remains pending SendGrid")) failures.push("create_missing_email_sendgrid_boundary");
  if (!String(created.body?.data?.item?.plain_english_preview || "").includes("You will be alerted")) failures.push("create_missing_plain_english_preview");

  const listed = await fetchJson("/api/v1/alerts?limit=10&offset=0", { headers: authHeaders(userId) });
  checks.push(summarize("list_same_user", listed));
  if (listed.status !== 200) failures.push(`list_http_${listed.status}`);
  if (!listed.body?.data?.items?.some?.((item) => item?.id === alertId)) failures.push("list_missing_created_alert");

  const otherUser = await fetchJson("/api/v1/alerts?limit=10&offset=0", { headers: authHeaders(`other-${userId}`) });
  checks.push(summarize("list_other_user", otherUser));
  if (otherUser.status !== 200) failures.push(`other_user_list_http_${otherUser.status}`);
  if (otherUser.body?.data?.items?.some?.((item) => item?.id === alertId)) failures.push("user_isolation_failed");
  if (!String(otherUser.body?.data?.empty_state || "").includes("You have no active alerts")) failures.push("missing_empty_state");

  if (alertId) {
    const patched = await fetchJson(`/api/v1/alerts/${encodeURIComponent(alertId)}`, {
      method: "PATCH",
      headers: authHeaders(userId),
      body: JSON.stringify({ enabled: false, frequency: "Daily Digest" }),
    });
    checks.push(summarize("patch", patched));
    if (patched.status !== 200) failures.push(`patch_http_${patched.status}`);
    if (patched.body?.data?.item?.enabled !== false) failures.push("patch_enabled_not_updated");
    if (patched.body?.data?.item?.frequency !== "Daily Digest") failures.push("patch_frequency_not_updated");

    const history = await fetchJson("/api/v1/alerts/history?limit=25&offset=0", { headers: authHeaders(userId) });
    checks.push(summarize("history", history));
    if (history.status !== 200) failures.push(`history_http_${history.status}`);
    if (history.body?.data?.retention_days !== 90) failures.push("history_missing_90_day_retention");
    if (history.body?.data?.delivery_worker_status !== "delivery_worker_available") failures.push("history_missing_delivery_worker_status");
    if (!String(history.body?.data?.delivery_claim || "").includes("Email delivery remains pending SendGrid")) failures.push("history_missing_email_sendgrid_boundary");

    const deleted = await fetchJson(`/api/v1/alerts/${encodeURIComponent(alertId)}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    });
    checks.push(summarize("delete", deleted));
    if (deleted.status !== 200) failures.push(`delete_http_${deleted.status}`);
    if (deleted.body?.data?.deleted !== true) failures.push("delete_missing_deleted_true");

    const relisted = await fetchJson("/api/v1/alerts?limit=10&offset=0", { headers: authHeaders(userId) });
    checks.push(summarize("relist_after_delete", relisted));
    if (relisted.status !== 200) failures.push(`relist_http_${relisted.status}`);
    if (relisted.body?.data?.items?.some?.((item) => item?.id === alertId)) failures.push("delete_did_not_remove_from_active_list");
  }

  if (webhookAlertId) {
    const deletedWebhook = await fetchJson(`/api/v1/alerts/${encodeURIComponent(webhookAlertId)}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    });
    checks.push(summarize("delete_webhook_receipt_alert", deletedWebhook));
    if (deletedWebhook.status !== 200) failures.push(`delete_webhook_http_${deletedWebhook.status}`);
    if (deletedWebhook.body?.data?.deleted !== true) failures.push("delete_webhook_missing_deleted_true");
  }

  const allText = checks.map((check) => JSON.stringify(check)).join("\n");
  for (const forbidden of ["source_doc_ids", "amount_display", "buyer_region", "swfi_live_", "key_hash", "delivery_sent"]) {
    if (allText.includes(forbidden)) failures.push(`forbidden_receipt_value_${forbidden}`);
  }

  return writeReceipt({
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    blockers,
    failures,
    checks,
    alert_id: alertId,
    user_isolation_checked: true,
    no_secret_values_written: true,
    no_delivery_claimed_without_receipts: true,
    webhook_delivery_receipts_enabled: true,
    email_delivery_claimed: false,
    sendgrid_onboarding_claimed: false,
  });
}

function hasReceipt(body, channel, status) {
  const receipts = body?.data?.delivery_receipts;
  return Array.isArray(receipts) && receipts.some((receipt) => receipt?.channel === channel && receipt?.status === status);
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
    item_name: item?.name || null,
    item_alert_type: item?.alert_type || null,
    item_enabled: typeof item?.enabled === "boolean" ? item.enabled : null,
    item_frequency: item?.frequency || null,
    item_delivery_worker_status: item?.delivery_worker_status || data?.delivery_worker_status || null,
    item_plain_english_preview_present: Boolean(item?.plain_english_preview),
    count: typeof data?.count === "number" ? data.count : null,
    total: typeof data?.total === "number" ? data.total : null,
    retention_days: typeof data?.retention_days === "number" ? data.retention_days : null,
    delivery_claim: data?.delivery_claim || item?.delivery_claim || null,
    deleted: typeof data?.deleted === "boolean" ? data.deleted : null,
    detail: body?.detail || null,
  };
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
    schema_version: "swfipn.alerts_brd_gate.v1",
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
      alert_id: fullReceipt.alert_id || "",
      user_isolation_checked: Boolean(fullReceipt.user_isolation_checked),
      no_delivery_claimed_without_receipts: Boolean(fullReceipt.no_delivery_claimed_without_receipts),
      webhook_delivery_receipts_enabled: Boolean(fullReceipt.webhook_delivery_receipts_enabled),
      email_delivery_claimed: Boolean(fullReceipt.email_delivery_claimed),
      sendgrid_onboarding_claimed: Boolean(fullReceipt.sendgrid_onboarding_claimed),
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

function envList(name, fallback = []) {
  const raw = String(process.env[name] || "").trim();
  if (!raw) return fallback;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

main().catch((error) => {
  const receipt = {
    schema_version: "swfipn.alerts_brd_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: origin,
    status: "fail",
    no_secret_values_written: true,
    blockers: [],
    failures: [`uncaught:${error.message}`],
    checks: [],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(JSON.stringify({ status: "fail", receipt: receiptPath, error: error.message }, null, 2));
  process.exit(1);
});
