#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-admin-api-ui-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const serviceToken = loadServiceToken();
const keyName = `BRD Admin UI Key ${Date.now()}`;

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const consoleErrors = [];
  let createdSecret = "";

  if (!serviceToken) {
    blockers.push("api_access_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks, console_errors: consoleErrors });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    const response = await page.goto(appUrl("/admin/"), { waitUntil: "domcontentloaded", timeout: 120_000 });
    checks.push({ label: "page_load", status: response?.status() || 0 });
    if ((response?.status() || 0) >= 400) failures.push(`page_http_${response?.status() || 0}`);

    await page.waitForSelector("[data-brd-admin-api-ui]", { timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    await page.waitForTimeout(1000);
    const initialText = await page.locator("[data-brd-admin-api-ui]").innerText();
    for (const required of ["Admin API Product Console", "Load Keys", "Create Key", "Product API keys"]) {
      if (!initialText.includes(required)) failures.push(`missing_initial_text_${slug(required)}`);
    }

    await page.getByTestId("admin-api-token").fill(serviceToken);
    await page.getByTestId("admin-api-load").click();
    await page.waitForFunction(() => /Showing\s+[0-9,]+\s+product API keys/i.test(document.querySelector("[data-testid='admin-api-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "load_keys", "product API keys"));

    await page.getByTestId("admin-api-name").fill(keyName);
    await page.getByTestId("admin-api-create").click();
    await page.waitForFunction((name) => document.body.innerText.includes(name) && /Product API key created/i.test(document.querySelector("[data-testid='admin-api-status']")?.textContent || ""), keyName, { timeout: 30_000 });
    createdSecret = await page.getByTestId("admin-api-created-secret").innerText({ timeout: 30_000 });
    if (!createdSecret.startsWith("swfi_live_")) failures.push("created_secret_not_displayed_once_to_operator");
    checks.push({ ...(await safeUiCheck(page, "create_key", keyName)), one_time_secret_visible_to_operator: createdSecret.startsWith("swfi_live_") });

    const createdRow = page.locator("tr", { hasText: keyName }).first();
    await createdRow.getByTestId("admin-api-revoke").click();
    await page.waitForFunction((name) => /Product API key revoked/i.test(document.querySelector("[data-testid='admin-api-status']")?.textContent || "") && document.body.innerText.includes(name) && /Revoked/i.test(document.body.innerText), keyName, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "revoke_key", "Product API key revoked"));

    const finalText = await page.locator("[data-brd-admin-api-ui]").innerText();
    const forbidden = ["key_hash", "swfi_live_", serviceToken, createdSecret].filter((needle) => needle && finalText.includes(needle));
    if (forbidden.length) failures.push(`forbidden_ui_values:${forbidden.map((item) => item === serviceToken ? "access_token" : item === createdSecret ? "created_api_key" : item).join("|")}`);
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
    admin_scope_claimed: "api_key_lifecycle_only",
    no_secret_values_written: true,
    no_key_hash_values_written: true,
    no_service_token_written: true,
    real_swfi_auth_integration_claimed: false,
    broader_admin_users_orgs_roles_claimed: false,
  });
}

async function safeUiCheck(page, label, text) {
  const body = await page.locator("body").innerText();
  return {
    label,
    expected_text_present: body.includes(text),
    status_text: await page.getByTestId("admin-api-status").innerText().catch(() => ""),
  };
}

function writeReceipt(receipt) {
  const fullReceipt = {
    schema_version: "swfipn.admin_api_ui_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    public_url: appUrl("/admin/"),
    created_key_name: keyName,
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
      admin_scope_claimed: fullReceipt.admin_scope_claimed,
      no_secret_values_written: Boolean(fullReceipt.no_secret_values_written),
      no_key_hash_values_written: Boolean(fullReceipt.no_key_hash_values_written),
      real_swfi_auth_integration_claimed: Boolean(fullReceipt.real_swfi_auth_integration_claimed),
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
    schema_version: "swfipn.admin_api_ui_brd_gate.v1",
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
