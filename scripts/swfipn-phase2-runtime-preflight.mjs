#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const cwd = process.cwd();
const outputDir = path.join(cwd, "output");
fs.mkdirSync(outputDir, { recursive: true });

const receiptPath = path.join(outputDir, "swfipn-phase2-runtime-preflight-latest.json");
const publicOrigin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const runtimeHost = process.env.SWFIPN_RUNTIME_REMOTE_HOST || process.env.SWFIPN_HOST || "swfipn-do";

const sendgridRequiredNames = [
  "SWFI2_SENDGRID_API_KEY",
  "SENDGRID_API_KEY",
  "SWFI2_SENDGRID_FROM_EMAIL",
  "SENDGRID_FROM_EMAIL",
  "SWFI2_SENDGRID_FROM_NAME",
  "SENDGRID_FROM_NAME",
];
const bridgeRequiredNames = [
  "SWFIPN_SWFI_SESSION_BRIDGE_SECRET",
  "SWFIPN_SWFI_SESSION_BRIDGE_ISSUER",
  "SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE",
  "SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED",
];

async function main() {
  const checks = [];
  const blockers = [];
  const failures = [];

  const localSendgrid = localSecretInventory([
    ["swfi2-sendgrid-api-key", ""],
    ["sendgrid-api-key", ""],
    ["SWFI2_SENDGRID_API_KEY", ""],
    ["SENDGRID_API_KEY", ""],
    ["SWFSUMMIT_SENDGRID_API_KEY", "mirror-admin"],
  ]);
  checks.push({ name: "local_sendgrid_secret_inventory", status: "pass", ...localSendgrid });

  const localBridge = localSecretInventory([
    ["swfipn-swfi-session-bridge-secret", ""],
    ["SWFIPN_SWFI_SESSION_BRIDGE_SECRET", ""],
  ]);
  checks.push({ name: "local_session_bridge_secret_inventory", status: "pass", ...localBridge });

  const remoteWeb = remoteEnvNames("swfipn_acceptance-swfipn-web-1");
  const remoteBackend = remoteEnvNames("swfipn_acceptance-swfi2-backend-1");
  checks.push({ name: "target_web_env_names", status: remoteWeb.status, names: remoteWeb.names, error: remoteWeb.error || null });
  checks.push({ name: "target_backend_env_names", status: remoteBackend.status, names: remoteBackend.names, error: remoteBackend.error || null });
  if (remoteWeb.status !== "pass") failures.push("target_web_env_unreadable");
  if (remoteBackend.status !== "pass") failures.push("target_backend_env_unreadable");

  const backendNames = new Set(remoteBackend.names || []);
  const webNames = new Set(remoteWeb.names || []);
  const sendgridHasKey = backendNames.has("SWFI2_SENDGRID_API_KEY") || backendNames.has("SENDGRID_API_KEY");
  const sendgridHasFrom = backendNames.has("SWFI2_SENDGRID_FROM_EMAIL") || backendNames.has("SENDGRID_FROM_EMAIL");
  const bridgeHasSecret = webNames.has("SWFIPN_SWFI_SESSION_BRIDGE_SECRET");
  const bridgeHasLogin = webNames.has("SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED");
  const bridgeHasIssuer = webNames.has("SWFIPN_SWFI_SESSION_BRIDGE_ISSUER");
  const bridgeHasAudience = webNames.has("SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE");

  if (!sendgridHasKey) blockers.push("sendgrid_target_runtime_missing_api_key");
  if (!sendgridHasFrom) blockers.push("sendgrid_target_runtime_missing_from_email");
  if (!bridgeHasSecret) blockers.push("swfi_session_bridge_target_runtime_missing_secret");
  if (!bridgeHasLogin) blockers.push("swfi_session_bridge_login_not_enabled_on_target_runtime");
  if (!bridgeHasIssuer) blockers.push("swfi_session_bridge_target_runtime_missing_issuer");
  if (!bridgeHasAudience) blockers.push("swfi_session_bridge_target_runtime_missing_audience");

  if (!localSendgrid.present_contract_services.length && localSendgrid.present_non_contract_services.length) {
    blockers.push("only_non_swfi_sendgrid_candidate_found_do_not_claim_sendgrid");
  }
  if (!localBridge.present_contract_services.length) {
    blockers.push("no_local_swfi_session_bridge_secret_available");
  }

  const bridgeProbe = await probeBridge();
  checks.push({ name: "public_bridge_endpoint_probe", ...bridgeProbe });
  if (bridgeProbe.status === "fail") failures.push("public_bridge_endpoint_probe_failed");
  if (bridgeProbe.status === "blocked") blockers.push(...bridgeProbe.blockers);

  const loginProbe = await probeLoginHandoff();
  checks.push({ name: "public_login_handoff_probe", ...loginProbe });
  if (loginProbe.status === "fail") failures.push("public_login_handoff_probe_failed");
  if (loginProbe.status === "blocked") blockers.push(...loginProbe.blockers);

  const status = failures.length ? "fail" : blockers.length ? "blocked" : "pass";
  const receipt = {
    schema_version: "swfipn.phase2_runtime_preflight.v1",
    generated_at: new Date().toISOString(),
    status,
    public_origin: publicOrigin,
    runtime_host: runtimeHost,
    no_secret_values_written: true,
    summary: {
      failures,
      blockers: [...new Set(blockers)],
      sendgrid_target_runtime_configured: sendgridHasKey && sendgridHasFrom,
      swfi_session_bridge_target_runtime_configured: bridgeHasSecret && bridgeHasLogin && bridgeHasIssuer && bridgeHasAudience,
      local_swfi_sendgrid_candidate_present: Boolean(localSendgrid.present_contract_services.length),
      local_non_contract_sendgrid_candidate_present: Boolean(localSendgrid.present_non_contract_services.length),
      local_bridge_secret_present: Boolean(localBridge.present_contract_services.length),
    },
    required_runtime_names: {
      backend_sendgrid: sendgridRequiredNames,
      web_swfi_session_bridge: bridgeRequiredNames,
    },
    checks,
  };

  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status, receipt: receiptPath, summary: receipt.summary }, null, 2));
  if (status === "fail") process.exit(1);
}

function normalizeOrigin(value) {
  const url = new URL(value);
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
}

function localSecretInventory(candidates) {
  const contract = [];
  const nonContract = [];
  for (const [service, account] of candidates) {
    if (!service) continue;
    const present = keychainPresent(service, account);
    if (!present && !process.env[service]) continue;
    const item = { service, account: account || null, source: process.env[service] ? "env" : "keychain" };
    if (service.startsWith("SWFSUMMIT")) nonContract.push(item);
    else contract.push(item);
  }
  return {
    present_contract_services: contract,
    present_non_contract_services: nonContract,
  };
}

function keychainPresent(service, account) {
  const args = ["find-generic-password", "-s", service];
  if (account) args.push("-a", account);
  try {
    execFileSync("security", args, {
      stdio: ["ignore", "ignore", "ignore"],
      timeout: 5000,
    });
    return true;
  } catch {
    return false;
  }
}

function remoteEnvNames(container) {
  try {
    const output = execFileSync(
      "ssh",
      [
        "-o",
        "BatchMode=yes",
        "-o",
        "ConnectTimeout=8",
        runtimeHost,
        `docker inspect ${container} --format '{{range .Config.Env}}{{println .}}{{end}}' | sed 's/=.*$//' | sort`,
      ],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
      }
    );
    return {
      status: "pass",
      names: output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean),
    };
  } catch (error) {
    return {
      status: "fail",
      names: [],
      error: String(error?.message || error).slice(0, 300),
    };
  }
}

async function probeBridge() {
  const url = new URL("auth/bridge/?next=/swficc/&assertion=invalid", publicOrigin).href;
  try {
    const response = await fetch(url, { redirect: "manual", headers: { "Cache-Control": "no-cache" } });
    const text = await response.text();
    const blockers = [];
    if (response.status === 503 && /not configured/i.test(text)) blockers.push("swfi_session_bridge_public_endpoint_not_configured");
    if (response.status !== 401 && response.status !== 503) return { status: "fail", url, http_status: response.status, blockers: [] };
    return { status: blockers.length ? "blocked" : "pass", url, http_status: response.status, blockers };
  } catch (error) {
    return { status: "fail", url, http_status: null, blockers: [], error: String(error?.message || error).slice(0, 300) };
  }
}

async function probeLoginHandoff() {
  const url = new URL("login/?next=/swficc/profiles/detail/?id=5e5713b876fb1e43b1bb71eb", publicOrigin).href;
  try {
    const response = await fetch(url, { redirect: "manual", headers: { "Cache-Control": "no-cache" } });
    const location = response.headers.get("location") || "";
    const decodedLocation = decodeURIComponent(location);
    const blockers = [];
    if (location.includes("www.swfi.com/v1/signin") && !decodedLocation.includes("/swficc/auth/bridge/")) {
      blockers.push("swfi_signin_not_configured_to_return_to_swfipn_session_bridge");
    }
    if (response.status < 300 || response.status > 399) return { status: "fail", url, http_status: response.status, location, blockers: [] };
    return { status: blockers.length ? "blocked" : "pass", url, http_status: response.status, location: redactUrl(location), blockers };
  } catch (error) {
    return { status: "fail", url, http_status: null, location: "", blockers: [], error: String(error?.message || error).slice(0, 300) };
  }
}

function redactUrl(value) {
  return value.replace(/([?&](?:token|assertion|key|secret|password)=)[^&]+/gi, "$1<redacted>");
}

main().catch((error) => {
  const receipt = {
    schema_version: "swfipn.phase2_runtime_preflight.v1",
    generated_at: new Date().toISOString(),
    status: "fail",
    failures: [`unhandled_${error?.name || "error"}`],
    blockers: [],
    no_secret_values_written: true,
    error_message: String(error?.message || error).slice(0, 500),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(JSON.stringify({ status: "fail", receipt: receiptPath, failures: receipt.failures }, null, 2));
  process.exit(1);
});
