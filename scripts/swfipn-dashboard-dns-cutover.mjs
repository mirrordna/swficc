import { execFileSync, spawnSync } from "node:child_process";
import dns from "node:dns/promises";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-dashboard-dns-cutover-latest.json");
const domain = process.env.SWFIPN_DASHBOARD_DNS_DOMAIN || "swfi.com";
const recordName = process.env.SWFIPN_DASHBOARD_DNS_RECORD || "dashboard";
const fqdn = `${recordName}.${domain}`;
const targetData = process.env.SWFIPN_DASHBOARD_DNS_TARGET || "161.35.56.218";
const ttl = Number(process.env.SWFIPN_DASHBOARD_DNS_TTL || 300);
const apply = truthy(process.env.SWFIPN_DASHBOARD_DNS_APPLY || "");
const pollSeconds = Number(process.env.SWFIPN_DASHBOARD_DNS_POLL_SECONDS || 180);
const dnsResolvers = String(process.env.SWFIPN_DNS_RESOLVERS || "1.1.1.1,9.9.9.9,8.8.8.8")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
if (dnsResolvers.length) dns.setServers(dnsResolvers);

const startedAt = new Date().toISOString();

try {
  const tokenResult = loadDoToken();
  if (!tokenResult.token) {
    writeReceipt({
      status: "blocked",
      phase: "preflight",
      started_at: startedAt,
      blockers: ["digitalocean_api_token_missing"],
      token_source: tokenResult.source,
    });
    process.exit(1);
  }

  const listResult = await doRequest(tokenResult.token, `/v2/domains/${encodeURIComponent(domain)}/records?per_page=200`);
  const records = Array.isArray(listResult.body?.domain_records) ? listResult.body.domain_records : [];
  const matching = records.filter((record) => record.name === recordName);
  const currentA = await resolveA(fqdn);
  const currentCname = await resolveCname(fqdn);
  const blockers = [];
  const failures = [];

  if (listResult.status !== 200) failures.push(`digitalocean_records_http_${listResult.status}`);
  const conflicting = matching.filter((record) => !(record.type === "A" && record.data === targetData));
  if (conflicting.length > 0) blockers.push(`conflicting_existing_records_${conflicting.map((record) => `${record.type}:${record.data}`).join(",")}`);

  const readyBase = {
    schema_version: "swfipn.dashboard_dns_cutover.v1",
    started_at: startedAt,
    domain,
    record_name: recordName,
    fqdn,
    target_type: "A",
    target_data: targetData,
    ttl,
    apply_requested: apply,
    token_source: tokenResult.source,
    values_redacted: true,
    preflight: {
      dns_resolvers: dnsResolvers,
      records_http_status: listResult.status,
      matching_record_count: matching.length,
      matching_records: matching.map(summarizeRecord),
      current_a_records: currentA,
      current_cname_records: currentCname,
    },
    failures,
    blockers,
  };

  if (failures.length || blockers.length) {
    writeReceipt({
      ...readyBase,
      status: failures.length ? "fail" : "blocked",
      phase: "preflight",
    });
    process.exit(1);
  }

  const alreadyActive = matching.some((record) => record.type === "A" && record.data === targetData) && currentA.includes(targetData);
  if (!apply) {
    writeReceipt({
      ...readyBase,
      status: alreadyActive ? "pass" : "ready",
      phase: "preflight",
      blockers: alreadyActive ? [] : ["apply_not_requested_set_SWFIPN_DASHBOARD_DNS_APPLY=1"],
    });
    process.exit(alreadyActive ? 0 : 1);
  }

  let applyResult = { skipped: true, reason: "record_already_active" };
  if (!matching.some((record) => record.type === "A" && record.data === targetData)) {
    const createResult = await doRequest(tokenResult.token, `/v2/domains/${encodeURIComponent(domain)}/records`, {
      method: "POST",
      body: {
        type: "A",
        name: recordName,
        data: targetData,
        ttl,
      },
    });
    applyResult = {
      http_status: createResult.status,
      success: createResult.status >= 200 && createResult.status < 300,
      created_record: createResult.body?.domain_record ? summarizeRecord(createResult.body.domain_record) : null,
      error: createResult.status >= 200 && createResult.status < 300 ? "" : safeDoError(createResult.body),
    };
    if (!applyResult.success) {
      writeReceipt({
        ...readyBase,
        status: createResult.status === 403 ? "blocked" : "fail",
        phase: "apply",
        apply_result: applyResult,
        blockers: [createResult.status === 403 ? "digitalocean_token_lacks_dns_write_permission" : `digitalocean_create_http_${createResult.status}`],
      });
      process.exit(1);
    }
  }

  const poll = await pollDns(fqdn, targetData, pollSeconds);
  const readiness = runDomainReadiness(fqdn, targetData);
  const ok = poll.status === "pass" && readiness.ok;
  writeReceipt({
    ...readyBase,
    status: ok ? "pass" : "blocked",
    phase: "postflight",
    apply_result: applyResult,
    postflight: {
      dns_poll: poll,
      readiness_gate_ok: readiness.ok,
      readiness_gate_summary: readiness.summary,
    },
    blockers: ok ? [] : ["dashboard_dns_not_ready_after_apply"],
  });
  process.exit(ok ? 0 : 1);
} catch (error) {
  writeReceipt({
    schema_version: "swfipn.dashboard_dns_cutover.v1",
    status: "fail",
    phase: "exception",
    started_at: startedAt,
    fqdn,
    target_data: targetData,
    error: error instanceof Error ? error.message : String(error),
  });
  process.exit(1);
}

function truthy(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function loadDoToken() {
  const fromEnv = process.env.DIGITALOCEAN_ACCESS_TOKEN || process.env.DO_API_TOKEN || "";
  if (fromEnv.trim()) return { token: fromEnv.trim(), source: process.env.DIGITALOCEAN_ACCESS_TOKEN ? "env:DIGITALOCEAN_ACCESS_TOKEN" : "env:DO_API_TOKEN" };
  for (const [service, account] of [
    [process.env.SWFIPN_DO_TOKEN_KEYCHAIN_SERVICE || "swfi-digital-ocean", process.env.SWFIPN_DO_TOKEN_KEYCHAIN_ACCOUNT || "swfipn-acceptance"],
    [process.env.SWFIPN_DO_TOKEN_KEYCHAIN_SERVICE || "swfi-digital-ocean", ""],
    ["digitalocean-swfi-readonly-token", ""],
  ]) {
    const token = readKeychainToken(service, account);
    if (token) return { token, source: account ? `keychain:${service}:${account}` : `keychain:${service}` };
  }
  return { token: "", source: "missing" };
}

function readKeychainToken(service, account) {
  const args = ["find-generic-password", "-s", service];
  if (account) args.push("-a", account);
  args.push("-w");
  try {
    return execFileSync("security", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }).trim();
  } catch {
    return "";
  }
}

async function doRequest(token, apiPath, options = {}) {
  const response = await fetch(new URL(apiPath, "https://api.digitalocean.com").href, {
    method: options.method || "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await response.text();
  let body = {};
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = { raw: text.slice(0, 300) };
  }
  return { status: response.status, body };
}

async function resolveA(host) {
  try {
    return await dns.resolve4(host);
  } catch {
    return [];
  }
}

async function resolveCname(host) {
  try {
    return await dns.resolveCname(host);
  } catch {
    return [];
  }
}

async function pollDns(host, expectedIp, seconds) {
  const started = Date.now();
  const samples = [];
  while (Date.now() - started <= seconds * 1000) {
    const records = await resolveA(host);
    samples.push({ at: new Date().toISOString(), records });
    if (records.includes(expectedIp)) {
      return { status: "pass", expected_ip: expectedIp, samples };
    }
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
  return { status: "timeout", expected_ip: expectedIp, samples };
}

function runDomainReadiness(host, expectedIp) {
  const result = spawnSync(process.execPath, ["scripts/swfipn-domain-readiness-gate.mjs"], {
    cwd,
    env: {
      ...process.env,
      SWFIPN_DASHBOARD_DOMAIN: host,
      SWFIPN_ORIGIN_IP: expectedIp,
    },
    encoding: "utf8",
    timeout: 45_000,
    maxBuffer: 1024 * 1024,
  });
  let summary = null;
  try {
    summary = JSON.parse(result.stdout.slice(result.stdout.indexOf("{")));
  } catch {
    summary = { stdout_tail: result.stdout.slice(-800), stderr_tail: result.stderr.slice(-800) };
  }
  return { ok: result.status === 0, summary };
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
  return String(body?.message || body?.id || JSON.stringify(body || {})).slice(0, 500);
}

function writeReceipt(receipt) {
  const payload = {
    generated_at: new Date().toISOString(),
    ...receipt,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(JSON.stringify({
    status: payload.status,
    phase: payload.phase,
    fqdn: payload.fqdn,
    blockers: payload.blockers || [],
    receipt: receiptPath,
  }, null, 2));
}
