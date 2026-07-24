#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-alerts-ui-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const serviceToken = loadServiceToken();
const userId = `alerts-ui-${Date.now()}@swfi.test`;
const alertName = `BRD UI Alert ${Date.now()}`;

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const consoleErrors = [];

  if (!serviceToken) {
    blockers.push("api_access_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks, console_errors: consoleErrors });
  }

  const browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    const response = await page.goto(appUrl("/alerts/"), { waitUntil: "domcontentloaded", timeout: 120_000 });
    checks.push({ label: "page_load", status: response?.status() || 0 });
    if ((response?.status() || 0) >= 400) failures.push(`page_http_${response?.status() || 0}`);

    await page.waitForSelector("[data-brd-alerts-ui]", { timeout: 120_000 });
    await page.waitForFunction(
      () => /New deals|New mandates|Investor activity/i.test(document.body.innerText) && /Showing\s+[0-9,]+\s+of\s+[0-9,]+/i.test(document.body.innerText),
      null,
      { timeout: 120_000 }
    ).catch(() => null);
    const initialText = await page.locator("body").innerText();
    for (const required of ["Alerts", "New deals", "New mandates", "Investor activity", "Alert Rule Management"]) {
      if (!initialText.includes(required)) failures.push(`missing_initial_text_${slug(required)}`);
    }

    await controlledFill(page, "alerts-access-token", serviceToken);
    await controlledFill(page, "alerts-user-id", userId);
    await page.getByTestId("alerts-load").click();
    await page.waitForFunction(() => /saved alert rules|No saved alert rules loaded/i.test(document.body.innerText), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "load_rules", "saved alert rules"));

    await controlledFill(page, "alerts-name", alertName);
    await page.getByTestId("alerts-type").selectOption("transaction");
    await page.getByTestId("alerts-frequency").selectOption("Daily Digest");
    await controlledFill(page, "alerts-sector", "Infrastructure");
    await controlledFill(page, "alerts-minimum-amount", "100000000");
    await page.getByTestId("alerts-create").click();
    await page.waitForFunction((name) => document.body.innerText.includes(name) && /Alert rule created/i.test(document.body.innerText), alertName, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "create_alert", alertName));

    await page.getByTestId("alerts-test-delivery").first().click();
    await page.waitForFunction(() => /Delivery test complete/i.test(document.body.innerText), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "test_delivery", "Delivery test complete"));

    await page.getByTestId("alerts-toggle").first().click();
    await page.waitForFunction(() => /Alert rule disabled|Disabled/i.test(document.body.innerText), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "disable_alert", "Disabled"));

    await page.getByTestId("alerts-history").click();
    await page.waitForFunction(() => /90-day retention/i.test(document.body.innerText), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "history", "90-day retention"));

    await page.getByTestId("alerts-delete").first().click();
    await page.waitForFunction((name) => /Alert rule deleted/i.test(document.body.innerText) && !document.body.innerText.includes(name), alertName, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "delete_alert", "Alert rule deleted"));

    const finalText = await page.locator("[data-brd-alerts-ui]").innerText();
    const forbidden = ["source_doc_ids", "amount_display", "buyer_region", "swfi_live_", "key_hash", serviceToken].filter((needle) => finalText.includes(needle));
    if (forbidden.length) failures.push(`forbidden_ui_values:${forbidden.map((item) => item === serviceToken ? "access_token" : item).join("|")}`);
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
    user_isolation_checked_with_unique_user: true,
    no_secret_values_written: true,
    no_delivery_claimed_without_receipts: true,
    email_delivery_claimed: false,
    real_swfi_auth_integration_claimed: false,
    test_delivery_ui_available: true,
  });
}

async function safeUiCheck(page, label, text) {
  const body = await page.locator("body").innerText();
  return {
    label,
    expected_text_present: body.includes(text),
    status_text: await page.getByTestId("alerts-ui-status").innerText().catch(() => ""),
  };
}

async function controlledFill(page, testId, value) {
  const locator = page.getByTestId(testId);
  await locator.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  if (value) await page.keyboard.insertText(value);
}

function writeReceipt(receipt) {
  const fullReceipt = {
    schema_version: "swfipn.alerts_ui_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    public_url: appUrl("/alerts/"),
    alert_name: alertName,
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
      checks: fullReceipt.checks?.length || 0,
      no_delivery_claimed_without_receipts: Boolean(fullReceipt.no_delivery_claimed_without_receipts),
      test_delivery_ui_available: Boolean(fullReceipt.test_delivery_ui_available),
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
    schema_version: "swfipn.alerts_ui_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
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
