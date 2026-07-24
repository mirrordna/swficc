#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-api-key-lifecycle-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const apiOrigin = new URL(process.env.SWFIPN_API_ACCEPTANCE_ORIGIN || process.env.SWFIPN_API_ORIGIN || "https://swfipn.activemirror.ai").origin;
const serviceToken = loadServiceToken();
const timeoutMs = Number(process.env.SWFIPN_API_KEY_LIFECYCLE_TIMEOUT_MS || 15000);

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  let createdKey = "";
  let createdId = "";

  if (!serviceToken) {
    blockers.push("service_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks });
  }

  const createName = `acceptance-gate-${Date.now()}`;
  const created = await fetchJson("/v1/admin/api-keys", {
    method: "POST",
    headers: adminHeaders(),
    body: JSON.stringify({ name: createName }),
  });
  checks.push(summarize("create", created));
  if (created.status !== 200) failures.push(`create_http_${created.status}`);
  createdKey = typeof created.body?.api_key === "string" ? created.body.api_key : "";
  createdId = typeof created.body?.item?.id === "string" ? created.body.item.id : "";
  if (!createdKey.startsWith("swfi_live_")) failures.push("create_missing_one_time_key");
  if (!createdId) failures.push("create_missing_key_id");
  if (created.body?.one_time_secret !== true) failures.push("create_missing_one_time_secret_flag");

  if (createdKey) {
    const useCreated = await fetchJson("/v1/entities?limit=1&offset=0&q=Norway", {
      headers: { Accept: "application/json", "X-API-Key": createdKey },
    });
    checks.push(summarize("use_created_key", useCreated));
    if (useCreated.status !== 200) failures.push(`use_created_key_http_${useCreated.status}`);
    if (useCreated.body?.status !== "ok") failures.push(`use_created_key_status_${useCreated.body?.status || "missing"}`);
    if (useCreated.body?.rate_limit?.source !== "managed_store") failures.push(`use_created_key_source_${useCreated.body?.rate_limit?.source || "missing"}`);
  }

  const listed = await fetchJson("/v1/admin/api-keys", { headers: adminHeaders() });
  const listedText = listed.text || "";
  checks.push(summarize("list", listed));
  if (listed.status !== 200) failures.push(`list_http_${listed.status}`);
  if (!Array.isArray(listed.body?.items)) failures.push("list_missing_items");
  if (createdId && !listed.body?.items?.some?.((item) => item?.id === createdId && item?.status === "active")) failures.push("list_missing_created_active_key");
  if (createdKey && listedText.includes(createdKey)) failures.push("list_leaked_created_key");
  if (/key_hash/i.test(listedText)) failures.push("list_leaked_key_hash");

  let revoked = null;
  if (createdId) {
    revoked = await fetchJson(`/v1/admin/api-keys/${encodeURIComponent(createdId)}`, {
      method: "DELETE",
      headers: adminHeaders(),
    });
    const revokedText = revoked.text || "";
    checks.push(summarize("revoke", revoked));
    if (revoked.status !== 200) failures.push(`revoke_http_${revoked.status}`);
    if (revoked.body?.item?.status !== "revoked") failures.push(`revoke_status_${revoked.body?.item?.status || "missing"}`);
    if (createdKey && revokedText.includes(createdKey)) failures.push("revoke_leaked_created_key");
    if (/key_hash/i.test(revokedText)) failures.push("revoke_leaked_key_hash");
  }

  if (createdKey) {
    const useRevoked = await fetchJson("/v1/entities?limit=1&offset=0&q=Norway", {
      headers: { Accept: "application/json", "X-API-Key": createdKey },
    });
    checks.push(summarize("use_revoked_key", useRevoked));
    if (useRevoked.status !== 401) failures.push(`use_revoked_key_expected_401_got_${useRevoked.status}`);
  }

  return writeReceipt({
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    blockers,
    failures,
    checks,
    created_key_id: createdId,
    created_key_returned_once: Boolean(createdKey),
    created_key_never_written_to_receipt: true,
  });
}

function adminHeaders() {
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${serviceToken}`,
  };
}

async function fetchJson(pathname, options = {}) {
  const url = new URL(pathname, `${apiOrigin}/`).href;
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
    body = { raw: text.slice(0, 300) };
  }
  return {
    url,
    status: response.status,
    headers: pickHeaders(response.headers),
    body,
    text,
  };
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
  if (!body || typeof body !== "object") return { type: typeof body };
  const item = body.item && typeof body.item === "object" ? body.item : null;
  return {
    status: body.status || null,
    schema_version: body.schema_version || null,
    total: typeof body.total === "number" ? body.total : null,
    item_id: item?.id || null,
    item_status: item?.status || null,
    item_source: item?.source || null,
    one_time_secret: body.one_time_secret === true,
    item_count: Array.isArray(body.items) ? body.items.length : null,
    rate_limit_source: body.rate_limit?.source || null,
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
    schema_version: "swfipn.api_key_lifecycle_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: apiOrigin,
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
      created_key_id: fullReceipt.created_key_id || "",
      created_key_returned_once: Boolean(fullReceipt.created_key_returned_once),
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
    schema_version: "swfipn.api_key_lifecycle_gate.v1",
    generated_at: new Date().toISOString(),
    api_origin: apiOrigin,
    status: "fail",
    error: error.message,
    no_secret_values_written: true,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
