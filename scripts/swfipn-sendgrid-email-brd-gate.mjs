#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-sendgrid-email-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const origin = new URL(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || process.env.SWFIPN_API_ORIGIN || "https://swfipn.activemirror.ai").origin;
const serviceToken = loadServiceToken();
const timeoutMs = Number(process.env.SWFIPN_SENDGRID_GATE_TIMEOUT_MS || 20000);
const expectConfigured = ["1", "true", "yes"].includes(String(process.env.SWFIPN_EXPECT_SENDGRID || "").toLowerCase());

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const userId = `sendgrid-proof-${Date.now()}@swfi.test`;
  let alertId = "";

  if (!serviceToken) {
    blockers.push("service_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: expectConfigured ? "fail" : "blocked", blockers, failures, checks });
  }

  const created = await fetchJson("/api/v1/alerts", {
    method: "POST",
    headers: authHeaders(userId),
    body: JSON.stringify({
      alert_name: `SendGrid delivery proof ${Date.now()}`,
      alert_type: "transaction",
      delivery_channels: ["email"],
      frequency: "Immediate",
      criteria: { sectors: ["Infrastructure"] },
    }),
  });
  checks.push(summarize("create_email_alert", created));
  alertId = String(created.body?.data?.item?.id || "");
  if (created.status !== 200) failures.push(`create_email_alert_http_${created.status}`);
  if (!alertId) failures.push("create_email_alert_missing_id");

  let emailTest = null;
  if (alertId) {
    emailTest = await fetchJson(`/api/v1/alerts/${encodeURIComponent(alertId)}/deliveries/test`, {
      method: "POST",
      headers: authHeaders(userId),
      body: JSON.stringify({ event_title: "SWFI SendGrid acceptance event", event_type: "transaction" }),
    });
    checks.push(summarize("test_sendgrid_email_delivery", emailTest));
    if (emailTest.status !== 200) failures.push(`email_test_http_${emailTest.status}`);
  }

  if (alertId) {
    const deleted = await fetchJson(`/api/v1/alerts/${encodeURIComponent(alertId)}`, {
      method: "DELETE",
      headers: authHeaders(userId),
    });
    checks.push(summarize("cleanup_email_alert", deleted));
    if (deleted.status !== 200) failures.push(`cleanup_email_alert_http_${deleted.status}`);
  }

  const data = emailTest?.body?.data || {};
  const delivered = data.delivered_count === 1
    && data.blocked_count === 0
    && data.failed_count === 0
    && data.email_delivery_claimed === true
    && data.sendgrid_onboarding_claimed === true
    && hasReceipt(emailTest?.body, "email", "delivered");
  const blocked = data.delivered_count === 0
    && data.blocked_count === 1
    && data.email_delivery_claimed === false
    && data.sendgrid_onboarding_claimed === false
    && hasReceipt(emailTest?.body, "email", "blocked");
  const sandboxValidated = data.delivered_count === 0
    && data.blocked_count === 0
    && data.failed_count === 0
    && data.email_delivery_claimed === false
    && data.sendgrid_onboarding_claimed === true
    && hasReceipt(emailTest?.body, "email", "validated");

  if (expectConfigured && !delivered) failures.push("sendgrid_expected_configured_but_email_not_delivered");
  if (!delivered && !blocked && !sandboxValidated) failures.push("sendgrid_email_delivery_state_unrecognized");
  if (!delivered && blocked) blockers.push("sendgrid_not_configured_on_target_runtime");
  if (!delivered && sandboxValidated) blockers.push("sendgrid_sandbox_mode_enabled_no_real_delivery");

  const serialized = JSON.stringify({ checks });
  for (const forbidden of [serviceToken, "SG.", "key_hash", "swfi_live_"]) {
    if (forbidden && serialized.includes(forbidden)) failures.push(`forbidden_receipt_value_${forbidden === serviceToken ? "service_token" : forbidden}`);
  }

  return writeReceipt({
    status: failures.length ? "fail" : delivered ? "pass" : "blocked",
    blockers,
    failures,
    checks,
    email_delivery_claimed: delivered,
    sendgrid_onboarding_claimed: delivered,
    no_secret_values_written: true,
    real_swfi_auth_integration_claimed: false,
  });
}

function hasReceipt(body, channel, status) {
  const receipts = body?.data?.delivery_receipts;
  return Array.isArray(receipts) && receipts.some((receipt) => receipt?.channel === channel && receipt?.status === status);
}

function authHeaders(userId) {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
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
  return { url, status: response.status, headers: pickHeaders(response.headers), body };
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
    item_id: item?.id || null,
    item_name: item?.name || null,
    item_delivery_worker_status: item?.delivery_worker_status || null,
    delivered_count: typeof data?.delivered_count === "number" ? data.delivered_count : null,
    blocked_count: typeof data?.blocked_count === "number" ? data.blocked_count : null,
    failed_count: typeof data?.failed_count === "number" ? data.failed_count : null,
    receipt_channels: receipts.map((receipt) => `${receipt.channel}:${receipt.status}`),
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
    schema_version: "swfipn.sendgrid_email_brd_gate.v1",
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
      "SWFI2_API_TOKEN",
    ]),
    envList("SWFIPN_SERVICE_TOKEN_KEYCHAIN_ACCOUNTS", ["mirrordna", "mirror-admin", "mirror-pro"]),
  );
}

function envList(name, fallback) {
  return String(process.env[name] || "").split(",").map((item) => item.trim()).filter(Boolean).concat(fallback).filter(Boolean);
}

function keychainLookup(services, accounts) {
  for (const account of accounts) {
    for (const service of services) {
      try {
        const value = execFileSync("security", ["find-generic-password", "-a", account, "-s", service, "-w"], {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeout: 5000,
        }).trim();
        if (value) return value;
      } catch {
        // Try next candidate.
      }
    }
  }
  return "";
}

main().catch((error) => {
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    schema_version: "swfipn.sendgrid_email_brd_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: origin,
    status: "fail",
    failures: [`unhandled_${error?.name || "error"}`],
    blockers: [],
    no_secret_values_written: true,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
