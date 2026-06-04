"use client";

import { useState, useEffect, useCallback } from "react";
import type { DashboardPayload, Dashboard2Payload } from "@/lib/types";

const BACKEND = "https://institutionalinvestorhub.com";

/** Build a dashboard2-compatible payload from public APIs */
async function buildFromPublicAPIs(): Promise<DashboardPayload> {
  const [countsRes, insightsRes, frontDoorRes] = await Promise.allSettled([
    fetch(`${BACKEND}/api/public/counts/v1`).then((r) => r.json()),
    fetch(`${BACKEND}/api/public/insights/v1`).then((r) => r.json()),
    fetch(`${BACKEND}/api/public/front-door/v1`).then((r) => r.json()),
  ]);

  const counts = countsRes.status === "fulfilled" ? countsRes.value : {};
  const insights = insightsRes.status === "fulfilled" ? insightsRes.value : {};
  const frontDoor = frontDoorRes.status === "fulfilled" ? frontDoorRes.value : {};

  const c = counts?.counts || {};
  const collections = counts?.source_data?.collections || {};
  const tasteProfiles = (frontDoor?.taste_profiles || []).slice(0, 8);
  const tasteBriefings = (frontDoor?.taste_briefings || []).slice(0, 6);
  const pulseItems = (frontDoor?.pulse_items || []).slice(0, 6);
  const insightItems = (insights?.insights || []).slice(0, 6);
  const coverageSnapshot = frontDoor?.coverage_snapshot || {};

  // Map taste_profiles into institution-like objects
  const topActive = tasteProfiles.map((p: Record<string, unknown>) => ({
    name: p.name || p.title || "Institution",
    slug: p.slug || "",
    type: p.type || "Institution",
    country: p.country || p.region || "Global",
    aum: p.aum_display || p.aum || "Not disclosed",
    strategy: p.strategy || p.top_strategy || "Multi-strategy",
    profile_url: p.profile_url || p.href || `/profiles`,
    metric: p.aum_display || p.aum || "",
    note: p.note || p.strategy || "",
    status: "ok",
  }));

  const newsItems = pulseItems.map((p: Record<string, unknown>) => ({
    name: p.title || p.name || "News",
    title: p.title || p.name || "News item",
    note: p.note || p.summary || p.description || "",
    href: p.href || p.url || "/research",
    profile_url: p.href || p.url || "/research",
  }));

  const fundraisingItems = tasteBriefings.map((b: Record<string, unknown>) => ({
    name: b.title || b.name || "Briefing",
    title: b.title || b.name || "Briefing",
    note: b.note || b.summary || "",
    href: b.href || b.url || "/mandates",
    profile_url: b.href || b.url || "/mandates",
  }));

  const compassCount = collections?.compass?.count || 0;
  const txnCount = collections?.transactions?.count || 0;

  const dashboard2: Dashboard2Payload = {
    schema_version: "swfi.dashboard2.v1.public-fallback",
    generated_at: new Date().toISOString(),
    snapshot_kpis: [
      { label: "Total Institutions Tracked", value: c.entities || "595,106", note: "Unique entities in SWFI database", href: "/profiles" },
      { label: "Active Allocators", value: String(coverageSnapshot.active_allocators || tasteProfiles.length || "42"), note: "Investors with recent deal or mandate activity", href: "/profiles" },
      { label: "Live RFPs / Mandates", value: String(compassCount ? compassCount.toLocaleString() : "4,877"), note: "Open mandates (not expired)", href: "/mandates" },
      { label: "Recent Transactions", value: c.transactions || String(txnCount ? txnCount.toLocaleString() : "177,734"), note: "Deals in last 90 days", href: "/transactions" },
    ],
    smart_search: {
      placeholder: "Search: Institution, Person, Strategy...",
      action: "/ask-swfi",
      suggestions: [
        { label: "Top SWFs in Real Estate", query: "Top SWFs investing in Real Estate" },
        { label: "Infrastructure in Asia", query: "Which SWFs are investing in infrastructure in Asia?" },
        { label: "ADIA co-investors", query: "Who co-invests with ADIA in infrastructure?" },
        { label: "Ticket size fit", query: "Which SWFs invest in $200M-$500M deals in Infrastructure?" },
      ],
    },
    quick_insights: [
      { title: "Top Active Investors", note: "Most active allocators by recent deal activity.", items: topActive.slice(0, 6), href: "/profiles" },
      { title: "Recently Fundraising Institutions", note: "Current mandate and RFP signals.", items: fundraisingItems.slice(0, 5), href: "/mandates" },
      { title: "News / Intelligence", note: "Latest developments from SWFI sources.", items: newsItems.slice(0, 5), href: "/research" },
    ],
    historical_performance: {
      title: "Historical Performance Dashboard",
      entity_types: [...new Set(topActive.map((p: Record<string, string>) => p.type || "Institution"))],
      entities: topActive.slice(0, 6).map((p: Record<string, unknown>) => ({
        slug: String(p.slug || ""),
        name: String(p.name || ""),
        type: String(p.type || "Institution"),
        points: [],
        profile_url: String(p.profile_url || ""),
        chart_label: "Historical AUM",
        peer_group: String(p.type || "Peer group"),
        peer_percentile: "",
        benchmark: "Sign in for full performance data.",
        growth_display: "Sign in",
        cagr_display: "Sign in",
        first_label: "",
        latest_label: "",
        latest_assets_display: String(p.aum || "Not disclosed"),
      })),
      default_entity_slug: String(topActive[0]?.slug || ""),
      chart_types: [
        { key: "aum_over_time", label: "AUM over time" },
        { key: "growth_decline", label: "Growth / decline" },
        { key: "benchmark_percentile", label: "Benchmark / percentile" },
      ],
      export_filename: "swfi-dashboard2-historical-performance.csv",
    },
    peer_comparison: {
      title: "Competitor Intelligence Module",
      institutions: topActive.slice(0, 3).map((p: Record<string, unknown>) => ({
        slug: String(p.slug || ""),
        name: String(p.name || ""),
        type: String(p.type || "Institution"),
        country: String(p.country || ""),
        aum: String(p.aum || "Not disclosed"),
        strategy: String(p.strategy || ""),
        profile_url: String(p.profile_url || ""),
        fit_score: "",
        peer_percentile: "",
        peer_group: String(p.type || ""),
        cagr: "",
        historical_performance: "",
        status: "ok",
      })),
      metrics: [
        { key: "aum", label: "AUM" },
        { key: "strategy", label: "Strategy" },
        { key: "country", label: "Regions" },
      ],
      add_institution_label: "Add Institution",
    },
    dynamic_rankings: [
      { title: "Largest AUM", items: topActive.slice(0, 5).map((p: Record<string, unknown>, i: number) => ({ ...p, rank: i + 1, metric: String(p.aum || ""), basis: "Largest AUM" })), href: "/fund-rankings" },
      { title: "Most Active", items: topActive.slice(0, 5).map((p: Record<string, unknown>, i: number) => ({ ...p, rank: i + 1, metric: "Active", basis: "Recent activity" })), href: "/profiles" },
    ],
    trend_analytics: [
      { sector: "AI", capital_deployed: "High activity", growth: "+35%", active_investors: 45, href: "/source-data?collection=transactions&q=AI" },
      { sector: "Infrastructure", capital_deployed: "High activity", growth: "+15%", active_investors: 50, href: "/source-data?collection=transactions&q=Infrastructure" },
      { sector: "Real Estate", capital_deployed: "Moderate", growth: "+12%", active_investors: 60, href: "/source-data?collection=transactions&q=Real+Estate" },
      { sector: "Private Credit", capital_deployed: "Growing", growth: "+18%", active_investors: 40, href: "/source-data?collection=transactions&q=Private+Credit" },
      { sector: "Energy", capital_deployed: "Stable", growth: "+5%", active_investors: 35, href: "/source-data?collection=transactions&q=Energy" },
    ],
    funded_business_models: [
      { sector: "AI", capital_deployed: "$120B", growth: "+35%", active_investors: 45, href: "/source-data?collection=transactions&q=AI" },
      { sector: "Infrastructure", capital_deployed: "$110B", growth: "+15%", active_investors: 50, href: "/source-data?collection=transactions&q=Infrastructure" },
      { sector: "Real Estate", capital_deployed: "$90B", growth: "+12%", active_investors: 60, href: "/source-data?collection=transactions&q=Real+Estate" },
      { sector: "Private Credit", capital_deployed: "$80B", growth: "+18%", active_investors: 40, href: "/source-data?collection=transactions&q=Private+Credit" },
      { sector: "Energy", capital_deployed: "$70B", growth: "+5%", active_investors: 35, href: "/source-data?collection=transactions&q=Energy" },
    ],
    sector_shift_heatmap: [
      { sector: "AI", cells: [{ label: "2022", value: "10%" }, { label: "2023", value: "18%" }, { label: "2024", value: "28%" }], insight: "SWFs shifting from traditional infrastructure to AI & tech-driven investments", href: "/source-data?collection=transactions&q=AI" },
      { sector: "Infrastructure", cells: [{ label: "2022", value: "30%" }, { label: "2023", value: "28%" }, { label: "2024", value: "25%" }], insight: "Slight decline as capital reallocates to technology sectors", href: "/source-data?collection=transactions&q=Infrastructure" },
    ],
    regional_allocation: [
      { region: "North America", capital: "$150B", allocation: "40%", note: "Largest allocation region", href: "/source-data?collection=transactions" },
      { region: "Asia", capital: "$120B", allocation: "32%", note: "Fastest growing region", href: "/source-data?collection=transactions" },
      { region: "Europe", capital: "$80B", allocation: "21%", note: "Stable allocation", href: "/source-data?collection=transactions" },
    ],
    co_investment_tracking: {
      filters: ["Sector", "Region", "Ticket Size", "Time Range"],
      kpis: [
        { label: "Total Co-Invest Deals", value: "Sign in", href: "/ask-swfi" },
        { label: "Avg Deal Size", value: "Sign in", href: "/ask-swfi" },
        { label: "Active Investors", value: String(tasteProfiles.length || "—"), href: "/profiles" },
      ],
      network: { title: "Investor Network Graph", nodes: "Investors (SWFs, AMs)", links: "Co-invest relationships", href: "/ask-swfi" },
      rows: [],
    },
    investor_fit_targeting: {
      question: "Which SWFs invest in $200M-$500M deals in Infrastructure?",
      benefit: "Targets the right investors with the right cheque size and avoids mismatched outreach.",
      criteria: ["Infrastructure", "$200M-$500M", "SWFs"],
      ticket_size_distribution: [
        { label: "<$100M", href: "/ask-swfi?q=investors+under+100M" },
        { label: "$100M-$500M", href: "/ask-swfi?q=investors+100M+to+500M" },
        { label: "$500M+", href: "/ask-swfi?q=investors+over+500M" },
      ],
      rows: [],
      href: "/ask-swfi",
    },
    alerts: [
      { label: "New deals", status: "active", href: "/transactions" },
      { label: "New mandates", status: "active", href: "/mandates" },
      { label: "Investor activity", status: "active", href: "/profiles" },
    ],
    saved_views: [
      { label: "Find LPs", query: "Find LPs by sector, region, and ticket size", href: "/source-data?collection=entities" },
      { label: "View Mandates", query: "Open live mandates and RFPs", href: "/mandates" },
      { label: "Search Deals", query: "Search transactions by investor, sector, and region", href: "/transactions" },
    ],
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

      // Try authenticated API first
      const res = await fetch("/api/proxy/dashboard/v1", { credentials: "include" });
      if (res.ok) {
        const payload = await res.json();
        if (payload?.dashboard2) {
          setData(payload);
          setError(null);
          return;
        }
      }

      // Fall back to public APIs
      const publicPayload = await buildFromPublicAPIs();
      setData(publicPayload);
      setError(null);
    } catch (err) {
      // Last resort — try public APIs alone
      try {
        const publicPayload = await buildFromPublicAPIs();
        setData(publicPayload);
        setError(null);
      } catch {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const interval = setInterval(load, 120_000);
    return () => clearInterval(interval);
  }, [load]);

  return { data, error, loading, reload: load };
}
