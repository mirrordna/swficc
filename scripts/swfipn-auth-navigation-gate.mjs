#!/usr/bin/env node
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-auth-navigation-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/swficc/");
const resolveIp = process.env.SWFIPN_RESOLVE_IP || "";
const originHost = new URL(origin).hostname;
const username = process.env.SWFIPN_AUTH_TEST_USERNAME || "";
const password = process.env.SWFIPN_AUTH_TEST_PASSWORD || "";
const brandHeaderLinks = [
  ["DASHBOARD", "/"],
  ["NEWS", "/intelligence/"],
  ["ENTITIES", "/profiles/"],
  ["PEOPLE", "/people/"],
  ["TRANSACTIONS", "/transactions/"],
  ["COMPASS", "/mandates/"],
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(route) {
  return route === "/" ? origin : new URL(route.replace(/^\//, ""), origin).href;
}

function appPath(route) {
  return new URL(route.replace(/^\//, ""), origin).pathname.replace(/\/?$/, "/");
}

function rootOriginUrl(pathname) {
  const root = new URL(origin);
  return new URL(pathname, root.origin).href;
}

function isInternalSwficcHref(href, expectedRoute = "") {
  try {
    const parsed = new URL(href, origin);
    const root = new URL(origin);
    const basePath = root.pathname.replace(/\/$/, "");
    if (parsed.origin !== root.origin) return false;
    if (!parsed.pathname.startsWith(basePath || "/")) return false;
    if (!expectedRoute) return true;
    const expected = new URL(expectedRoute.replace(/^\//, ""), origin).pathname.replace(/\/?$/, "/");
    return parsed.pathname.replace(/\/?$/, "/") === expected;
  } catch {
    return false;
  }
}

function isExternalSwfiHref(href) {
  return /^https?:\/\/(www\.)?swfi\.com/i.test(String(href || ""));
}

function isCanonicalSwfiRecordHref(href) {
  try {
    const parsed = new URL(String(href || ""));
    if (!["www.swfi.com", "swfi.com", "cms.swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname === "/" && /^\?p=\d+/i.test(parsed.search)) return true;
    return /^\/v1\/(entities|people|transactions|compass|news)\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function isSwfiSigninRecordHandoff(href, section = "entities") {
  try {
    const parsed = new URL(String(href || ""));
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    return new RegExp(`^/v1/${section}/[a-f0-9]{24}$`, "i").test(redirect);
  } catch {
    return false;
  }
}

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

async function bodyText(page, max = 700) {
  return (await page.locator("body").innerText({ timeout: 30_000 }).catch(() => ""))
    .slice(0, max)
    .replace(/\s+/g, " ");
}

async function clickActiveAllocators(page) {
  const link = page.locator('a:has-text("Active Allocators")').first();
  const href = await link.getAttribute("href");
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 90_000 }).catch(() => null),
    link.click({ timeout: 30_000 }),
  ]);
  await page.waitForTimeout(1500);
  return href;
}

async function unauthenticatedClickCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const result = { id: "dashboard_click_opens_internal_swfi2_route", ok: true, failures: [], target_href: "", final_url: "", body_excerpt: "" };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
    result.target_href = await clickActiveAllocators(page) || "";
    result.final_url = page.url();
    result.body_excerpt = await bodyText(page);
    if (!isInternalSwficcHref(result.target_href, "/allocators/")) result.failures.push(`target_not_internal_allocators:${result.target_href || "missing"}`);
    if (!isInternalSwficcHref(result.final_url, "/allocators/")) result.failures.push(`final_not_internal_allocators:${result.final_url}`);
    if (isExternalSwfiHref(result.target_href) || isExternalSwfiHref(result.final_url)) result.failures.push("external_swfi_navigation");
    if (/Subscriber Sign In/i.test(result.body_excerpt)) result.failures.push("unexpected_login_page");
    if (/Not found|404/i.test(result.body_excerpt)) result.failures.push("internal_route_404");
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function unauthenticatedProfileRowClickCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const result = { id: "dashboard_profile_row_links_to_swfi_signin_handoff", ok: true, failures: [], target_href: "", final_url: "", next: "", body_excerpt: "" };
  try {
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(4000);
    result.target_href = await page.locator('a[href^="https://www.swfi.com/v1/signin/"][href*="%2Fv1%2Fentities%2F"], a[href^="https://swfi.com/v1/signin/"][href*="%2Fv1%2Fentities%2F"]').first().getAttribute("href", { timeout: 60_000 }) || "";
    result.final_url = page.url();
    result.body_excerpt = await bodyText(page);
    if (!isSwfiSigninRecordHandoff(result.target_href, "entities")) {
      result.failures.push(`missing_swfi_signin_entity_handoff:${result.target_href || "missing"}`);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function unauthenticatedBrandHeaderClickCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  const result = { id: "dashboard_brand_header_clicks_open_public_pages", ok: true, failures: [], links: [] };
  try {
    for (const [label, route] of brandHeaderLinks) {
      const row = { label, expected_next: appPath(route), target_href: "", final_url: "", next: "", body_excerpt: "" };
      await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
      await page.waitForTimeout(1500);
      const link = page.locator(`a:has-text("${label}")`).first();
      row.target_href = await link.getAttribute("href", { timeout: 30_000 }) || "";
      await link.click({ timeout: 30_000 });
      await page.waitForLoadState("domcontentloaded", { timeout: 30_000 }).catch(() => null);
      row.final_url = page.url();
      const parsed = new URL(row.final_url);
      row.next = parsed.searchParams.get("next") || "";
      row.body_excerpt = await bodyText(page, 300);
      if (!isInternalSwficcHref(row.target_href, route)) result.failures.push(`${label}:target_not_public_route:${row.target_href}`);
      if (!isInternalSwficcHref(row.final_url, route)) result.failures.push(`${label}:not_public_route:${row.final_url}`);
      if (/Subscriber Sign In/i.test(row.body_excerpt)) result.failures.push(`${label}:unexpected_login_page`);
      if (/Not found|404/i.test(row.body_excerpt)) result.failures.push(`${label}:public_page_404`);
      if (isExternalSwfiHref(row.target_href) || isExternalSwfiHref(row.final_url) || isExternalSwfiHref(row.next)) result.failures.push(`${label}:external_swfi_login_target`);
      result.links.push(row);
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function unauthenticatedSessionCheck(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const result = { id: "session_status_unauthenticated", ok: true, failures: [], status: 0, body: null };
  try {
    const response = await context.request.get(rootOriginUrl("/api/session/status/v1"), { timeout: 30_000 });
    result.status = response.status();
    result.body = await response.json().catch(async () => ({ text: (await response.text()).slice(0, 200) }));
    if (result.status === 404) {
      result.body = { local_session_api: "not_present_phase1_swfi_auth_handoff" };
    } else {
      if (![200, 401].includes(result.status)) result.failures.push(`expected_200_401_or_404_got_${result.status}`);
      if (result.body?.authenticated !== false) result.failures.push("unauthenticated_body_not_false");
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function authenticatedClickCheck(browser) {
  const result = { id: "authenticated_dashboard_emits_internal_mirror_link", ok: true, skipped: false, failures: [], login_final_url: "", click_final_url: "", session_status: 0, body_excerpt: "", phase1_swfi_auth_handoff: false };
  if (!username || !password) {
    result.skipped = true;
    return result;
  }
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await context.newPage();
  try {
    await page.goto(appUrl(`/login/?next=${encodeURIComponent("/swficc/allocators/")}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
    result.login_final_url = page.url();
    const loginUrl = new URL(result.login_final_url);
    if (["www.swfi.com", "swfi.com"].includes(loginUrl.hostname) && loginUrl.pathname.replace(/\/?$/, "/") === "/v1/signin/") {
      const redirectTarget = loginUrl.searchParams.get("redirect") || "";
      result.phase1_swfi_auth_handoff = true;
      if (!redirectTarget.includes("/swficc/allocators/")) {
        result.failures.push(`swfi_redirect_target_missing:${redirectTarget || "missing"}`);
      }
      result.click_final_url = result.login_final_url;
      result.ok = result.failures.length === 0;
      return result;
    }
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/swficc\/allocators\/(?:$|[?#])/, { timeout: 90_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    result.login_final_url = page.url();
    const session = await context.request.get(rootOriginUrl("/api/session/status/v1"), { timeout: 30_000 });
    result.session_status = session.status();
    if (result.session_status !== 200) result.failures.push(`session_status_${result.session_status}`);
    await page.goto(appUrl("/"), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.waitForTimeout(2000);
    result.click_final_url = await page.locator('#insight-top-investors a[href*="/swficc/profiles/detail/"]').first().getAttribute("href", { timeout: 60_000 }) || "";
    result.body_excerpt = await bodyText(page);
    if (!isInternalSwficcHref(result.click_final_url)) {
      result.failures.push(`authenticated_missing_internal_profile_detail_href:${result.click_final_url || "missing"}`);
    }
    if (isExternalSwfiHref(result.click_final_url)) result.failures.push(`authenticated_external_swfi_href:${result.click_final_url}`);
    if (/Subscriber Sign In/i.test(result.body_excerpt)) result.failures.push("authenticated_click_returned_login");
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const launchOptions = {
    headless: true,
    args: resolveIp ? [`--host-resolver-rules=MAP ${originHost} ${resolveIp}`] : [],
  };
  async function runBrowserCheck(check) {
    const browser = await chromium.launch(launchOptions);
    try {
      return await check(browser);
    } finally {
      await browser.close().catch(() => {});
    }
  }
  const checks = [
    await runBrowserCheck(unauthenticatedSessionCheck),
    await runBrowserCheck(unauthenticatedClickCheck),
    await runBrowserCheck(unauthenticatedProfileRowClickCheck),
    await runBrowserCheck(unauthenticatedBrandHeaderClickCheck),
    await runBrowserCheck(authenticatedClickCheck),
  ];
  const hardFailures = checks.filter((check) => !check.skipped && !check.ok);
  const receipt = {
    schema_version: "swfipn.auth_navigation_gate.v1",
    origin,
    generated_at: new Date().toISOString(),
    status: hardFailures.length ? "fail" : "pass",
    summary: {
      checks: checks.length,
      failures: hardFailures.length,
      authenticated_check_skipped: checks.some((check) => check.id === "authenticated_dashboard_emits_internal_mirror_link" && check.skipped),
    },
    checks,
    failures: hardFailures.map((check) => ({ id: check.id, failures: check.failures })),
  };
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({ status: receipt.status, summary: receipt.summary, receipt: receiptPath }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
