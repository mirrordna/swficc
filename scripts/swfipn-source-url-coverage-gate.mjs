#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const ORIGIN = normalizeOrigin(process.env.SWFIPN_ORIGIN || "https://swfipn.activemirror.ai/swficc/");
const BACKEND_ORIGIN = (process.env.SWFIPN_BACKEND_ORIGIN || new URL(ORIGIN).origin).replace(/\/$/, "");
const SAMPLE_LIMIT = clampInt(process.env.SWFIPN_SOURCE_URL_SAMPLE_LIMIT, 5, 1, 25);
const OUT_DIR = path.resolve("output");
const RECEIPT = path.join(OUT_DIR, "swfipn-source-url-coverage-latest.json");
const LEDGER_PATH = path.resolve("docs/swfipn-route-ledger.json");

const publicPages = [
  { source: "https://www.swfi.com/about-us/overview", route: "/about-us/overview/", required_route_ids: ["about", "about_overview"] },
  { source: "https://www.swfi.com/about-us/our-team", route: "/about-us/our-team/", required_route_ids: ["our_team"] },
  { source: "https://www.swfi.com/solutions", route: "/solutions/", required_route_ids: ["solutions"] },
  { source: "https://www.swfi.com/demo", route: "/demo/", required_route_ids: ["demo"] },
  { source: "https://www.swfi.com/contact-us", route: "/contact/", required_route_ids: ["contact"] },
  { source: "https://www.swfi.com/newsletter-subscription", route: "/newsletter-subscription/", required_route_ids: ["newsletter_subscription"] },
  { source: "https://www.swfi.com/privacy-policy", route: "/privacy-policy/", required_route_ids: ["privacy_policy"] },
  { source: "https://www.swfi.com/terms-of-use", route: "/terms-of-use/", required_route_ids: ["terms_of_use"] },
  { source: "https://www.swfi.com/cookie-policy", route: "/cookie-policy/", required_route_ids: ["cookie_policy"] },
  { source: "https://www.swfi.com/accessibility", route: "/accessibility/", required_route_ids: ["accessibility_statement"] },
];

const sourceFamilies = [
  {
    id: "entities",
    endpoint: "/api/source-data/search/v1?collection=entities",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/entities\/[a-f0-9]{24}$/i,
    expectedRoutePrefix: "/profiles/detail/",
    routeId: "profile_detail",
    sourceKeys: ["source_url", "swfi_url"],
    totalKey: "count",
  },
  {
    id: "people",
    endpoint: "/api/source-data/search/v1?collection=people",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/people\/[a-f0-9]{24}$/i,
    expectedRoutePrefix: "/people/detail/",
    routeId: "person_detail",
    sourceKeys: ["source_url", "swfi_url"],
    totalKey: "count",
  },
  {
    id: "compass",
    endpoint: "/api/source-data/search/v1?collection=compass",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/compass\/[a-f0-9]{24}$/i,
    expectedRoutePrefix: "/mandates/detail/",
    routeId: "mandate_detail",
    sourceKeys: ["source_url", "swfi_url"],
    totalKey: "count",
  },
  {
    id: "transactions",
    endpoint: "/api/transactions/v1",
    sourcePattern: /^https:\/\/www\.swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i,
    expectedRoutePrefix: "/transactions/detail/",
    routeId: "transaction_detail",
    sourceKeys: ["source_url", "swfi_url"],
    totalKey: "source_total",
  },
  {
    id: "news",
    endpoint: "/api/source-intelligence/news/v1",
    sourcePattern: /^legacy:\d+$/i,
    expectedRoutePrefix: "/research/detail/",
    routeId: "research_detail",
    sourceKeys: ["legacy_post", "legacy_post_id", "post_id", "wordpress_id", "source_url", "url"],
    totalKey: "count",
    countIsWindowOnly: true,
  },
];

function normalizeOrigin(value) {
  return value.endsWith("/") ? value : `${value}/`;
}

function clampInt(value, fallback, low, high) {
  const n = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(low, Math.min(high, n));
}

function ledger() {
  return JSON.parse(fs.readFileSync(LEDGER_PATH, "utf8"));
}

function routeSetFromLedger(data) {
  return new Set((data.routes || []).filter((route) => route.status === "live").map((route) => route.path));
}

function routeIdSetFromLedger(data) {
  return new Set((data.routes || []).filter((route) => route.status === "live").map((route) => route.id));
}

function appHref(route) {
  const clean = route.startsWith("/") ? route.slice(1) : route;
  return new URL(clean, ORIGIN).toString();
}

async function fetchJson(pathname) {
  const join = pathname.includes("?") ? "&" : "?";
  const url = `${BACKEND_ORIGIN}${pathname}${join}limit=${SAMPLE_LIMIT}&page=1`;
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  const text = await response.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text.slice(0, 500) };
  }
  return { url, status: response.status, body };
}

function rowsFromPacket(packet) {
  const data = packet?.body?.data || {};
  return Array.isArray(data.rows) ? data.rows : Array.isArray(data.results) ? data.results : [];
}

function totalFromPacket(packet, family) {
  const data = packet?.body?.data || {};
  return Number(data[family.totalKey] ?? data.count ?? data.source_total ?? 0) || 0;
}

function firstSourceUrl(row, family) {
  for (const key of family.sourceKeys) {
    const value = String(row?.[key] || "").trim();
    if (family.id === "news" && /^\d+$/.test(value)) return `legacy:${value}`;
    if (/^https?:\/\//i.test(value)) return normalizeSourceUrl(value);
  }
  return "";
}

function normalizeSourceUrl(value) {
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "cms.swfi.com") return parsed.toString();
    if (parsed.hostname.endsWith("swfi.com")) return parsed.toString();
  } catch {
    return value;
  }
  return value;
}

function sourceRecordId(sourceUrl) {
  if (/^legacy:\d+$/i.test(sourceUrl)) return sourceUrl.replace(/^legacy:/i, "");
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.searchParams.get("p")) return parsed.searchParams.get("p") || "";
    return parsed.pathname.split("/").filter(Boolean).at(-1) || "";
  } catch {
    return "";
  }
}

function mapSourceUrl(sourceUrl, row = {}) {
  const id = sourceRecordId(sourceUrl);
  const source = sourceUrl || "";
  if (/^legacy:\d+$/i.test(sourceUrl)) {
    const title = String(row.title || row.name || "").trim();
    const params = new URLSearchParams({ legacy: id });
    if (title) params.set("title", title);
    return `/research/detail/?${params.toString()}`;
  }
  try {
    const parsed = new URL(sourceUrl);
    const legacy = parsed.searchParams.get("p");
    if (legacy) {
      return `/research/detail/?${new URLSearchParams({ legacy, source }).toString()}`;
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1 = parts.indexOf("v1");
    const section = v1 >= 0 ? parts[v1 + 1] : parts[0];
    if (section === "entities" && id) {
      const params = new URLSearchParams({ id, source });
      const name = String(row.name || row.institution || "").trim();
      const slug = String(row.slug || row.profile_slug || "").trim();
      if (name) params.set("name", name);
      if (slug) params.set("slug", slug);
      return `/profiles/detail/?${params.toString()}`;
    }
    if (section === "transactions" && id) {
      const params = new URLSearchParams({ id, source });
      const title = String(row.title || row.name || "").trim();
      if (title) params.set("title", title);
      return `/transactions/detail/?${params.toString()}`;
    }
    if (section === "compass" && id) {
      const params = new URLSearchParams({ id, source });
      const title = String(row.title || row.name || "").trim();
      if (title) params.set("title", title);
      return `/mandates/detail/?${params.toString()}`;
    }
    if (section === "people" && id) {
      const params = new URLSearchParams({ id, source });
      const name = String(row.name || row.title || "").trim();
      if (name) params.set("name", name);
      return `/people/detail/?${params.toString()}`;
    }
  } catch {
    return "";
  }
  return "";
}

async function publicSitemapProbe() {
  const probes = [];
  for (const url of ["https://www.swfi.com/robots.txt", "https://www.swfi.com/sitemap.xml", "https://www.swfi.com/sitemap_index.xml"]) {
    const response = await fetch(url).catch((error) => ({ status: 0, text: async () => error.message }));
    const body = await response.text();
    probes.push({
      url,
      status: response.status,
      bytes: body.length,
      hasXmlUrls: /<urlset|<sitemapindex|<loc>/i.test(body),
      appShell: /<div id="root"><\/div>|<title>Sovereign Wealth Fund Institute<\/title>/i.test(body),
    });
  }
  return probes;
}

async function inspectFamily(family, liveRouteIds) {
  const packet = await fetchJson(family.endpoint);
  const rows = rowsFromPacket(packet);
  const total = totalFromPacket(packet, family);
  const samples = rows.slice(0, SAMPLE_LIMIT).map((row, index) => {
    const sourceUrl = firstSourceUrl(row, family);
    const mappedRoute = mapSourceUrl(sourceUrl, row);
    const internalUrl = mappedRoute ? appHref(mappedRoute) : "";
    const failures = [];
    if (!sourceUrl) failures.push("missing_source_url");
    if (sourceUrl && !family.sourcePattern.test(sourceUrl)) failures.push(`source_pattern_mismatch:${sourceUrl}`);
    if (!mappedRoute.startsWith(family.expectedRoutePrefix)) failures.push(`wrong_mapped_route:${mappedRoute || "missing"}`);
    if (!internalUrl) failures.push("missing_internal_url");
    return {
      index,
      source_url: sourceUrl,
      source_record_id: sourceRecordId(sourceUrl),
      mapped_route: mappedRoute,
      internal_url: internalUrl,
      label: row.title || row.name || row.institution || "",
      ok: failures.length === 0,
      failures,
    };
  });
  const failures = [];
  if (packet.status !== 200 || packet.body?.status !== "ok") failures.push(`endpoint_not_ok:${packet.status}:${packet.body?.status || "missing"}`);
  if (total < 1) failures.push("zero_backend_count");
  if (!rows.length) failures.push("no_sample_rows");
  if (!liveRouteIds.has(family.routeId)) failures.push(`route_ledger_missing_template:${family.routeId}`);
  for (const sample of samples) {
    failures.push(...sample.failures.map((failure) => `sample_${sample.index}:${failure}`));
  }
  return {
    id: family.id,
    endpoint: packet.url,
    status: failures.length ? "fail" : "pass",
    backend_count: total,
    count_semantics: family.countIsWindowOnly ? "window_sample_count_not_total" : "collection_total",
    route_template_id: family.routeId,
    expected_route_prefix: family.expectedRoutePrefix,
    samples,
    failures,
  };
}

async function run() {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const ledgerData = ledger();
  const liveRoutes = routeSetFromLedger(ledgerData);
  const liveRouteIds = routeIdSetFromLedger(ledgerData);
  const failures = [];

  const publicPageResults = publicPages.map((page) => {
    const missingRouteIds = page.required_route_ids.filter((id) => !liveRouteIds.has(id));
    const routeVisible = liveRoutes.has(page.route);
    const resultFailures = [
      ...missingRouteIds.map((id) => `missing_route_id:${id}`),
      ...(routeVisible ? [] : [`missing_route_path:${page.route}`]),
    ];
    return { ...page, app_url: appHref(page.route), ok: resultFailures.length === 0, failures: resultFailures };
  });
  for (const page of publicPageResults) {
    failures.push(...page.failures.map((failure) => ({ id: `public_page:${page.source}`, failure })));
  }

  const families = [];
  for (const family of sourceFamilies) {
    families.push(await inspectFamily(family, liveRouteIds));
  }
  for (const family of families) {
    failures.push(...family.failures.map((failure) => ({ id: `family:${family.id}`, failure })));
  }

  const sitemap_probe = await publicSitemapProbe();
  const publicSitemapAvailable = sitemap_probe.some((probe) => probe.hasXmlUrls && !probe.appShell);

  const receipt = {
    schema_version: "swfipn.source_url_coverage.v1",
    generated_at: new Date().toISOString(),
    origin: ORIGIN,
    backend_origin: BACKEND_ORIGIN,
    status: failures.length ? "fail" : "pass",
    public_sitemap_available: publicSitemapAvailable,
    public_sitemap_probe: sitemap_probe,
    coverage_strategy: publicSitemapAvailable
      ? "public_sitemap_plus_backend_records"
      : "backend_record_url_families_public_sitemap_unavailable",
    public_pages: publicPageResults,
    families,
    totals: Object.fromEntries(families.map((family) => [family.id, family.backend_count])),
    failures,
  };
  fs.writeFileSync(RECEIPT, `${JSON.stringify(receipt, null, 2)}\n`);
  console.log(JSON.stringify({
    status: receipt.status,
    strategy: receipt.coverage_strategy,
    totals: receipt.totals,
    failures,
    receipt: RECEIPT,
  }, null, 2));
  if (failures.length) process.exit(1);
}

run().catch((error) => {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(RECEIPT, `${JSON.stringify({ status: "fail", generated_at: new Date().toISOString(), error: error.message }, null, 2)}\n`);
  console.error(error);
  process.exit(1);
});
