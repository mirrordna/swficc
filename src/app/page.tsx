"use client";

import type { AnchorHTMLAttributes, CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Packet } from "@/lib/sourcePackets";
import {
  count,
  fetchPacket,
  isFact,
  money,
  normalizeSwfiUrl,
  numericSortValue,
  packetData,
  packetReason,
  rows,
  SOURCE_GAP,
  text,
} from "@/lib/sourcePackets";
import { useGsapReveal } from "@/hooks/useGsapReveal";
import { HOME_PACKET_SNAPSHOT } from "@/lib/homeSourceSnapshot";
import { appHref, assetHref, isSwfiPlatformRecordHref, sourceProvenanceHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { mandateDetailHref, personDetailHref, profileDetailHref, researchDetailHref, transactionDetailHref } from "@/lib/detailRoutes";

const ENDPOINTS = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  allocators30: "/api/allocator-activity/v1?days=90&limit=25",
  allocators90: "/api/allocator-activity/v1?days=90&limit=1&count_only=1",
  rfps: "/api/live-opportunities/v1?limit=25&page=1",
  transactions30: "/api/recent-transactions/v1?days=30&limit=25&page=1",
  entities: "/api/source-data/search/v1?collection=entities&limit=25&page=1",
  people: "/api/source-data/search/v1?collection=people&limit=25&page=1",
  top20: "/v1/swfi/top20?limit=5",
  news: "/api/source-intelligence/news/v1?limit=25",
  sectorFlows: "/api/sector-flows/v1?days=365",
};

const LOADING = "Loading";
const DASHBOARD_EMPTY = "No records to show for this view";
const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
const DASHBOARD_LOAD_ORDER: PacketKey[] = ["metrics", "sectorFlows", "allocators90", "rfps", "allocators30", "transactions30", "entities", "people", "top20", "news"];
const insightNav = [
  ["Top Investors", "/allocators"],
  ["Fundraising", "/mandates"],
  ["Market Activity", "/transactions"],
  ["News", "/intelligence"],
] as const;

function searchPrefetchCacheKey(query: string): string {
  return `${SEARCH_PREFETCH_CACHE_PREFIX}${query.trim().toLowerCase()}`;
}

type Packets = Record<keyof typeof ENDPOINTS, Packet | undefined>;
type PacketKey = keyof typeof ENDPOINTS;
type Cell = string | { label: string; href?: string; sourceHref?: string; citationText?: string };
type DashboardTableControls = {
  rowLimit: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
};

type BrdSearchItem = {
  label: string;
  detail: string;
  href: string;
  sourceHref?: string;
};

type BrdSearchGroup = {
  label: string;
  items: BrdSearchItem[];
};

const navMain = [
  ["Dashboard", "/"],
  ["Institutions", "/profiles"],
  ["People", "/people"],
  ["Deals", "/deals"],
  ["Active Allocators", "/allocators"],
  ["Comparisons", "/comparisons"],
  ["RFPs", "/mandates"],
  ["Reports", "/reports"],
  ["Intelligence", "/intelligence"],
] as const;

const navIntel = [
  ["Historical Performance", "/reports/#historical-performance-dashboard"],
  ["Peer Comparison", "/comparisons"],
  ["Rankings", "/reports/#dynamic-rankings-engine"],
  ["Trend Analytics", "/reports/#investment-trend-analytics"],
  ["Co-Investment", "/reports/#co-investment-tracking"],
  ["Deal Intelligence", "/deals"],
] as const;

export default function DashboardPage() {
  const rootRef = useGsapReveal<HTMLDivElement>();
  const [packets, setPackets] = useState<Packets>(() => freshHomeSnapshot());
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [newsTab, setNewsTab] = useState<"latest" | "referenced" | "topics">("latest");
  const [newestTab, setNewestTab] = useState<"transactions" | "rfps" | "opportunities" | "people">("transactions");
  const [topTab, setTopTab] = useState<"compass" | "sector">("compass");
  const [expandedPanel, setExpandedPanel] = useState("capital-flows");
  const [visualControls, setVisualControls] = useState<DashboardTableControls>({ rowLimit: 5, sortColumn: 0, sortDir: "asc" });

  useEffect(() => {
    let active = true;
    void loadDashboardPackets((key, packet) => {
      if (!active) return;
      setPackets((current) => ({
        ...current,
        [key]: shouldReplacePacket(current[key], packet) ? packet : current[key],
      }));
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === "k") {
        event.preventDefault();
        setSearchOpen(true);
      }
      if (key === "escape") setSearchOpen(false);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const entityRows = factRows(packets.entities).slice(0, 25);
  const peopleRows = factRows(packets.people).slice(0, 25);
  const transactionRows = factRows(packets.transactions30).slice(0, 25);
  const rfpRows = factRows(packets.rfps).slice(0, 25);
  const newsRows = factRows(packets.news).slice(0, 25);
  const allocatorRows = factRows(packets.allocators30).slice(0, 25);
  const sectorRows = sectorFacetRows(packets.sectorFlows).slice(0, 10);
  const topAumRows = factRows(packets.top20).slice(0, 25);
  const dashboardReady = useMemo(() => {
    return ["metrics", "sectorFlows", "allocators30", "rfps", "transactions30", "entities", "top20", "news"]
      .every((key) => isFact(packets[key as PacketKey]));
  }, [packets]);
  const dataAsOfLabel = useMemo(() => dataAsOfLabelFor(packets.metrics), [packets.metrics]);
  const quickLinks = useMemo(() => brdQuickLinks(entityRows, transactionRows, rfpRows), [entityRows, transactionRows, rfpRows]);
  const unifiedRows = useMemo(() => unifiedIntelligenceRows({
    topInvestors: allocatorRows,
    marketRows: transactionRows,
    fundraisingRows: rfpRows,
    newsRows,
    sectorRows,
  }), [allocatorRows, transactionRows, rfpRows, newsRows, sectorRows]);
  const searchGroups = useMemo(() => brdSearchGroups({
    query: searchQuery,
    entityRows,
    peopleRows,
    transactionRows,
    rfpRows,
    newsRows,
  }), [searchQuery, entityRows, peopleRows, transactionRows, rfpRows, newsRows]);
  const searchItems = useMemo(() => searchGroups.flatMap((group) => group.items), [searchGroups]);

  useEffect(() => {
    const timer = window.setTimeout(() => setActiveSearchIndex(0), 0);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const clean = searchQuery.trim();
    if (clean.length < 2) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(clean)}&limit=25`, 10_000, {
        signal: controller.signal,
        attempts: 1,
      }).then((packet) => {
        if (controller.signal.aborted || !isFact(packet)) return;
        try {
          window.sessionStorage.setItem(searchPrefetchCacheKey(clean), JSON.stringify({
            query: clean,
            stored_at: Date.now(),
            packet,
          }));
        } catch {
          // Session storage is an optimization only; search still fetches live.
        }
      });
    }, 120);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [searchOpen, searchQuery]);

  function togglePanel(id: string) {
    setExpandedPanel((current) => current === id ? "" : id);
  }

  function sortVisualPanel(column: number) {
    setVisualControls((current) => ({
      ...current,
      sortColumn: column,
      sortDir: current.sortColumn === column && current.sortDir === "asc" ? "desc" : "asc",
    }));
  }

  return (
    <div ref={rootRef} data-dashboard-ready={dashboardReady ? "true" : "false"} className="min-h-screen bg-[#F5F3EF] font-sans text-[#101827]">
      <BrdTopNavigation onSearchOpen={() => setSearchOpen(true)} />
      <BrdDiscoverBar quickLinks={quickLinks} onSearchOpen={() => setSearchOpen(true)} dataAsOfLabel={dataAsOfLabel} />
      <VisualExecutiveOverview
        packets={packets}
        topAumRows={topAumRows}
        entityRows={entityRows}
        allocatorRows={allocatorRows}
        transactionRows={transactionRows}
        rfpRows={rfpRows}
        newsRows={newsRows}
        sectorRows={sectorRows}
        unifiedRows={unifiedRows}
        expandedPanel={expandedPanel}
        onTogglePanel={togglePanel}
        controls={visualControls}
        onRowLimitChange={(rowLimit) => setVisualControls((current) => ({ ...current, rowLimit }))}
        onSort={sortVisualPanel}
      />
      <main className="mx-auto grid max-w-[1440px] gap-x-14 gap-y-8 px-4 py-8 sm:px-8 xl:grid-cols-[minmax(0,1fr)_304px]">
        <BrdNewsFeed rows={newsRows} tab={newsTab} onTabChange={setNewsTab} />
        <BrdRightRail sectorRows={sectorRows} />
        <BrdNewestData
          tab={newestTab}
          onTabChange={setNewestTab}
          transactionRows={transactionRows}
          rfpRows={rfpRows}
          peopleRows={peopleRows}
        />
        <BrdTopTen tab={topTab} onTabChange={setTopTab} rfpRows={rfpRows} sectorRows={sectorRows} />
      </main>
      {searchOpen ? (
        <BrdSearchModal
          query={searchQuery}
          groups={searchGroups}
          activeIndex={activeSearchIndex}
          onQueryChange={setSearchQuery}
          onActiveIndexChange={setActiveSearchIndex}
          onClose={() => setSearchOpen(false)}
          flatItems={searchItems}
        />
      ) : null}
    </div>
  );
}

function BrdTopNavigation({ onSearchOpen }: { onSearchOpen: () => void }) {
  const nav = [
    ["Dashboard", "/"],
    ["News", "/intelligence"],
    ["Entities", "/profiles"],
    ["People", "/people"],
    ["Transactions", "/transactions"],
    ["Deals", "/transactions"],
    ["Compass", "/mandates"],
    ["RFPs", "/mandates"],
    ["Active Allocators", "/allocators"],
    ["Deals & Transactions", "/deals"],
    ["Reports", "/reports"],
  ] as const;
  return (
    <header data-gsap-reveal className="bg-[#B90D12] text-white">
      <div className="mx-auto flex min-h-[64px] max-w-[1440px] flex-wrap items-stretch">
        <DashboardLink href="/" className="flex w-[152px] items-center bg-[#8E090D] px-6 no-underline">
          <img src={assetHref("/swfi-assets/logo.svg")} alt="SWFI Sovereign Wealth Fund Institute" className="h-10 w-[104px] object-contain" />
        </DashboardLink>
        <nav className="flex min-w-0 flex-1 overflow-x-auto text-[13px] font-bold uppercase tracking-[0.04em] text-white/78">
          {nav.map(([label, href], index) => (
            <DashboardLink
              key={label}
              href={href}
              className={`flex min-h-[64px] shrink-0 items-center gap-1 px-6 no-underline ${index === 0 ? "bg-[#A10B10] text-white" : "text-white/82 hover:bg-[#8E090D] hover:text-white"}`}
            >
              <span>{label}</span>
              {["Entities", "People", "Transactions", "Deals", "Compass", "RFPs"].includes(label) ? <span className="text-[13px] text-white/55">⌄</span> : null}
            </DashboardLink>
          ))}
        </nav>
        <div className="flex min-h-[64px] items-center gap-4 px-5">
          <button type="button" onClick={onSearchOpen} aria-label="Open Global Search" className="grid h-11 w-11 place-items-center rounded-full bg-transparent text-white hover:bg-white/8">
            <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden="true">
              <path d="M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Zm5.4-1.8 4.2 4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.4" />
            </svg>
          </button>
          <DashboardLink href="/login/" className="hidden items-center gap-2 text-[13px] font-semibold text-white/80 no-underline hover:text-white sm:flex">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-white/90 text-[#8E090D]">
              <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
                <path d="M12 12.4a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c1.4-3.5 4-5.2 7-5.2s5.6 1.7 7 5.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2" />
              </svg>
            </span>
            <span>Your Account</span>
            <span className="text-white/50">⌄</span>
          </DashboardLink>
        </div>
        <DashboardLink href="/search/?q=Events" className="flex min-h-[64px] items-center bg-[#071F48] px-8 text-[13px] font-bold text-white no-underline hover:bg-[#0A2B56]">
          Events
        </DashboardLink>
      </div>
    </header>
  );
}

function BrdDiscoverBar({ quickLinks, dataAsOfLabel, onSearchOpen }: {
  quickLinks: BrdSearchItem[];
  dataAsOfLabel: string;
  onSearchOpen: () => void;
}) {
  return (
    <section data-gsap-reveal className="border-b border-[#E5E1DA] bg-[#ECEAE5]">
      <div className="mx-auto grid max-w-[1440px] gap-4 px-4 py-5 sm:px-8 lg:grid-cols-[82px_minmax(260px,650px)_minmax(0,1fr)] lg:items-center">
        <h1 className="font-serif text-[28px] leading-none text-[#22293C]">Discover</h1>
        <button
          type="button"
          onClick={onSearchOpen}
          className="flex min-h-[44px] min-w-0 items-center justify-between gap-3 bg-white px-4 text-left text-[13px] text-[#758092] shadow-sm"
          aria-label="Open Global Search"
        >
          <span className="truncate">Search For Entities, People, Transactions, News, opportunities...</span>
          <kbd className="shrink-0 border border-[#DEE2E7] bg-[#F4F5F7] px-1.5 py-0.5 font-mono text-[11px] font-bold text-[#2D3446]">Ctrl/⌘ + K</kbd>
        </button>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-[#7A8190]">
          <span aria-hidden="true" className="grid h-5 w-5 place-items-center rounded-full bg-[#99A1AC] text-[11px] font-bold text-white">◷</span>
          {quickLinks.map((item) => (
            <DataLink key={`${item.label}-${item.href}`} href={item.href} sourceHref={item.sourceHref} className="max-w-[190px] truncate text-[#747B88] underline">
              {item.label}
            </DataLink>
          ))}
          <span className="text-[#99A1AC]">{dataAsOfLabel}</span>
        </div>
      </div>
    </section>
  );
}

function VisualExecutiveOverview({
  packets,
  topAumRows,
  entityRows,
  allocatorRows,
  transactionRows,
  rfpRows,
  newsRows,
  sectorRows,
  unifiedRows,
  expandedPanel,
  controls,
  onTogglePanel,
  onRowLimitChange,
  onSort,
}: {
  packets: Packets;
  topAumRows: Record<string, unknown>[];
  entityRows: Record<string, unknown>[];
  allocatorRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
  unifiedRows: UnifiedInsight[];
  expandedPanel: string;
  controls: DashboardTableControls;
  onTogglePanel: (id: string) => void;
  onRowLimitChange: (value: number) => void;
  onSort: (column: number) => void;
}) {
  const kpis = dashboardMetricCards(packets, topAumRows, sectorRows);
  const topRows = topAumRows.length ? topAumRows : entityRows;

  return (
    <section data-gsap-reveal className="border-b border-[#E0DDD6] bg-[#EEF1F4] px-4 py-5 sm:px-8">
      <div className="mx-auto grid max-w-[1440px] gap-3">
        <div className="grid gap-2 md:grid-cols-3 xl:grid-cols-6">
          {kpis.map((kpi) => (
            <ConceptKpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
        <div className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_340px]">
          <ExpandablePanel
            id="capital-map"
            title="Global Capital Map"
            href="#capital-map"
            expanded={expandedPanel === "capital-map"}
            onToggle={onTogglePanel}
            detail={<TotalAumInsightDetail topRows={topRows} entityRows={entityRows} transactionRows={transactionRows} rfpRows={rfpRows} sectorRows={sectorRows} />}
            className="xl:row-span-2"
          >
            <GlobalCapitalMap topRows={topRows} sectorRows={sectorRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="capital-flows"
            title="Capital Flows & Allocation Trends"
            href="/deals"
            expanded={expandedPanel === "capital-flows"}
            onToggle={onTogglePanel}
            detail={<ExpandedSectorRows rows={sectorRows} controls={controls} />}
          >
            <CapitalFlowPanel rows={sectorRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="ai-insights"
            title="Market Signals"
            href="/intelligence"
            expanded={expandedPanel === "ai-insights"}
            onToggle={onTogglePanel}
            detail={<ExpandedUnifiedInsightRows rows={unifiedRows} controls={controls} />}
          >
            <AiInsightsPanel topInvestors={allocatorRows} marketRows={transactionRows} fundraisingRows={rfpRows} newsRows={newsRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="pipeline"
            title="Pipeline Overview"
            href="/profiles"
            expanded={expandedPanel === "pipeline"}
            onToggle={onTogglePanel}
            detail={<ExpandedInvestorRows rows={entityRows} controls={controls} />}
          >
            <PipelineFunnelPanel packets={packets} topRows={topRows} marketRows={transactionRows} fundraisingRows={rfpRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="relationships"
            title="Top Active Investors"
            href="/allocators"
            expanded={expandedPanel === "relationships"}
            onToggle={onTogglePanel}
            detail={<ExpandedInvestorRows rows={allocatorRows} controls={controls} />}
          >
            <RelationshipPanel rows={allocatorRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="research-hub"
            title="Research & Analytics Hub"
            href="/intelligence"
            expanded={expandedPanel === "research-hub"}
            onToggle={onTogglePanel}
            detail={<ExpandedNewsRows rows={newsRows} controls={controls} />}
          >
            <ResearchHubPanel rows={newsRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="market-intelligence"
            title="Market Intelligence"
            href="/deals"
            expanded={expandedPanel === "market-intelligence"}
            onToggle={onTogglePanel}
            detail={<ExpandedSectorRows rows={sectorRows} controls={controls} />}
          >
            <MarketIntelligencePanel rows={sectorRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="engagements"
            title="Upcoming Events & Engagements"
            href="/mandates"
            expanded={expandedPanel === "engagements"}
            onToggle={onTogglePanel}
            detail={<ExpandedMandateRows rows={rfpRows} controls={controls} />}
            className="xl:col-span-2"
          >
            <EngagementCards rows={rfpRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="activity-feed"
            title="Activity Feed"
            href="/intelligence"
            expanded={expandedPanel === "activity-feed"}
            onToggle={onTogglePanel}
            detail={<ExpandedDealRows rows={transactionRows} controls={controls} />}
          >
            <ActivityFeedPanel marketRows={transactionRows} newsRows={newsRows} fundraisingRows={rfpRows} />
          </ExpandablePanel>
          <ExpandablePanel
            id="deal-intelligence"
            title="Deal Intelligence"
            href="/deals"
            expanded={expandedPanel === "deal-intelligence"}
            onToggle={onTogglePanel}
            detail={<ExpandedDealRows rows={transactionRows} controls={controls} />}
          >
            <DealIntelligencePanel rows={transactionRows} sectorRows={sectorRows} />
          </ExpandablePanel>
        </div>
        <DashboardControlStrip
          totalRows={Math.max(topRows.length, entityRows.length, allocatorRows.length, transactionRows.length, rfpRows.length, newsRows.length, sectorRows.length)}
          rowLimit={controls.rowLimit}
          sortColumn={controls.sortColumn}
          sortDir={controls.sortDir}
          onRowLimitChange={onRowLimitChange}
          onSort={onSort}
        />
        <div className="overflow-hidden bg-[#071F48] text-white">
          <NewsTicker rows={newsRows} />
        </div>
      </div>
    </section>
  );
}

function BrdNewsFeed({ rows: sourceRows, tab, onTabChange }: {
  rows: Record<string, unknown>[];
  tab: "latest" | "referenced" | "topics";
  onTabChange: (tab: "latest" | "referenced" | "topics") => void;
}) {
  const rowsToUse = brdNewsRowsForTab(sourceRows, tab);
  const featured = rowsToUse[0];
  const secondary = rowsToUse.slice(1, 4);
  const sideList = rowsToUse.slice(4, 8);
  return (
    <section data-gsap-reveal className="min-w-0">
      <BrdTabs
        tabs={[
          ["latest", "Latest Intelligence"],
          ["referenced", "Most Referenced"],
          ["topics", "Topics"],
        ]}
        active={tab}
        onChange={(value) => onTabChange(value as "latest" | "referenced" | "topics")}
      />
      <DashboardSectionNote>
        Latest market intelligence appears first. Use the other views to browse frequently referenced items or topics.
      </DashboardSectionNote>
      {featured ? (
        <div className="mt-8 grid gap-10 lg:grid-cols-[minmax(260px,340px)_minmax(320px,1fr)_minmax(220px,310px)]">
          <DataLink href={researchRecordHref(featured)} sourceHref={sourceHref(featured)} className="block text-inherit no-underline">
            <h2 className="font-serif text-[34px] leading-[1.18] text-[#253047] sm:text-[40px]">{brdText(featured.title || featured.name)}</h2>
            <p className="mt-4 line-clamp-3 text-[14px] leading-5 text-[#24304B]">{brdExcerpt(featured)}</p>
            <div className="mt-4 flex items-center gap-4 text-[12px] text-[#5A6372]">
              <span>{brdReadTime(featured)}</span>
              {brdPopularBadge(featured, sourceRows) ? <span className="bg-[#D8D9D5] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#41464F]">Popular</span> : null}
            </div>
          </DataLink>
          <DataLink href={researchRecordHref(featured)} sourceHref={sourceHref(featured)} className="block min-h-[200px] overflow-hidden bg-[#D8DDE6] text-inherit no-underline">
            <span className="sr-only">{brdText(featured.title || featured.name)}</span>
            <img src={assetHref(`/swfi-assets/images/${brdImageForIndex(0)}`)} alt="" className="h-full min-h-[250px] w-full object-cover" />
          </DataLink>
          <div className="grid content-start gap-5">
            {sideList.map((row, index) => (
              <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="block text-inherit no-underline">
                <h3 className="font-serif text-[21px] leading-[1.22] text-[#31384B]">{brdText(row.title || row.name)}</h3>
                <div className="mt-2 text-[12px] text-[#5D6676]">{brdReadTime(row)}</div>
              </DataLink>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-8 border border-[#DDD8D0] bg-white p-8 text-[14px] text-[#4A5363]">{DASHBOARD_EMPTY}</div>
      )}
      <div className="mt-10 grid gap-6 md:grid-cols-3">
        {secondary.map((row, index) => (
          <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[100px_minmax(0,1fr)] gap-4 text-inherit no-underline">
            <img src={assetHref(`/swfi-assets/images/${brdImageForIndex(index + 1)}`)} alt="" className="h-[100px] w-[100px] object-cover" />
            <span className="min-w-0">
              <span className="block font-serif text-[18px] leading-[1.22] text-[#31384B]">{brdText(row.title || row.name)}</span>
              <span className="mt-2 block text-[12px] text-[#5D6676]">{brdReadTime(row)}</span>
            </span>
          </DataLink>
        ))}
      </div>
    </section>
  );
}

function BrdRightRail({ sectorRows }: { sectorRows: Record<string, unknown>[] }) {
  const tags = brdMarketFocusTags(sectorRows);
  return (
    <aside data-gsap-reveal className="grid content-start gap-8">
      <section>
        <h2 className="mb-5 text-[13px] font-extrabold uppercase tracking-[0.04em] text-[#202A42]">Upcoming Events</h2>
        <DashboardLink href="/search/?q=Events" className="grid gap-1 bg-[#F0EFEC] px-4 py-4 text-inherit no-underline hover:bg-[#E8E6E1]">
          <span className="text-[13px] font-bold text-[#24304B]">GWC Events Calendar</span>
          <span className="text-[12px] text-[#656D7B]">View events coverage</span>
        </DashboardLink>
      </section>
      <section>
        <h2 className="mb-5 text-[13px] font-extrabold uppercase tracking-[0.04em] text-[#202A42]">Market Focus</h2>
        <div className="flex flex-wrap gap-3">
          {tags.map((tag) => (
            <DashboardLink key={tag} href={`/search/?q=${encodeURIComponent(tag)}`} className="rounded-full bg-[#E3E2DF] px-5 py-2 text-[12px] font-bold text-[#435175] no-underline hover:bg-[#D7D6D2]">
              {tag}
            </DashboardLink>
          ))}
        </div>
      </section>
    </aside>
  );
}

function BrdNewestData({ tab, onTabChange, transactionRows, rfpRows, peopleRows }: {
  tab: "transactions" | "rfps" | "opportunities" | "people";
  onTabChange: (tab: "transactions" | "rfps" | "opportunities" | "people") => void;
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  peopleRows: Record<string, unknown>[];
}) {
  const rowsToUse = brdNewestRows(tab, transactionRows, rfpRows, peopleRows);
  return (
    <section data-gsap-reveal className="min-w-0">
      <h2 className="font-serif text-[28px] leading-none text-[#22293C]">Newest Data</h2>
      <BrdTabs
        className="mt-5"
        tabs={[
          ["transactions", "Transactions"],
          ["rfps", "RFPs"],
          ["opportunities", "Opportunities"],
          ["people", "People"],
        ]}
        active={tab}
        onChange={(value) => onTabChange(value as "transactions" | "rfps" | "opportunities" | "people")}
      />
      <DashboardSectionNote>
        Showing recent activity by category. Open a row for details, or use search to explore more.
      </DashboardSectionNote>
      <BrdTable headers={rowsToUse.headers} rows={rowsToUse.rows} empty={DASHBOARD_EMPTY} />
    </section>
  );
}

function BrdTopTen({ tab, onTabChange, rfpRows, sectorRows }: {
  tab: "compass" | "sector";
  onTabChange: (tab: "compass" | "sector") => void;
  rfpRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}) {
  const rowsToUse = tab === "compass" ? brdCompassTopRows(rfpRows) : brdSectorTopRows(sectorRows);
  return (
    <section data-gsap-reveal className="min-w-0">
      <h2 className="font-serif text-[28px] leading-none text-[#22293C]">Top 10</h2>
      <BrdTabs
        className="mt-5"
        tabs={[
          ["compass", "Compass Investment Types"],
          ["sector", "SWF Buys by Sector"],
        ]}
        active={tab}
        onChange={(value) => onTabChange(value as "compass" | "sector")}
      />
      <DashboardSectionNote>
        A compact ranking of current dashboard activity. Open a row to continue into the matching view.
      </DashboardSectionNote>
      <BrdTable headers={["Inv Type", "Amount (USD)", "Count"]} rows={rowsToUse} empty={DASHBOARD_EMPTY} />
    </section>
  );
}

function BrdSearchModal({
  query,
  groups,
  activeIndex,
  flatItems,
  onQueryChange,
  onActiveIndexChange,
  onClose,
}: {
  query: string;
  groups: BrdSearchGroup[];
  activeIndex: number;
  flatItems: BrdSearchItem[];
  onQueryChange: (query: string) => void;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
}) {
  const [filter, setFilter] = useState("All");
  const visibleGroups = filter === "All" ? groups : groups.filter((group) => group.label === filter);
  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = visibleItems[Math.min(activeIndex, Math.max(0, visibleItems.length - 1))];

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      onActiveIndexChange(Math.min(Math.max(0, visibleItems.length - 1), activeIndex + 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      onActiveIndexChange(Math.max(0, activeIndex - 1));
      return;
    }
    if (event.key === "Enter" && activeItem) {
      event.preventDefault();
      window.location.assign(dashboardResolvedHref(activeItem.href));
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-start bg-[#050915]/65 px-4 py-10 backdrop-blur-sm sm:py-20" role="dialog" aria-modal="true" aria-label="Global Search">
      <div className="mx-auto w-full max-w-[860px] overflow-hidden bg-white shadow-[0_30px_70px_rgba(0,0,0,0.35)]" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 border-b border-[#E2E6ED] px-5 py-4">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#1E2940]" aria-hidden="true">
            <path d="M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Zm5.4-1.8 4.2 4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search entities, people, transactions, RFPs, news..."
            className="min-h-11 min-w-0 flex-1 text-[17px] outline-none placeholder:text-[#8E95A3]"
            aria-label="Search query"
          />
          {query ? (
            <button type="button" onClick={() => onQueryChange("")} className="border border-[#D8DDE5] px-3 py-2 text-[12px] font-bold text-[#394356]">
              Clear
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-[22px] text-[#394356]" aria-label="Close search">×</button>
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-[#E2E6ED] px-5 py-3">
          {["All", "Entities", "RFPs & Opportunities", "Transactions", "News & Articles", "People"].map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFilter(label);
                onActiveIndexChange(0);
              }}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold ${filter === label ? "bg-[#0B132B] text-white" : "bg-[#ECEFF4] text-[#46546A]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="max-h-[56vh] overflow-y-auto px-5 py-4">
          {visibleGroups.map((group) => (
            <section key={group.label} className="mb-5 last:mb-0">
              <h3 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#7E8795]">{group.label}</h3>
              <div className="grid gap-1">
                {group.items.map((item) => {
                  const itemIndex = visibleItems.indexOf(item);
                  return (
                    <DataLink
                      key={`${group.label}-${item.label}-${item.href}`}
                      href={item.href}
                      sourceHref={item.sourceHref}
                      className={`grid gap-1 px-3 py-2 text-inherit no-underline ${itemIndex === activeIndex ? "bg-[#EEF2F7]" : "hover:bg-[#F6F8FA]"}`}
                    >
                      <span className="truncate text-[14px] font-bold text-[#152039]">{item.label}</span>
                      <span className="truncate text-[12px] text-[#687385]">{item.detail}</span>
                    </DataLink>
                  );
                })}
              </div>
            </section>
          ))}
          {!flatItems.length ? <div className="py-8 text-center text-[14px] text-[#687385]">No visible dashboard matches.</div> : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E6ED] px-5 py-3 text-[12px] text-[#687385]">
          <span>Use ↑↓ to move, Enter to open, Escape to close.</span>
          <DashboardLink href={`/search/?q=${encodeURIComponent(query.trim())}`} className="font-bold text-[#0B4A83] underline">
            View all results
          </DashboardLink>
        </div>
      </div>
    </div>
  );
}

function BrdTabs({ tabs, active, onChange, className = "" }: {
  tabs: readonly (readonly [string, string])[];
  active: string;
  onChange: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap gap-8 border-b border-transparent text-[15px] font-bold text-[#9AA0AC] ${className}`}>
      {tabs.map(([value, label]) => (
        <button
          key={value}
          type="button"
          onClick={() => onChange(value)}
          className={`border-b border-transparent bg-transparent pb-2 ${active === value ? "border-[#1B243B] text-[#182138]" : "text-[#9AA0AC] hover:text-[#4F596D]"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

function DashboardSectionNote({ children }: { children: ReactNode }) {
  return <p className="mt-2 max-w-3xl text-[12px] leading-5 text-[#667386]">{children}</p>;
}

function BrdTable({ headers, rows: tableRows, empty }: { headers: string[]; rows: Cell[][]; empty: string }) {
  return (
    <div className="mt-5 overflow-x-auto">
      <table className="min-w-full border-collapse text-left text-[13px]">
        <thead>
          <tr className="bg-[#E9ECF1] text-[12px] font-extrabold text-[#263148]">
            {headers.map((header) => (
              <th key={header} className="border-b border-[#D8DEE8] px-3 py-2">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {tableRows.length ? tableRows.slice(0, 10).map((row, index) => (
            <tr key={index} className="border-b border-[#ECEFF4] bg-white/80">
              {row.map((cell, cellIndex) => (
                <td key={cellIndex} className={`px-3 py-2 align-top ${cellIndex === 0 ? "font-bold text-[#14213D]" : "text-[#2F3A4F]"}`}>
                  {displayCell(cell)}
                </td>
              ))}
            </tr>
          )) : (
            <tr>
              <td className="bg-white px-3 py-4 text-[#606A7C]" colSpan={headers.length}>{empty}</td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

function brdQuickLinks(entityRows: Record<string, unknown>[], transactionRows: Record<string, unknown>[], rfpRows: Record<string, unknown>[]): BrdSearchItem[] {
  return [
    ...entityRows.slice(0, 4).map((row) => ({
      label: brdText(row.name),
      detail: brdText(row.type || row.entity_type, "Entity"),
      href: dashboardProfileHref(row),
      sourceHref: sourceHref(row),
    })),
    ...transactionRows.slice(0, 1).map((row) => ({
      label: brdText(row.buyer_entity || row.institution || row.name),
      detail: "Transaction",
      href: dashboardTransactionHref(row),
      sourceHref: sourceHref(row),
    })),
    ...rfpRows.slice(0, 1).map((row) => ({
      label: brdText(row.institution || row.name),
      detail: "Compass",
      href: dashboardMandateHref(row),
      sourceHref: sourceHref(row),
    })),
  ].filter((item) => item.label !== "Not disclosed").slice(0, 6);
}

function brdSearchGroups({ query, entityRows, peopleRows, transactionRows, rfpRows, newsRows }: {
  query: string;
  entityRows: Record<string, unknown>[];
  peopleRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
}): BrdSearchGroup[] {
  const filter = (row: Record<string, unknown>) => {
    const clean = query.trim().toLowerCase();
    if (!clean) return true;
    return Object.values(row).some((value) => typeof value === "string" && value.toLowerCase().includes(clean));
  };
  const group = (label: string, items: BrdSearchItem[]): BrdSearchGroup => ({ label, items: items.slice(0, 5) });
  return [
    group("Entities", entityRows.filter(filter).map((row) => ({
      label: brdText(row.name),
      detail: [brdText(row.type || row.entity_type, "Entity"), brdText(row.country, "")].filter(Boolean).join(" · "),
      href: dashboardProfileHref(row),
      sourceHref: sourceHref(row),
    }))),
    group("RFPs & Opportunities", rfpRows.filter(filter).map((row) => ({
      label: brdText(row.title || row.name),
      detail: [brdText(row.institution, ""), brdText(row.strategy || row.asset_class_or_strategy, "")].filter(Boolean).join(" · "),
      href: dashboardMandateHref(row),
      sourceHref: sourceHref(row),
    }))),
    group("Transactions", transactionRows.filter(filter).map((row) => ({
      label: brdText(row.title || row.name),
      detail: [brdText(row.buyer_entity || row.institution, ""), cleanMoney(row.amount_display || row.capital_display || row.amount)].filter(Boolean).join(" · "),
      href: dashboardTransactionHref(row),
      sourceHref: sourceHref(row),
    }))),
    group("News & Articles", newsRows.filter(filter).map((row) => ({
      label: brdText(row.title || row.name),
      detail: [brdReadTime(row), brdText(row.source, "")].filter(Boolean).join(" · "),
      href: researchRecordHref(row),
      sourceHref: sourceHref(row),
    }))),
    group("People", peopleRows.filter(filter).map((row) => ({
      label: brdText(row.name),
      detail: [brdText(row.title, ""), brdText(row.institution, "")].filter(Boolean).join(" · "),
      href: dashboardPersonHref(row),
      sourceHref: sourceHref(row),
    }))),
  ].filter((searchGroup) => searchGroup.items.length);
}

function brdNewestRows(
  tab: "transactions" | "rfps" | "opportunities" | "people",
  transactionRows: Record<string, unknown>[],
  rfpRows: Record<string, unknown>[],
  peopleRows: Record<string, unknown>[],
): { headers: string[]; rows: Cell[][] } {
  if (tab === "transactions") {
    return {
      headers: ["Name", "Buyer Entity", "Amount (USD)"],
      rows: transactionRows.map((row) => [
        dealCell(row),
        buyerCell(row),
        cleanMoney(row.amount_display || row.capital_display || row.amount),
      ]),
    };
  }
  if (tab === "people") {
    return {
      headers: ["Name", "Title", "Institution"],
      rows: peopleRows.map((row) => [
        personCell(row),
        brdText(row.title),
        brdText(row.institution),
      ]),
    };
  }
  const visibleRfps = tab === "opportunities"
    ? rfpRows.filter((row) => /opportun/i.test(brdText(row.type || row.title || row.name, "")))
    : rfpRows.filter((row) => !/opportun/i.test(brdText(row.type, "")));
  const rowsToUse = visibleRfps.length ? visibleRfps : rfpRows;
  return {
    headers: ["Name", "Institution", "Deadline"],
    rows: rowsToUse.map((row) => [
      mandateCell(row),
      brdText(row.institution),
      timelineDate(row),
    ]),
  };
}

function brdCompassTopRows(rfpRows: Record<string, unknown>[]): Cell[][] {
  const buckets = new Map<string, { amount: number; count: number }>();
  for (const row of rfpRows) {
    const label = brdText(row.investment_type || row.strategy || row.asset_class_or_strategy || row.type, "Not disclosed");
    const current = buckets.get(label) || { amount: 0, count: 0 };
    current.count += 1;
    current.amount += numericSortValue(cleanMoney(row.amount_display || row.capital_display || row.amount)) || 0;
    buckets.set(label, current);
  }
  return [...buckets.entries()]
    .sort((a, b) => b[1].count - a[1].count || b[1].amount - a[1].amount)
    .slice(0, 10)
    .map(([label, bucket]) => [
      { label, href: `/mandates/?filter=${encodeURIComponent(label)}` },
      bucket.amount ? compactMoney(bucket.amount) : "Not disclosed",
      bucket.count.toLocaleString("en-US"),
    ]);
}

function brdSectorTopRows(sectorRows: Record<string, unknown>[]): Cell[][] {
  return sectorRows.slice(0, 10).map((row) => [
    sectorCell(row),
    cleanMoney(row.capital_display || row.capital_deployed || row.capital),
    brdText(row.count, "0"),
  ]);
}

function brdNewsRowsForTab(rowsToUse: Record<string, unknown>[], tab: "latest" | "referenced" | "topics") {
  if (tab === "referenced") {
    return [...rowsToUse].sort((a, b) => brdNewsScore(b) - brdNewsScore(a));
  }
  if (tab === "topics") {
    return [...rowsToUse].sort((a, b) => brdText(a.title || a.name).localeCompare(brdText(b.title || b.name)));
  }
  return rowsToUse;
}

function brdNewsScore(row: Record<string, unknown>) {
  return numericSortValue(brdText(row.page_views || row.views || row.legacy_post, "")) || brdText(row.content || row.excerpt, "").length || 1;
}

function brdPopularBadge(row: Record<string, unknown>, rowsToUse: Record<string, unknown>[]) {
  if (!("page_views" in row || "views" in row)) return false;
  const scores = rowsToUse.map(brdNewsScore).sort((a, b) => b - a);
  const cutoff = scores[Math.max(0, Math.floor(scores.length * 0.1) - 1)] || scores[0] || Number.POSITIVE_INFINITY;
  return brdNewsScore(row) >= cutoff;
}

function brdMarketFocusTags(sectorRows: Record<string, unknown>[]) {
  const sourceTags = sectorRows.map((row) => brdText(row.name || row.value, "")).filter(Boolean).slice(0, 8);
  return sourceTags.length ? sourceTags : ["Active Equities", "Sovereign Wealth Funds", "Real Estate"];
}

function brdImageForIndex(index: number) {
  const images = ["business_development.webp", "investor.webp", "fundraising.webp", "deal_trends.webp", "industry.webp"];
  return images[index % images.length];
}

function brdExcerpt(row: Record<string, unknown>) {
  const value = brdText(row.excerpt || row.summary || row.content, "");
  if (!value) return "SWFI intelligence record";
  return value.replace(/\s+/g, " ").slice(0, 190);
}

function brdReadTime(row: Record<string, unknown>) {
  const words = brdText(row.content || row.excerpt || row.summary || row.title || row.name, "").split(/\s+/).filter(Boolean).length;
  return `${Math.max(2, Math.min(8, Math.ceil(words / 180)))} min read`;
}

function brdText(value: unknown, fallback = "Not disclosed") {
  const result = text(value, fallback);
  return result === SOURCE_GAP || result === LOADING ? fallback : result;
}

function cleanMoney(value: unknown) {
  const result = money(value);
  return result === SOURCE_GAP || result === LOADING ? "Not disclosed" : result;
}

function cleanDisplayValue(value: string, fallback = "Not disclosed") {
  return value === SOURCE_GAP || value === LOADING || /not disclosed by swfi\.com/i.test(value) ? fallback : value;
}

function buyerCell(row: Record<string, unknown>): Cell {
  const label = brdText(row.buyer_entity || row.institution, "Not disclosed");
  const source = brdText(row.buyer_entity_url || row.institution_url, "");
  return source ? { label, href: dashboardProfileHref({ name: label, source_url: source }), sourceHref: source } : label;
}

function personCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.name),
    href: dashboardPersonHref(row),
    sourceHref: source,
    citationText: "SWFI people source on file",
  };
}

function dashboardResolvedHref(href: string) {
  if (href.startsWith("#")) return href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return isSwfiPlatformRecordHref(href) ? swfiAuthHandoffHref(href) : href;
  }
  return appHref(href);
}

function ConceptSidebar({ topRows }: { topRows: Record<string, unknown>[] }) {
  return (
    <aside data-gsap-reveal className="order-2 min-w-0 border-r border-[#132A49] bg-[#071F48] text-white lg:order-none lg:overflow-y-auto">
      <div className="flex min-h-[64px] items-center gap-3 border-b border-white/10 px-4">
        <div className="grid h-10 w-[112px] place-items-center bg-[#B90D12] px-2">
          <img src={assetHref("/swfi-assets/logo.svg")} alt="SWFI" className="h-8 w-[98px] shrink-0 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase leading-tight tracking-[0.14em] text-white">Terminal</div>
          <div className="mt-1 text-[10px] font-semibold leading-tight text-white/55">Source workspaces</div>
        </div>
      </div>
      <nav className="px-3 py-3">
        <div className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Institutional Intelligence</div>
        {navMain.map(([label, href], index) => (
          <DashboardLink
            key={label}
            href={href}
            className={`mb-1 flex min-h-9 items-center gap-2 border-l-4 px-3 text-[12px] font-semibold no-underline ${index === 0 ? "border-[#D51E29] bg-white/12 text-white" : "border-transparent text-white/70 hover:border-[#D51E29]/70 hover:bg-white/8 hover:text-white"}`}
          >
            <MiniIcon index={index} />
            <span>{label === "Deals" ? "Deals & Transactions" : label}</span>
          </DashboardLink>
        ))}
        <div className="mb-2 mt-4 px-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Analytics</div>
        {navIntel.map(([label, href], index) => (
          <DashboardLink key={label} href={href} className="mb-1 flex min-h-8 items-center gap-2 border-l-4 border-transparent px-3 text-[11.5px] font-semibold text-white/55 no-underline hover:border-[#D51E29]/70 hover:bg-white/8 hover:text-white">
            <MiniIcon index={index + 9} />
            <span>{label}</span>
          </DashboardLink>
        ))}
        <div className="mt-4 border border-white/10 bg-[#0A2B56] p-3">
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">Market Focus</div>
          {["SWF", "Pensions", "Real Estate"].map((label) => (
            <DashboardLink key={label} href={`/profiles/?filter=${encodeURIComponent(label)}`} className="flex items-center justify-between border-t border-white/10 py-2 text-[11px] font-semibold text-white/70 no-underline first:border-t-0 hover:text-white">
              <span>{label}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-white/45">Open</span>
            </DashboardLink>
          ))}
        </div>
      </nav>
      <div className="mx-3 mb-4 border border-white/10 bg-[#0A2B56] p-3">
        <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-white/45">TOP AUM RANKING</div>
        <div className="grid gap-2">
          {topRows.slice(0, 5).map((row) => (
            <div key={brdText(row.name)} className="border-t border-white/10 pt-2 first:border-t-0 first:pt-0">
              <DataLink href={dashboardProfileHref(row)} sourceHref={sourceHref(row)} className="block truncate text-[11px] font-bold text-white underline">
              {brdText(row.name)}
              </DataLink>
              <div className="mt-0.5 text-[10px] text-white/55">{entityTypeCell(row)}</div>
              <div className="text-[10px] text-white/55">{brdText(row.country)}</div>
              <div className="text-[10px] font-semibold text-white">{aumDisplay(row)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-3 mb-4 border border-white/10 p-3 text-[10.5px] font-semibold text-white/55">
        Public discovery dashboard. Protected records continue through SWFI sign-in.
      </div>
    </aside>
  );
}

function ConceptTopBar({ dataAsOfLabel, packets }: { dataAsOfLabel: string; packets: Packets }) {
  const exactCounts = [
    ["Institutions", metricNumber(packets.metrics, "institutions")],
    ["Active Allocators", numericSortValue(packetCount(packets.allocators90, "count")) || metricNumber(packets.metrics, "allocators")],
    ["Transactions", metricNumber(packets.metrics, "transactions")],
  ].filter(([, value]) => typeof value === "number" && Number.isFinite(value as number)) as [string, number][];
  return (
    <header data-gsap-reveal className="border-b border-[#8E090D] bg-[#B90D12] text-white">
      <div className="flex min-h-[64px] flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
        <div className="min-w-[190px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[18px] font-extrabold leading-tight text-white">SWFI Intelligence Terminal</span>
          </div>
          <div className="text-[11px] text-white/80">Institutional intelligence, capital activity, mandates, and market signals.</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10.5px] font-semibold text-white/85">
            {exactCounts.map(([label, value]) => <span key={label}>{label} {value.toLocaleString("en-US")}</span>)}
          </div>
        </div>
        <nav className="order-4 flex w-full flex-wrap gap-2 text-[11px] font-bold sm:order-none sm:w-auto">
          <DashboardLink href="/about/" className="text-white/90 no-underline hover:text-white">About Us</DashboardLink>
          <DashboardLink href="/solutions/" className="text-white/90 no-underline hover:text-white">Solutions</DashboardLink>
          <DashboardLink href="/demo/" className="text-white/90 no-underline hover:text-white">Demo</DashboardLink>
          <DashboardLink href="/contact/" className="text-white/90 no-underline hover:text-white">Contact Us</DashboardLink>
          <DashboardLink href="/login/" className="text-white/90 no-underline hover:text-white">Sign In</DashboardLink>
        </nav>
        <form action={appHref("/search/")} className="order-3 flex h-9 w-full items-center border border-white/30 bg-white px-2.5 text-[#444D5F] sm:order-none sm:w-[430px]">
          <span className="mr-2 text-[10px] font-black uppercase tracking-[0.12em] text-[#7A8794]">Search</span>
          <input id="dashboard-search" name="q" type="search" aria-label="Search entities, people, transactions, RFPs, and news" placeholder="Companies, investors, funds, people, reports" className="min-w-0 flex-1 bg-transparent text-[12.5px] outline-none placeholder:text-[#70798B]" />
          <button aria-label="Search" className="ml-2 border border-[#C9D3DE] bg-white px-2 py-1 text-[10px] font-bold text-[#004483]" type="submit">Go</button>
        </form>
        <div className="flex items-center gap-2">
          <div className="hidden border-l border-white/25 pl-3 text-right text-[10px] text-white/80 md:block">
            <div className="font-bold text-white">{new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date())}</div>
            <div>{dataAsOfLabel}</div>
          </div>
          <DashboardLink href="/intelligence" className="bg-[#071F48] px-3 py-2 text-[11px] font-bold text-white no-underline">
            Tools
          </DashboardLink>
        </div>
      </div>
      <div className="flex overflow-x-auto border-t border-[#E4E9EF] bg-white px-3 text-[11px] font-bold sm:px-5">
        {[
          ["Dashboard", "/"],
          ["Screeners", "/search"],
          ["Profiles", "/profiles"],
          ["Deals", "/transactions"],
          ["RFPs", "/mandates"],
          ["Research", "/intelligence"],
        ].map(([label, href], index) => (
          <DashboardLink key={label} href={href} className={`shrink-0 border-b-2 px-3 py-2 no-underline ${index === 0 ? "border-[#D51E29] text-[#071F48]" : "border-transparent text-[#5C6977] hover:border-[#AAB6C3] hover:text-[#071F48]"}`}>
            {label}
          </DashboardLink>
        ))}
      </div>
    </header>
  );
}

function ConceptKpiCard({ label, value, note, href, series, color }: {
  label: string;
  value: string;
  note: string;
  href: string;
  series: number[];
  color: string;
}) {
  return (
    <DashboardLink href={href} data-qa-min="150" className="min-w-0 border border-[#C9D3DE] bg-white px-3 py-2.5 text-inherit no-underline shadow-[0_1px_2px_rgba(20,44,70,0.05)] hover:border-[#D51E29]/50">
      <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="break-words text-[20px] font-extrabold leading-none text-[#13283D]">{value}</div>
        <MiniSparkline series={series} color={color} large />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
        <span className="font-bold text-[#1A9A68]">Updated</span>
        <span className="truncate text-[#7B8996]">{note}</span>
      </div>
      <div className="mt-2 text-[9.5px] font-semibold text-[#7B8996]">Reviewed SWFI data</div>
    </DashboardLink>
  );
}

function DashboardControlStrip({
  totalRows,
  rowLimit,
  sortColumn,
  sortDir,
  onRowLimitChange,
  onSort,
}: {
  totalRows: number;
  rowLimit: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  onRowLimitChange: (value: number) => void;
  onSort: (column: number) => void;
}) {
  const visibleRows = Math.min(rowLimit, totalRows);
  const sortButtons = ["Result", "Metric", "Source", "Detail"];
  return (
    <section data-gsap-reveal className="mb-3 flex flex-wrap items-center gap-2 border border-[#C9D3DE] bg-white px-3 py-2 text-[11.5px] text-[#405062] shadow-[0_1px_2px_rgba(20,44,70,0.05)]">
      <div className="mr-auto font-bold">
        Showing {visibleRows.toLocaleString("en-US")} of {totalRows.toLocaleString("en-US")}
      </div>
      <label className="flex items-center gap-2 font-bold">
        <span>Rows</span>
        <select
          value={rowLimit}
          onChange={(event) => onRowLimitChange(Number(event.target.value))}
          className="min-h-8 border border-[#B8C4D0] bg-white px-2 text-[#203448]"
        >
          {[5, 10, 25].map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-1">
        {sortButtons.map((label, index) => (
          <button
            key={label}
            type="button"
            onClick={() => onSort(index)}
            className="min-h-8 border border-[#B8C4D0] bg-white px-2.5 font-bold text-[#0A3A7A] hover:border-[#B90D12]/50"
          >
            {label}{sortColumn === index ? ` ${sortDir}` : ""}
          </button>
        ))}
      </div>
    </section>
  );
}

function ExpandablePanel({ id, title, href, expanded, onToggle, children, detail, className = "" }: {
  id: string;
  title: string;
  href: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  detail?: ReactNode;
  className?: string;
}) {
  return (
    <section id={id} data-panel-id={id} className={`min-w-0 overflow-hidden border border-[#C9D3DE] bg-white shadow-[0_1px_2px_rgba(20,44,70,0.05)] ${expanded ? "ring-2 ring-[#D51E29]/15" : ""} ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#E3EAF1] bg-[#F8FAFC] px-3 py-2">
        <button type="button" data-panel-toggle={id} aria-expanded={expanded} aria-controls={`${id}-detail`} aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} onClick={() => onToggle(id)} className="flex min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left">
          <span className="grid h-5 w-5 place-items-center border border-[#C9D3DE] bg-white text-[11px] font-black text-[#D51E29]">{expanded ? "−" : "+"}</span>
          <span className="truncate text-[12px] font-extrabold text-[#1E3145]">{title}</span>
        </button>
        <DashboardLink href={href} className="border border-[#C9D3DE] bg-white px-2 py-1 text-[10px] font-bold text-[#0A3A7A] no-underline">View all</DashboardLink>
      </div>
      <div className="p-3">{children}</div>
      {expanded && detail ? (
        <div id={`${id}-detail`} className="border-t border-[#EEF2F5] bg-[#F8FAFC] p-3">{detail}</div>
      ) : null}
    </section>
  );
}

function GlobalCapitalMap({ topRows, sectorRows }: { topRows: Record<string, unknown>[]; sectorRows: Record<string, unknown>[] }) {
  const topCapital = topRows.slice(0, 4);
  const sectorCapital = sumNumbers(sectorRows.map(sectorValue));
  const nodes = mapNodes(sectorRows);
  return (
    <div className="grid min-h-[250px] gap-3">
      <div className="relative min-h-[190px] overflow-hidden rounded-[6px] bg-[#F7FAFD]">
        <svg viewBox="0 0 700 285" className="absolute inset-0 h-full w-full" role="img" aria-label="Sector activity and top AUM map">
          <defs>
            <radialGradient id="mapNode" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0A66C2" stopOpacity="0.95" />
              <stop offset="100%" stopColor="#0A66C2" stopOpacity="0.06" />
            </radialGradient>
            <linearGradient id="flowLine" x1="0" x2="1" y1="0" y2="0">
              <stop offset="0%" stopColor="#0A66C2" stopOpacity="0.18" />
              <stop offset="55%" stopColor="#0A66C2" stopOpacity="0.68" />
              <stop offset="100%" stopColor="#B90D12" stopOpacity="0.55" />
            </linearGradient>
          </defs>
          {mapDots().map((dot) => (
            <circle key={`${dot.x}-${dot.y}`} cx={dot.x} cy={dot.y} r="1.15" fill="#2A74D6" opacity={dot.opacity} />
          ))}
          {mapFlows(nodes).map((flow) => (
            <path key={flow} d={flow} fill="none" stroke="url(#flowLine)" strokeDasharray="3 5" strokeWidth="1.5" />
          ))}
          {nodes.map((node, index) => (
            <g key={node.label}>
              <circle cx={node.x} cy={node.y} r={node.r + 12} fill="url(#mapNode)" opacity={0.2} />
              <circle cx={node.x} cy={node.y} r={node.r} fill={index === 0 ? "#B90D12" : "#0A66C2"} opacity="0.88" />
              <text x={node.x + 11} y={node.y - 9} fill="#23364A" fontSize="9" fontWeight="700">{node.label}</text>
            </g>
          ))}
        </svg>
        <div className="absolute left-3 top-3 rounded-[5px] bg-white/90 px-3 py-2 shadow-sm">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">Sector activity</div>
          <div className="mt-1 text-[18px] font-extrabold text-[#13283D]">{compactMoney(sectorCapital)}</div>
          <div className="mt-1 text-[9px] font-semibold text-[#7B8996]">Industry activity</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        {topCapital.map((row) => (
          <DataLink key={brdText(row.name)} href={dashboardProfileHref(row)} sourceHref={sourceHref(row)} className="rounded-[5px] border border-[#E1E8EF] px-2 py-2 text-[#405062] no-underline">
            <span className="block truncate font-bold text-[#0A3A7A]">{brdText(row.name)}</span>
            <span className="mt-1 block text-[#7B8996]">{brdText(row.country)} · {aumDisplay(row)}</span>
          </DataLink>
        ))}
      </div>
    </div>
  );
}

function CapitalFlowPanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const chartRows = sourceRows.slice(0, 6);
  return (
    <div className="grid gap-3 lg:grid-cols-[118px_minmax(0,1fr)]">
      <div className="grid content-start gap-2">
        {chartRows.slice(0, 4).map((row, index) => (
          <div key={brdText(row.name || row.value)} className="rounded-[5px] border border-[#E3EAF0] bg-[#F8FAFC] px-2 py-2">
            <div className="truncate text-[10px] font-bold text-[#516273]">{brdText(row.name || row.value)}</div>
            <div className="mt-1 text-[11px] font-extrabold text-[#13283D]">{cleanMoney(row.capital_display || row.capital_deployed || row.capital)}</div>
            <div className={`mt-1 text-[10px] font-bold ${index % 2 ? "text-[#B90D12]" : "text-[#1A9A68]"}`}>SWFI sector facet</div>
          </div>
        ))}
      </div>
      <StackedArea rows={chartRows} />
    </div>
  );
}

function AiInsightsPanel({ topInvestors, marketRows, fundraisingRows, newsRows }: {
  topInvestors: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
}) {
  const insights = [
    { label: "Institutional allocator activity", row: topInvestors[0], href: "/allocators", detail: topInvestors[0] ? `${brdText(topInvestors[0].name)} · ${dealCountLabel(activityCountValue(topInvestors[0]))}` : DASHBOARD_EMPTY },
    { label: "Largest recent deal", row: marketRows[0], href: "/deals", detail: marketRows[0] ? `${brdText(marketRows[0].title || marketRows[0].name)} · ${cleanMoney(marketRows[0].amount_display || marketRows[0].capital_display || marketRows[0].amount)}` : DASHBOARD_EMPTY },
    { label: "Open mandate deadline", row: fundraisingRows[0], href: "/mandates", detail: fundraisingRows[0] ? `${brdText(fundraisingRows[0].title || fundraisingRows[0].name)} · ${timelineDate(fundraisingRows[0])}` : DASHBOARD_EMPTY },
    { label: "Latest intelligence", row: newsRows[0], href: newsRows[0] ? researchRecordHref(newsRows[0]) : "/intelligence", detail: newsRows[0] ? brdText(newsRows[0].title || newsRows[0].name) : DASHBOARD_EMPTY },
  ];
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        {insightNav.map(([label, href]) => (
          <DashboardLink key={label} href={href} className="rounded-[5px] border border-[#E2E8EF] bg-[#F8FAFC] px-2 py-1.5 text-center text-[10.5px] font-extrabold text-[#0A3A7A] no-underline hover:bg-[#EEF4FA]">
            {label}
          </DashboardLink>
        ))}
      </div>
      {insights.map((insight, index) => (
        <DashboardLink key={insight.label} href={insight.href} className="grid grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-[6px] border border-[#E5EBF1] px-2.5 py-2 text-inherit no-underline">
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[#F1F5F8] text-[11px] font-extrabold text-[#B90D12]">{index + 1}</span>
          <span className="min-w-0">
            <span className="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#7B8996]">{insight.label}</span>
            <span className="mt-1 block truncate text-[12px] font-bold text-[#203448]">{insight.detail}</span>
          </span>
        </DashboardLink>
      ))}
    </div>
  );
}

function MarketIntelligencePanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const chartRows = sourceRows.slice(0, 5);
  return (
    <div className="grid gap-1.5">
      {chartRows.map((row, index) => (
        <DashboardLink key={`${brdText(row.name || row.value)}-${index}`} href={`/deals/?filter=${encodeURIComponent(brdText(row.name || row.value, ""))}`} className="grid grid-cols-[minmax(0,1fr)_70px] gap-2 rounded-[4px] px-2 py-1.5 text-[11.5px] text-[#405062] no-underline hover:bg-[#F5F8FB]">
          <span className="truncate font-bold">{brdText(row.name || row.value)}</span>
          <span className="text-right font-extrabold text-[#1A9A68]">{brdText(row.count)}</span>
        </DashboardLink>
      ))}
    </div>
  );
}

function PipelineFunnelPanel({ packets, topRows, marketRows, fundraisingRows }: {
  packets: Packets;
  topRows: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
}) {
  const stages = [
    { label: "Institutions", value: metricNumber(packets.metrics, "institutions") || topRows.length, href: "/profiles", color: "#7D28CF" },
    { label: "Active Allocators", value: numericSortValue(packetCount(packets.allocators90, "count")) || topRows.length, href: "/allocators", color: "#944AE2" },
    { label: "Deals", value: metricNumber(packets.metrics, "transactions") || marketRows.length, href: "/deals", color: "#B368EC" },
    { label: "Live RFPs", value: metricNumber(packets.metrics, "rfps") || fundraisingRows.length, href: "/mandates", color: "#D196F1" },
    { label: "Top AUM", value: topRows.length, href: "/profiles", color: "#E9C9F6" },
  ];
  const max = Math.max(1, ...stages.map((stage) => stage.value));
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_150px]">
      <svg viewBox="0 0 380 250" className="h-[220px] w-full" role="img" aria-label="Pipeline funnel">
        {stages.map((stage, index) => {
          const topWidth = 320 - index * 48;
          const bottomWidth = 320 - (index + 1) * 48;
          const y = 16 + index * 42;
          const cx = 190;
          const d = `M${cx - topWidth / 2} ${y} L${cx + topWidth / 2} ${y} L${cx + bottomWidth / 2} ${y + 34} L${cx - bottomWidth / 2} ${y + 34} Z`;
          return (
            <DashboardLink key={stage.label} href={stage.href}>
              <path d={d} fill={stage.color} opacity={0.92} />
              <text x={cx} y={y + 22} textAnchor="middle" fill="white" fontSize="13" fontWeight="800">{stage.label}</text>
            </DashboardLink>
          );
        })}
      </svg>
      <div className="grid content-center gap-2">
        {stages.map((stage) => (
          <DashboardLink key={stage.label} href={stage.href} className="flex items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 text-[11px] text-[#405062] no-underline hover:bg-[#F5F8FB]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />{stage.label}</span>
            <span className="font-extrabold text-[#13283D]">{compactNumber(stage.value)}</span>
          </DashboardLink>
        ))}
        <div className="text-[10px] font-semibold text-[#7B8996]">Funnel widths normalize against {compactNumber(max)} records.</div>
      </div>
    </div>
  );
}

function RelationshipPanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const visible = sourceRows.slice(0, 5);
  return (
    <div className="grid gap-2">
      {visible.map((row, index) => (
        <DataLink key={`${brdText(row.name)}-${index}`} href={dashboardProfileHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[26px_minmax(0,1fr)_76px] items-center gap-2 rounded-[5px] px-2 py-1.5 text-[#405062] no-underline hover:bg-[#F5F8FB]">
          <span className="font-extrabold text-[#8A97A4]">{index + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.name)}</span>
            <span className="block truncate text-[10.5px] text-[#7B8996]">{allocatorMeta(row)}</span>
          </span>
          <span className="text-right text-[11px] font-extrabold text-[#1A9A68]">{dealCountLabel(activityCountValue(row))}</span>
        </DataLink>
      ))}
    </div>
  );
}

function ResearchHubPanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const images = ["investor.webp", "deal_trends.webp", "industry.webp", "fundraising.webp"];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sourceRows.slice(0, 4).map((row, index) => (
        <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="overflow-hidden rounded-[6px] border border-[#E4EAF0] bg-[#F8FAFC] text-inherit no-underline">
          <img src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" className="h-16 w-full object-cover" />
          <span className="block p-2">
            <span className="block truncate text-[11px] font-extrabold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
            <span className="mt-1 block text-[10px] text-[#7B8996]">{brdText(row.published_at || row.date, "SWFI record")}</span>
          </span>
        </DataLink>
      ))}
    </div>
  );
}

function EngagementCards({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const images = ["business_development.webp", "fundraising.webp", "asset_owner.webp"];
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {sourceRows.slice(0, 3).map((row, index) => (
        <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={dashboardMandateHref(row)} sourceHref={sourceHref(row)} className="overflow-hidden rounded-[6px] border border-[#E4EAF0] bg-[#F8FAFC] text-inherit no-underline">
          <img src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" className="h-16 w-full object-cover" />
          <span className="block p-2">
            <span className="block truncate text-[11px] font-extrabold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
            <span className="mt-1 block text-[10px] text-[#7B8996]">{brdText(row.institution)} · {timelineDate(row)}</span>
          </span>
        </DataLink>
      ))}
    </div>
  );
}

function ActivityFeedPanel({ marketRows, newsRows, fundraisingRows }: {
  marketRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
}) {
  const items = [
    ...marketRows.slice(0, 2).map((row) => ({ row, label: "Deal updated", href: dashboardTransactionHref(row), detail: brdText(row.title || row.name) })),
    ...fundraisingRows.slice(0, 2).map((row) => ({ row, label: "Mandate posted", href: dashboardMandateHref(row), detail: brdText(row.title || row.name) })),
    ...newsRows.slice(0, 2).map((row) => ({ row, label: "Research published", href: researchRecordHref(row), detail: brdText(row.title || row.name) })),
  ].slice(0, 5);
  return (
    <div className="grid gap-2">
      {items.map((item, index) => (
        <DataLink key={`${item.label}-${index}`} href={item.href} sourceHref={sourceHref(item.row)} className="grid grid-cols-[9px_minmax(0,1fr)] gap-2 text-inherit no-underline">
          <span className="mt-1.5 h-2 w-2 rounded-full bg-[#B90D12]" />
          <span className="min-w-0">
            <span className="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#7B8996]">{item.label}</span>
            <span className="block truncate text-[12px] font-bold text-[#203448]">{item.detail}</span>
          </span>
        </DataLink>
      ))}
    </div>
  );
}

function DealIntelligencePanel({ rows: sourceRows, sectorRows }: { rows: Record<string, unknown>[]; sectorRows: Record<string, unknown>[] }) {
  const topDeals = [...sourceRows].sort((a, b) => amountValue(b) - amountValue(a)).slice(0, 4);
  const topDeal = topDeals[0];
  const topSector = sectorRows[0];
  const gauge = dealGaugePercent(sectorRows);
  return (
    <div className="grid gap-3">
      <div className="flex items-center gap-3">
        <DonutGauge value={gauge} />
        <div className="min-w-0">
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">Deal momentum</div>
          <div className="mt-1 text-[13px] font-bold text-[#203448]">{topSector ? brdText(topSector.name || topSector.value) : DASHBOARD_EMPTY}</div>
          <div className="mt-1 text-[11px] text-[#7B8996]">{topSector ? `${brdText(topSector.count)} items` : "No current activity"}</div>
        </div>
      </div>
      {topDeal ? (
        <DataLink href={dashboardTransactionHref(topDeal)} sourceHref={sourceHref(topDeal)} className="rounded-[6px] bg-[#F8FAFC] p-3 text-inherit no-underline">
          <span className="block text-[11px] font-bold text-[#0A3A7A]">{brdText(topDeal.title || topDeal.name)}</span>
          <span className="mt-1 block text-[18px] font-extrabold text-[#13283D]">{cleanMoney(topDeal.amount_display || topDeal.capital_display || topDeal.amount)}</span>
        </DataLink>
      ) : <div className="text-[12px] text-[#405062]">{DASHBOARD_EMPTY}</div>}
      {topDeals.length > 1 ? (
        <div className="grid gap-1">
          {topDeals.slice(1).map((row, index) => (
            <DataLink
              key={`${brdText(row.title || row.name)}-${index}`}
              href={dashboardTransactionHref(row)}
              sourceHref={sourceHref(row)}
              className="grid grid-cols-[minmax(0,1fr)_82px] gap-2 rounded-[5px] px-2 py-1.5 text-[11px] text-[#405062] no-underline hover:bg-[#F5F8FB]"
            >
              <span className="truncate font-bold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
              <span className="text-right font-extrabold text-[#13283D]">{cleanMoney(row.amount_display || row.capital_display || row.amount)}</span>
            </DataLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

type UnifiedInsight = {
  label: string;
  title: string;
  detail: string;
  href: string;
  sourceHref?: string;
  metric: string;
  value: number;
};

function unifiedIntelligenceRows({
  topInvestors,
  marketRows,
  fundraisingRows,
  newsRows,
  sectorRows,
}: {
  topInvestors: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}): UnifiedInsight[] {
  const insights: UnifiedInsight[] = [];
  const allocator = topInvestors[0];
  if (allocator) {
    const source = sourceHref(allocator);
    const deals = activityCountValue(allocator);
    insights.push({
      label: "Allocator",
      title: brdText(allocator.name),
      detail: [allocatorMeta(allocator), dealCountLabel(deals)].filter(Boolean).join(" · "),
      href: dashboardProfileHref(allocator),
      sourceHref: source,
      metric: dealCountLabel(deals),
      value: deals || 1,
    });
  }

  const deal = [...marketRows].sort((a, b) => amountValue(b) - amountValue(a))[0];
  if (deal) {
    const source = sourceHref(deal);
    const amount = amountValue(deal);
    insights.push({
      label: "Deal",
      title: brdText(deal.title || deal.name),
      detail: [brdText(deal.institution, ""), brdText(deal.sector || deal.industry || deal.category, "")].filter(Boolean).join(" · "),
      href: dashboardTransactionHref(deal),
      sourceHref: source,
      metric: amount ? compactMoney(amount) : cleanMoney(deal.amount_display || deal.capital_display || deal.amount),
      value: amount || 1,
    });
  }

  const mandate = [...fundraisingRows].sort((a, b) => deadlineTime(a) - deadlineTime(b))[0];
  if (mandate) {
    const source = sourceHref(mandate);
    const score = mandateUrgencyScore(mandate);
    insights.push({
      label: "RFP",
      title: brdText(mandate.title || mandate.name),
      detail: [brdText(mandate.institution, ""), brdText(mandate.strategy || mandate.asset_class_or_strategy, ""), timelineDate(mandate)].filter(Boolean).join(" · "),
      href: dashboardMandateHref(mandate),
      sourceHref: source,
      metric: timelineDate(mandate),
      value: score,
    });
  }

  const sector = [...sectorRows].sort((a, b) => sectorValue(b) - sectorValue(a))[0];
  if (sector) {
    const label = brdText(sector.name || sector.value);
    const value = sectorValue(sector);
    insights.push({
      label: "Sector",
      title: label,
      detail: `${brdText(sector.count)} transactions · ${cleanMoney(sector.capital_display || sector.capital_deployed || sector.capital)}`,
      href: `/deals/?filter=${encodeURIComponent(label)}`,
      metric: value ? compactMoney(value) : brdText(sector.count),
      value: value || numericSortValue(brdText(sector.count, "")) || 1,
    });
  }

  const news = newsRows[0];
  if (news) {
    const source = sourceHref(news);
    insights.push({
      label: "Intel",
      title: brdText(news.title || news.name),
      detail: [brdText(news.source, ""), brdText(news.published_at || news.date, "")].filter(Boolean).join(" · "),
      href: researchRecordHref(news),
      sourceHref: source,
      metric: "Latest",
      value: publishedRecencyScore(news),
    });
  }

  return insights;
}

function UnifiedIntelligencePanel({ rows: insights }: { rows: UnifiedInsight[] }) {
  const max = Math.max(1, ...insights.map((insight) => insight.value));
  const visible = insights.slice(0, 5);
  return (
    <div className="grid gap-3">
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-5" role="img" aria-label="Institutional activity heatmap">
        {visible.map((insight, index) => {
          const intensity = Math.max(16, Math.round((insight.value / max) * 100));
          return (
            <DataLink
              key={insight.label}
              href={insight.href}
              sourceHref={insight.sourceHref}
              className="min-h-[70px] rounded-[5px] border border-[#E1E8EF] p-2 text-inherit no-underline"
              style={{
                backgroundColor: `rgba(10, 58, 122, ${0.08 + (intensity / 100) * 0.22})`,
              }}
            >
              <span className="block text-[9px] font-extrabold uppercase tracking-[0.08em] text-[#526171]">{insight.label}</span>
              <span className="mt-1 block text-[15px] font-extrabold text-[#13283D]">{insight.metric}</span>
              <span className="mt-1 block h-1.5 overflow-hidden rounded bg-white/70">
                <span className="block h-full rounded bg-[#B90D12]" style={{ width: `${intensity}%` }} />
              </span>
              <span className="sr-only">{index + 1}. {insight.title}</span>
            </DataLink>
          );
        })}
      </div>
      <div className="grid gap-2">
        {visible.map((insight) => (
          <DataLink
            key={`${insight.label}-${insight.title}`}
            href={insight.href}
            sourceHref={insight.sourceHref}
            className="grid grid-cols-[104px_minmax(0,1fr)] gap-2 rounded-[6px] border border-[#E5EBF1] px-2.5 py-2 text-inherit no-underline hover:bg-[#F5F8FB]"
          >
            <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#7B8996]">{insight.label}</span>
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{insight.title}</span>
              <span className="mt-0.5 block truncate text-[10.5px] text-[#657484]">{insight.detail}</span>
            </span>
          </DataLink>
        ))}
      </div>
      {!visible.length ? <div className="text-[12px] text-[#405062]">{DASHBOARD_EMPTY}</div> : null}
      <div className="text-[10px] font-semibold text-[#7B8996]">Joined from available SWFI source packets.</div>
    </div>
  );
}

function NewsTicker({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const visible = sourceRows.slice(0, 6);
  return (
    <div className="flex min-h-10 items-center gap-4 px-3 text-[11px]">
      <div className="shrink-0 font-extrabold uppercase tracking-[0.14em] text-[#80A9DD]">Latest News & Intelligence</div>
      <div className="flex min-w-0 flex-1 gap-6 overflow-hidden">
        {visible.map((row) => (
          <DataLink key={brdText(row.title || row.name)} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="shrink-0 text-white/90 no-underline">
            {brdText(row.title || row.name)}
          </DataLink>
        ))}
      </div>
    </div>
  );
}

function dashboardMetricCards(packets: Packets, topAumRows: Record<string, unknown>[], sectorRows: Record<string, unknown>[]) {
  const totalAum = totalAumValue(packets.top20, topAumRows);
  const activeAllocators = numericSortValue(packetCount(packets.allocators90, "count")) || metricNumber(packets.metrics, "allocators") || 0;
  const sectorCapital = sumNumbers(sectorRows.map(sectorValue));
  const rfps = metricNumber(packets.metrics, "rfps") || packetCountNumber(packets.rfps) || 0;
  const swfs = metricNumber(packets.metrics, "swfs") || packetCountNumber(packets.entities) || 0;
  const research = metricNumber(packets.metrics, "news") || packetCountNumber(packets.news) || 0;
  return [
    {
      label: "TOTAL AUM ENGAGED",
      value: totalAum ? compactMoney(totalAum) : metricCardWithFallback(packets.metrics, "institutions", packetCountNumber(packets.entities)),
      note: "Capital visualization",
      href: "#capital-map",
      series: seriesFromNumbers(topAumRows.map(aumValue)),
      color: "#0A66C2",
    },
    {
      label: "ACTIVE RELATIONSHIPS",
      value: activeAllocators ? compactNumber(activeAllocators) : packetCount(packets.allocators90, "count"),
      note: "Allocator activity",
      href: "/allocators",
      series: seriesFromNumbers([activeAllocators]),
      color: "#1A9A68",
    },
    {
      label: "PIPELINE VALUE",
      value: sectorCapital ? compactMoney(sectorCapital) : metricCard(packets.metrics, "transactions"),
      note: "Capital flows",
      href: "/deals",
      series: seriesFromNumbers(sectorRows.map(sectorValue)),
      color: "#E4A400",
    },
    {
      label: "LIVE RFPS / MANDATES",
      value: rfps ? compactNumber(rfps) : "Not disclosed",
      note: "Live RFPs",
      href: "/mandates",
      series: seriesFromNumbers([rfps]),
      color: "#A85BE3",
    },
    {
      label: "SWF PROFILES",
      value: swfs ? compactNumber(swfs) : "Not disclosed",
      note: "SWF profiles",
      href: "/profiles/?filter=Sovereign%20Wealth%20Fund",
      series: seriesFromNumbers([swfs]),
      color: "#C25656",
    },
    {
      label: "INTELLIGENCE ITEMS",
      value: research ? compactNumber(research) : packetCount(packets.news, "count"),
      note: "Intelligence items",
      href: "/intelligence",
      series: seriesFromNumbers([research]),
      color: "#2C78D2",
    },
  ];
}

function MiniIcon({ index }: { index: number }) {
  const shapes = [
    "M4 13h16M4 7h16M4 19h10",
    "M5 18V8l7-4 7 4v10H5z",
    "M7 17h10M9 17V7h6v10",
    "M5 12h14M12 5v14",
    "M6 7h12v10H6zM9 10h6",
    "M6 18l5-12 3 7 4-5",
  ];
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4 shrink-0" aria-hidden="true">
      <path d={shapes[index % shapes.length]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function TopIcon({ label, path }: { label: string; path: string }) {
  return (
    <button type="button" title={label} className="grid h-9 w-9 place-items-center rounded-[5px] border border-white/20 bg-white/10 text-white hover:bg-white/20">
      <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true">
        <path d={path} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </button>
  );
}

function MiniSparkline({ series, color, large = false }: { series: number[]; color: string; large?: boolean }) {
  const values = seriesFromNumbers(series);
  const max = Math.max(1, ...values);
  const min = Math.min(...values);
  const spread = Math.max(1, max - min);
  const width = large ? 70 : 48;
  const height = large ? 28 : 18;
  const points = values.map((value, index) => {
    const x = values.length <= 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / spread) * (height - 4) - 2;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className={large ? "h-7 w-[70px]" : "h-[18px] w-12"} aria-hidden="true">
      <polyline points={points} fill="none" stroke={color} strokeWidth={large ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function StackedArea({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const chartRows = sourceRows.slice(0, 6);
  const palette = ["#0A3A7A", "#2C78D2", "#25A36F", "#E0A415", "#B90D12", "#8E56D8"];
  const layers = deterministicStackLayers(chartRows);
  const max = Math.max(1, ...layers.flatMap((layer) => layer.top));
  const plot = { left: 42, top: 22, width: 438, height: 176 };
  return (
    <div className="grid gap-2">
      <svg viewBox="0 0 520 240" className="h-[230px] w-full rounded-[6px] bg-[#F5F8FB]" role="img" aria-label="Stacked capital flow chart">
        {[0, 1, 2, 3, 4].map((line) => (
          <g key={line}>
            <line x1={plot.left} x2={plot.left + plot.width} y1={plot.top + line * 39} y2={plot.top + line * 39} stroke="#DCE5ED" strokeWidth="1" />
            <text x="12" y={plot.top + line * 39 + 4} fill="#526171" fontSize="9">{compactMoney(max * (1 - line / 4))}</text>
          </g>
        ))}
        {layers.map((layer, index) => {
          const d = stackedAreaPath(layer, max, plot);
          return <path key={layer.label} d={d} fill={palette[index % palette.length]} opacity={0.88 - index * 0.04} />;
        })}
        {flowLabels().map((label, index) => (
          <text key={label} x={plot.left + (plot.width / 5) * index} y="224" fill="#526171" fontSize="10" fontWeight="700">{label}</text>
        ))}
      </svg>
      <div className="flex flex-wrap gap-2 text-[10px] text-[#526171]">
        {chartRows.map((row, index) => (
          <DashboardLink key={brdText(row.name || row.value)} href={`/deals/?filter=${encodeURIComponent(brdText(row.name || row.value, ""))}`} className="flex items-center gap-1 text-[#526171] no-underline">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
            <span>{brdText(row.name || row.value)}</span>
          </DashboardLink>
        ))}
      </div>
    </div>
  );
}

function ExpandedEntityRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Entity", "Type", "Country", "AUM"]}
      rows={sourceRows.map((row) => [entityCell(row), entityTypeCell(row), brdText(row.country), aumDisplay(row)])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function TotalAumInsightDetail({ topRows, entityRows, transactionRows, rfpRows, sectorRows }: {
  topRows: Record<string, unknown>[];
  entityRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}) {
  const baseRows = entityRows.length ? entityRows : topRows;
  const typeRows = groupedCountRows(baseRows, (row) => entityTypeCell(row)).slice(0, 6);
  const regionRows = groupedAmountRows(topRows, (row) => brdText(row.region || row.country)).slice(0, 6);
  const fundraisingRows = rfpRows.slice(0, 5);
  const trendRows = sectorRows.slice(0, 6);
  const maxTrend = Math.max(1, ...trendRows.map(sectorValue));
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <VisualPanel title="Institutions by Entity Type" source={ENDPOINTS.entities} empty={DASHBOARD_EMPTY} hasRows={typeRows.length > 0}>
        <div className="grid gap-2">
          {typeRows.map((row) => (
            <div key={row.label} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-bold text-[#203448]">{row.label}</span>
                <span className="font-extrabold text-[#0A3A7A]">{compactNumber(row.value)}</span>
              </div>
              <Bar value={row.value} max={typeRows[0]?.value || 1} />
            </div>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Regional AUM Concentration" source={ENDPOINTS.top20} empty={DASHBOARD_EMPTY} hasRows={regionRows.length > 0}>
        <div className="grid gap-2">
          {regionRows.map((row) => (
            <div key={row.label} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-bold text-[#203448]">{row.label}</span>
                <span className="font-extrabold text-[#0A3A7A]">{compactMoney(row.value)}</span>
              </div>
              <Bar value={row.value} max={regionRows[0]?.value || 1} />
            </div>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Recently Fundraising Institutions" source={ENDPOINTS.rfps} empty={DASHBOARD_EMPTY} hasRows={fundraisingRows.length > 0}>
        <div className="grid gap-2">
          {fundraisingRows.map((row, index) => (
            <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={dashboardMandateHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[minmax(0,1fr)_78px] gap-2 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.institution || row.name)}</span>
                <span className="block truncate text-[10.5px] text-[#7B8996]">{brdText(row.title || row.strategy || row.asset_class_or_strategy)}</span>
              </span>
              <span className="text-right text-[11px] font-extrabold text-[#41566B]">{timelineDate(row)}</span>
            </DataLink>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Investment Trends by Industry / Category" source={ENDPOINTS.sectorFlows} empty={DASHBOARD_EMPTY} hasRows={trendRows.length > 0}>
        <div className="grid gap-2">
          {trendRows.map((row, index) => {
            const value = sectorValue(row);
            return (
              <DataLink key={`${brdText(row.name || row.value)}-${index}`} href={`/deals/?filter=${encodeURIComponent(brdText(row.name || row.value, ""))}`} sourceHref={sourceHref(row)} className="grid gap-1 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline">
                <span className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate font-bold text-[#0A3A7A]">{brdText(row.name || row.value)}</span>
                  <span className="font-extrabold text-[#41566B]">{cleanMoney(row.capital_display || row.capital_deployed || row.capital)}</span>
                </span>
                <Bar value={value} max={maxTrend} />
              </DataLink>
            );
          })}
        </div>
      </VisualPanel>
      <VisualPanel title="Recent Capital Activity" source={ENDPOINTS.transactions30} empty={DASHBOARD_EMPTY} hasRows={transactionRows.length > 0}>
        <div className="grid gap-2">
          {transactionRows.slice(0, 5).map((row, index) => (
            <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={dashboardTransactionHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[minmax(0,1fr)_90px] gap-2 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline xl:col-span-2">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
                <span className="block truncate text-[10.5px] text-[#7B8996]">{brdText(row.buyer_entity || row.institution)} · {brdText(row.sector || row.industry || row.category)}</span>
              </span>
              <span className="text-right text-[11px] font-extrabold text-[#41566B]">{cleanMoney(row.amount_display || row.capital_display || row.amount)}</span>
            </DataLink>
          ))}
        </div>
      </VisualPanel>
    </div>
  );
}

function ExpandedInvestorRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Entity", "Deals", "Type", "Region"]}
      rows={sourceRows.map((row) => [entityCell(row), activityCountCell(row), entityTypeCell(row), brdText(row.region || row.country)])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function ExpandedDealRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Deal", "Institution", "Industry / Category", "Amount"]}
      rows={sourceRows.map((row) => [dealCell(row), brdText(row.institution), brdText(row.sector || row.industry || row.category), cleanMoney(row.amount_display || row.capital_display || row.amount)])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function ExpandedMandateRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Mandate", "Institution", "Strategy", "Deadline"]}
      rows={sourceRows.map((row) => [mandateCell(row), brdText(row.institution), brdText(row.strategy || row.asset_class_or_strategy), brdText(row.deadline || row.due_at)])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function ExpandedNewsRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Headline", "Source", "Published", "Record"]}
      rows={sourceRows.map((row) => [researchCell(row), brdText(row.source), brdText(row.published_at || row.date, "Not disclosed"), sourceDetailCell("SWFI source", sourceHref(row), "/intelligence/")])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function ExpandedSectorRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Industry / Category", "Capital", "Transactions", "Open"]}
      rows={sourceRows.map((row) => [sectorCell(row), cleanMoney(row.capital_display || row.capital_deployed || row.capital), brdText(row.count), sectorCell(row)])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function ExpandedUnifiedInsightRows({ rows: insights, controls }: { rows: UnifiedInsight[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Signal", "Record", "Metric", "Source Detail"]}
      rows={insights.map((insight) => [
        insight.label,
        { label: insight.title, href: insight.href, sourceHref: insight.sourceHref, citationText: "SWFI source on file" },
        insight.metric,
        insight.detail,
      ])}
      empty={DASHBOARD_EMPTY}
      controls={controls}
    />
  );
}

function MiniRecordTable({ headers, rows: sourceRows, empty, controls }: { headers: string[]; rows: Cell[][]; empty: string; controls: DashboardTableControls }) {
  const safeSortColumn = Math.min(controls.sortColumn, Math.max(0, headers.length - 1));
  const sortedRows = [...sourceRows].sort((a, b) => compareCells(a[safeSortColumn], b[safeSortColumn], controls.sortDir));
  const visible = sortedRows.slice(0, controls.rowLimit);
  return (
    <div className="min-w-0 overflow-x-auto">
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7B8996]">Showing {visible.length.toLocaleString("en-US")} of {sourceRows.length.toLocaleString("en-US")}</div>
      <div className="min-w-[560px]">
        <div className="grid grid-cols-4 gap-2 border-b border-[#DDE6EE] pb-1 text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#6B7784]">
          {headers.map((header) => <div key={header}>{header}</div>)}
        </div>
        {visible.length ? visible.map((row, index) => (
          <div key={index} className="grid grid-cols-4 gap-2 border-b border-[#E9EEF3] py-2 text-[11.5px] text-[#405062] last:border-b-0">
            {row.map((cell, cellIndex) => (
              <div key={cellIndex} className={`min-w-0 break-words ${cellIndex === 0 ? "font-bold text-[#0A3A7A]" : ""}`}>{displayCell(cell)}</div>
            ))}
          </div>
        )) : <div className="py-2 text-[12px] text-[#405062]">{empty}</div>}
      </div>
    </div>
  );
}

function mapNodes(rows: Record<string, unknown>[]) {
  const values = rows.slice(0, 5)
    .map(sectorValue)
    .filter((value) => Number.isFinite(value) && value > 0);
  const max = Math.max(1, ...values);
  const valueAt = (index: number) => values[index] ?? 0;
  return [
    { label: "North America", x: 135, y: 121, r: nodeRadius(valueAt(0), max) },
    { label: "Europe", x: 335, y: 105, r: nodeRadius(valueAt(1), max) },
    { label: "Middle East", x: 405, y: 143, r: nodeRadius(valueAt(2), max) },
    { label: "Asia", x: 525, y: 122, r: nodeRadius(valueAt(3), max) },
    { label: "Oceania", x: 592, y: 206, r: nodeRadius(valueAt(4), max) },
  ];
}

function mapFlows(nodes: Array<{ x: number; y: number }>) {
  if (nodes.length < 5) return [];
  return [
    curvedPath(nodes[0], nodes[1], -42),
    curvedPath(nodes[0], nodes[2], 36),
    curvedPath(nodes[1], nodes[3], -28),
    curvedPath(nodes[2], nodes[3], 24),
    curvedPath(nodes[3], nodes[4], 34),
  ];
}

function curvedPath(a: { x: number; y: number }, b: { x: number; y: number }, lift: number) {
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2 + lift;
  return `M${a.x} ${a.y} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${b.x} ${b.y}`;
}

function nodeRadius(value: number, max: number) {
  return Math.max(5, Math.min(13, 5 + (value / max) * 8));
}

function mapDots() {
  const continents = [
    { cx: 135, cy: 108, rx: 102, ry: 42, skew: -0.18 },
    { cx: 178, cy: 170, rx: 47, ry: 78, skew: 0.18 },
    { cx: 336, cy: 101, rx: 70, ry: 33, skew: 0.08 },
    { cx: 363, cy: 153, rx: 61, ry: 66, skew: -0.06 },
    { cx: 500, cy: 121, rx: 136, ry: 58, skew: 0.16 },
    { cx: 574, cy: 199, rx: 55, ry: 30, skew: 0.05 },
  ];
  const dots: Array<{ x: number; y: number; opacity: number }> = [];
  for (let x = 35; x <= 655; x += 7) {
    for (let y = 48; y <= 235; y += 6) {
      const inside = continents.some((shape) => {
        const sx = x + (y - shape.cy) * shape.skew;
        const dx = (sx - shape.cx) / shape.rx;
        const dy = (y - shape.cy) / shape.ry;
        return dx * dx + dy * dy <= 1;
      });
      if (!inside) continue;
      const coastCut = ((Math.round(x) * 17 + Math.round(y) * 31) % 11) === 0;
      if (coastCut) continue;
      dots.push({ x, y, opacity: 0.22 + (((x + y) % 5) * 0.07) });
    }
  }
  return dots;
}

function flowLabels() {
  return ["S1", "S2", "S3", "S4", "S5", "S6"];
}

function deterministicStackLayers(rows: Record<string, unknown>[]) {
  const baseSeries = rows.map((row, rowIndex) => ({
    label: brdText(row.name || row.value),
    values: flowLabels().map((_, pointIndex) => deterministicFlowPoint(sectorValue(row), rowIndex, pointIndex)),
  }));
  const cumulative = Array(flowLabels().length).fill(0) as number[];
  return baseSeries.map((series) => {
    const bottom = [...cumulative];
    series.values.forEach((value, index) => {
      cumulative[index] += value;
    });
    return { label: series.label, bottom, top: [...cumulative] };
  });
}

function deterministicFlowPoint(base: number, rowIndex: number, pointIndex: number) {
  const wave = 0.72 + ((rowIndex * 13 + pointIndex * 17) % 31) / 100;
  const slope = 0.82 + pointIndex * 0.055;
  return Math.max(1, base * wave * slope);
}

function stackedAreaPath(layer: { bottom: number[]; top: number[] }, max: number, plot: { left: number; top: number; width: number; height: number }) {
  const topPoints = layer.top.map((value, index) => pointFor(value, index, layer.top.length, max, plot));
  const bottomPoints = layer.bottom.map((value, index) => pointFor(value, index, layer.bottom.length, max, plot)).reverse();
  const [first, ...rest] = [...topPoints, ...bottomPoints];
  return `M${first.x} ${first.y} ${rest.map((point) => `L${point.x} ${point.y}`).join(" ")} Z`;
}

function pointFor(value: number, index: number, count: number, max: number, plot: { left: number; top: number; width: number; height: number }) {
  const x = plot.left + (count <= 1 ? 0 : (index / (count - 1)) * plot.width);
  const y = plot.top + plot.height - (value / max) * plot.height;
  return { x: x.toFixed(1), y: y.toFixed(1) };
}

function DonutGauge({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  const circumference = 2 * Math.PI * 27;
  const dash = (safe / 100) * circumference;
  return (
    <svg viewBox="0 0 72 72" className="h-16 w-16 shrink-0" role="img" aria-label={`${safe}% deal momentum`}>
      <circle cx="36" cy="36" r="27" fill="none" stroke="#E3EAF0" strokeWidth="9" />
      <circle cx="36" cy="36" r="27" fill="none" stroke="#1A9A68" strokeWidth="9" strokeLinecap="round" strokeDasharray={`${dash} ${circumference - dash}`} transform="rotate(-90 36 36)" />
      <text x="36" y="40" textAnchor="middle" fill="#13283D" fontSize="15" fontWeight="900">{safe}%</text>
    </svg>
  );
}

function dealGaugePercent(rows: Record<string, unknown>[]) {
  const counts = rows.slice(0, 6).map((row) => numericSortValue(text(row.count, "")) ?? 0);
  const total = sumNumbers(counts);
  if (!total) return 0;
  return Math.round((Math.max(...counts) / total) * 100);
}

function totalAumValue(packet: Packet | undefined, topRows: Record<string, unknown>[]) {
  if (isFact(packet)) {
    const data = packetData(packet);
    const direct = numberValue(data.total_assets || data.total_aum || data.aum_total);
    if (direct) return direct;
  }
  return sumNumbers(topRows.map(aumValue));
}

function metricNumber(packet: Packet | undefined, key: string) {
  if (!packet || !isFact(packet)) return undefined;
  const data = packetData(packet) as { cards?: Record<string, { value?: unknown }> } | undefined;
  return numberValue(data?.cards?.[key]?.value);
}

function packetCountNumber(packet: Packet | undefined) {
  if (!packet || !isFact(packet)) return undefined;
  const direct = numericSortValue(packetCount(packet, "count"));
  if (direct) return direct;
  const rowCount = rows(packet).length;
  return rowCount > 0 ? rowCount : undefined;
}

function aumValue(row: Record<string, unknown>) {
  return numericSortValue(text(row.aum, "")) ?? 0;
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function numberValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = numericSortValue(text(value, ""));
  return parsed ?? undefined;
}

function compactNumber(value: number) {
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: value >= 1000 ? 1 : 0 }).format(value);
}

function compactMoney(value: number) {
  if (!Number.isFinite(value)) return "Not disclosed";
  if (value === 0) return "$0";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  const unit = units.find(([size]) => abs >= size);
  if (!unit) return `$${value.toLocaleString("en-US")}`;
  const amount = value / unit[0];
  return `$${amount.toLocaleString("en-US", { maximumFractionDigits: amount >= 100 ? 0 : 1 })}${unit[1]}`;
}

function seriesFromNumbers(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length >= 2) return clean.slice(0, 8);
  const seed = clean[0] || 10;
  return [seed, seed];
}

function DashboardLink({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  if (href.startsWith("#")) return <a href={href} {...props}>{children}</a>;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    if (isSwfiPlatformRecordHref(href)) return <a href={swfiAuthHandoffHref(href)} {...props}>{children}</a>;
    return <a href={href} {...props}>{children}</a>;
  }
  return <a href={appHref(href)} {...props}>{children}</a>;
}

function researchRecordHref(row: Record<string, unknown>) {
  return researchDetailHref(row, sourceHref(row));
}

async function loadDashboardPackets(onPacket: (key: PacketKey, packet: Packet) => void) {
  const entries = DASHBOARD_LOAD_ORDER.map((key) => [key, ENDPOINTS[key]] as [PacketKey, string]);
  await Promise.all(entries.map(async ([key, path]) => {
    const packet = await fetchPacket(path, dashboardTimeout(key), { attempts: dashboardAttempts(key) });
    onPacket(key, packet);
  }));
}

function dashboardAttempts(key: PacketKey) {
  return key === "news" || key === "top20" ? 8 : 3;
}

function dashboardTimeout(key: PacketKey) {
  if (key === "metrics" || key === "sectorFlows") return 180_000;
  if (key.startsWith("allocators") || key.startsWith("transactions")) return 150_000;
  return 120_000;
}

function factRows(packet?: Packet) {
  return isFact(packet) ? rows(packet) : [];
}

function shouldReplacePacket(current: Packet | undefined, incoming: Packet) {
  if (isFact(incoming)) return true;
  if (!isFact(current)) return true;
  return !isTransportGap(incoming);
}

function freshHomeSnapshot(): Packets {
  const today = new Date().toISOString().slice(0, 10);
  return Object.fromEntries(
    Object.entries(HOME_PACKET_SNAPSHOT as Partial<Packets>).filter(([, packet]) => {
      const generatedAt = typeof packet?.generated_at === "string" ? packet.generated_at : "";
      return generatedAt.startsWith(today);
    }),
  ) as Packets;
}

function isTransportGap(packet: Packet) {
  const reason = packetReason(packet);
  return reason === "frontend_backend_origin_missing_or_invalid"
    || reason === "backend_fetch_failed"
    || reason.startsWith("backend_http_");
}

function sectorFacetRows(packet?: Packet) {
  if (!isFact(packet)) return [];
  const facets = packet?.data && typeof packet.data === "object" && !Array.isArray(packet.data)
    ? (packet.data as { facets?: { sectors?: unknown } }).facets
    : undefined;
  return Array.isArray(facets?.sectors) ? facets.sectors as Record<string, unknown>[] : [];
}

function dataAsOfLabelFor(packet?: Packet) {
  const provenance = packet?.provenance && typeof packet.provenance === "object" && !Array.isArray(packet.provenance)
    ? packet.provenance as Record<string, unknown>
    : {};
  const value = text(packet?.generated_at || provenance.fetched_at, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Data as of latest SWFI source sync";
  return `Data as of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(parsed))}`;
}

function packetCount(packet: Packet | undefined, key = "rows") {
  if (!packet) return "Not disclosed";
  if (!isFact(packet)) return "Not disclosed";
  const data = packetData(packet);
  const value = data[key];
  if (typeof value === "number") return value.toLocaleString("en-US");
  return cleanDisplayValue(count(packet));
}

function metricCard(packet: Packet | undefined, key: string) {
  if (!packet) return "Not disclosed";
  if (!isFact(packet)) return "Not disclosed";
  const data = packetData(packet) as { cards?: Record<string, { value?: unknown }> } | undefined;
  const value = data?.cards?.[key]?.value;
  return typeof value === "number" ? value.toLocaleString("en-US") : "Not disclosed";
}

function metricCardWithFallback(packet: Packet | undefined, key: string, fallback?: number) {
  const value = metricCard(packet, key);
  if (value !== "Not disclosed") return value;
  return fallback && Number.isFinite(fallback) && fallback > 0 ? compactNumber(fallback) : value;
}

function KpiCard({ label, value, note, source, href }: { label: string; value: string; note: string; source: string; href: string }) {
  return (
    <DashboardLink data-qa-min="150" href={href} className="min-w-0 rounded border border-[#DCE3EA] bg-white p-[13px_15px] text-inherit no-underline">
      <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">{label}</div>
      <div className="mt-1 break-words text-[25px] font-bold text-[#11314F]">{value}</div>
      <div className="mt-1 text-[11px] text-[#7A8A9B]">{note}</div>
      <MetricRail value={value} />
      <div className="mt-1 text-[10.5px] text-[#7A8A9B]" data-source-path={source}>Updated from SWFI</div>
    </DashboardLink>
  );
}

function MetricRail({ value }: { value: string }) {
  const numeric = numericSortValue(value);
  const width = numeric && numeric > 0
    ? Math.max(10, Math.min(100, 18 + Math.log10(numeric + 1) * 12))
    : 0;
  return (
    <div className="mt-2 h-1.5 overflow-hidden rounded bg-[#E8EDF2]" aria-hidden="true">
      <div className="h-full rounded bg-[#5C9BD6]" style={{ width: `${width}%` }} />
    </div>
  );
}

function InsightRow({
  id,
  label,
  href,
  sourceNote,
  headers,
  rows: sourceRows,
  empty,
  defaultSortColumn = 0,
  defaultSortDir = "asc",
}: {
  id: string;
  label: string;
  href?: string;
  sourceNote: string;
  headers: string[];
  rows: Cell[][];
  empty: string;
  defaultSortColumn?: number;
  defaultSortDir?: "asc" | "desc";
}) {
  const [tableSearch, setTableSearch] = useState("");
  const [sortColumn, setSortColumn] = useState(defaultSortColumn);
  const [sortDir, setSortDir] = useState<"asc" | "desc">(defaultSortDir);
  const [rowLimit, setRowLimit] = useState(5);
  const [pageIndex, setPageIndex] = useState(0);
  const rowsToUse = useMemo(
    () => sourceRows.length ? sourceRows : [headers.map(() => empty)],
    [empty, headers, sourceRows],
  );
  const filteredRows = useMemo(() => {
    const clean = tableSearch.trim().toLowerCase();
    if (!clean) return rowsToUse;
    return rowsToUse.filter((row) => row.some((cell) => searchableCellText(cell).toLowerCase().includes(clean)));
  }, [rowsToUse, tableSearch]);
  const sortedRows = useMemo(() => {
    return [...filteredRows].sort((a, b) => compareCells(a[sortColumn], b[sortColumn], sortDir));
  }, [filteredRows, sortColumn, sortDir]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / rowLimit));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = safePageIndex * rowLimit;
  const visibleRows = sortedRows.slice(pageStart, pageStart + rowLimit);
  return (
    <div id={id} className="scroll-mt-20 border-b border-[#F2F5F8] last:border-b-0">
      <div className="px-4 pt-3">
        <div className="text-[13px] font-bold text-[#11314F]">
          {href ? <DashboardLink href={href} className="text-[#16538C] underline">{label}</DashboardLink> : label}
        </div>
        <div className="mt-0.5 text-[11px] text-[#7A8A9B]" data-source-path={sourceNote}>Updated from SWFI</div>
      </div>
      <div className="grid gap-2 px-4 py-2 text-[12px] text-[#41566B] md:grid-cols-[minmax(0,1fr)_minmax(160px,220px)_112px] md:items-end">
        <div className="font-semibold">
          Showing {visibleRows.length.toLocaleString("en-US")} of {rowsToUse.length.toLocaleString("en-US")}
          {tableSearch.trim() ? ` / filtered ${filteredRows.length.toLocaleString("en-US")}` : ""}
        </div>
        <label className="grid gap-1">
          <span className="font-semibold">Search</span>
          <input
            type="search"
            value={tableSearch}
            onChange={(event) => {
              setTableSearch(event.target.value);
              setPageIndex(0);
            }}
            className="min-h-8 rounded border border-[#C7D2DD] px-2 outline-none"
            placeholder="Search rows"
          />
        </label>
        <label className="grid gap-1">
          <span className="font-semibold">Rows</span>
          <select
            value={rowLimit}
            onChange={(event) => {
              setRowLimit(Number(event.target.value));
              setPageIndex(0);
            }}
            className="min-h-8 rounded border border-[#C7D2DD] bg-white px-2"
          >
            {[5, 10, 25].map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
      </div>
      <div className="grid grid-cols-2 gap-2 px-4 pb-1 text-[11px] text-[#5B6B7C] md:grid-cols-4">
        {headers.map((header, index) => (
          <button
            key={header}
            type="button"
            className="bg-transparent p-0 text-left font-semibold text-[#41566B]"
            onClick={() => {
              setSortColumn(index);
              setSortDir(sortColumn === index && sortDir === "asc" ? "desc" : "asc");
              setPageIndex(0);
            }}
          >
            {header}{sortColumn === index ? ` ${sortDir}` : ""}
          </button>
        ))}
      </div>
      {visibleRows.length ? visibleRows.map((row, index) => (
        <div key={`${label}-${index}`} className="grid grid-cols-1 gap-1 px-4 py-2 text-[12.5px] text-[#41566B] md:grid-cols-[1.4fr_1fr_1fr_0.9fr] md:gap-3">
          {row.map((cell, cellIndex) => <div key={cellIndex} className={`min-w-0 break-words ${cellIndex === 0 ? "font-bold text-[#16538C]" : ""}`}>{displayCell(cell)}</div>)}
        </div>
      )) : (
        <div className="px-4 py-2 text-[12.5px] text-[#41566B]">{empty}</div>
      )}
      {pageCount > 1 ? (
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-3 text-[12px] text-[#41566B]">
          <div>Page {(safePageIndex + 1).toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}</div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-[#C7D2DD] bg-white px-3 py-1 text-[#16538C] disabled:opacity-40"
              disabled={safePageIndex <= 0}
              onClick={() => setPageIndex((current) => Math.max(0, current - 1))}
            >
              Previous
            </button>
            <button
              type="button"
              className="rounded border border-[#C7D2DD] bg-white px-3 py-1 text-[#16538C] disabled:opacity-40"
              disabled={safePageIndex >= pageCount - 1}
              onClick={() => setPageIndex((current) => Math.min(pageCount - 1, current + 1))}
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function AllocatorActivityVisual({ rows: sourceRows, ready }: { rows: Record<string, unknown>[]; ready: boolean }) {
  const chartRows = [...sourceRows]
    .sort((a, b) => activityCountValue(b) - activityCountValue(a))
    .slice(0, 5);
  const max = Math.max(1, ...chartRows.map(activityCountValue));
  return (
    <VisualPanel title="Active Allocator Activity" source={ENDPOINTS.allocators30} empty={DASHBOARD_EMPTY} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = activityCountValue(row);
        return (
          <div key={`${brdText(row.name)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_76px] sm:items-start">
              <div className="min-w-0 font-bold text-[#16538C]">{displayCell(entityCell(row))}</div>
              <div className="text-right text-[12px] font-semibold text-[#41566B] sm:text-right">{dealCountLabel(value)}</div>
            </div>
            <Bar value={value} max={max} />
            <div className="mt-1 text-[11px] text-[#7A8A9B]">{allocatorMeta(row)}</div>
          </div>
        );
      })}
    </VisualPanel>
  );
}

function DealAmountVisual({ rows: sourceRows, ready }: { rows: Record<string, unknown>[]; ready: boolean }) {
  const chartRows = [...sourceRows]
    .sort((a, b) => amountValue(b) - amountValue(a))
    .slice(0, 5);
  const max = Math.max(1, ...chartRows.map(amountValue));
  return (
    <VisualPanel title="Largest Recent Deals" source={ENDPOINTS.transactions30} empty={DASHBOARD_EMPTY} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = amountValue(row);
        const amount = cleanMoney(row.amount_display || row.capital_display || row.amount);
        return (
          <div key={`${brdText(row.title || row.name)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px] sm:items-start">
              <div className="min-w-0 font-bold text-[#16538C]">{displayCell(dealCell(row))}</div>
              <div className="text-right text-[12px] font-semibold text-[#41566B]">{amount}</div>
            </div>
            <Bar value={value} max={max} />
            <div className="mt-1 text-[11px] text-[#7A8A9B]">{brdText(row.institution)} · {brdText(row.sector)}</div>
          </div>
        );
      })}
    </VisualPanel>
  );
}

function MandateTimelineVisual({ rows: sourceRows, ready }: { rows: Record<string, unknown>[]; ready: boolean }) {
  const chartRows = [...sourceRows]
    .sort((a, b) => deadlineTime(a) - deadlineTime(b))
    .slice(0, 5);
  return (
    <VisualPanel title="RFP Deadline Timeline" source={ENDPOINTS.rfps} empty={DASHBOARD_EMPTY} hasRows={chartRows.length > 0}>
      <div className="grid gap-2">
        {chartRows.map((row, index) => (
          <div key={`${brdText(row.title || row.name)}-${index}`} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-[#F2F5F8] pb-2 last:border-b-0">
            <div className="rounded border border-[#C7D2DD] bg-[#F7F9FA] px-2 py-1 text-center text-[11px] font-bold text-[#11314F]">
              {timelineDate(row)}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[#16538C]">{displayCell(mandateCell(row))}</div>
              <div className="mt-1 text-[11px] text-[#7A8A9B]">{brdText(row.institution)} · {brdText(row.strategy || row.asset_class_or_strategy)}</div>
            </div>
          </div>
        ))}
      </div>
    </VisualPanel>
  );
}

function SectorFlowVisual({ rows: sourceRows, ready }: { rows: Record<string, unknown>[]; ready: boolean }) {
  const chartRows = sourceRows.slice(0, 5);
  const max = Math.max(1, ...chartRows.map(sectorValue));
  return (
    <VisualPanel title="Sector Flow" source={ENDPOINTS.sectorFlows} empty={DASHBOARD_EMPTY} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = sectorValue(row);
        return (
          <div key={`${brdText(row.name || row.value)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px] sm:items-start">
              <div className="min-w-0 font-bold text-[#16538C]">{displayCell(sectorCell(row))}</div>
              <div className="text-right text-[12px] font-semibold text-[#41566B]">{cleanMoney(row.capital_display || row.capital_deployed || row.capital)}</div>
            </div>
            <Bar value={value} max={max} />
            <div className="mt-1 text-[11px] text-[#7A8A9B]">{brdText(row.count)} transactions</div>
          </div>
        );
      })}
    </VisualPanel>
  );
}

function VisualPanel({ title, source, empty, hasRows, children }: { title: string; source: string; empty: string; hasRows: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded border border-[#DCE3EA] bg-white p-4">
      <div className="mb-3">
        <div className="text-[13px] font-bold tracking-[0.07em] text-[#41566B]">{title}</div>
        <div className="mt-0.5 text-[11px] text-[#7A8A9B]" data-source-path={source}>Updated from SWFI</div>
      </div>
      {hasRows ? children : <div className="text-[13px] text-[#41566B]">{empty}</div>}
    </div>
  );
}

function Bar({ value, max }: { value: number; max: number }) {
  const width = max > 0 && value > 0 ? Math.max(4, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div className="mt-2 h-2 overflow-hidden rounded bg-[#E8EDF2]">
      <div className="h-full rounded bg-[#5C9BD6]" style={{ width: `${width}%` }} />
    </div>
  );
}

function activityCountValue(row: Record<string, unknown>) {
  return numericSortValue(text(row.activity_count || row.deal_count, "")) ?? 0;
}

function dealCountLabel(value: number | string) {
  const numeric = typeof value === "number" ? value : numericSortValue(text(value, "")) ?? 0;
  return `${numeric.toLocaleString("en-US")} ${numeric === 1 ? "deal" : "deals"}`;
}

function allocatorMeta(row: Record<string, unknown>) {
  return [entityTypeCell(row), brdText(row.region || row.country, "")]
    .filter((part) => part && part !== SOURCE_GAP && part !== "Not disclosed")
    .join(" · ");
}

function amountValue(row: Record<string, unknown>) {
  const display = cleanMoney(row.amount_display || row.capital_display || row.amount);
  return numericSortValue(display) ?? 0;
}

function sectorValue(row: Record<string, unknown>) {
  const capital = cleanMoney(row.capital_display || row.capital_deployed || row.capital);
  return numericSortValue(capital) ?? numericSortValue(text(row.count, "")) ?? 0;
}

function deadlineTime(row: Record<string, unknown>) {
  const value = text(row.deadline || row.due_at, "");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : Number.MAX_SAFE_INTEGER;
}

function timelineDate(row: Record<string, unknown>) {
  const value = text(row.deadline || row.due_at, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return brdText(value, "Not disclosed");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(parsed));
}

function mandateUrgencyScore(row: Record<string, unknown>) {
  const parsed = deadlineTime(row);
  if (!Number.isFinite(parsed) || parsed === Number.MAX_SAFE_INTEGER) return 1;
  const days = Math.max(0, Math.round((parsed - Date.now()) / 86_400_000));
  return Math.max(1, 120 - Math.min(119, days));
}

function publishedRecencyScore(row: Record<string, unknown>) {
  const value = text(row.published_at || row.date, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return 1;
  const days = Math.max(0, Math.round((Date.now() - parsed) / 86_400_000));
  return Math.max(1, 90 - Math.min(89, days));
}

function aumDisplay(row: Record<string, unknown>) {
  const numeric = numericSortValue(text(row.aum, ""));
  const currency = text(row.aum_currency, "").trim();
  if (numeric == null || !currency) return "Not disclosed";
  return `${currency} ${numeric.toLocaleString("en-US")}`;
}

function ActionButton({ href, children }: { href: string; children: React.ReactNode }) {
  return <DashboardLink href={href} className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[13px] text-[#16538C] no-underline">{children}</DashboardLink>;
}

function RailLink({ href, label }: { href: string; label: string }) {
  return <DashboardLink href={href} className="border-b border-[#F2F5F8] px-4 py-2 text-[13px] text-[#41566B] no-underline last:border-b-0">{label}</DashboardLink>;
}

function sourceHref(row: Record<string, unknown>): string | undefined {
  for (const key of ["source_url", "swfi_url", "url"]) {
    const value = text(row[key], "");
    if (value.startsWith("http://") || value.startsWith("https://")) return normalizeSwfiUrl(value);
  }
  for (const key of ["deal_source_urls", "source_urls"]) {
    const value = row[key];
    if (!Array.isArray(value)) continue;
    const first = value.map((item) => text(item, "")).find((item) => item.startsWith("http://") || item.startsWith("https://"));
    if (first) return normalizeSwfiUrl(first);
  }
  return undefined;
}

function entitySourceUrl(entityId: string): string {
  return entityId ? `https://www.swfi.com/v1/entities/${encodeURIComponent(entityId)}` : "";
}

function transactionSourceUrl(transactionId: string): string {
  return transactionId ? `https://www.swfi.com/v1/transactions/${encodeURIComponent(transactionId)}` : "";
}

function mandateSourceUrl(mandateId: string): string {
  return mandateId ? `https://www.swfi.com/v1/compass/${encodeURIComponent(mandateId)}` : "";
}

function personSourceUrl(personId: string): string {
  return personId ? `https://www.swfi.com/v1/people/${encodeURIComponent(personId)}` : "";
}

function dashboardProfileHref(row: Record<string, unknown>): string {
  const entityId = text(row.entity_id || row.entityID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || entitySourceUrl(entityId);
  return profileDetailHref(row, source || undefined);
}

function dashboardTransactionHref(row: Record<string, unknown>): string {
  const transactionId = text(row.transaction_id || row.transactionID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || transactionSourceUrl(transactionId);
  return transactionDetailHref(row, source || undefined);
}

function dashboardMandateHref(row: Record<string, unknown>): string {
  const mandateId = text(row.compass_id || row.mandate_id || row.rfp_id || row.source_record_id || row.id, "");
  const source = sourceHref(row) || mandateSourceUrl(mandateId);
  return mandateDetailHref(row, source || undefined);
}

function dashboardPersonHref(row: Record<string, unknown>): string {
  const personId = text(row.person_id || row.personID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || personSourceUrl(personId);
  return personDetailHref(row, source || undefined);
}

function dealCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: dashboardTransactionHref(row),
    sourceHref: source,
    citationText: "SWFI transaction source on file",
  };
}

function mandateCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: dashboardMandateHref(row),
    sourceHref: source,
    citationText: "SWFI Compass source on file",
  };
}

function researchCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: researchDetailHref(row, source),
    sourceHref: source,
    citationText: "SWFI source on file",
  };
}

function sourceDetailCell(label: string, href?: string, fallback = "/research/"): Cell {
  const provenance = href ? sourceProvenanceHref(href) : undefined;
  return provenance ? { label, href: sourceRecordDetailHref(provenance, fallback), sourceHref: provenance, citationText: "SWFI source on file" } : label;
}

function sourceRecordDetailHref(provenance: string, fallback: string): string {
  try {
    const parsed = new URL(provenance);
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1Index = parts.indexOf("v1");
    const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
    const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
    if (!/^[a-f0-9]{24}$/i.test(id || "")) return fallback;
    if (section === "entities") return profileDetailHref({}, provenance);
    if (section === "people") return personDetailHref({}, provenance);
    if (section === "transactions") return transactionDetailHref({}, provenance);
    if (section === "compass") return mandateDetailHref({}, provenance);
  } catch {
    return fallback;
  }
  return fallback;
}

function cellText(cell: Cell): string {
  return cleanDisplayValue(typeof cell === "string" ? cell : cell.label);
}

function searchableCellText(cell: Cell): string {
  return typeof cell === "string"
    ? cell
    : [cell.label, cell.href, cell.sourceHref, cell.citationText].filter(Boolean).join(" ");
}

function compareCells(a: Cell | undefined, b: Cell | undefined, dir: "asc" | "desc") {
  const av = a ? cellText(a) : "";
  const bv = b ? cellText(b) : "";
  const an = numericSortValue(av);
  const bn = numericSortValue(bv);
  const result = an !== null && bn !== null
    ? an - bn
    : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

function displayCell(cell: Cell) {
  if (typeof cell === "string") return cleanDisplayValue(cell);
  const hasSource = Boolean(cell.sourceHref);
  const label = cleanDisplayValue(cell.label);
  return (
    <span className="grid gap-1">
      <DataLink href={cell.href || "#"} sourceHref={cell.sourceHref} className="text-[#16538C] underline">{label}</DataLink>
      {hasSource ? <span className="text-[10.5px] leading-tight text-[#7A8A9B]">SWFI source on file</span> : null}
    </span>
  );
}

function DataLink({ href, sourceHref, className, style, children }: { href: string; sourceHref?: string; className: string; style?: CSSProperties; children: React.ReactNode }) {
  const target = href;
  const provenance = sourceHref || sourceProvenanceHref(href);
  const recordLink = isCanonicalSwfiRecordHref(href);
  return <DashboardLink href={target} title={provenance ? "SWFI source on file" : undefined} data-record-link={recordLink ? "true" : undefined} data-source-state={provenance ? "on-file" : undefined} className={className} style={style}>{children}</DashboardLink>;
}

function isCanonicalSwfiRecordHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const parsed = new URL(href, "https://swfipn.local");
    if (parsed.hostname === "swfipn.local" || parsed.pathname.startsWith("/swficc/")) {
      return isTerminalRecordHref(parsed);
    }
    if (!parsed.hostname.endsWith("swfi.com")) return false;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1Index = parts.indexOf("v1");
    const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
    const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
    return ["entities", "people", "person", "transactions", "compass"].includes(section || "")
      && /^[a-f0-9]{24}$/i.test(id || "");
  } catch {
    return false;
  }
}

function isTerminalRecordHref(parsed: URL): boolean {
  const path = parsed.pathname.replace(/^\/swficc/, "").replace(/\/?$/, "/");
  if (path === "/profiles/detail/") return Boolean(parsed.searchParams.get("slug") || parsed.searchParams.get("name") || parsed.searchParams.get("id"));
  if (path === "/transactions/detail/") return Boolean(parsed.searchParams.get("title") || parsed.searchParams.get("id"));
  if (path === "/mandates/detail/") return Boolean(parsed.searchParams.get("title") || parsed.searchParams.get("id"));
  if (path === "/people/detail/") return Boolean(parsed.searchParams.get("name") || parsed.searchParams.get("id"));
  if (path === "/research/detail/") return Boolean(parsed.searchParams.get("legacy"));
  return false;
}

function entityCell(row: Record<string, unknown>): Cell {
  const entityId = text(row.entity_id, "");
  const source = sourceHref(row) || entitySourceUrl(entityId);
  return {
    label: brdText(row.name),
    href: dashboardProfileHref(row),
    sourceHref: source || undefined,
    citationText: entityId ? "SWFI source on file" : "SWFI allocator activity source",
  };
}

function groupedCountRows(rows: Record<string, unknown>[], labelFor: (row: Record<string, unknown>) => string) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const label = labelFor(row);
    if (!label || label === "Not disclosed") continue;
    groups.set(label, (groups.get(label) || 0) + 1);
  }
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function groupedAmountRows(rows: Record<string, unknown>[], labelFor: (row: Record<string, unknown>) => string) {
  const groups = new Map<string, number>();
  for (const row of rows) {
    const label = labelFor(row);
    const value = aumValue(row);
    if (!label || label === "Not disclosed" || value <= 0) continue;
    groups.set(label, (groups.get(label) || 0) + value);
  }
  return [...groups.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function entityTypeCell(row: Record<string, unknown>): string {
  return brdText(row.entity_type || row.type, "Not disclosed");
}

function activityCountCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  const value = text(row.activity_count || row.deal_count, "0");
  return {
    label: dealCountLabel(value),
    href: source || `/allocators/?filter=${encodeURIComponent(text(row.name, ""))}`,
    sourceHref: source || undefined,
    citationText: `SWFI allocator activity source: ${ENDPOINTS.allocators30}`,
  };
}

function sectorCell(row: Record<string, unknown>): Cell {
  const label = brdText(row.name || row.value);
  return {
    label,
    href: `/deals/?filter=${encodeURIComponent(label)}`,
    citationText: `SWFI sector flow source: ${ENDPOINTS.sectorFlows}`,
  };
}
