"use client";

import type { AnchorHTMLAttributes, ReactNode } from "react";
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
import { appHref, assetHref, isSwfiPlatformRecordHref, sourceProvenanceHref, swfiMirrorHref } from "@/lib/selfContainedLinks";
import { mandateDetailHref, profileDetailHref, researchDetailHref, transactionDetailHref } from "@/lib/detailRoutes";

const ENDPOINTS = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  allocators30: "/api/allocator-activity/v1?days=90&limit=25",
  allocators90: "/api/allocator-activity/v1?days=90&limit=1&count_only=1",
  rfps: "/api/live-opportunities/v1?limit=25&page=1",
  transactions30: "/api/recent-transactions/v1?days=30&limit=25&page=1",
  top20: "/v1/swfi/top20?limit=5",
  news: "/api/source-intelligence/news/v1?limit=25",
  sectorFlows: "/api/sector-flows/v1?days=365",
};

const LOADING = "Loading";
const DASHBOARD_LOAD_ORDER: PacketKey[] = ["metrics", "sectorFlows", "allocators90", "rfps", "allocators30", "transactions30", "top20", "news"];
const insightNav = [
  ["Top Investors", "/allocators"],
  ["Fundraising", "/mandates"],
  ["Market Activity", "/transactions"],
  ["News", "/intelligence"],
] as const;

type Packets = Record<keyof typeof ENDPOINTS, Packet | undefined>;
type PacketKey = keyof typeof ENDPOINTS;
type Cell = string | { label: string; href?: string; sourceHref?: string; citationText?: string };
type DashboardTableControls = {
  rowLimit: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
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
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

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

  const topInvestors = factRows(packets.allocators30).slice(0, 25);
  const marketRows = factRows(packets.transactions30).slice(0, 25);
  const fundraisingRows = factRows(packets.rfps).slice(0, 25);
  const newsRows = factRows(packets.news).slice(0, 25);
  const sectorRows = sectorFacetRows(packets.sectorFlows).slice(0, 10);
  const dataAsOfLabel = useMemo(() => dataAsOfLabelFor(packets.metrics), [packets.metrics]);
  const topAumRows = factRows(packets.top20).slice(0, 5);
  const metricCards = dashboardMetricCards(packets, topAumRows, sectorRows);
  const [dashboardRowLimit, setDashboardRowLimit] = useState(5);
  const [dashboardSortColumn, setDashboardSortColumn] = useState(0);
  const [dashboardSortDir, setDashboardSortDir] = useState<"asc" | "desc">("asc");
  const dashboardTableControls = useMemo<DashboardTableControls>(() => ({
    rowLimit: dashboardRowLimit,
    sortColumn: dashboardSortColumn,
    sortDir: dashboardSortDir,
  }), [dashboardRowLimit, dashboardSortColumn, dashboardSortDir]);
  const dashboardSourceRowCount = topAumRows.length
    + sectorRows.length
    + topInvestors.length
    + fundraisingRows.length
    + marketRows.length
    + newsRows.length;

  function toggleSection(id: string) {
    setExpandedSection((current) => current === id ? null : id);
  }

  function sortDashboardBy(column: number) {
    setDashboardSortDir((current) => dashboardSortColumn === column && current === "asc" ? "desc" : "asc");
    setDashboardSortColumn(column);
  }

  return (
    <div ref={rootRef} className="min-h-screen bg-[#E9EEF3] font-sans text-[#172431]">
      <div className="grid min-h-screen lg:h-screen lg:grid-cols-[238px_minmax(0,1fr)] lg:overflow-hidden">
        <ConceptSidebar topRows={topAumRows} />
        <div className="order-1 min-w-0 overflow-hidden lg:order-none lg:flex lg:flex-col">
          <ConceptTopBar dataAsOfLabel={dataAsOfLabel} packets={packets} />
          <main className="min-w-0 overflow-visible px-3 py-3 sm:px-4 lg:overflow-y-auto">
            <div className="sr-only">
              KPI CARDS INSIGHTS Top AUM & Sector Activity Active Allocator Activity Largest Recent Deals RFP Deadline Timeline Sector Flow Newest Transactions (Last 25) Fundraising Activity SECTOR FLOW TABLE QUICK ACTIONS
            </div>
            <section data-gsap-reveal className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-6">
              {metricCards.map((card) => (
                <ConceptKpiCard key={card.label} {...card} />
              ))}
            </section>
            <DashboardControlStrip
              totalRows={dashboardSourceRowCount}
              rowLimit={dashboardRowLimit}
              sortColumn={dashboardSortColumn}
              sortDir={dashboardSortDir}
              onRowLimitChange={setDashboardRowLimit}
              onSort={sortDashboardBy}
            />

            <section data-gsap-reveal className="grid auto-rows-max gap-3 2xl:grid-cols-[minmax(0,1.08fr)_minmax(360px,0.9fr)_330px]">
              <ExpandablePanel
                id="global-map"
                title="Top AUM & Sector Activity"
                href="/profiles"
                expanded={expandedSection === "global-map"}
                onToggle={toggleSection}
                className="min-h-[310px]"
                detail={<ExpandedEntityRows rows={topAumRows} controls={dashboardTableControls} />}
              >
                <GlobalCapitalMap topRows={topAumRows} sectorRows={sectorRows} />
              </ExpandablePanel>

              <ExpandablePanel
                id="capital-flows"
                title="Capital Flows & Allocation Trends"
                href="/deals"
                expanded={expandedSection === "capital-flows"}
                onToggle={toggleSection}
                className="min-h-[310px]"
                detail={<ExpandedSectorRows rows={sectorRows} controls={dashboardTableControls} />}
              >
                <CapitalFlowPanel rows={sectorRows} />
              </ExpandablePanel>

              <div className="grid gap-3">
                <ExpandablePanel
                  id="ai-insights"
                title="AI Insights"
                  href="/intelligence"
                  expanded={expandedSection === "ai-insights"}
                  onToggle={toggleSection}
                  detail={<ExpandedNewsRows rows={newsRows} controls={dashboardTableControls} />}
                >
                  <AiInsightsPanel topInvestors={topInvestors} marketRows={marketRows} fundraisingRows={fundraisingRows} newsRows={newsRows} />
                </ExpandablePanel>
                <ExpandablePanel
                  id="market-intelligence"
                title="Market Intelligence"
                  href="/deals"
                  expanded={expandedSection === "market-intelligence"}
                  onToggle={toggleSection}
                  detail={<ExpandedSectorRows rows={sectorRows} controls={dashboardTableControls} />}
                >
                  <MarketIntelligencePanel rows={sectorRows} />
                </ExpandablePanel>
              </div>

              <ExpandablePanel
                id="pipeline"
                title="Pipeline Overview"
                href="/mandates"
                expanded={expandedSection === "pipeline"}
                onToggle={toggleSection}
                detail={<ExpandedMandateRows rows={fundraisingRows} controls={dashboardTableControls} />}
              >
                <PipelineFunnelPanel packets={packets} topRows={topAumRows} marketRows={marketRows} fundraisingRows={fundraisingRows} />
              </ExpandablePanel>

              <ExpandablePanel
                id="relationships"
                title="Top Active Allocators (Last 90 Days)"
                href="/allocators"
                expanded={expandedSection === "relationships"}
                onToggle={toggleSection}
                detail={<ExpandedInvestorRows rows={topInvestors} controls={dashboardTableControls} />}
              >
                <RelationshipPanel rows={topInvestors} />
              </ExpandablePanel>

              <ExpandablePanel
                id="research"
                title="Research & Analytics Hub"
                href="/intelligence"
                expanded={expandedSection === "research"}
                onToggle={toggleSection}
                detail={<ExpandedNewsRows rows={newsRows} controls={dashboardTableControls} />}
              >
                <ResearchHubPanel rows={newsRows} />
              </ExpandablePanel>

              <ExpandablePanel
                id="events"
                title="Live RFPs / Mandates"
                href="/mandates"
                expanded={expandedSection === "events"}
                onToggle={toggleSection}
                detail={<ExpandedMandateRows rows={fundraisingRows} controls={dashboardTableControls} />}
              >
                <EngagementCards rows={fundraisingRows} />
              </ExpandablePanel>

              <ExpandablePanel
                id="activity"
                title="Activity Feed"
                href="/transactions"
                expanded={expandedSection === "activity"}
                onToggle={toggleSection}
                detail={<ExpandedDealRows rows={marketRows} controls={dashboardTableControls} />}
              >
                <ActivityFeedPanel marketRows={marketRows} newsRows={newsRows} fundraisingRows={fundraisingRows} />
              </ExpandablePanel>

              <ExpandablePanel
                id="deal-intelligence"
                title="Deal Intelligence"
                href="/deals"
                expanded={expandedSection === "deal-intelligence"}
                onToggle={toggleSection}
                detail={<ExpandedDealRows rows={marketRows} controls={dashboardTableControls} />}
              >
                <DealIntelligencePanel rows={marketRows} sectorRows={sectorRows} />
              </ExpandablePanel>
            </section>

            <section data-gsap-reveal className="mt-3 overflow-hidden rounded-[6px] bg-[#071F48] text-white shadow-[0_16px_30px_rgba(7,31,72,0.18)]">
              <NewsTicker rows={newsRows} />
            </section>
          </main>
        </div>
      </div>
    </div>
  );
}

function ConceptSidebar({ topRows }: { topRows: Record<string, unknown>[] }) {
  return (
    <aside data-gsap-reveal className="min-w-0 border-r border-[#D9E1E8] bg-white lg:overflow-y-auto">
      <div className="flex h-[66px] items-center gap-3 border-b border-[#E6ECF1] px-4">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[6px] bg-[#B90D12]">
          <img src={assetHref("/swfi-assets/logo.svg")} alt="SWFI" className="h-5 w-8 object-contain" />
        </div>
        <div className="min-w-0">
          <div className="text-[18px] font-extrabold leading-none text-[#B90D12]">SWFI</div>
          <div className="mt-1 text-[9px] font-bold uppercase tracking-[0.18em] text-[#6F7C89]">Command Center</div>
        </div>
      </div>
      <nav className="px-3 py-3">
        <div className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A97A4]">Command Center</div>
        {navMain.map(([label, href], index) => (
          <DashboardLink
            key={label}
            href={href}
            className={`mb-1 flex min-h-9 items-center gap-2 rounded-[5px] px-3 text-[12.5px] font-semibold no-underline ${index === 0 ? "bg-[#0A3A7A] text-white" : "text-[#435263] hover:bg-[#F1F5F8]"}`}
          >
            <MiniIcon index={index} />
            <span>{label === "Deals" ? "Deals & Transactions" : label}</span>
          </DashboardLink>
        ))}
        <div className="mb-2 mt-4 px-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A97A4]">Intelligence</div>
        {navIntel.map(([label, href], index) => (
          <DashboardLink key={label} href={href} className="mb-1 flex min-h-8 items-center gap-2 rounded-[5px] px-3 text-[12px] font-semibold text-[#526171] no-underline hover:bg-[#F1F5F8]">
            <MiniIcon index={index + 9} />
            <span>{label}</span>
          </DashboardLink>
        ))}
        <div className="mt-4 rounded-[6px] border border-[#E2E9EF] bg-[#F8FAFC] p-3">
          <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A97A4]">Market Focus</div>
          {["SWF", "Pensions", "Real Estate"].map((label) => (
            <DashboardLink key={label} href={`/profiles/?filter=${encodeURIComponent(label)}`} className="flex items-center justify-between border-t border-[#E6ECF1] py-2 text-[11px] font-semibold text-[#405062] no-underline first:border-t-0">
              <span>{label}</span>
              <span className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#8A97A4]">Open</span>
            </DashboardLink>
          ))}
        </div>
      </nav>
      <div className="mx-3 mb-4 rounded-[6px] border border-[#E2E9EF] bg-[#F8FAFC] p-3">
        <div className="mb-2 text-[9px] font-bold uppercase tracking-[0.16em] text-[#8A97A4]">TOP AUM RANKING</div>
        <div className="grid gap-2">
          {topRows.slice(0, 5).map((row) => (
            <div key={text(row.name)} className="border-t border-[#E6ECF1] pt-2 first:border-t-0 first:pt-0">
              <DataLink href={profileDetailHref(row, sourceHref(row))} sourceHref={sourceHref(row)} className="block truncate text-[11px] font-bold text-[#0A3A7A] underline">
                {text(row.name)}
              </DataLink>
              <div className="mt-0.5 text-[10px] text-[#657484]">{entityTypeCell(row)}</div>
              <div className="text-[10px] text-[#657484]">{text(row.country)}</div>
              <div className="text-[10px] font-semibold text-[#405062]">{aumDisplay(row)}</div>
            </div>
          ))}
        </div>
      </div>
      <div className="mx-3 mb-4 rounded-[6px] border border-[#E2E9EF] p-3 text-[10.5px] font-semibold text-[#657484]">
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
    <header data-gsap-reveal className="border-b border-[#8E090D] bg-[#B90D12] text-white shadow-[0_8px_22px_rgba(68,12,15,0.22)]">
      <div className="flex min-h-[66px] flex-wrap items-center gap-3 px-3 py-2 sm:px-5">
        <div className="min-w-[210px] flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[19px] font-extrabold leading-tight">SWFI</span>
            <span className="text-[19px] font-bold leading-tight">Intelligence Dashboard</span>
          </div>
          <div className="text-[11px] text-white/80">Public discovery view powered by approved SWFI records.</div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] font-semibold text-white/85">
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
        <form action={appHref("/search/")} className="order-3 flex h-9 w-full items-center rounded-[5px] bg-white px-3 text-[#253444] shadow-inner sm:order-none sm:w-[390px]">
          <input id="dashboard-search" name="q" type="search" aria-label="Search SWFI records" placeholder="Search for countries, insights, reports..." className="min-w-0 flex-1 bg-transparent text-[12px] outline-none placeholder:text-[#8A97A4]" />
          <button aria-label="Search" className="ml-2 rounded-[4px] bg-[#EEF2F6] px-2 py-1 text-[10px] font-bold text-[#405062]" type="submit">⌘ K</button>
        </form>
        <div className="flex items-center gap-2">
          <div className="hidden border-l border-white/25 pl-3 text-right text-[10px] text-white/85 md:block">
            <div className="font-bold">{new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date())}</div>
            <div>{dataAsOfLabel}</div>
          </div>
          <DashboardLink href="/intelligence" className="rounded-full bg-[#0A3A7A] px-3 py-2 text-[11px] font-bold text-white no-underline">
            Intelligence
          </DashboardLink>
        </div>
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
    <DashboardLink href={href} data-qa-min="150" className="min-w-0 rounded-[6px] border border-[#DCE4EA] bg-white px-3 py-3 text-inherit no-underline shadow-[0_10px_22px_rgba(20,44,70,0.06)] hover:border-[#B90D12]/40">
      <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="break-words text-[21px] font-extrabold leading-none text-[#13283D]">{value}</div>
        <MiniSparkline series={series} color={color} large />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[10.5px]">
        <span className="font-bold text-[#1A9A68]">Source-backed</span>
        <span className="truncate text-[#7B8996]">{note}</span>
      </div>
      <div className="mt-2 text-[9.5px] font-semibold text-[#7B8996]">Data source: SWFI records</div>
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
    <section data-gsap-reveal className="mb-3 flex flex-wrap items-center gap-2 rounded-[6px] border border-[#DCE4EA] bg-white px-3 py-2 text-[11.5px] text-[#405062] shadow-[0_8px_18px_rgba(20,44,70,0.05)]">
      <div className="mr-auto font-bold">
        Showing {visibleRows.toLocaleString("en-US")} of {totalRows.toLocaleString("en-US")}
      </div>
      <label className="flex items-center gap-2 font-bold">
        <span>Rows</span>
        <select
          value={rowLimit}
          onChange={(event) => onRowLimitChange(Number(event.target.value))}
          className="min-h-8 rounded-[4px] border border-[#C7D2DD] bg-white px-2 text-[#203448]"
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
            className="min-h-8 rounded-[4px] border border-[#C7D2DD] bg-white px-2.5 font-bold text-[#0A3A7A] hover:border-[#B90D12]/50"
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
    <section className={`min-w-0 overflow-hidden rounded-[7px] border border-[#DCE4EA] bg-white shadow-[0_10px_22px_rgba(20,44,70,0.06)] ${expanded ? "ring-2 ring-[#B90D12]/15" : ""} ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#EEF2F5] px-3 py-2.5">
        <button type="button" onClick={() => onToggle(id)} className="flex min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left">
          <span className="grid h-5 w-5 place-items-center rounded-[4px] bg-[#EEF3F7] text-[11px] font-black text-[#B90D12]">{expanded ? "−" : "+"}</span>
          <span className="truncate text-[12px] font-extrabold text-[#1E3145]">{title}</span>
        </button>
        <DashboardLink href={href} className="rounded-[4px] border border-[#D4DDE5] px-2 py-1 text-[10px] font-bold text-[#0A3A7A] no-underline">View all</DashboardLink>
      </div>
      <div className="p-3">{children}</div>
      {expanded && detail ? (
        <div className="border-t border-[#EEF2F5] bg-[#F8FAFC] p-3">{detail}</div>
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
        <svg viewBox="0 0 700 285" className="absolute inset-0 h-full w-full" role="img" aria-label="Deterministic sector activity and top AUM map">
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
          <div className="mt-1 text-[9px] font-semibold text-[#7B8996]">Sector facet from SWFI records</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
        {topCapital.map((row) => (
          <DataLink key={text(row.name)} href={profileDetailHref(row, sourceHref(row))} sourceHref={sourceHref(row)} className="rounded-[5px] border border-[#E1E8EF] px-2 py-2 text-[#405062] no-underline">
            <span className="block truncate font-bold text-[#0A3A7A]">{text(row.name)}</span>
            <span className="mt-1 block text-[#7B8996]">{text(row.country)} · {aumDisplay(row)}</span>
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
          <div key={text(row.name || row.value)} className="rounded-[5px] border border-[#E3EAF0] bg-[#F8FAFC] px-2 py-2">
            <div className="truncate text-[10px] font-bold text-[#516273]">{text(row.name || row.value)}</div>
            <div className="mt-1 text-[11px] font-extrabold text-[#13283D]">{money(row.capital_display || row.capital_deployed || row.capital)}</div>
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
    { label: "Institutional allocator activity", row: topInvestors[0], href: "/allocators", detail: topInvestors[0] ? `${text(topInvestors[0].name)} · ${dealCountLabel(activityCountValue(topInvestors[0]))}` : LOADING },
    { label: "Largest recent deal", row: marketRows[0], href: "/deals", detail: marketRows[0] ? `${text(marketRows[0].title || marketRows[0].name)} · ${money(marketRows[0].amount_display || marketRows[0].capital_display || marketRows[0].amount)}` : LOADING },
    { label: "Open mandate deadline", row: fundraisingRows[0], href: "/mandates", detail: fundraisingRows[0] ? `${text(fundraisingRows[0].title || fundraisingRows[0].name)} · ${timelineDate(fundraisingRows[0])}` : LOADING },
    { label: "Latest intelligence", row: newsRows[0], href: newsRows[0] ? researchRecordHref(newsRows[0]) : "/intelligence", detail: newsRows[0] ? text(newsRows[0].title || newsRows[0].name) : LOADING },
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
        <DashboardLink key={`${text(row.name || row.value)}-${index}`} href={`/deals/?filter=${encodeURIComponent(text(row.name || row.value, ""))}`} className="grid grid-cols-[minmax(0,1fr)_70px] gap-2 rounded-[4px] px-2 py-1.5 text-[11.5px] text-[#405062] no-underline hover:bg-[#F5F8FB]">
          <span className="truncate font-bold">{text(row.name || row.value)}</span>
          <span className="text-right font-extrabold text-[#1A9A68]">{text(row.count)}</span>
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
      <svg viewBox="0 0 380 250" className="h-[220px] w-full" role="img" aria-label="Deterministic pipeline funnel">
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
        <DataLink key={`${text(row.name)}-${index}`} href={profileDetailHref(row, sourceHref(row))} sourceHref={sourceHref(row)} className="grid grid-cols-[26px_minmax(0,1fr)_76px] items-center gap-2 rounded-[5px] px-2 py-1.5 text-[#405062] no-underline hover:bg-[#F5F8FB]">
          <span className="font-extrabold text-[#8A97A4]">{index + 1}</span>
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{text(row.name)}</span>
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
        <DataLink key={`${text(row.title || row.name)}-${index}`} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="overflow-hidden rounded-[6px] border border-[#E4EAF0] bg-[#F8FAFC] text-inherit no-underline">
          <img src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" className="h-16 w-full object-cover" />
          <span className="block p-2">
            <span className="block truncate text-[11px] font-extrabold text-[#0A3A7A]">{text(row.title || row.name)}</span>
            <span className="mt-1 block text-[10px] text-[#7B8996]">{text(row.published_at || row.date, "SWFI record")}</span>
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
        <DataLink key={`${text(row.title || row.name)}-${index}`} href={mandateDetailHref(row, sourceHref(row))} sourceHref={sourceHref(row)} className="overflow-hidden rounded-[6px] border border-[#E4EAF0] bg-[#F8FAFC] text-inherit no-underline">
          <img src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" className="h-16 w-full object-cover" />
          <span className="block p-2">
            <span className="block truncate text-[11px] font-extrabold text-[#0A3A7A]">{text(row.title || row.name)}</span>
            <span className="mt-1 block text-[10px] text-[#7B8996]">{text(row.institution)} · {timelineDate(row)}</span>
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
    ...marketRows.slice(0, 2).map((row) => ({ row, label: "Deal updated", href: transactionDetailHref(row, sourceHref(row)), detail: text(row.title || row.name) })),
    ...fundraisingRows.slice(0, 2).map((row) => ({ row, label: "Mandate posted", href: mandateDetailHref(row, sourceHref(row)), detail: text(row.title || row.name) })),
    ...newsRows.slice(0, 2).map((row) => ({ row, label: "Research published", href: researchRecordHref(row), detail: text(row.title || row.name) })),
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
          <div className="mt-1 text-[13px] font-bold text-[#203448]">{topSector ? text(topSector.name || topSector.value) : LOADING}</div>
          <div className="mt-1 text-[11px] text-[#7B8996]">{topSector ? `${text(topSector.count)} source records` : "Data source: SWFI records"}</div>
        </div>
      </div>
      {topDeal ? (
        <DataLink href={transactionDetailHref(topDeal, sourceHref(topDeal))} sourceHref={sourceHref(topDeal)} className="rounded-[6px] bg-[#F8FAFC] p-3 text-inherit no-underline">
          <span className="block text-[11px] font-bold text-[#0A3A7A]">{text(topDeal.title || topDeal.name)}</span>
          <span className="mt-1 block text-[18px] font-extrabold text-[#13283D]">{money(topDeal.amount_display || topDeal.capital_display || topDeal.amount)}</span>
        </DataLink>
      ) : <div className="text-[12px] text-[#405062]">{LOADING}</div>}
      {topDeals.length > 1 ? (
        <div className="grid gap-1">
          {topDeals.slice(1).map((row, index) => (
            <DataLink
              key={`${text(row.title || row.name)}-${index}`}
              href={transactionDetailHref(row, sourceHref(row))}
              sourceHref={sourceHref(row)}
              className="grid grid-cols-[minmax(0,1fr)_82px] gap-2 rounded-[5px] px-2 py-1.5 text-[11px] text-[#405062] no-underline hover:bg-[#F5F8FB]"
            >
              <span className="truncate font-bold text-[#0A3A7A]">{text(row.title || row.name)}</span>
              <span className="text-right font-extrabold text-[#13283D]">{money(row.amount_display || row.capital_display || row.amount)}</span>
            </DataLink>
          ))}
        </div>
      ) : null}
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
          <DataLink key={text(row.title || row.name)} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="shrink-0 text-white/90 no-underline">
            {text(row.title || row.name)}
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
  const rfps = metricNumber(packets.metrics, "rfps") || 0;
  const swfs = metricNumber(packets.metrics, "swfs") || 0;
  const research = metricNumber(packets.metrics, "news") || packetCountNumber(packets.news) || 0;
  return [
    {
      label: "TOTAL AUM ENGAGED",
      value: totalAum ? compactMoney(totalAum) : metricCard(packets.metrics, "institutions"),
      note: "Top AUM ranking",
      href: "/profiles",
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
      value: rfps ? compactNumber(rfps) : metricCard(packets.metrics, "rfps"),
      note: "Live RFPs",
      href: "/mandates",
      series: seriesFromNumbers([rfps]),
      color: "#A85BE3",
    },
    {
      label: "SWF PROFILES",
      value: swfs ? compactNumber(swfs) : metricCard(packets.metrics, "swfs"),
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
      <svg viewBox="0 0 520 240" className="h-[230px] w-full rounded-[6px] bg-[#F5F8FB]" role="img" aria-label="Deterministic stacked capital flow chart">
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
          <DashboardLink key={text(row.name || row.value)} href={`/deals/?filter=${encodeURIComponent(text(row.name || row.value, ""))}`} className="flex items-center gap-1 text-[#526171] no-underline">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: palette[index % palette.length] }} />
            <span>{text(row.name || row.value)}</span>
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
      rows={sourceRows.map((row) => [entityCell(row), entityTypeCell(row), text(row.country), aumDisplay(row)])}
      empty={SOURCE_GAP}
      controls={controls}
    />
  );
}

function ExpandedInvestorRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Entity", "Deals", "Type", "Region"]}
      rows={sourceRows.map((row) => [entityCell(row), activityCountCell(row), entityTypeCell(row), text(row.region || row.country)])}
      empty={SOURCE_GAP}
      controls={controls}
    />
  );
}

function ExpandedDealRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Deal", "Institution", "Industry / Category", "Amount"]}
      rows={sourceRows.map((row) => [dealCell(row), text(row.institution), text(row.sector || row.industry || row.category), money(row.amount_display || row.capital_display || row.amount)])}
      empty={SOURCE_GAP}
      controls={controls}
    />
  );
}

function ExpandedMandateRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Mandate", "Institution", "Strategy", "Deadline"]}
      rows={sourceRows.map((row) => [mandateCell(row), text(row.institution), text(row.strategy || row.asset_class_or_strategy), text(row.deadline || row.due_at)])}
      empty={SOURCE_GAP}
      controls={controls}
    />
  );
}

function ExpandedNewsRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Headline", "Source", "Published", "Record"]}
      rows={sourceRows.map((row) => [researchCell(row), text(row.source), text(row.published_at || row.date, "Not disclosed"), sourceDetailCell("SWFI source", sourceHref(row), "/intelligence/")])}
      empty={SOURCE_GAP}
      controls={controls}
    />
  );
}

function ExpandedSectorRows({ rows: sourceRows, controls }: { rows: Record<string, unknown>[]; controls: DashboardTableControls }) {
  return (
    <MiniRecordTable
      headers={["Industry / Category", "Capital", "Transactions", "Open"]}
      rows={sourceRows.map((row) => [sectorCell(row), money(row.capital_display || row.capital_deployed || row.capital), text(row.count), sectorCell(row)])}
      empty={SOURCE_GAP}
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
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7B8996]">Showing {visible.length.toLocaleString("en-US")} of {sourceRows.length.toLocaleString("en-US")} · Data source: SWFI records</div>
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
    label: text(row.name || row.value),
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
    <svg viewBox="0 0 72 72" className="h-16 w-16 shrink-0" role="img" aria-label={`${safe}% source-weighted deal momentum`}>
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
  const value = numericSortValue(packetCount(packet, "count"));
  return value || undefined;
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
  if (!Number.isFinite(value)) return SOURCE_GAP;
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
    if (isSwfiPlatformRecordHref(href)) return <a href={swfiMirrorHref(href)} {...props}>{children}</a>;
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
    const packet = await fetchPacket(path, dashboardTimeout(key), { attempts: 3 });
    onPacket(key, packet);
  }));
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
  if (!packet) return LOADING;
  if (!isFact(packet)) return SOURCE_GAP;
  const data = packetData(packet);
  const value = data[key];
  if (typeof value === "number") return value.toLocaleString("en-US");
  return count(packet);
}

function metricCard(packet: Packet | undefined, key: string) {
  if (!packet) return LOADING;
  if (!isFact(packet)) return SOURCE_GAP;
  const data = packetData(packet) as { cards?: Record<string, { value?: unknown }> } | undefined;
  const value = data?.cards?.[key]?.value;
  return typeof value === "number" ? value.toLocaleString("en-US") : SOURCE_GAP;
}

function KpiCard({ label, value, note, source, href }: { label: string; value: string; note: string; source: string; href: string }) {
  return (
    <DashboardLink data-qa-min="150" href={href} className="min-w-0 rounded border border-[#DCE3EA] bg-white p-[13px_15px] text-inherit no-underline">
      <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">{label}</div>
      <div className="mt-1 break-words text-[25px] font-bold text-[#11314F]">{value}</div>
      <div className="mt-1 text-[11px] text-[#7A8A9B]">{note}</div>
      <MetricRail value={value} />
      <div className="mt-1 text-[10.5px] text-[#7A8A9B]" data-source-path={source}>Data source: SWFI records</div>
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
        <div className="mt-0.5 text-[11px] text-[#7A8A9B]" data-source-path={sourceNote}>Data source: SWFI records</div>
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
    <VisualPanel title="Active Allocator Activity" source={ENDPOINTS.allocators30} empty={ready ? SOURCE_GAP : LOADING} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = activityCountValue(row);
        return (
          <div key={`${text(row.name)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
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
    <VisualPanel title="Largest Recent Deals" source={ENDPOINTS.transactions30} empty={ready ? SOURCE_GAP : LOADING} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = amountValue(row);
        const amount = money(row.amount_display || row.capital_display || row.amount);
        return (
          <div key={`${text(row.title || row.name)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px] sm:items-start">
              <div className="min-w-0 font-bold text-[#16538C]">{displayCell(dealCell(row))}</div>
              <div className="text-right text-[12px] font-semibold text-[#41566B]">{amount}</div>
            </div>
            <Bar value={value} max={max} />
            <div className="mt-1 text-[11px] text-[#7A8A9B]">{text(row.institution)} · {text(row.sector)}</div>
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
    <VisualPanel title="RFP Deadline Timeline" source={ENDPOINTS.rfps} empty={ready ? SOURCE_GAP : LOADING} hasRows={chartRows.length > 0}>
      <div className="grid gap-2">
        {chartRows.map((row, index) => (
          <div key={`${text(row.title || row.name)}-${index}`} className="grid grid-cols-[88px_minmax(0,1fr)] gap-3 border-b border-[#F2F5F8] pb-2 last:border-b-0">
            <div className="rounded border border-[#C7D2DD] bg-[#F7F9FA] px-2 py-1 text-center text-[11px] font-bold text-[#11314F]">
              {timelineDate(row)}
            </div>
            <div className="min-w-0">
              <div className="font-bold text-[#16538C]">{displayCell(mandateCell(row))}</div>
              <div className="mt-1 text-[11px] text-[#7A8A9B]">{text(row.institution)} · {text(row.strategy || row.asset_class_or_strategy)}</div>
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
    <VisualPanel title="Sector Flow" source={ENDPOINTS.sectorFlows} empty={ready ? SOURCE_GAP : LOADING} hasRows={chartRows.length > 0}>
      {chartRows.map((row, index) => {
        const value = sectorValue(row);
        return (
          <div key={`${text(row.name || row.value)}-${index}`} className="border-b border-[#F2F5F8] py-2 last:border-b-0">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_88px] sm:items-start">
              <div className="min-w-0 font-bold text-[#16538C]">{displayCell(sectorCell(row))}</div>
              <div className="text-right text-[12px] font-semibold text-[#41566B]">{money(row.capital_display || row.capital_deployed || row.capital)}</div>
            </div>
            <Bar value={value} max={max} />
            <div className="mt-1 text-[11px] text-[#7A8A9B]">{text(row.count)} transactions</div>
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
        <div className="mt-0.5 text-[11px] text-[#7A8A9B]" data-source-path={source}>Data source: SWFI records</div>
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
  return [entityTypeCell(row), text(row.region || row.country, "")]
    .filter((part) => part && part !== SOURCE_GAP)
    .join(" · ");
}

function amountValue(row: Record<string, unknown>) {
  const display = money(row.amount_display || row.capital_display || row.amount);
  return numericSortValue(display) ?? 0;
}

function sectorValue(row: Record<string, unknown>) {
  const capital = money(row.capital_display || row.capital_deployed || row.capital);
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
  if (!Number.isFinite(parsed)) return text(value, "Not disclosed");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit" }).format(new Date(parsed));
}

function aumDisplay(row: Record<string, unknown>) {
  const numeric = numericSortValue(text(row.aum, ""));
  const currency = text(row.aum_currency, "").trim();
  if (numeric == null || !currency) return SOURCE_GAP;
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

function dealCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: text(row.title || row.name),
    href: transactionDetailHref(row, source),
    sourceHref: source,
    citationText: "SWFI transaction source on file",
  };
}

function mandateCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: text(row.title || row.name),
    href: mandateDetailHref(row, source),
    sourceHref: source,
    citationText: "SWFI Compass source on file",
  };
}

function researchCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: text(row.title || row.name),
    href: source || researchDetailHref(row, source),
    sourceHref: source,
    citationText: "SWFI source on file",
  };
}

function sourceDetailCell(label: string, href?: string, fallback = "/research/"): Cell {
  const provenance = href ? sourceProvenanceHref(href) : undefined;
  return provenance ? { label, href: provenance || fallback, sourceHref: provenance, citationText: "SWFI source on file" } : label;
}

function cellText(cell: Cell): string {
  return typeof cell === "string" ? cell : cell.label;
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
  if (typeof cell === "string") return cell;
  const hasSource = Boolean(cell.sourceHref);
  return (
    <span className="grid gap-1">
      <DataLink href={cell.href || "#"} sourceHref={cell.sourceHref} className="text-[#16538C] underline">{cell.label}</DataLink>
      {hasSource ? <span className="text-[10.5px] leading-tight text-[#7A8A9B]">SWFI source on file</span> : null}
    </span>
  );
}

function DataLink({ href, sourceHref, className, children }: { href: string; sourceHref?: string; className: string; children: React.ReactNode }) {
  const target = href;
  const provenance = sourceHref || sourceProvenanceHref(href);
  const recordLink = isCanonicalSwfiRecordHref(href);
  return <DashboardLink href={target} title={provenance ? "SWFI source on file" : undefined} data-record-link={recordLink ? "true" : undefined} data-source-state={provenance ? "on-file" : undefined} className={className}>{children}</DashboardLink>;
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
    label: text(row.name),
    href: profileDetailHref(row, source || undefined),
    sourceHref: source || undefined,
    citationText: entityId ? "SWFI source on file" : "SWFI allocator activity source",
  };
}

function entityTypeCell(row: Record<string, unknown>): string {
  return text(row.entity_type || row.type, "Not disclosed");
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
  const label = text(row.name || row.value);
  return {
    label,
    href: `/deals/?filter=${encodeURIComponent(label)}`,
    citationText: `SWFI sector flow source: ${ENDPOINTS.sectorFlows}`,
  };
}
