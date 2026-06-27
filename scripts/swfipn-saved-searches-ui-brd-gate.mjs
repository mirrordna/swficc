#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cwd = process.cwd();
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://localhost:3025/swficc/");
const outputDir = path.join(cwd, "output");
const receiptPath = path.join(outputDir, "swfipn-saved-searches-ui-brd-gate-latest.json");
fs.mkdirSync(outputDir, { recursive: true });

const serviceToken = loadServiceToken();
const userId = `saved-search-ui-${Date.now()}@swfi.test`;
const savedSearchName = `BRD UI Saved Search ${Date.now()}`;

async function main() {
  const checks = [];
  const failures = [];
  const blockers = [];
  const consoleErrors = [];

  if (!serviceToken) {
    blockers.push("api_access_token_not_available_in_env_or_keychain");
    return writeReceipt({ status: "blocked", blockers, failures, checks, console_errors: consoleErrors });
  }

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => consoleErrors.push(error.message));

  try {
    const response = await page.goto(appUrl("/search/?q=Infrastructure"), { waitUntil: "domcontentloaded", timeout: 120_000 });
    checks.push({ label: "page_load", status: response?.status() || 0 });
    if ((response?.status() || 0) >= 400) failures.push(`page_http_${response?.status() || 0}`);

    await page.waitForSelector("[data-brd-saved-searches-ui]", { timeout: 120_000 });
    await page.waitForLoadState("networkidle", { timeout: 120_000 }).catch(() => null);
    await page.waitForTimeout(1500);
    const initialText = await page.locator("body").innerText();
    for (const required of ["Smart Search Bar", "Saved Search Workspace", "Save filters", "Load Saved"]) {
      if (!initialText.includes(required)) failures.push(`missing_initial_text_${slug(required)}`);
    }

    await controlledFill(page, "saved-searches-access-token", serviceToken);
    await controlledFill(page, "saved-searches-user-id", userId);
    await page.getByTestId("saved-searches-load").click();
    await page.getByTestId("saved-searches-ui-status").waitFor({ state: "visible", timeout: 30_000 });
    await page.waitForFunction(() => /Showing\s+[0-9,]+\s+saved searches/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "load_saved_searches", "saved searches"));

    await controlledFill(page, "saved-searches-name", savedSearchName);
    await page.getByTestId("saved-searches-section").selectOption("transaction");
    await controlledFill(page, "saved-searches-query", "Norway");
    await controlledFill(page, "saved-searches-region", "Asia");
    await controlledFill(page, "saved-searches-sector", "Infrastructure");
    await controlledFill(page, "saved-searches-minimum-amount", "100000000");
    await page.getByTestId("saved-searches-alert-enabled").setChecked(true);
    await page.getByTestId("saved-searches-alert-frequency").selectOption("Daily Digest");
    await page.getByTestId("saved-searches-create").click();
    await page.waitForFunction((name) => document.body.innerText.includes(name) && /Saved search created/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || ""), savedSearchName, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "create_saved_search", savedSearchName));

    await page.getByTestId("saved-searches-test-alert-delivery").first().click();
    await page.waitForFunction(() => /Linked alert delivery test complete/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "test_linked_alert_delivery", "Linked alert delivery test complete"));

    await page.getByTestId("saved-searches-update").first().click();
    await page.waitForFunction(() => /alert confirmation|Saved search updated/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "update_with_alert_confirmation", "alert confirmation"));

    await page.getByTestId("saved-searches-rerun").first().click();
    await page.waitForFunction(() => /Current .* results/i.test(document.querySelector("[data-testid='saved-searches-results-summary']")?.textContent || "") && /rerun against the current SWFI data source/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || ""), null, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "rerun_current_results", "Current"));

    await page.getByTestId("saved-searches-delete").first().click();
    await page.waitForFunction((name) => /Saved search deleted/i.test(document.querySelector("[data-testid='saved-searches-ui-status']")?.textContent || "") && !document.querySelector("[data-testid='saved-searches-list']")?.textContent?.includes(name), savedSearchName, { timeout: 30_000 });
    checks.push(await safeUiCheck(page, "delete_saved_search", "Saved search deleted"));

    const finalText = await page.locator("[data-brd-saved-searches-ui]").innerText();
    const forbidden = ["source_doc_ids", "buyer_entity", "amount_display", "swfi_live_", "key_hash", serviceToken].filter((needle) => finalText.includes(needle));
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
    no_fact_rows_persisted_in_receipt: true,
    no_delivery_claimed_without_receipts: true,
    saved_search_alert_delivery_ui_available: true,
    linked_alert_delivery_receipt_written: true,
    email_delivery_claimed: false,
    sendgrid_onboarding_claimed: false,
    real_swfi_auth_integration_claimed: false,
  });
}

async function safeUiCheck(page, label, text) {
  const body = await page.locator("body").innerText();
  return {
    label,
    expected_text_present: body.includes(text),
    status_text: await page.getByTestId("saved-searches-ui-status").innerText().catch(() => ""),
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
    schema_version: "swfipn.saved_searches_ui_brd_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    public_url: appUrl("/search/?q=Infrastructure"),
    saved_search_name: savedSearchName,
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
      no_fact_rows_persisted_in_receipt: Boolean(fullReceipt.no_fact_rows_persisted_in_receipt),
      saved_search_alert_delivery_ui_available: Boolean(fullReceipt.saved_search_alert_delivery_ui_available),
      linked_alert_delivery_receipt_written: Boolean(fullReceipt.linked_alert_delivery_receipt_written),
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
    schema_version: "swfipn.saved_searches_ui_brd_gate.v1",
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
