#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-swfi-session-bridge-brd-gate-latest.json");
const targetOrigin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const timeoutMs = Number(process.env.SWFIPN_SESSION_BRIDGE_GATE_TIMEOUT_MS || 30000);
const expectConfigured = /^(1|true|yes|on)$/i.test(String(process.env.SWFIPN_EXPECT_SWFI_SESSION_BRIDGE || ""));
fs.mkdirSync(outputDir, { recursive: true });

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];

  const local = await localBridgeProof();
  checks.push(local);
  if (!local.ok) failures.push(...local.failures.map((failure) => `local:${failure}`));

  const target = await targetRuntimeProbe();
  checks.push(target);
  if (!target.ok && target.mode === "misconfigured") failures.push(...target.failures.map((failure) => `target:${failure}`));
  if (!target.configured) blockers.push(...target.blockers);

  if (expectConfigured && !target.configured) failures.push("swfi_session_bridge_expected_configured_but_target_blocked");

  const fullReceipt = {
    schema_version: "swfipn.swfi_session_bridge_brd_gate.v1",
    generated_at: new Date().toISOString(),
    target_origin: targetOrigin,
    status: failures.length ? "fail" : target.configured ? "pass" : "blocked",
    blockers: unique(blockers),
    failures: unique(failures),
    checks,
    local_session_bridge_mechanics_passed: Boolean(local.ok),
    target_runtime_bridge_configured: Boolean(target.configured),
    real_swfi_auth_integration_claimed: Boolean(target.configured && target.real_swfi_auth_integration_claimed),
    browser_backend_token_exposure: false,
    no_secret_values_written: true,
  };

  const serialized = JSON.stringify(fullReceipt);
  for (const forbidden of ["local-bridge-secret", "local-session-secret", "local-backend-token", "SG.", "swfi_live_", "key_hash"]) {
    if (serialized.includes(forbidden)) fullReceipt.failures.push(`forbidden_receipt_value:${forbidden}`);
  }
  if (fullReceipt.failures.length) fullReceipt.status = "fail";

  fs.writeFileSync(receiptPath, `${JSON.stringify(fullReceipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: fullReceipt.status,
    receipt: receiptPath,
    blockers: fullReceipt.blockers,
    failures: fullReceipt.failures,
    summary: {
      local_session_bridge_mechanics_passed: fullReceipt.local_session_bridge_mechanics_passed,
      target_runtime_bridge_configured: fullReceipt.target_runtime_bridge_configured,
      real_swfi_auth_integration_claimed: fullReceipt.real_swfi_auth_integration_claimed,
    },
  }, null, 2));
  if (fullReceipt.status === "fail") process.exit(1);
}

async function localBridgeProof() {
  const failures = [];
  const backendRequests = [];
  const backendToken = "local-backend-token";
  const bridgeSecret = "local-bridge-secret";
  const sessionSecret = "local-session-secret";
  const backend = await startBackend(backendRequests, backendToken);
  const staticPort = await freePort();
  const staticRoot = fs.mkdtempSync(path.join(os.tmpdir(), "swfipn-bridge-root-"));
  const audience = `127.0.0.1:${staticPort}`;
  const server = await startStaticServer({
    staticRoot,
    staticPort,
    backendOrigin: backend.origin,
    backendToken,
    bridgeSecret,
    sessionSecret,
    audience,
  }).catch((error) => ({ error }));

  try {
    if (server.error) {
      failures.push(`static_server_start_failed:${server.error.message}`);
      return localResult(false, failures, backendRequests);
    }
    const origin = `http://127.0.0.1:${staticPort}`;
    const protectedPath = "/swficc/profiles/detail/?id=5e5713b876fb1e43b1bb71eb";
    const unauth = await fetchText(`${origin}${protectedPath}`, { redirect: "manual" });
    if (![302, 303, 307, 308].includes(unauth.status)) failures.push(`unauth_protected_status_${unauth.status}`);
    if (!/https:\/\/www\.swfi\.com\/v1\/signin\//i.test(unauth.location)) failures.push("unauth_not_sent_to_swfi_signin");
    if (!decodeURIComponent(unauth.location || "").includes("/swficc/auth/bridge/")) failures.push("signin_redirect_missing_bridge_callback");

    const invalid = await fetchText(`${origin}/swficc/auth/bridge/?next=${encodeURIComponent(protectedPath)}&assertion=bad`, { redirect: "manual" });
    if (invalid.status !== 401) failures.push(`invalid_assertion_status_${invalid.status}`);

    const expiredAssertion = signAssertion({
      iss: "swfi.com",
      aud: audience,
      sub: "prem@swfi.test",
      roles: ["viewer"],
      iat: Math.floor(Date.now() / 1000) - 600,
      exp: Math.floor(Date.now() / 1000) - 60,
    }, bridgeSecret);
    const expired = await fetchText(`${origin}/swficc/auth/bridge/?next=${encodeURIComponent(protectedPath)}&assertion=${encodeURIComponent(expiredAssertion)}`, { redirect: "manual" });
    if (expired.status !== 401) failures.push(`expired_assertion_status_${expired.status}`);

    const validAssertion = signAssertion({
      iss: "swfi.com",
      aud: audience,
      sub: "prem@swfi.test",
      email: "prem@swfi.test",
      roles: ["viewer"],
      iat: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    }, bridgeSecret);
    const bridged = await fetchText(`${origin}/swficc/auth/bridge/?next=${encodeURIComponent(protectedPath)}&assertion=${encodeURIComponent(validAssertion)}`, { redirect: "manual" });
    if (![302, 303, 307, 308].includes(bridged.status)) failures.push(`valid_assertion_status_${bridged.status}`);
    if (!String(bridged.location || "").includes("/swficc/profiles/detail/")) failures.push("valid_assertion_wrong_redirect");
    const cookie = bridged.setCookie;
    if (!/__swfipn_session=/.test(cookie)) failures.push("valid_assertion_missing_session_cookie");

    const protectedPage = await fetchText(`${origin}${protectedPath}`, { headers: { Cookie: cookie } });
    if (protectedPage.status !== 200) failures.push(`bridged_protected_status_${protectedPage.status}`);
    if (!/Protected SWFI detail/i.test(protectedPage.body)) failures.push("bridged_protected_body_missing");

    const savedSearches = await fetchJson(`${origin}/api/v1/saved-searches`, { headers: { Cookie: cookie, Accept: "application/json" } });
    if (savedSearches.status !== 200) failures.push(`bridged_saved_searches_status_${savedSearches.status}`);
    const savedSearchRequest = [...backendRequests].reverse().find((request) => String(request.path || "").startsWith("/api/v1/saved-searches")) || {};
    const userId = savedSearchRequest.userId;
    const authSource = savedSearchRequest.authSource;
    const hasBackendAuth = savedSearchRequest.authorization === `Bearer ${backendToken}`;
    if (userId !== "prem@swfi.test") failures.push(`bridged_backend_user_${userId || "missing"}`);
    if (authSource !== "swfi_session_bridge") failures.push(`bridged_backend_auth_source_${authSource || "missing"}`);
    if (!hasBackendAuth) failures.push("bridged_backend_token_not_added_by_edge");

    return localResult(failures.length === 0, failures, backendRequests);
  } finally {
    await stopProcess(server.child);
    await new Promise((resolve) => backend.server.close(resolve));
    fs.rmSync(staticRoot, { recursive: true, force: true });
  }
}

function localResult(ok, failures, backendRequests) {
  return {
    id: "local_swfi_session_bridge_contract",
    ok,
    failures,
    backend_requests: backendRequests.map((request) => ({
      path: request.path,
      has_authorization: Boolean(request.authorization),
      user_id: request.userId || "",
      auth_source: request.authSource || "",
      admin_role: request.adminRole || "",
    })),
  };
}

async function targetRuntimeProbe() {
  const failures = [];
  const blockers = [];
  const root = new URL(targetOrigin);
  const loginUrl = new URL("login/?next=/swficc/profiles/detail/%3Fid%3D5e5713b876fb1e43b1bb71eb", targetOrigin).href;
  const bridgeUrl = new URL("auth/bridge/?next=/swficc/&assertion=invalid", targetOrigin).href;

  const login = await fetchText(loginUrl, { redirect: "manual" }).catch((error) => ({ error }));
  const bridge = await fetchText(bridgeUrl, { redirect: "manual" }).catch((error) => ({ error }));
  const result = {
    id: "target_runtime_swfi_session_bridge",
    ok: true,
    configured: false,
    real_swfi_auth_integration_claimed: false,
    mode: "blocked",
    failures,
    blockers,
    login_status: statusOf(login),
    login_location: locationSummary(login?.location || ""),
    invalid_assertion_status: statusOf(bridge),
    bridge_body_excerpt: String(bridge?.body || "").replace(/\s+/g, " ").slice(0, 240),
  };

  if (login?.error) failures.push(`login_probe_failed:${login.error.message}`);
  if (bridge?.error) failures.push(`bridge_probe_failed:${bridge.error.message}`);
  if (failures.length) {
    result.ok = false;
    result.mode = "misconfigured";
    return result;
  }

  const loginLocation = String(login.location || "");
  const loginUsesBridge = decodeURIComponent(loginLocation).includes("/swficc/auth/bridge/");
  const bridgeRouteDeployed = [401, 503].includes(bridge.status);
  const bridgeConfigured = bridge.status === 401;

  if (!bridgeRouteDeployed) {
    blockers.push(`swfi_session_bridge_route_not_deployed_status_${bridge.status}`);
  } else if (!bridgeConfigured) {
    blockers.push("swfi_session_bridge_secret_not_configured_on_target_runtime");
  }
  if (!loginUsesBridge) {
    blockers.push("swfi_signin_not_configured_to_return_to_swfipn_session_bridge");
  }

  result.configured = bridgeConfigured && loginUsesBridge;
  result.real_swfi_auth_integration_claimed = false;
  result.ok = failures.length === 0;
  result.mode = result.configured ? "configured_but_requires_swfi_signed_assertion_e2e" : "blocked";
  if (result.configured && !process.env.SWFIPN_SWFI_SESSION_BRIDGE_PROOF_ASSERTION) {
    blockers.push("swfi_signed_assertion_e2e_proof_not_supplied_to_gate");
    result.configured = false;
  }

  if (process.env.SWFIPN_SWFI_SESSION_BRIDGE_PROOF_ASSERTION) {
    const proofUrl = new URL(`auth/bridge/?next=/swficc/&assertion=${encodeURIComponent(process.env.SWFIPN_SWFI_SESSION_BRIDGE_PROOF_ASSERTION)}`, targetOrigin).href;
    const proof = await fetchText(proofUrl, { redirect: "manual" }).catch((error) => ({ error }));
    result.proof_assertion_status = statusOf(proof);
    result.proof_assertion_location = locationSummary(proof?.location || "");
    if (proof?.error) failures.push(`proof_assertion_failed:${proof.error.message}`);
    if (![302, 303, 307, 308].includes(proof?.status)) failures.push(`proof_assertion_status_${statusOf(proof)}`);
    result.configured = failures.length === 0;
    result.real_swfi_auth_integration_claimed = failures.length === 0;
  }

  return result;
}

async function startBackend(requests, expectedToken) {
  const server = http.createServer((req, res) => {
    const authorization = req.headers.authorization || "";
    const record = {
      path: req.url,
      authorization,
      userId: req.headers["x-swfi-user-id"] || "",
      authSource: req.headers["x-swfi-auth-source"] || "",
      adminRole: req.headers["x-swfi-admin-role"] || "",
    };
    requests.push(record);
    if (req.url === "/health") {
      json(res, 200, { status: "ok" });
      return;
    }
    if (req.url?.startsWith("/api/v1/saved-searches")) {
      json(res, authorization === `Bearer ${expectedToken}` ? 200 : 401, {
        status: authorization === `Bearer ${expectedToken}` ? "ok" : "unauthorized",
        received: {
          backend_authorized: authorization === `Bearer ${expectedToken}`,
          user_id: record.userId,
          auth_source: record.authSource,
          admin_role: record.adminRole,
        },
      });
      return;
    }
    json(res, 404, { status: "not_found" });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  return { server, origin: `http://127.0.0.1:${port}` };
}

async function startStaticServer({ staticRoot, staticPort, backendOrigin, backendToken, bridgeSecret, sessionSecret, audience }) {
  fs.mkdirSync(path.join(staticRoot, "profiles", "detail"), { recursive: true });
  fs.writeFileSync(path.join(staticRoot, "profiles", "detail", "index.html"), "<!doctype html><title>Protected</title><body>Protected SWFI detail</body>\n");
  fs.writeFileSync(path.join(staticRoot, "index.html"), "<!doctype html><title>SWFI</title><body>SWFI dashboard</body>\n");
  fs.writeFileSync(path.join(staticRoot, "swficc-release.json"), `${JSON.stringify({
    schema_version: "swfipn.release_marker.v1",
    asset_version: "local-session-bridge-proof",
    generated_at: new Date().toISOString(),
    git_sha: "local",
    git_dirty: true,
  })}\n`);

  const child = spawn("python3", [
    "scripts/serve-static-with-headers.py",
    "--host", "127.0.0.1",
    "--port", String(staticPort),
    "--root", staticRoot,
    "--backend", backendOrigin,
    "--backend-timeout", "5",
  ], {
    cwd: repoRoot,
    env: {
      ...process.env,
      SWFIPN_REQUIRE_RECORD_AUTH: "1",
      SWFIPN_AUTH_SESSION_SECRET: sessionSecret,
      SWFIPN_SWFI_SESSION_BRIDGE_SECRET: bridgeSecret,
      SWFIPN_SWFI_SESSION_BRIDGE_ISSUER: "swfi.com",
      SWFIPN_SWFI_SESSION_BRIDGE_AUDIENCE: audience,
      SWFIPN_SWFI_SESSION_BRIDGE_LOGIN_ENABLED: "1",
      SWFIPN_BACKEND_TOKEN: backendToken,
      SWFIPN_AUTH_USE_KEYCHAIN: "0",
      SWFIPN_BACKEND_TOKEN_USE_KEYCHAIN: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
  const origin = `http://127.0.0.1:${staticPort}`;
  const started = await waitFor(async () => {
    const response = await fetchText(`${origin}/swficc/__origin/ready`).catch(() => null);
    return response?.status === 200;
  }, timeoutMs).catch((error) => {
    error.message = `${error.message}; stderr=${stderr.slice(-600)}`;
    throw error;
  });
  if (!started) throw new Error(`static_server_not_ready; stderr=${stderr.slice(-600)}`);
  return { child };
}

function json(res, status, body) {
  const payload = `${JSON.stringify(body)}\n`;
  res.writeHead(status, { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

async function freePort() {
  const server = net.createServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    return {
      status: response.status,
      url: response.url,
      location: response.headers.get("location") || "",
      setCookie: response.headers.get("set-cookie") || "",
      body: await response.text(),
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const response = await fetchText(url, options);
  try {
    response.body = JSON.parse(response.body || "null");
  } catch {
    response.body = { raw: String(response.body || "").slice(0, 240) };
  }
  return response;
}

async function waitFor(fn, timeout) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return true;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error("timeout");
}

async function stopProcess(child) {
  if (!child || child.killed) return;
  child.kill("SIGTERM");
  await new Promise((resolve) => setTimeout(resolve, 250));
  if (!child.killed) child.kill("SIGKILL");
}

function signAssertion(payload, secret) {
  const payloadPart = b64url(JSON.stringify(payload));
  const signature = crypto.createHmac("sha256", secret).update(payloadPart).digest("base64url");
  return `${payloadPart}.${signature}`;
}

function b64url(value) {
  return Buffer.from(value).toString("base64url");
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function statusOf(value) {
  if (!value) return 0;
  if (value.error) return 0;
  return Number(value.status || 0);
}

function locationSummary(value) {
  const text = String(value || "");
  if (!text) return "";
  try {
    const parsed = new URL(text);
    if (parsed.hostname.endsWith("swfi.com")) {
      const redirect = parsed.searchParams.get("redirect") || "";
      return `${parsed.origin}${parsed.pathname}?redirect=${redirect ? decodeURIComponent(redirect).slice(0, 160) : ""}`;
    }
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return text.slice(0, 180);
  }
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

main().catch((error) => {
  fs.writeFileSync(receiptPath, `${JSON.stringify({
    schema_version: "swfipn.swfi_session_bridge_brd_gate.v1",
    generated_at: new Date().toISOString(),
    target_origin: targetOrigin,
    status: "fail",
    blockers: [],
    failures: [`unhandled_${error?.name || "error"}:${error?.message || "unknown"}`],
    no_secret_values_written: true,
    real_swfi_auth_integration_claimed: false,
  }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
