#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const apiOrigin = new URL("/", origin).origin;
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-admin-governance-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const serviceToken = loadServiceToken();
const runId = Date.now();
const orgName = `BRD Admin Governance Org ${runId}`;
const uiOrgName = `BRD Admin Governance UI Org ${runId}`;
const userEmail = `admin.governance.${runId}@swfi.test`;
const uiUserEmail = `admin.governance.ui.${runId}@swfi.test`;
const contentTitle = `BRD Admin Governance Draft ${runId}`;
const uiContentTitle = `BRD Admin Governance UI Draft ${runId}`;

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const consoleErrors = [];
  let createdApiKeySeenOnce = false;

  if (!serviceToken) {
    blockers.push("api_access_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks, console_errors: consoleErrors });
  }

  const unauthorized = await apiFetch("/v1/admin/organizations", {
    method: "POST",
    body: { org_name: "No Token" },
    includeToken: false,
  });
  checks.push({ label: "unauthenticated_write_blocked", status: unauthorized.status });
  if (unauthorized.status !== 401) failures.push(`unauthenticated_write_status_${unauthorized.status}`);

  const viewerBlocked = await apiFetch("/v1/admin/organizations", {
    method: "POST",
    role: "Viewer",
    body: {
      org_name: `Viewer Blocked ${runId}`,
      org_type: "Subscriber",
      billing_email: "viewer.blocked@swfi.test",
      max_users: 2,
    },
  });
  checks.push({ label: "viewer_org_create_blocked", status: viewerBlocked.status });
  if (viewerBlocked.status !== 403) failures.push(`viewer_org_create_status_${viewerBlocked.status}`);

  const org = await apiFetch("/v1/admin/organizations", {
    method: "POST",
    role: "Super Admin",
    body: {
      org_name: orgName,
      org_type: "API Client",
      subscription_tier: "Enterprise",
      contract_start: "2026-06-01",
      contract_end: "2027-06-01",
      max_users: 3,
      billing_email: "admin.governance@swfi.test",
      api_access: true,
    },
  });
  const orgId = org.body?.data?.item?.id || "";
  checks.push({ label: "super_admin_create_org", status: org.status, created: Boolean(orgId) });
  if (org.status !== 200 || !orgId) failures.push(`super_admin_create_org_status_${org.status}`);

  const user = await apiFetch("/v1/admin/users", {
    method: "POST",
    role: "Admin",
    body: {
      first_name: "Prem",
      last_name: "Validator",
      email: userEmail,
      org_id: orgId,
      role: "Admin",
      status: "Pending",
      two_factor_enabled: true,
    },
  });
  const userId = user.body?.data?.item?.id || "";
  createdApiKeySeenOnce = typeof user.body?.data?.one_time_api_key === "string" && user.body.data.one_time_api_key.startsWith("swfi_live_");
  checks.push({ label: "admin_create_user", status: user.status, created: Boolean(userId), one_time_api_key_seen_once: createdApiKeySeenOnce });
  if (user.status !== 200 || !userId || !createdApiKeySeenOnce) failures.push(`admin_create_user_status_${user.status}`);
  if (user.body?.welcome_email_claimed !== false || user.body?.sendgrid_onboarding_claimed !== false) failures.push("email_or_sendgrid_claimed_by_admin_user_create");

  const listUsers = await apiFetch("/v1/admin/users?limit=25&offset=0", { method: "GET", role: "Viewer" });
  const listPayload = JSON.stringify(listUsers.body || {});
  checks.push({ label: "viewer_can_read_users_without_secrets", status: listUsers.status });
  if (listUsers.status !== 200) failures.push(`viewer_user_list_status_${listUsers.status}`);
  if (listPayload.includes("swfi_live_") || listPayload.includes("key_hash")) failures.push("admin_user_list_exposes_secret_material");

  const adminDeleteBlocked = await apiFetch(`/v1/admin/users/${encodeURIComponent(userId)}`, { method: "DELETE", role: "Admin" });
  checks.push({ label: "admin_delete_user_blocked", status: adminDeleteBlocked.status });
  if (adminDeleteBlocked.status !== 403) failures.push(`admin_delete_user_status_${adminDeleteBlocked.status}`);

  const content = await apiFetch("/v1/admin/content-items", {
    method: "POST",
    role: "Editor",
    body: {
      section: "news",
      title: contentTitle,
      status: "Draft",
      summary: "Draft content stays inside Admin until published.",
      featured: true,
      premium: false,
    },
  });
  checks.push({ label: "editor_create_content", status: content.status, created: Boolean(content.body?.data?.item?.id) });
  if (content.status !== 200 || !content.body?.data?.item?.id) failures.push(`editor_create_content_status_${content.status}`);

  const viewerContentBlocked = await apiFetch("/v1/admin/content-items", {
    method: "POST",
    role: "Viewer",
    body: { section: "news", title: `Viewer content ${runId}` },
  });
  checks.push({ label: "viewer_content_create_blocked", status: viewerContentBlocked.status });
  if (viewerContentBlocked.status !== 403) failures.push(`viewer_content_status_${viewerContentBlocked.status}`);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    const response = await page.goto(appUrl("/admin/"), { waitUntil: "domcontentloaded", timeout: 120_000 });
    checks.push({ label: "admin_page_load", status: response?.status() || 0 });
    if ((response?.status() || 0) >= 400) failures.push(`admin_page_http_${response?.status() || 0}`);

    await page.waitForSelector("[data-brd-admin-governance-ui]", { timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    const panelText = await page.locator("[data-brd-admin-governance-ui]").innerText();
    for (const required of ["Admin Governance Console", "Organizations", "Users", "Content Workflow"]) {
      if (!panelText.includes(required)) failures.push(`missing_governance_ui_text_${slug(required)}`);
    }

    await controlledFill(page, "admin-governance-token", serviceToken);
    await page.getByTestId("admin-governance-role").selectOption("Super Admin");
    await page.getByTestId("admin-governance-load").click();
    await page.waitForFunction(() => /organizations.*users.*content workflow records/i.test(document.querySelector("[data-testid='admin-governance-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push({ label: "ui_load_admin_governance", status_text: await page.getByTestId("admin-governance-status").innerText() });

    await controlledFill(page, "admin-governance-org-name", uiOrgName);
    await controlledFill(page, "admin-governance-org-email", "ui.governance@swfi.test");
    await page.getByTestId("admin-governance-create-org").click();
    await page.waitForFunction(() => /Organization created/i.test(document.querySelector("[data-testid='admin-governance-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push({ label: "ui_create_organization", expected_text_present: (await page.locator("body").innerText()).includes(uiOrgName) });

    await controlledFill(page, "admin-governance-user-email", uiUserEmail);
    await page.getByTestId("admin-governance-create-user").click();
    await page.waitForFunction(() => /User created/i.test(document.querySelector("[data-testid='admin-governance-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push({ label: "ui_create_user", expected_text_present: (await page.locator("body").innerText()).includes("Prem Validator") });

    await controlledFill(page, "admin-governance-content-title", uiContentTitle);
    await page.getByTestId("admin-governance-create-content").click();
    await page.waitForFunction(() => /Content workflow draft saved/i.test(document.querySelector("[data-testid='admin-governance-status']")?.textContent || ""), null, { timeout: 30_000 });
    const finalText = await page.locator("[data-brd-admin-governance-ui]").innerText();
    checks.push({ label: "ui_create_content", expected_text_present: finalText.includes(uiContentTitle) });
    if (finalText.includes(serviceToken) || finalText.includes("swfi_live_") || finalText.includes("key_hash")) failures.push("admin_governance_ui_exposes_secret_material");
  } finally {
    await browser.close();
  }

  if (consoleErrors.length) failures.push("console_errors_present");
  return writeReceipt({
    status: failures.length ? "fail" : blockers.length ? "blocked" : "pass",
    blockers,
    failures,
    checks,
    console_errors: consoleErrors.slice(0, 10),
    admin_governance_scope_claimed: "organizations_users_roles_content_workflow",
    organizations_api_checked: true,
    users_api_checked: true,
    role_permissions_checked: true,
    content_workflow_checked: true,
    created_api_key_seen_once: createdApiKeySeenOnce,
    no_secret_values_written: true,
    no_key_hash_values_written: true,
    no_service_token_written: true,
    welcome_email_claimed: false,
    sendgrid_onboarding_claimed: false,
    real_swfi_auth_integration_claimed: false,
  });
}

async function apiFetch(route, options = {}) {
  const url = new URL(route, apiOrigin).href;
  const headers = { Accept: "application/json", "Content-Type": "application/json", "X-SWFIPN-Internal": "1" };
  if (options.includeToken !== false) headers.Authorization = `Bearer ${serviceToken}`;
  if (options.role) headers["X-SWFI-Admin-Role"] = options.role;
  headers["X-SWFI-Admin-User"] = "swfi-admin-gate@swfi.test";
  const response = await fetch(url, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const body = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
  return { status: response.status, body };
}

async function controlledFill(page, testId, value) {
  const locator = page.getByTestId(testId);
  await locator.click();
  await locator.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await locator.press("Backspace");
  await locator.type(value);
}

function writeReceipt(receipt) {
  const fullReceipt = {
    schema_version: "swfipn.admin_governance_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    public_url: appUrl("/admin/"),
    no_secret_values_written: true,
    no_key_hash_values_written: true,
    ...receipt,
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(fullReceipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: fullReceipt.status,
    receipt: receiptPath,
    summary: {
      failures: fullReceipt.failures || [],
      blockers: fullReceipt.blockers || [],
      checks: fullReceipt.checks?.length || 0,
      admin_governance_scope_claimed: fullReceipt.admin_governance_scope_claimed,
      role_permissions_checked: Boolean(fullReceipt.role_permissions_checked),
      content_workflow_checked: Boolean(fullReceipt.content_workflow_checked),
      real_swfi_auth_integration_claimed: Boolean(fullReceipt.real_swfi_auth_integration_claimed),
      sendgrid_onboarding_claimed: Boolean(fullReceipt.sendgrid_onboarding_claimed),
    },
  }, null, 2));
  if (fullReceipt.status === "fail") process.exit(1);
}

function appUrl(route) {
  return new URL(route.replace(/^\//, ""), origin).href;
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
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
    schema_version: "swfipn.admin_governance_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    status: "fail",
    no_secret_values_written: true,
    no_key_hash_values_written: true,
    failures: [`uncaught:${error.message}`],
    blockers: [],
    checks: [],
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.error(JSON.stringify({ status: "fail", receipt: receiptPath, error: error.message }, null, 2));
  process.exit(1);
});
