#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-alert-delivery-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const origin = new URL(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || process.env.SWFIPN_API_ORIGIN || "https://swfipn.activemirror.ai").origin;
const webhookUrl = process.env.SWFIPN_ALERT_WEBHOOK_TEST_URL || `${origin}/api/v1/alerts/webhook-test-sink`;
const serviceToken = loadServiceToken();
const timeoutMs = Number(process.env.SWFIPN_ALERT_DELIVERY_TIMEOUT_MS || 20000);

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const userId = `alert-delivery-${Date.now()}@swfi.test`;
  let webhookAlertId = "";
  let emailAlertId = "";

  if (!serviceToken) {
    blockers.push("service_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks });
  }

  const webhookCreated = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: `Webhook delivery proof ${Date.now()}`,
      alert_type: "transaction",
      delivery_channels: ["in_app", "webhook"],
      webhook_url: webhookUrl,
      frequency: "Immediate",
      criteria: { sectors: ["Infrastructure"], min_amount_usd: 100000000 },
    }),
  });
  checks.push(summarize("create_webhook_alert_with_validation_ping", webhookCreated));
  webhookAlertId = String(webhookCreated.body?.data?.item?.id || "");
  if (webhookCreated.status !== 200) failures.push(`create_webhook_alert_http_${webhookCreated.status}`);
  if (!webhookAlertId) failures.push("create_webhook_alert_missing_id");
  if (!hasReceipt(webhookCreated.body, "webhook", "delivered")) failures.push("create_webhook_validation_missing_delivered_webhook_receipt");
  if (!hasReceipt(webhookCreated.body, "in_app", "delivered")) failures.push("create_webhook_validation_missing_in_app_receipt");

  if (webhookAlertId) {
    const tested = await fetchJson(`/api/v1/alerts/${encodeURIComponent(webhookAlertId)}/deliveries/test`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ event_title: "SWFI alert delivery acceptance event", event_type: "transaction" }),
    });
    checks.push(summarize("test_delivery_webhook_in_app", tested));
    if (tested.status !== 200) failures.push(`test_delivery_http_${tested.status}`);
    if (tested.body?.data?.delivered_count !== 2) failures.push(`test_delivery_expected_2_delivered_got_${tested.body?.data?.delivered_count ?? "missing"}`);
    if (tested.body?.data?.blocked_count !== 0) failures.push(`test_delivery_expected_0_blocked_got_${tested.body?.data?.blocked_count ?? "missing"}`);
    if (tested.body?.data?.failed_count !== 0) failures.push(`test_delivery_expected_0_failed_got_${tested.body?.data?.failed_count ?? "missing"}`);
    if (tested.body?.data?.email_delivery_claimed !== false) failures.push("test_delivery_claimed_email");
    if (tested.body?.data?.sendgrid_onboarding_claimed !== false) failures.push("test_delivery_claimed_sendgrid");
    if (!hasReceipt(tested.body, "webhook", "delivered")) failures.push("test_delivery_missing_webhook_delivered_receipt");
    if (!hasReceipt(tested.body, "in_app", "delivered")) failures.push("test_delivery_missing_in_app_delivered_receipt");
  }

  const emailCreated = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: `Email boundary proof ${Date.now()}`,
      alert_type: "transaction",
      delivery_channels: ["email"],
      frequency: "Daily Digest",
      criteria: { sectors: ["Infrastructure"] },
    }),
  });
  checks.push(summarize("create_email_boundary_alert", emailCreated));
  emailAlertId = String(emailCreated.body?.data?.item?.id || "");
  if (emailCreated.status !== 200) failures.push(`create_email_alert_http_${emailCreated.status}`);
  if (!emailAlertId) failures.push("create_email_alert_missing_id");

  if (emailAlertId) {
    const emailTest = await fetchJson(`/api/v1/alerts/${encodeURIComponent(emailAlertId)}/deliveries/test`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ event_title: "SWFI email boundary event", event_type: "transaction" }),
    });
    checks.push(summarize("test_delivery_email_boundary", emailTest));
    if (emailTest.status !== 200) failures.push(`email_test_http_${emailTest.status}`);
    if (emailTest.body?.data?.delivered_count !== 0) failures.push("email_test_overclaimed_delivered_count");
    if (emailTest.body?.data?.blocked_count !== 1) failures.push(`email_test_expected_1_blocked_got_${emailTest.body?.data?.blocked_count ?? "missing"}`);
    if (emailTest.body?.data?.email_delivery_claimed !== false) failures.push("email_delivery_claimed_without_sendgrid");
    if (emailTest.body?.data?.sendgrid_onboarding_claimed !== false) failures.push("sendgrid_onboarding_claimed_without_receipt");
    if (!hasReceipt(emailTest.body, "email", "blocked")) failures.push("email_test_missing_blocked_receipt");
  }

  const history = await fetchJson("/api/v1/alerts/history?limit=25&offset=0", { headers: authHeaders(userId) });
  checks.push(summarize("history_contains_delivery_receipts", history));
  if (history.status !== 200) failures.push(`history_http_${history.status}`);
  if (history.body?.data?.delivery_worker_status !== "delivery_worker_available") failures.push(`history_worker_status_${history.body?.data?.delivery_worker_status || "missing"}`);
  if (!historyHas(history.body, "webhook", "delivered")) failures.push("history_missing_webhook_delivered_receipt");
  if (!historyHas(history.body, "in_app", "delivered")) failures.push("history_missing_in_app_delivered_receipt");
  if (!historyHas(history.body, "email", "blocked")) failures.push("history_missing_email_blocked_receipt");

  for (const alertId of [webhookAlertId, emailAlertId].filter(Boolean)) {
    const deleted = await fetchJson(`/api/v1/alerts/${encodeURIComponent(alertId)}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    });
    checks.push(summarize(`cleanup_${alertId}`, deleted));
    if (deleted.status !== 200) failures.push(`cleanup_${alertId}_http_${deleted.status}`);
  }

  const serialized = JSON.stringify({ checks, webhookUrl });
  for (const forbidden of [serviceToken, "swfi_live_", "key_hash", "source_doc_ids", "delivery_sent"]) {
    if (forbidden && serialized.includes(forbidden)) failures.push(`forbidden_receipt_value_${forbidden === serviceToken ? "service_token" : forbidden}`);
  }

  return writeReceipt({
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    blockers,
    failures,
    checks,
    webhook_test_host: new URL(webhookUrl).host,
    webhook_delivery_receipt_written: true,
    in_app_delivery_receipt_written: true,
    email_delivery_claimed: false,
    sendgrid_onboarding_claimed: false,
    no_secret_values_written: true,
    real_swfi_auth_integration_claimed: false,
  });
}

function hasReceipt(body, channel, status) {
  const receipts = body?.data?.delivery_receipts;
  return Array.isArray(receipts) && receipts.some((receipt) => receipt?.channel === channel && receipt?.status === status);
}

function historyHas(body, channel, status) {
  const items = body?.data?.items;
  return Array.isArray(items) && items.some((receipt) => receipt?.channel === channel && receipt?.status === status);
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
  const receipts = Array.isArray(data?.delivery_receipts) ? data.delivery_receipts : [];
  return {
    status: body?.status || null,
    schema_version: body?.schema_version || null,
    source: body?.provenance?.source || null,
    item_id: item?.id || null,
    item_name: item?.name || null,
    item_delivery_worker_status: item?.delivery_worker_status || data?.delivery_worker_status || null,
    delivered_count: typeof data?.delivered_count === "number" ? data.delivered_count : null,
    blocked_count: typeof data?.blocked_count === "number" ? data.blocked_count : null,
    failed_count: typeof data?.failed_count === "number" ? data.failed_count : null,
    receipt_channels: receipts.map((receipt) => `${receipt.channel}:${receipt.status}`),
    history_count: typeof data?.count === "number" ? data.count : null,
    history_total: typeof data?.total === "number" ? data.total : null,
    delivery_claim: data?.delivery_claim || item?.delivery_claim || null,
    email_delivery_claimed: typeof data?.email_delivery_claimed === "boolean" ? data.email_delivery_claimed : null,
    sendgrid_onboarding_claimed: typeof data?.sendgrid_onboarding_claimed === "boolean" ? data.sendgrid_onboarding_claimed : null,
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
    schema_version: "swfipn.alert_delivery_brd_gate.v1",
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
      webhook_delivery_receipt_written: Boolean(fullReceipt.webhook_delivery_receipt_written),
      in_app_delivery_receipt_written: Boolean(fullReceipt.in_app_delivery_receipt_written),
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
    schema_version: "swfipn.alert_delivery_brd_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: origin,
    status: "fail",
    no_secret_values_written: true,
    failures: [`uncaught:${error.message}`],
    blockers: [],
    checks: [],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(JSON.stringify({ status: "fail", receipt: receiptPath, error: error.message }, null, 2));
  process.exit(1);
});
