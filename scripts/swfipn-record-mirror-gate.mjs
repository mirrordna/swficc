import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const outputDir = path.join(repoRoot, "output");
const receiptPath = path.join(outputDir, "swfipn-record-mirror-gate-latest.json");
const origin = normalizeOrigin(process.env.SWFIPN_ORIGIN || "http://127.0.0.1:8353/");
const originUrl = new URL(origin);
const appBasePath = originUrl.pathname.replace(/\/$/, "");
const backendOrigin = (process.env.SWFIPN_BACKEND_ORIGIN || origin).replace(/\/$/, "");
const sampleLimit = Number(process.env.SWFIPN_RECORD_MIRROR_SAMPLE_LIMIT || 2);
const enumerateAll = process.env.SWFIPN_RECORD_MIRROR_ENUMERATE_ALL === "1";
const enumeratePageLimit = Number(process.env.SWFIPN_RECORD_MIRROR_ENUMERATE_LIMIT || 50);
const authMode = String(process.env.SWFIPN_RECORD_MIRROR_AUTH_MODE || "self-contained");
const validateLegacyAuth = authMode === "legacy-auth";
const username = validateLegacyAuth
  ? loadSecret("SWFIPN_AUTH_TEST_USERNAME", "SWFIPN_AUTH_USERNAME_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_USERNAME", "SWFI_PREVIEW_AUTH_USERNAME"]).trim()
  : "";
const password = validateLegacyAuth
  ? loadSecret("SWFIPN_AUTH_TEST_PASSWORD", "SWFIPN_AUTH_PASSWORD_KEYCHAIN_SERVICE", ["SWFIPN_AUTH_PASSWORD", "SWFI_PREVIEW_AUTH_PASSWORD"], false)
  : "";

const classes = [
  {
    id: "entities",
    sourceSection: "entities",
    endpoint: (limit, page) => `/api/source-data/search/v1?collection=entities&limit=${limit}&page=${page}`,
    scanEndpoint: (limit, after = "") => `/api/source-data/scan/v1?collection=entities&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    targetPath: (id, sourceUrl) => `/swficc/profiles/detail/?${new URLSearchParams({ id, source: sourceUrl }).toString()}`,
    required: (row) => ["Entity Profile", row.name || row.id, "Verified in SWFI records"],
  },
  {
    id: "people",
    sourceSection: "people",
    endpoint: (limit, page) => `/api/source-data/search/v1?collection=people&limit=${limit}&page=${page}`,
    scanEndpoint: (limit, after = "") => `/api/source-data/scan/v1?collection=people&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    targetPath: (id, sourceUrl) => `/swficc/people/detail/?${new URLSearchParams({ id, source: sourceUrl }).toString()}`,
    required: (row) => ["Person Detail", row.name || row.id, "Verified in SWFI records"],
  },
  {
    id: "transactions",
    sourceSection: "transactions",
    endpoint: (limit, page) => `/api/transactions/v1?limit=${limit}&page=${page}`,
    scanEndpoint: (limit, after = "") => `/api/source-data/scan/v1?collection=transactions&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    targetPath: (id, sourceUrl) => `/swficc/transactions/detail/?${new URLSearchParams({ id, source: sourceUrl }).toString()}`,
    required: (row) => ["Transaction Details", row.title || row.name || row.id, "Verified in SWFI records"],
  },
  {
    id: "compass",
    sourceSection: "compass",
    endpoint: (limit, page) => `/api/source-data/search/v1?collection=compass&limit=${limit}&page=${page}`,
    scanEndpoint: (limit, after = "") => `/api/source-data/scan/v1?collection=compass&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    targetPath: (id, sourceUrl) => `/swficc/mandates/detail/?${new URLSearchParams({ id, source: sourceUrl }).toString()}`,
    required: (row) => ["Compass / RFP Detail", row.title || row.name || row.id, "Verified in SWFI records"],
  },
  {
    id: "news",
    sourceSection: "news",
    publicDetail: true,
    endpoint: (limit, page) => `/api/source-intelligence/news/v1?limit=${limit}&page=${page}`,
    scanEndpoint: (limit, after = "") => `/api/source-data/scan/v1?collection=news&limit=${limit}${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    sourceUrl: (row, id) => String(row.source_url || row.url || `https://cms.swfi.com/?p=${encodeURIComponent(id)}`),
    targetPath: (id, sourceUrl) => `/swficc/research/detail/?${new URLSearchParams({ legacy: id, source: sourceUrl }).toString()}`,
    sourcePath: (id, sourceUrl) => `/swficc/research/detail/?${new URLSearchParams({ legacy: id, source: sourceUrl }).toString()}`,
    required: (row) => [
      "Research / News Detail",
      row.title || row.name || row.id,
      "Verified in SWFI records",
      "Article Details",
      "Article / Report Body",
      "Download Source Data",
    ],
  },
];

function loadPlaywright() {
  for (const root of [repoRoot, "/Users/mirror-pro/repos/SWFI2.0-final"]) {
    const marker = path.join(root, "node_modules", "playwright", "package.json");
    if (fs.existsSync(marker)) return createRequire(marker)("playwright");
  }
  return createRequire(import.meta.url)("playwright");
}

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function appUrl(pathname) {
  const value = String(pathname || "/");
  if (/^https?:\/\//i.test(value)) return value;
  if (value.startsWith("/api/")) return new URL(value, originUrl.origin).href;
  if (appBasePath && value.startsWith(`${appBasePath}/`)) return new URL(value, originUrl.origin).href;
  return new URL(value.replace(/^\//, ""), origin).href;
}

function backendUrl(pathname) {
  return `${backendOrigin}${pathname}`;
}

function sourceUrlFor(section, id) {
  if (section === "news") return `https://cms.swfi.com/?p=${encodeURIComponent(id)}`;
  return `https://www.swfi.com/v1/${section}/${encodeURIComponent(id)}`;
}

function publicSourceUrl(section, id) {
  return new URL(`${appBasePath || ""}/v1/${section}/${encodeURIComponent(id)}`, originUrl.origin).href;
}

function idFromSourceUrl(value) {
  try {
    const parsed = new URL(String(value || ""));
    const legacy = parsed.searchParams.get("p");
    if (legacy) return legacy;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const marker = parts.indexOf("v1");
    if (marker >= 0 && parts.length > marker + 2) return parts[marker + 2];
    return parts.at(-1) || "";
  } catch {
    return "";
  }
}

function idFromRow(row) {
  return String(row.id || row.entity_id || row.source_record_id || row.legacy_post || row.legacy_post_id || idFromSourceUrl(row.source_url || row.swfi_url) || "");
}

function envList(name, fallback) {
  return String(process.env[name] || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .length
    ? String(process.env[name])
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean)
    : fallback;
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
        // Try the next account/service pair.
      }
    }
  }
  return "";
}

function loadSecret(envName, serviceEnvName, defaultServices, strip = true) {
  const direct = process.env[envName] || "";
  if (direct) return strip ? direct.trim() : direct;
  const value = keychainLookup(envList(serviceEnvName, defaultServices));
  return strip ? value.trim() : value.replace(/\n$/, "");
}

async function fetchPacket(pathname) {
  const response = await fetch(backendUrl(pathname), {
    headers: {
      Accept: "application/json",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36",
    },
  });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { status: response.status, body };
}

function packetRows(packet) {
  const data = packet.body?.data || {};
  return Array.isArray(data.rows) ? data.rows : Array.isArray(data.results) ? data.results : [];
}

function packetCount(packet) {
  const data = packet.body?.data || {};
  return Number(data.count ?? data.total ?? data.source_total ?? 0);
}

async function waitForBody(page, required, timeout = Number(process.env.SWFIPN_RECORD_MIRROR_BODY_TIMEOUT_MS || 30_000)) {
  const start = Date.now();
  let body = "";
  while (Date.now() - start < timeout) {
    body = await page.locator("body").innerText().catch(() => "");
    const lower = body.toLowerCase();
    const ok = required.every((item) => lower.includes(String(item).toLowerCase()));
    if (ok && !/\bLoading\b/.test(body)) return body;
    await page.waitForTimeout(750);
  }
  return body;
}

async function loginContext(browser) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 850 } });
  const page = await context.newPage();
  const failures = [];
  try {
    await page.goto(appUrl(`/login/?next=${encodeURIComponent(`${appBasePath || "/swficc"}/`)}`), { waitUntil: "domcontentloaded", timeout: 90_000 });
    await page.locator('input[name="username"]').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await Promise.all([
      page.waitForURL(/\/swficc\/(?:$|[?#])/, { timeout: 90_000 }),
      page.locator('button[type="submit"]').click(),
    ]);
    const session = await context.request.get(appUrl("/api/session/status/v1"), { timeout: 30_000 });
    if (session.status() !== 200) failures.push(`session_status_${session.status()}`);
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  if (failures.length) {
    await context.close().catch(() => {});
    throw new Error(`authenticated_context_failed:${failures.join("|")}`);
  }
  return context;
}

async function inspectUnauthenticatedGate(browser, sourcePathUrl, expectedTarget) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const result = { ok: true, final_url: "", next: "", body_excerpt: "", failures: [] };
  try {
    await page.goto(sourcePathUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    await page.waitForURL(/\/swficc\/login\/(?:$|[?#])/, { timeout: 20_000 }).catch(() => null);
    result.final_url = page.url();
    const parsed = new URL(result.final_url);
    result.next = parsed.searchParams.get("next") || "";
    result.body_excerpt = (await page.locator("body").innerText().catch(() => "")).slice(0, 500);
    if (!/\/swficc\/login\/(?:$|[?#])/.test(parsed.pathname + parsed.search + parsed.hash)) {
      result.failures.push(`not_login_gated:${result.final_url}`);
    }
    if (!result.next.includes(expectedTarget.split("?")[0])) {
      result.failures.push(`next_not_preserved:${result.next}`);
    }
    if (!/Subscriber Sign In/i.test(result.body_excerpt)) {
      result.failures.push("login_page_not_rendered");
    }
  } catch (error) {
    result.failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = result.failures.length === 0;
  return result;
}

function swfiSigninHandoffUrl(value, expectedTarget) {
  try {
    const parsed = new URL(String(value || ""), originUrl.origin);
    if (!["www.swfi.com", "swfi.com"].includes(parsed.hostname)) return false;
    if (parsed.pathname.replace(/\/?$/, "/") !== "/v1/signin/") return false;
    const redirect = parsed.searchParams.get("redirect") || "";
    if (!redirect) return false;
    const redirectUrl = new URL(redirect, originUrl.origin);
    const expectedUrl = new URL(appUrl(expectedTarget));
    return redirectUrl.origin === originUrl.origin
      && redirectUrl.pathname === expectedUrl.pathname
      && redirectUrl.search === expectedUrl.search;
  } catch {
    return false;
  }
}

async function inspectSwfiAuthHandoffSample(browser, sourcePathUrl, expectedTarget) {
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] }, viewport: { width: 1280, height: 850 } });
  const failures = [];
  const result = { ok: true, source_status: 0, source_location: "", detail_status: 0, detail_location: "", failures };
  try {
    const first = await context.request.get(sourcePathUrl, { maxRedirects: 0, timeout: 45_000 });
    result.source_status = first.status();
    result.source_location = first.headers().location || "";
    if (![302, 303, 307, 308].includes(first.status())) failures.push(`source_not_redirect:${first.status()}`);
    if (swfiSigninHandoffUrl(result.source_location, expectedTarget)) {
      return { ...result, ok: failures.length === 0 };
    }
    const expected = new URL(appUrl(expectedTarget));
    const detailUrl = new URL(result.source_location || sourcePathUrl, originUrl.origin);
    if (detailUrl.origin !== originUrl.origin || detailUrl.pathname !== expected.pathname) {
      failures.push(`wrong_internal_bridge:${result.source_location || "missing"}`);
      return { ...result, ok: false };
    }
    const second = await context.request.get(detailUrl.href, { maxRedirects: 0, timeout: 45_000 });
    result.detail_status = second.status();
    result.detail_location = second.headers().location || "";
    if (![302, 303, 307, 308].includes(second.status())) failures.push(`detail_not_redirect:${second.status()}`);
    if (!swfiSigninHandoffUrl(result.detail_location, expectedTarget)) failures.push(`detail_not_swfi_signin:${result.detail_location || "missing"}`);
  } catch (error) {
    failures.push(error.message);
  } finally {
    await context.close().catch(() => {});
  }
  result.ok = failures.length === 0;
  return result;
}

async function inspectAuthenticatedSample(context, item, row, id, sourceUrl, sourcePathUrl, expectedTarget) {
  const page = await context.newPage();
  const failures = [];
  const result = { ok: true, final_url: "", failures };
  try {
    const response = await page.goto(sourcePathUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) failures.push(`http_${response?.status() || "missing"}`);
    await page.waitForURL(new RegExp(`${expectedTarget.split("?")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), { timeout: 30_000 }).catch(() => null);
    result.final_url = page.url();
    if (!result.final_url.includes(expectedTarget.split("?")[0])) failures.push(`wrong_internal_route:${result.final_url}`);
    const required = item.required(row);
    const body = await waitForBody(page, required);
    for (const text of required) {
      if (!body.toLowerCase().includes(String(text).toLowerCase())) failures.push(`missing:${text}`);
    }
    if (/Subscriber Sign In/i.test(body)) failures.push("authenticated_detail_returned_login");
    if (/Source gap/i.test(body) && !/Source-backed fact/i.test(body)) failures.push("source_gap_detail");
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = failures.length === 0;
  return result;
}

async function inspectSelfContainedSample(browser, item, row, sourcePathUrl, expectedTarget) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 850 } });
  const failures = [];
  const result = { ok: true, final_url: "", failures };
  try {
    const response = await page.goto(sourcePathUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
    if (!response || response.status() >= 400) failures.push(`http_${response?.status() || "missing"}`);
    await page.waitForURL(new RegExp(`${expectedTarget.split("?")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`), { timeout: 30_000 }).catch(() => null);
    result.final_url = page.url();
    if (!result.final_url.includes(expectedTarget.split("?")[0])) failures.push(`wrong_internal_route:${result.final_url}`);
    if (/www\.swfi\.com\/v1\//i.test(result.final_url)) failures.push(`escaped_to_swfi:${result.final_url}`);
    const required = item.required(row).filter(Boolean);
    const body = await waitForBody(page, required);
    for (const text of required) {
      if (!body.toLowerCase().includes(String(text).toLowerCase())) failures.push(`missing:${text}`);
    }
    if (/Subscriber Sign In/i.test(body)) failures.push("self_contained_detail_returned_login");
    if (/No internal record mapping|citation-only/i.test(body)) failures.push("placeholder_detail");
  } catch (error) {
    failures.push(error.message);
  } finally {
    await page.close().catch(() => {});
  }
  result.ok = failures.length === 0;
  return result;
}

async function inspectSample(browser, authContext, item, row) {
  const id = idFromRow(row);
  const sourceUrl = item.sourceUrl
    ? item.sourceUrl(row, id)
    : String(row.source_url || row.swfi_url || sourceUrlFor(item.sourceSection, id));
  const expectedTarget = item.targetPath(id, sourceUrl, row);
  const sourcePath = item.sourcePath ? item.sourcePath(id, sourceUrl, row) : publicSourceUrl(item.sourceSection, id);
  const sourcePathUrl = /^https?:\/\//i.test(sourcePath) ? sourcePath : appUrl(sourcePath);
  const failures = [];
  const result = {
    id,
    label: row.name || row.title || "",
    source_url: sourceUrl,
    public_source_url: sourcePathUrl,
    expected_target: appUrl(expectedTarget),
    unauthenticated: null,
    authenticated: null,
    final_url: "",
    ok: true,
    failures,
  };
  try {
    if (validateLegacyAuth) {
      result.unauthenticated = await inspectUnauthenticatedGate(browser, sourcePathUrl, expectedTarget);
      if (!result.unauthenticated.ok) failures.push(...result.unauthenticated.failures.map((failure) => `unauth:${failure}`));
      if (!authContext) {
        failures.push("auth_credentials_missing_for_protected_detail_validation");
      } else {
        result.authenticated = await inspectAuthenticatedSample(authContext, item, row, id, sourceUrl, sourcePathUrl, expectedTarget);
        result.final_url = result.authenticated.final_url;
        if (!result.authenticated.ok) failures.push(...result.authenticated.failures.map((failure) => `auth:${failure}`));
      }
    } else {
      if (item.publicDetail || authMode === "self-contained") {
        result.self_contained = await inspectSelfContainedSample(browser, item, row, sourcePathUrl, expectedTarget);
        result.final_url = result.self_contained.final_url;
        if (!result.self_contained.ok) failures.push(...result.self_contained.failures.map((failure) => `self-contained:${failure}`));
      } else {
        result.swfi_auth_handoff = await inspectSwfiAuthHandoffSample(browser, sourcePathUrl, expectedTarget);
        result.final_url = result.swfi_auth_handoff.detail_location || result.swfi_auth_handoff.source_location;
        if (!result.swfi_auth_handoff.ok) failures.push(...result.swfi_auth_handoff.failures.map((failure) => `swfi-auth-handoff:${failure}`));
      }
    }
  } catch (error) {
    failures.push(error.message);
  }
  result.ok = failures.length === 0;
  return result;
}

async function enumerateClass(item, count) {
  const outputPath = path.join(outputDir, `swfipn-record-mirror-${item.id}-latest.ndjson`);
  if (!enumerateAll) return { enabled: false, output: outputPath, rows_written: 0 };
  const stream = fs.createWriteStream(outputPath);
  let rowsWritten = 0;
  let pages = 0;
  const effectivePageLimit = Math.max(1, Math.min(enumeratePageLimit, 1000));
  const writeRows = (packet) => {
    for (const row of packetRows(packet)) {
      const id = String(row.id || row.entity_id || row.source_record_id || "");
      const resolvedId = id || idFromRow(row);
      if (!resolvedId) continue;
      const sourceUrl = item.sourceUrl
        ? item.sourceUrl(row, resolvedId)
        : String(row.source_url || row.swfi_url || sourceUrlFor(item.sourceSection, resolvedId));
      stream.write(`${JSON.stringify({
        class: item.id,
        id: resolvedId,
        label: row.name || row.title || "",
        source_url: sourceUrl,
        public_source_url: item.sourcePath
          ? appUrl(item.sourcePath(resolvedId, sourceUrl, row))
          : publicSourceUrl(item.sourceSection, resolvedId),
        internal_url: appUrl(item.targetPath(resolvedId, sourceUrl, row)),
      })}\n`);
      rowsWritten += 1;
    }
  };
  let after = "";
  let sourceTotal = 0;
  while (true) {
    pages += 1;
    const packet = item.scanEndpoint
      ? await fetchPacket(item.scanEndpoint(effectivePageLimit, after))
      : await fetchPacket(item.endpoint(effectivePageLimit, pages));
    const data = packet.body?.data || {};
    sourceTotal = Number(data.source_total ?? sourceTotal ?? 0);
    writeRows(packet);
    if (packet.status >= 400 || packet.body?.status !== "ok") {
      await new Promise((resolve) => stream.end(resolve));
      return {
        enabled: true,
        output: outputPath,
        cursor_mode: Boolean(item.scanEndpoint),
        requested_page_limit: enumeratePageLimit,
        effective_page_limit: effectivePageLimit,
        source_total: sourceTotal,
        pages,
        rows_written: rowsWritten,
        failure: `scan_packet_failed:${packet.status}:${packet.body?.status || "missing"}`,
      };
    }
    if (!item.scanEndpoint) break;
    after = String(data.next_after || "");
    if (!data.has_more || !after) break;
  }
  await new Promise((resolve) => stream.end(resolve));
  return {
    enabled: true,
    output: outputPath,
    cursor_mode: Boolean(item.scanEndpoint),
    expected_count: count,
    requested_page_limit: enumeratePageLimit,
    effective_page_limit: effectivePageLimit,
    source_total: sourceTotal,
    pages,
    rows_written: rowsWritten,
  };
}

async function run() {
  fs.mkdirSync(outputDir, { recursive: true });
  const { chromium } = loadPlaywright();
  const browser = await chromium.launch({ headless: true });
  let authContext = null;
  const receipt = {
    schema_version: "swfipn.record_mirror_gate.v1",
    generated_at: new Date().toISOString(),
    origin,
    backend_origin: backendOrigin,
    auth_mode: authMode,
    authenticated_detail_validation: validateLegacyAuth && Boolean(username && password),
    status: "pass",
    total_mirrorable_records: 0,
    enumerate_all: enumerateAll,
    classes: [],
    failures: [],
  };
  try {
    if (username && password) {
      authContext = await loginContext(browser);
    }
    for (const item of classes) {
      const packet = await fetchPacket(item.endpoint(Math.max(sampleLimit, 1), 1));
      const rows = packetRows(packet);
      const count = packetCount(packet);
      const classResult = {
        id: item.id,
        endpoint: item.endpoint(Math.max(sampleLimit, 1), 1),
        status: packet.body?.status || "unknown",
        count,
        rows_sampled: Math.min(sampleLimit, rows.length),
        samples: [],
        enumeration: { enabled: false, output: "", rows_written: 0 },
        ok: true,
        failures: [],
      };
      receipt.total_mirrorable_records += count;
      if (packet.status >= 400) classResult.failures.push(`backend_http_${packet.status}`);
      if (packet.body?.status !== "ok") classResult.failures.push(`backend_status_${packet.body?.status || "missing"}`);
      if (!count) classResult.failures.push("zero_count");
      for (const row of rows.slice(0, sampleLimit)) {
        const sample = await inspectSample(browser, authContext, item, row);
        classResult.samples.push(sample);
        if (!sample.ok) classResult.failures.push(`sample_failed:${sample.id}`);
      }
      classResult.enumeration = await enumerateClass(item, count);
      if (classResult.enumeration.failure) {
        classResult.failures.push(classResult.enumeration.failure);
      }
      if (classResult.enumeration.enabled && classResult.enumeration.rows_written !== count) {
        classResult.failures.push(`enumeration_count_mismatch:${classResult.enumeration.rows_written}:${count}`);
      }
      if (classResult.enumeration.enabled && classResult.enumeration.source_total && classResult.enumeration.source_total !== count) {
        classResult.failures.push(`enumeration_source_total_mismatch:${classResult.enumeration.source_total}:${count}`);
      }
      classResult.ok = classResult.failures.length === 0;
      if (!classResult.ok) {
        receipt.status = "fail";
        receipt.failures.push({ id: item.id, failures: classResult.failures });
      }
      receipt.classes.push(classResult);
    }
  } finally {
    if (authContext) await authContext.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  fs.writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    total_mirrorable_records: receipt.total_mirrorable_records,
    classes: receipt.classes.map((item) => ({ id: item.id, count: item.count, ok: item.ok, rows_sampled: item.rows_sampled })),
    receipt: receiptPath,
  }, null, 2));
  if (receipt.status !== "pass") process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(outputDir, { recursive: true });
  fs.writeFileSync(receiptPath, `${JSON.stringify({ status: "fail", error: error.message, generated_at: new Date().toISOString() }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
