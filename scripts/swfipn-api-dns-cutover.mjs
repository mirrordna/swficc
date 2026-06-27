#!/usr/bin/env node
import { execFileSync, spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-api-dns-cutover-latest.json");
const domain = process.env.SWFIPN_API_DNS_DOMAIN || "swfi.com";
const recordName = process.env.SWFIPN_API_DNS_RECORD || "api";
const fqdn = `${recordName}.${domain}`;
const targetData = process.env.SWFIPN_API_DNS_TARGET || "161.35.56.218";
const apply = truthy(process.env.SWFIPN_API_DNS_APPLY || "");
const pollSeconds = Number(process.env.SWFIPN_API_DNS_POLL_SECONDS || 300);

async function main() {
  const tokenResult = loadDoToken();
  const token = tokenResult.token;
  const startedAt = new Date().toISOString();
  const preflight = {
    token_present: Boolean(token),
    token_source: tokenResult.source,
    domain,
    record_name: recordName,
    fqdn,
    target_data: targetData,
    apply_requested: apply,
  };

  if (!token) {
    return writeReceipt({
      started_at: startedAt,
      status: "blocked",
      phase: "preflight",
      preflight,
      blockers: ["digitalocean_api_token_missing"],
      failures: [],
    });
  }

  const recordsResult = await doRequest(token, `/v2/domains/${encodeURIComponent(domain)}/records?type=A&per_page=200`);
  const records = Array.isArray(recordsResult.body?.domain_records) ? recordsResult.body.domain_records : [];
  const matching = records.filter((record) => record.type === "A" && record.name === recordName);
  const currentDns = await resolveA(fqdn);
  const acceptanceControl = runNodeGate("scripts/swfipn-api-dns-key-lifecycle-gate.mjs", {
    SWFIPN_API_PRODUCTION_ORIGIN: "https://api.swfi.com",
    SWFIPN_API_ACCEPTANCE_ORIGIN: "https://swfipn.activemirror.ai",
  });

  const blockers = [];
  const failures = [];
  if (recordsResult.status !== 200) failures.push(`digitalocean_records_http_${recordsResult.status}`);
  if (matching.length !== 1) blockers.push(`expected_one_A_record_for_${recordName}_got_${matching.length}`);
  if (!acceptanceControl.ok) blockers.push("acceptance_api_control_not_ready");

  const currentRecord = matching[0] || null;
  const rollback = currentRecord
    ? {
        record_id: currentRecord.id,
        previous_type: currentRecord.type,
        previous_name: currentRecord.name,
        previous_data: currentRecord.data,
        previous_ttl: currentRecord.ttl,
      }
    : null;
  const alreadyCutOver = currentRecord?.data === targetData && currentDns.includes(targetData);

  const baseReceipt = {
    started_at: startedAt,
    phase: "preflight",
    preflight: {
      ...preflight,
      records_http_status: recordsResult.status,
      matching_record_count: matching.length,
      current_dns_a_records: currentDns,
      target_already_active: alreadyCutOver,
      acceptance_gate_ok: acceptanceControl.ok,
      acceptance_gate_status: acceptanceControl.summary?.status || null,
    },
    current_record: currentRecord ? summarizeRecord(currentRecord) : null,
    rollback,
    values_redacted: true,
    failures,
    blockers,
  };

  if (failures.length || blockers.length) {
    return writeReceipt({
      ...baseReceipt,
      status: failures.length ? "fail" : "blocked",
      phase: "preflight",
    });
  }

  if (!apply) {
    return writeReceipt({
      ...baseReceipt,
      status: alreadyCutOver ? "pass" : "ready",
      phase: "preflight",
      blockers: alreadyCutOver ? [] : ["apply_not_requested_set_SWFIPN_API_DNS_APPLY=1"],
    });
  }

  if (alreadyCutOver) {
    const postGate = runNodeGate("scripts/swfipn-api-dns-key-lifecycle-gate.mjs", {
      SWFIPN_API_PRODUCTION_ORIGIN: "https://api.swfi.com",
      SWFIPN_API_ACCEPTANCE_ORIGIN: "https://swfipn.activemirror.ai",
    });
    return writeReceipt({
      ...baseReceipt,
      status: postGate.ok ? "pass" : "blocked",
      phase: "postflight",
      postflight: {
        dns_a_records: currentDns,
        api_dns_gate_ok: postGate.ok,
        api_dns_gate_summary: postGate.summary,
      },
      blockers: postGate.ok ? [] : ["api_dns_key_lifecycle_gate_not_passing_after_existing_cutover"],
    });
  }

  const patchResult = await doRequest(token, `/v2/domains/${encodeURIComponent(domain)}/records/${currentRecord.id}`, {
    method: "PATCH",
    body: {
      data: targetData,
      ttl: Number(currentRecord.ttl || 3600),
    },
  });

  if (patchResult.status < 200 || patchResult.status >= 300) {
    return writeReceipt({
      ...baseReceipt,
      status: patchResult.status === 403 ? "blocked" : "fail",
      phase: "apply",
      apply_result: {
        http_status: patchResult.status,
        success: false,
        error_type: patchResult.status === 403 ? "digitalocean_forbidden" : "digitalocean_patch_failed",
        message: safeDoError(patchResult.body),
      },
      blockers: [...blockers, patchResult.status === 403 ? "digitalocean_token_lacks_dns_write_permission" : `digitalocean_patch_http_${patchResult.status}`],
    });
  }

  const poll = await pollDns(fqdn, targetData, pollSeconds);
  const postGate = runNodeGate("scripts/swfipn-api-dns-key-lifecycle-gate.mjs", {
    SWFIPN_API_PRODUCTION_ORIGIN: "https://api.swfi.com",
    SWFIPN_API_ACCEPTANCE_ORIGIN: "https://swfipn.activemirror.ai",
  });

  return writeReceipt({
    ...baseReceipt,
    status: poll.status === "pass" && postGate.ok ? "pass" : "blocked",
    phase: "postflight",
    apply_result: {
      http_status: patchResult.status,
      success: true,
      patched_record: summarizeRecord(patchResult.body?.domain_record || {}),
    },
    postflight: {
      dns_poll: poll,
      api_dns_gate_ok: postGate.ok,
      api_dns_gate_summary: postGate.summary,
    },
    blockers: poll.status === "pass" && postGate.ok ? [] : ["post_cutover_api_dns_gate_not_passing"],
  });
}

function loadDoToken() {
  const fromEnv = process.env.DIGITALOCEAN_ACCESS_TOKEN || process.env.DO_API_TOKEN || "";
  if (fromEnv.trim()) return { token: fromEnv.trim(), source: process.env.DIGITALOCEAN_ACCESS_TOKEN ? "env:DIGITALOCEAN_ACCESS_TOKEN" : "env:DO_API_TOKEN" };
  const service = process.env.SWFIPN_DO_TOKEN_KEYCHAIN_SERVICE || "swfi-digital-ocean";
  const account = process.env.SWFIPN_DO_TOKEN_KEYCHAIN_ACCOUNT || "swfipn-acceptance";
  const accountToken = readKeychainToken(service, account);
  if (accountToken) return { token: accountToken, source: `keychain:${service}:${account}` };
  const serviceToken = readKeychainToken(service, "");
  if (serviceToken) return { token: serviceToken, source: `keychain:${service}` };
  return { token: "", source: "missing" };
}

function readKeychainToken(service, account) {
  const args = ["find-generic-password", "-s", service];
  if (account) args.push("-a", account);
  args.push("-w");
  try {
    return execFileSync("security", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout: 5000,
      maxBuffer: 1024 * 1024,
    }).trim();
  } catch {
    return "";
  }
}

async function doRequest(token, apiPath, options = {}) {
  const url = new URL(apiPath, "https://api.digitalocean.com").href;
  const response = await fetch(url, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body };
}

function runNodeGate(script, env) {
  const result = spawnSync(process.execPath, [script], {
    cwd,
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 1024 * 1024 * 4,
  });
  let summary = null;
  try {
    const parsed = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
    summary = {
      status: parsed.status || null,
      summary: parsed.summary || null,
    };
  } catch {
    summary = {
      status: null,
      stdout_tail: result.stdout.slice(-800),
      stderr_tail: result.stderr.slice(-800),
    };
  }
  return {
    ok: result.status === 0 && summary.status !== "fail" && summary.summary?.acceptance_keyed_entities_status === 200,
    exit_code: result.status,
    summary,
  };
}

async function resolveA(host) {
  try {
    return await dns.resolve4(host);
  } catch (error) {
    if (["ENODATA", "ENOTFOUND", "ENODOMAIN"].includes(error.code)) return [];
    return [`error:${error.code || error.message}`];
  }
}

async function pollDns(host, target, seconds) {
  const deadline = Date.now() + Math.max(0, seconds) * 1000;
  const samples = [];
  while (true) {
    const a = await resolveA(host);
    samples.push({ at: new Date().toISOString(), a_records: a });
    if (a.includes(target)) return { status: "pass", samples };
    if (Date.now() >= deadline) return { status: "blocked", samples };
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
}

function summarizeRecord(record) {
  return {
    id: record.id,
    type: record.type,
    name: record.name,
    data: record.data,
    ttl: record.ttl,
  };
}

function safeDoError(body) {
  if (!body || typeof body !== "object") return "no_json_error_body";
  const message = String(body.message || body.id || body.error || "unknown_error");
  return message.slice(0, 300);
}

function writeReceipt(receipt) {
  const finalReceipt = {
    schema_version: "swfipn.api_dns_cutover.v1",
    generated_at: new Date().toISOString(),
    ...receipt,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(finalReceipt, null, 2));
  console.log(
    JSON.stringify(
      {
        status: finalReceipt.status,
        phase: finalReceipt.phase,
        blockers: finalReceipt.blockers || [],
        failures: finalReceipt.failures || [],
        receipt: receiptPath,
      },
      null,
      2
    )
  );
  if (finalReceipt.status === "fail") process.exit(1);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

main().catch((error) => {
  const receipt = {
    schema_version: "swfipn.api_dns_cutover.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    phase: "exception",
    blockers: [],
    failures: [`exception:${error?.name || "Error"}`],
    error_message: String(error?.message || error).slice(0, 500),
    values_redacted: true,
  };
  fs.writeFileSync(receiptPath, JSON.stringify(receipt, null, 2));
  console.error(JSON.stringify({ status: "fail", receipt: receiptPath, failures: receipt.failures }, null, 2));
  process.exit(1);
});
