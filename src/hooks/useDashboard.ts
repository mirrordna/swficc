"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardPayload, Dashboard2Payload } from "@/lib/types";
import { appHref } from "@/lib/selfContainedLinks";

const BACKEND = (process.env.NEXT_PUBLIC_SWFI_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

const UNKNOWN = "Not disclosed by SWFI.com";

type JsonRecord = Record<string, unknown>;

function sourceValue(value: unknown): string {
  if (value == null || value === "") return UNKNOWN;
  if (typeof value === "number") return value.toLocaleString("en-US");
  return String(value);
}

function sourceCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function sourceText(value: unknown, fallback = UNKNOWN): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

function sourceUrl(value: unknown, fallback: string): string {
  const raw = sourceText(value, fallback);
  try {
    const parsed = new URL(raw);
    if (parsed.hostname === "cms.swfi.com") {
      parsed.hostname = "www.swfi.com";
      return parsed.toString();
    }
  } catch {
    return raw;
  }
  return raw;
}

function moneyText(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value;
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount)) return UNKNOWN;
  const abs = Math.abs(amount);
  if (abs >= 1_000_000_000_000) return `$${trimNumber(amount / 1_000_000_000_000)}T`;
  if (abs >= 1_000_000_000) return `$${trimNumber(amount / 1_000_000_000)}B`;
  if (abs >= 1_000_000) return `$${trimNumber(amount / 1_000_000)}M`;
  return `$${amount.toLocaleString("en-US")}`;
}

function trimNumber(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}

function rowsFrom(packet: unknown, keys = ["rows", "results", "items", "entities", "data"]): Record<string, unknown>[] {
  if (!packet || typeof packet !== "object") return [];
  if (Array.isArray(packet)) return packet as Record<string, unknown>[];
  const object = packet as Record<string, unknown>;
  for (const key of keys) {
    const value = object[key];
    if (Array.isArray(value)) return value as Record<string, unknown>[];
    if (value && typeof value === "object") {
      const nested = rowsFrom(value, ["rows", "results", "items", "entities"]);
      if (nested.length) return nested;
    }
  }
  return [];
}

function recordFrom(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function packetData(packet: unknown): JsonRecord {
  const object = recordFrom(packet);
  return recordFrom(object.data);
}

function packetRows(packet: unknown, keys?: string[]): JsonRecord[] {
  return rowsFrom(packetData(packet), keys);
}

function isFactPacket(packet: Record<string, unknown>): boolean {
  const status = String(packet?.status || "").toLowerCase();
  return status === "ok" && packet.fact === true;
}

function profileHref(slug: unknown, fallback: unknown = ""): string {
  const clean = sourceText(slug, "").replace(/^\/+/, "");
  const raw = sourceText(fallback, "");
  if (clean) return appHref(`/profiles/?record=${encodeURIComponent(clean)}`);
  return raw ? appHref("/profiles/") : appHref("/profiles/");
}

function transactionHref(id: unknown): string {
  const clean = sourceText(id, "");
  return clean ? appHref(`/transactions/?record=${encodeURIComponent(clean)}`) : appHref("/transactions/");
}

/** Build a dashboard2-compatible payload from SWFI/RIDE database contracts only. */
async function buildFromPublicAPIs(): Promise<DashboardPayload> {
  const backendPrefix = () => {
    if (!BACKEND || BACKEND === "same-origin") return "";
    try {
      const parsed = new URL(BACKEND);
      const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
      if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocal)) return parsed.origin;
    } catch {
      return "";
    }
    return "";
  };

  const fetchJson = async (path: string, timeoutMs = 25_000) => {
    const prefix = backendPrefix();
    const candidates = prefix ? [`${prefix}${path}`, path] : [path];
    for (const candidate of candidates) {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
      try {
        const sameOrigin = candidate.startsWith("/");
        const res = await fetch(candidate, {
          ...(sameOrigin ? { credentials: "include" as RequestCredentials } : {}),
          signal: controller.signal,
        });
        if (res.ok) return res.json();
      } catch { /* try the next configured source */ }
      finally {
        window.clearTimeout(timeout);
      }
    }
    return {};
  };

  const [
    dashboardMetrics,
    topSwfs,
    sectorFlows,
    allocatorActivity,
    liveRfps,
    recentTransactions,
    coInvestments,
    investorFit,
    ticketSize,
    news,
  ] = await Promise.all([
    fetchJson("/api/swfi/dashboard-metrics/v1", 30_000).catch(() => ({})),
    fetchJson("/v1/swfi/top20?limit=20", 30_000).catch(() => ({})),
    fetchJson("/api/sector-flows/v1?days=90", 30_000).catch(() => ({})),
    fetchJson("/api/allocator-activity/v1?days=90&limit=8", 30_000).catch(() => ({})),
    fetchJson("/api/live-rfps/v1?limit=8", 30_000).catch(() => ({})),
    fetchJson("/api/recent-transactions/v1?days=90&limit=8", 30_000).catch(() => ({})),
    fetchJson("/api/co-investments/v1?days=90&limit=8", 30_000).catch(() => ({})),
    fetchJson("/api/deal-intelligence/investor-fit/v1?q=infrastructure&days=365&limit=8", 30_000).catch(() => ({})),
    fetchJson("/api/deal-intelligence/ticket-size/v1?q=infrastructure&days=365&limit=4", 30_000).catch(() => ({})),
    fetchJson("/api/source-intelligence/news/v1?limit=6", 20_000).catch(() => ({})),
  ]);

  const topSwfRows = isFactPacket(topSwfs as JsonRecord) ? packetRows(topSwfs) : [];
  const allocatorRows = isFactPacket(allocatorActivity as JsonRecord) ? packetRows(allocatorActivity) : [];
  const rfpRows = isFactPacket(liveRfps as JsonRecord) ? packetRows(liveRfps) : [];
  const transactionRows = isFactPacket(recentTransactions as JsonRecord) ? packetRows(recentTransactions) : [];
  const coRows = isFactPacket(coInvestments as JsonRecord) ? packetRows(coInvestments) : [];
  const fitRows = isFactPacket(investorFit as JsonRecord) ? packetRows(investorFit) : [];
  const ticketRows = isFactPacket(ticketSize as JsonRecord) ? packetRows(ticketSize, ["ranges", "rows"]) : [];
  const newsRows = isFactPacket(news as JsonRecord) ? packetRows(news) : [];
  const sectorData = packetData(sectorFlows);
  const facets = recordFrom(sectorData.facets);
  const sectorFacets = isFactPacket(sectorFlows as JsonRecord) && Array.isArray(facets.sectors) ? facets.sectors as JsonRecord[] : [];

  const aumRows = topSwfRows.map((p: JsonRecord, i: number) => ({
    name: sourceText(p.name || p.title, "Institution"),
    slug: sourceText(p.slug, ""),
    type: sourceText(p.type, "Institution"),
    country: sourceText(p.country || p.region),
    aum: moneyText(p.aum || p.assets || p.metric),
    strategy: sourceText(p.strategy || p.top_strategy),
    profile_url: profileHref(p.slug, p.profile_url),
    metric: moneyText(p.aum || p.assets || p.metric),
    note: p.aum_date ? `AUM date ${sourceText(p.aum_date)}` : sourceText(p.note || p.strategy, ""),
    rank: Number(p.rank || i + 1),
    basis: "SWFI.com AUM ranking",
    status: "fact",
  }));

  const metricData = packetData(dashboardMetrics);
  const metricCards = recordFrom(metricData.cards);
  const metricValue = (key: string, fallback: unknown = null) => recordFrom(metricCards[key]).value ?? fallback;
  const metricNote = (key: string, fallback: string) => sourceText(recordFrom(metricCards[key]).basis || recordFrom(metricCards[key]).sub, fallback);

  const profilePackets = await Promise.all(
    aumRows.slice(0, 6)
      .filter((row) => row.slug)
      .map((row) => fetchJson(`/api/profiles/${encodeURIComponent(row.slug)}/v1`, 12_000).catch(() => ({}))),
  );
  const profilesBySlug = new Map<string, JsonRecord>();
  profilePackets.forEach((packet) => {
    if (!isFactPacket(packet as JsonRecord)) return;
    const profile = recordFrom(packetData(packet).profile);
    const slug = sourceText(profile.slug, "");
    if (slug) profilesBySlug.set(slug, profile);
  });

  const performanceEntities = aumRows.slice(0, 6).map((p) => {
    const profile = profilesBySlug.get(p.slug) || {};
    const historical = recordFrom(profile.historical_aum);
    const points = rowsFrom(historical.points).map((point) => ({
      label: sourceText(point.label || point.period || point.date, ""),
      assets: sourceCount(point.assets || point.amount_usd),
      assets_display: moneyText(point.assets_display || point.assets || point.amount_usd),
    })).filter((point) => point.label && point.assets > 0);
    const growthRows = rowsFrom(historical.growth_points);
    const latestGrowth = growthRows[growthRows.length - 1];
    return {
      slug: p.slug, name: p.name, type: p.type,
      points,
      profile_url: p.profile_url,
      chart_label: "Historical AUM",
      peer_group: p.type,
      peer_percentile: "",
      benchmark: points.length ? "SWFI.com historical AUM source rows" : "Not disclosed by SWFI.com",
      growth_display: latestGrowth?.growth_percent == null ? UNKNOWN : `${sourceText(latestGrowth.growth_percent)}%`,
      cagr_display: UNKNOWN,
      first_label: points[0]?.label || "",
      latest_label: points[points.length - 1]?.label || "",
      latest_assets_display: points[points.length - 1]?.assets_display || p.aum,
    };
  });

  const trendRows = sectorFacets.slice(0, 6).map((row) => {
    const sector = sourceText(row.name || row.value, "Sector");
    const count = sourceCount(row.count);
    return {
      sector,
      capital_deployed: moneyText(row.capital_display || row.capital || row.capital_deployed),
      growth: UNKNOWN,
      active_investors: count,
      active_investors_display: count ? `${count.toLocaleString("en-US")} transaction rows` : UNKNOWN,
      href: appHref(`/search/?q=${encodeURIComponent(sector)}`),
      note: "Derived from approved SWFI transaction sector facets. Growth is not disclosed by SWFI.com.",
    };
  });

  const requestedSectors = ["AI", "Infrastructure", "Private Credit", "Real Estate", "Emerging sectors"];

  const quickInsights = [
    {
      title: "Top Active Allocators (Last 90 Days)",
      note: "SWFI transaction buyerEntities in the last 90 days.",
      items: allocatorRows.slice(0, 8).map((row) => ({
        name: sourceText(row.name || row.investor, "Institution"),
        metric: row.deal_count == null ? UNKNOWN : `${sourceText(row.deal_count)} deals`,
        sector: sourceText(row.entity_type || row.type, "Not disclosed by SWFI.com"),
        region: sourceText(row.region),
        profile_url: profileHref(row.slug),
        status: "fact",
      })),
      href: appHref("/profiles/"),
    },
    {
      title: "Recently Fundraising Institutions",
      note: "Open SWFI Compass RFP rows.",
      items: rfpRows.slice(0, 6).map((row) => ({
        title: sourceText(row.title || row.name, "RFP"),
        name: sourceText(row.institution || row.entity, "Institution"),
        metric: sourceText(row.amount_display || row.deadline || row.due_at),
        strategy: sourceText(row.strategy || row.asset_class_or_strategy || row.type),
        href: appHref("/mandates/"),
        source_url: sourceText(row.swfi_url || row.source_url || row.attachment_url, ""),
        status: "fact",
      })),
      href: appHref("/mandates/"),
    },
    {
      title: "Market Activity",
      note: "SWFI transaction sector facets.",
      items: trendRows.map((row) => ({
        title: row.sector,
        metric: row.capital_deployed,
        note: row.active_investors_display,
        href: row.href,
        status: "fact",
      })),
      href: appHref("/transactions/"),
    },
    {
      title: "News",
      note: "SWFI source intelligence news rows.",
      items: newsRows.slice(0, 6).map((row) => ({
        title: sourceText(row.title || row.name, "News"),
        note: sourceText(row.published_at || row.date || row.source, ""),
        href: appHref("/research/"),
        source_url: sourceUrl(row.url || row.source_url, ""),
        status: "fact",
      })),
      href: appHref("/research/"),
    },
  ];

  const totalCoInvestDeals = sourceCount(recordFrom(packetData(coInvestments).kpis).total_co_invest_deals);
  const avgDealSize = recordFrom(packetData(coInvestments).kpis).avg_deal_size;
  const activeCoInvestors = sourceCount(recordFrom(packetData(coInvestments).kpis).active_investors);

  const dashboard2: Dashboard2Payload = {
    schema_version: "swfi.dashboard2.v1.backend-wired",
    generated_at: new Date().toISOString(),
    snapshot_kpis: [
      { label: "Total Institutions Tracked", value: sourceValue(metricValue("institutions")), note: metricValue("institutions") == null ? "Not disclosed by SWFI.com" : metricNote("institutions", "SWFI.com entity count"), href: appHref("/profiles/") },
      { label: "Active Allocators (last 90 days)", value: sourceValue(metricValue("allocators")), note: metricValue("allocators") == null ? "Not disclosed by SWFI.com" : metricNote("allocators", "Assets or managed assets updated in last 90 days"), href: appHref("/profiles/") },
      { label: "Live RFPs / Mandates", value: sourceValue(metricValue("rfps", packetData(liveRfps).count)), note: metricValue("rfps", packetData(liveRfps).count) == null ? "Not disclosed by SWFI.com" : metricNote("rfps", "Open Compass rows"), href: appHref("/mandates/") },
      { label: "Recent Transactions", value: sourceValue(metricValue("transactions", packetData(recentTransactions).count)), note: metricValue("transactions", packetData(recentTransactions).count) == null ? "Not disclosed by SWFI.com" : metricNote("transactions", "SWFI transaction rows in selected window"), href: appHref("/transactions/") },
    ],
    smart_search: {
      placeholder: "Search: Institution, Person, Strategy...",
      action: appHref("/search/"),
      suggestions: [
        { label: "Top SWFs investing in Real Estate", query: "Top SWFs investing in Real Estate" },
      ],
    },
    quick_insights: quickInsights,
    historical_performance: {
      title: "Historical Performance Dashboard",
      entity_types: [...new Set(performanceEntities.map((p) => p.type || "Institution"))],
      entities: performanceEntities,
      default_entity_slug: String(performanceEntities[0]?.slug || ""),
      chart_types: [
        { key: "aum_over_time", label: "AUM over time" },
        { key: "growth_decline", label: "Growth / decline" },
        { key: "benchmark_percentile", label: "Benchmark / percentile" },
      ],
      export_filename: "swfi-dashboard2-historical-performance.csv",
    },
    peer_comparison: {
      title: "Competitor Intelligence Module",
      institutions: aumRows.slice(0, 3).map((p) => ({
        slug: p.slug, name: p.name, type: p.type,
        country: p.country, aum: p.aum, strategy: p.strategy,
        profile_url: p.profile_url, fit_score: "", peer_percentile: "",
        peer_group: p.type, cagr: "", historical_performance: "",
        status: "fact",
      })),
      metrics: [
        { key: "aum", label: "AUM" },
        { key: "strategy", label: "Strategy allocation" },
        { key: "deal_activity", label: "Deal activity" },
        { key: "country", label: "Regional focus" },
      ],
      add_institution_label: "Add Institution",
    },
    dynamic_rankings: [
      { title: "Largest AUM", items: aumRows.slice(0, 5), href: appHref("/profiles/") },
      { title: "Fastest AUM Growth", items: [], href: appHref("/profiles/") },
      { title: "Best Historical Returns", items: [], href: appHref("/profiles/") },
    ],
    trend_analytics: trendRows.length ? trendRows : requestedSectors.map((sector) => ({
      sector,
      capital_deployed: UNKNOWN,
      growth: UNKNOWN,
      active_investors: 0,
      active_investors_display: UNKNOWN,
      href: appHref(`/search/?q=${encodeURIComponent(sector)}`),
      note: "Capital, growth, and active-investor counts require approved SWFI transaction fields.",
    })),
    funded_business_models: trendRows.length ? trendRows : requestedSectors.map((sector) => ({
      sector,
      capital_deployed: UNKNOWN,
      growth: UNKNOWN,
      active_investors: 0,
      active_investors_display: UNKNOWN,
      href: appHref(`/search/?q=${encodeURIComponent(sector)}`),
      note: "Capital, growth, and active-investor counts are source gaps unless SWFI returns those fields.",
    })),
    sector_shift_heatmap: [],
    regional_allocation: [],
    co_investment_tracking: {
      filters: ["Sector", "Region", "Ticket Size", "Time Range"],
      kpis: [
        { label: "Total Co-Invest Deals", value: totalCoInvestDeals ? sourceValue(totalCoInvestDeals) : UNKNOWN, href: appHref("/transactions/") },
        { label: "Avg Deal Size", value: avgDealSize == null ? UNKNOWN : moneyText(avgDealSize), href: appHref("/transactions/") },
        { label: "Active Investors", value: activeCoInvestors ? sourceValue(activeCoInvestors) : UNKNOWN, href: appHref("/profiles/") },
      ],
      network: {
        title: "Network Graph (Core Visual)",
        nodes: coRows.length ? `${packetRows(coInvestments, ["nodes"]).length} nodes` : "Nodes: Not disclosed by SWFI.com",
        links: coRows.length ? `${packetRows(coInvestments, ["edges"]).length} links` : "Links: Not disclosed by SWFI.com",
        href: appHref("/transactions/"),
      },
      rows: coRows.map((row) => ({
        investor_a: sourceText(row.investor_a),
        investor_b: sourceText(row.investor_b),
        sector: sourceText(row.sector),
        deal: sourceText(row.latest_transaction || row.deal),
        amount: moneyText(row.amount_display || row.total_amount || row.amount),
        href: transactionHref(Array.isArray(row.transaction_ids) ? row.transaction_ids[0] : ""),
      })),
    },
    investor_fit_targeting: {
      question: "Which SWFs invest in $200M-$500M deals in Infrastructure?",
      benefit: "Targets right investors with right cheque size. Avoids mismatched outreach.",
      criteria: ["Infrastructure", "$200M-$500M", "SWFs"],
      ticket_size_distribution: ticketRows.map((row) => ({
        label: `${sourceText(row.label || row.band)} (${sourceValue(row.count)} deals)`,
        href: appHref("/transactions/"),
      })),
      rows: fitRows.map((row) => ({
        institution: sourceText(row.investor || row.name),
        sector_focus: sourceText(row.sector),
        average_ticket_size: moneyText(row.average_ticket_size_display || row.average_ticket_size),
        fit: row.source_match_count == null ? UNKNOWN : `${sourceText(row.source_match_count)} source matches`,
        href: profileHref(row.slug),
      })),
      href: appHref("/search/"),
    },
    alerts: [
      { label: "New deals", status: transactionRows.length ? `${transactionRows.length} source rows` : UNKNOWN, href: appHref("/transactions/") },
      { label: "New mandates", status: rfpRows.length ? `${rfpRows.length} source rows` : UNKNOWN, href: appHref("/mandates/") },
      { label: "Investor activity", status: allocatorRows.length ? `${allocatorRows.length} source rows` : UNKNOWN, href: appHref("/profiles/") },
    ],
    saved_views: [],
  };

  return { dashboard2 } as DashboardPayload;
}

export function useDashboard() {
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const payload = await buildFromPublicAPIs();
      setData(payload);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load dashboard");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => { void load(); }, 0);
    const interval = window.setInterval(() => { void load(); }, 120_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  return { data, error, loading, reload: load };
}
