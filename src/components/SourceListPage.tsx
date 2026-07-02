"use client";

import type { MouseEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import type { Packet } from "@/lib/sourcePackets";
import { useGsapReveal } from "@/hooks/useGsapReveal";
import {
  fetchPacket,
  isFact,
  money,
  normalizeSwfiUrl,
  numericSortValue,
  packetData,
  rows,
  SOURCE_GAP,
  text,
} from "@/lib/sourcePackets";
import { appHref, isSwfiPlatformRecordHref, selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import { legacyPostId, mandateDetailHref, personDetailHref, profileDetailHref, researchDetailHref, sourceRecordIdFor, transactionDetailHref } from "@/lib/detailRoutes";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import AlertsRuleManager from "@/components/AlertsRuleManager";
import SavedSearchManager from "@/components/SavedSearchManager";

type Kind = "profiles" | "people" | "transactions" | "deals" | "allocators" | "comparisons" | "mandates" | "alerts" | "research" | "intelligence" | "search";
type Row = Record<string, unknown>;
type CellLink = { label: string; href?: string; sourceHref?: string };
type Cell = string | { label: string; href?: string; sourceHref?: string; citationText?: string; links?: CellLink[] };
const NOT_DISCLOSED = "Not disclosed";
const LOADING = "Loading";
const DEFAULT_SEARCH_QUERY = "";
const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
const pageLinks = [
  ["Dashboard", "/"],
  ["Institutions", "/profiles"],
  ["People", "/people"],
  ["Deals", "/deals"],
  ["Active Allocators", "/allocators"],
  ["Comparisons", "/comparisons"],
  ["RFPs", "/mandates"],
  ["Alerts", "/alerts"],
  ["Reports", "/reports"],
  ["Intelligence", "/intelligence"],
  ["Search", "/search"],
] as const;
const routeByKind: Record<Kind, string> = {
  profiles: "/profiles",
  people: "/people",
  transactions: "/transactions",
  deals: "/deals",
  allocators: "/allocators",
  comparisons: "/comparisons",
  mandates: "/mandates",
  alerts: "/alerts",
  research: "/research",
  intelligence: "/intelligence",
  search: "/search",
};

function searchPrefetchCacheKey(query: string): string {
  return `${SEARCH_PREFETCH_CACHE_PREFIX}${query.trim().toLowerCase()}`;
}

function initialSearchPackets(kind: Kind, query: string): Record<string, Packet> {
  if (kind !== "search" || typeof window === "undefined" || !query.trim()) return {};
  try {
    const raw = window.sessionStorage.getItem(searchPrefetchCacheKey(query));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { query?: string; stored_at?: number; packet?: Packet };
    if (String(parsed.query || "").trim().toLowerCase() !== query.trim().toLowerCase()) return {};
    if (!parsed.stored_at || Date.now() - parsed.stored_at > 60_000) return {};
    if (!parsed.packet || !isFact(parsed.packet)) return {};
    return { institutions: parsed.packet };
  } catch {
    return {};
  }
}

const CONFIG: Record<Kind, { title: string; endpoint: string; columns: string[]; sources?: Record<string, string> }> = {
  profiles: {
    title: "Institutions",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=100",
    columns: ["Entity Name", "Type", "Country", "AUM"],
  },
  people: {
    title: "People",
    endpoint: "/api/source-data/search/v1?collection=people&limit=100",
    columns: ["Name", "Title", "Institution", "Country", "Citation"],
  },
  transactions: {
    title: "Transactions",
    endpoint: "/api/transactions/v1?limit=100",
    columns: ["Name", "Buyer Entity", "Buyer Region", "Seller Entity", "Seller Region", "Amount (USD)", "Closed At"],
  },
  deals: {
    title: "Deals",
    endpoint: "/api/transactions/v1?limit=100",
    columns: ["Name", "Buyer Entity", "Buyer Region", "Seller Entity", "Seller Region", "Amount (USD)", "Closed At"],
  },
  allocators: {
    title: "Active Allocators",
    endpoint: "/api/allocator-activity/v1?days=90&limit=100",
    columns: ["Entity Name", "Entity Type", "Country", "Region", "Number of Deals", "Total Deal Value", "Last Transaction Date", "AUM"],
  },
  comparisons: {
    title: "Peer Comparisons",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=100",
    columns: ["Institution", "Entity Type", "Country / Region", "AUM", "Peer Group"],
  },
  mandates: {
    title: "RFPs / Mandates",
    endpoint: "/api/live-opportunities/v1",
    columns: ["Title", "Institution", "Strategy", "Deadline", "Citation"],
  },
  alerts: {
    title: "Alerts",
    endpoint: "",
    columns: ["Alert", "Type", "Institution", "Date", "Citation"],
  },
  research: {
    title: "Research / News",
    endpoint: "/api/source-intelligence/news/v1?limit=100",
    columns: ["Title", "Source", "Published", "Citation"],
  },
  intelligence: {
    title: "Intelligence",
    endpoint: "/api/source-intelligence/news/v1?limit=100",
    columns: ["Title", "Source", "Published", "Citation"],
  },
  search: {
    title: "Smart Search Bar",
    endpoint: "",
    columns: ["Type", "Result", "Source", "Detail", "Citation"],
  },
};

function rowCells(kind: Kind, row: Row): Cell[] {
  const href = sourceHref(row);
  if (kind === "profiles") return [profileCell(row), businessText(row.type), businessText(row.country || row.region), disclosedMoney(row.aum || row.assets)];
  if (kind === "comparisons") return [profileCell(row), businessText(row.type || row.entity_type), compactParts([row.country, row.region]), disclosedMoney(row.aum || row.assets), businessText(row.type || row.entity_type)];
  if (kind === "allocators") {
    return [
      allocatorProfileCell(row),
      text(row.entity_type || row.type, NOT_DISCLOSED),
      text(row.country, NOT_DISCLOSED),
      text(row.region, NOT_DISCLOSED),
      text(row.activity_count || row.deal_count, "0"),
      disclosedMoney(row.total_deal_value),
      text(row.latest_transaction_date || row.most_recent_activity_date, NOT_DISCLOSED),
      disclosedMoney(row.aum || row.assets),
    ];
  }
  if (kind === "people") return [personCell(row), text(row.title), text(row.institution), text(row.country), citation(href, "/people/")];
  if (kind === "transactions" || kind === "deals") {
    return [
      transactionCell(row),
      entityListCell(row, "buyer"),
      transactionFactCell(row, text(row.buyer_region || row.region)),
      entityListCell(row, "seller"),
      transactionFactCell(row, text(row.seller_region)),
      transactionFactCell(row, disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value)),
      transactionFactCell(row, text(row.closed_at || row.announced_at || row.date)),
    ];
  }
  if (kind === "mandates") return [mandateCell(row), text(row.institution), text(row.strategy || row.asset_class_or_strategy), text(row.deadline || row.due_at), citation(href, "/mandates/")];
  if (kind === "research" || kind === "intelligence") {
    const researchHref = researchSourceHref(row);
    return [researchCell(row), text(row.source), text(row.published_at || row.date), citation(researchHref, "/intelligence/")];
  }
  if (kind === "search") return [text(row.title || row.name), linked(text(row.institution || row.name), href, "/search/"), text(row.sector), disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value), citation(href, "/search/")];
  return [];
}

const allocatorSortOptions = [
  ["activity_count", "Number of Deals"],
  ["total_deal_value", "Total Deal Value"],
  ["most_recent_activity_date", "Last Transaction Date"],
  ["name", "Entity Name"],
  ["aum", "AUM"],
  ["country", "Country"],
  ["entity_type", "Entity Type"],
  ["last_updated", "Last Updated"],
] as const;

function defaultSortColumn(kind: Kind): number {
  return kind === "allocators" ? 4 : 0;
}

function defaultSortDir(kind: Kind): "asc" | "desc" {
  return kind === "allocators" ? "desc" : "asc";
}

function allocatorSortParamForColumn(column: string): string {
  const normalized = column.toLowerCase();
  if (normalized === "entity name") return "name";
  if (normalized === "entity type") return "entity_type";
  if (normalized === "country") return "country";
  if (normalized === "number of deals" || normalized === "activity count") return "activity_count";
  if (normalized === "total deal value") return "total_deal_value";
  if (normalized === "last transaction date" || normalized === "most recent activity date") return "most_recent_activity_date";
  if (normalized === "aum") return "aum";
  return "activity_count";
}

function allocatorColumnIndexForSort(sortKey: string, columns: string[]): number {
  const columnBySort: Record<string, string> = {
    activity_count: "Number of Deals",
    total_deal_value: "Total Deal Value",
    most_recent_activity_date: "Last Transaction Date",
    name: "Entity Name",
    aum: "AUM",
    country: "Country",
    entity_type: "Entity Type",
    number_of_investments: "Number of Deals",
    deal_count: "Number of Deals",
  };
  if (sortKey === "last_updated") return -1;
  return columns.indexOf(columnBySort[sortKey] || "Number of Deals");
}

export default function SourceListPage({ kind }: { kind: Kind }) {
  const rootRef = useGsapReveal<HTMLDivElement>();
  const config = CONFIG[kind];
  const [packets, setPackets] = useState<Record<string, Packet>>({});
  const [query, setQuery] = useState(DEFAULT_SEARCH_QUERY);
  const [submittedQuery, setSubmittedQuery] = useState(DEFAULT_SEARCH_QUERY);
  const [tableFilter, setTableFilter] = useState("");
  const [sortColumn, setSortColumn] = useState(() => defaultSortColumn(kind));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => defaultSortDir(kind));
  const [allocatorSort, setAllocatorSort] = useState("deal_count");
  const [selectedDealEntityTypes, setSelectedDealEntityTypes] = useState<string[]>([]);
  const [sectionView, setSectionView] = useState<"data" | "visualization">("data");
  const [rowLimit, setRowLimit] = useState(25);
  const [pageIndex, setPageIndex] = useState(0);
  const [comparisonPackets, setComparisonPackets] = useState<Record<string, Packet>>({});
  const serverPageIndex = isServerPagedKind(kind) ? pageIndex : 0;
  const serverRowLimit = isServerPagedKind(kind) ? rowLimit : 0;
  const serverFilterTerm = supportsServerFilter(kind) ? tableFilter.trim() : "";
  const serverSortDir = kind === "allocators" ? sortDir : "desc";

  const sources = useMemo(() => {
    if (kind !== "search") {
      if (kind === "profiles" || kind === "comparisons") {
        const entityQuery = serverFilterTerm ? `&q=${encodeURIComponent(serverFilterTerm)}` : "";
        return { main: `/api/source-data/search/v1?collection=entities${entityQuery}&limit=${serverRowLimit}&page=${serverPageIndex + 1}` };
      }
      if (kind === "people") {
        const peopleQuery = serverFilterTerm ? `&q=${encodeURIComponent(serverFilterTerm)}` : "";
        return { main: `/api/source-data/search/v1?collection=people${peopleQuery}&limit=${serverRowLimit}&page=${serverPageIndex + 1}` };
      }
      if (kind === "transactions" || kind === "deals") {
        const transactionFilter = [
          serverFilterTerm,
          ...(kind === "deals" ? selectedDealEntityTypes : []),
        ].filter(Boolean).join(" ");
        const transactionQuery = transactionFilter ? `&q=${encodeURIComponent(transactionFilter)}` : "";
        const main = `/api/transactions/v1?limit=${serverRowLimit}&page=${serverPageIndex + 1}${transactionQuery}`;
        return kind === "deals"
          ? { main, dealEntityTypes: "/api/transactions/v1?limit=100&page=1" }
          : { main };
      }
      if (kind === "allocators") {
        const allocatorQuery = serverFilterTerm ? `&q=${encodeURIComponent(serverFilterTerm)}` : "";
        return { main: `/api/allocator-activity/v1?days=90&limit=${serverRowLimit}&page=${serverPageIndex + 1}${allocatorQuery}&sort=${encodeURIComponent(allocatorSort)}&direction=${serverSortDir}` };
      }
      if (kind === "mandates") return { main: `/api/live-opportunities/v1?limit=${serverRowLimit}&page=${serverPageIndex + 1}` };
      if (kind === "alerts") {
        return {
          deals: "/api/recent-transactions/v1?days=30&limit=100&page=1",
          mandates: "/api/live-opportunities/v1?limit=100&page=1",
          allocators: "/api/allocator-activity/v1?days=90&limit=100&sort=deal_count&direction=desc",
        };
      }
      if (kind === "research" || kind === "intelligence") {
        const newsQuery = serverFilterTerm ? `&q=${encodeURIComponent(serverFilterTerm)}` : "";
        return { main: `/api/source-intelligence/news/v1?limit=${serverRowLimit}&page=${serverPageIndex + 1}${newsQuery}` };
      }
      return config.sources || (config.endpoint ? { main: config.endpoint } : {});
    }
    const clean = submittedQuery.trim();
    if (!clean) return {};
    const encoded = encodeURIComponent(clean);
    return {
      institutions: `/api/v1/public/search?q=${encoded}&limit=${rowLimit}`,
    };
  }, [allocatorSort, config.endpoint, config.sources, kind, rowLimit, selectedDealEntityTypes, serverFilterTerm, serverPageIndex, serverRowLimit, serverSortDir, submittedQuery]);

  useEffect(() => {
    let active = true;
    const controllers: AbortController[] = [];
    const resetTimer = globalThis.setTimeout(() => {
      if (active) {
        setPackets((current) => (kind === "search" && current.institutions ? current : {}));
      }
    }, 0);
    Object.entries(sources).forEach(([key, endpoint]) => {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = kind === "search" ? 180_000 : kind === "profiles" ? 180_000 : 150_000;
      void fetchPacket(endpoint, timeout, { signal: controller.signal, attempts: 3 }).then((packet) => {
        if (active) setPackets((current) => ({ ...current, [key]: packet }));
      });
    });
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
      globalThis.clearTimeout(resetTimer);
    };
  }, [kind, sources]);

  useEffect(() => {
    if (kind !== "search" || typeof window === "undefined") return;
    const urlQuery = new URLSearchParams(window.location.search).get("q")?.trim() || DEFAULT_SEARCH_QUERY;
    if (!urlQuery) return;
    const cachedPackets = initialSearchPackets(kind, urlQuery);
    const timer = window.setTimeout(() => {
      setQuery(urlQuery);
      setSubmittedQuery(urlQuery);
      if (cachedPackets.institutions) {
        setPackets((current) => ({ ...current, ...cachedPackets }));
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind]);

  useEffect(() => {
    if (kind !== "search") return;
    const clean = submittedQuery.trim();
    if (!clean || !packets.institutions || packets.people || packets.strategy) return;
    let active = true;
    const controller = new AbortController();
    const encoded = encodeURIComponent(clean);
    const secondarySources = {
      people: `/api/source-data/search/v1?collection=people&q=${encoded}&limit=${rowLimit}`,
      strategy: `/api/transaction-drilldown/v1?field=sector&value=${encoded}&days=365&limit=${rowLimit}`,
    };
    Object.entries(secondarySources).forEach(([key, endpoint]) => {
      void fetchPacket(endpoint, 180_000, { signal: controller.signal, attempts: 2 }).then((packet) => {
        if (active) setPackets((current) => ({ ...current, [key]: packet }));
      });
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [kind, packets.institutions, packets.people, packets.strategy, rowLimit, submittedQuery]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const urlFilter = new URLSearchParams(window.location.search).get("filter")?.trim();
    if (!urlFilter) return;
    const timeoutId = window.setTimeout(() => {
      setTableFilter(urlFilter);
      setPageIndex(0);
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, [kind]);

  const packet = packets.main;
  const sourceKeys = Object.keys(sources);
  const searchPacketsComplete = kind === "search" && sourceKeys.length > 0 && sourceKeys.every((key) => packets[key]);
  const searchHasRenderableRows = kind === "search" && sourceKeys.some((key) => {
    const item = packets[key];
    if (!isFact(item)) return false;
    return rows(item, key === "institutions" ? "results" : "rows").length > 0;
  });
  const allSourcesReady = kind === "search"
    ? sourceKeys.length > 0 && (searchHasRenderableRows || searchPacketsComplete)
    : sourceKeys.every((key) => packets[key]);
  const isLoading = sourceKeys.length > 0 && !allSourcesReady;
  const emptyMessage = isLoading ? LOADING : kind === "search" && !submittedQuery.trim() ? "Enter an institution, person, or strategy" : NOT_DISCLOSED;
  const waitingForSearch = kind === "search" && !submittedQuery.trim();
  const serverPaged = isServerPagedKind(kind) && (!tableFilter.trim() || supportsServerFilter(kind));

  const sourceRows = useMemo(() => {
    if (isLoading) return [];
    if (kind === "search") return searchRowsFromPackets(packets);
    if (kind === "alerts") return alertsRowsFromPackets(packets);
    if (!isFact(packet)) return [];
    const packetRows = rows(packet);
    const scopedRows = kind === "deals" && selectedDealEntityTypes.length
      ? packetRows.filter((row) => {
        const rowTypes = entityTypesForTransactionRow(row);
        return selectedDealEntityTypes.every((entityType) => rowTypes.includes(entityType));
      })
      : packetRows;
    return scopedRows.map((row) => rowCells(kind, row));
  }, [allSourcesReady, isLoading, kind, packet, packets, selectedDealEntityTypes]);
  const totalRows = totalCount(kind, packet, packets, sourceRows.length);
  const filteredRows = useMemo(() => {
    const clean = tableFilter.trim().toLowerCase();
    const filtered = clean
      ? sourceRows.filter((row) => row.some((cell) => searchableCellText(cell).toLowerCase().includes(clean)))
      : sourceRows;
    if (kind === "allocators") return filtered;
    return [...filtered].sort((a, b) => compareCells(a[sortColumn], b[sortColumn], sortDir));
  }, [kind, sourceRows, sortColumn, sortDir, tableFilter]);
  const pageCount = Math.max(1, Math.ceil((serverPaged ? totalRows : filteredRows.length) / rowLimit));
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  const pageStart = serverPaged ? 0 : safePageIndex * rowLimit;
  const visibleRows = filteredRows.slice(pageStart, pageStart + rowLimit);
  const comparisonRecords = useMemo(() => {
    if (kind !== "comparisons" || !isFact(packet)) return [];
    const clean = tableFilter.trim().toLowerCase();
    const source = rows(packet);
    const filtered = clean
      ? source.filter((row) => rowCells("comparisons", row).some((cell) => searchableCellText(cell).toLowerCase().includes(clean)))
      : source;
    return [...filtered].sort((a, b) => compareCells(rowCells("comparisons", a)[sortColumn], rowCells("comparisons", b)[sortColumn], sortDir));
  }, [kind, packet, sortColumn, sortDir, tableFilter]);
  const visibleComparisonRecords = useMemo(
    () => comparisonRecords.slice(pageStart, pageStart + rowLimit).slice(0, 5),
    [comparisonRecords, pageStart, rowLimit],
  );
  const countDetails = tableCountDetails(kind, packet, packets, totalRows, sourceRows.length);
  const visualizationRows = useMemo(() => isFact(packet) ? rows(packet) : [], [packet]);
  const dealEntityTypeOptions = useMemo(() => {
    if (kind !== "deals") return [];
    const optionPacket = packets.dealEntityTypes || packet;
    const values = new Set<string>(selectedDealEntityTypes);
    if (isFact(optionPacket)) {
      rows(optionPacket).forEach((row) => {
        entityTypesForTransactionRow(row).forEach((entityType) => values.add(entityType));
      });
    }
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [kind, packet, packets.dealEntityTypes, selectedDealEntityTypes]);
  const activeRoute = routeByKind[kind];

  useEffect(() => {
    if (kind !== "comparisons" || !visibleComparisonRecords.length) {
      return;
    }
    let active = true;
    const controllers: AbortController[] = [];
    visibleComparisonRecords.forEach((row) => {
      const id = comparisonRecordId(row);
      if (!id) return;
      const controller = new AbortController();
      controllers.push(controller);
      void fetchPacket(`/api/profiles/${encodeURIComponent(id)}/v1`, 90_000, { signal: controller.signal, attempts: 2 }).then((detailPacket) => {
        if (!active) return;
        setComparisonPackets((current) => ({ ...current, [id]: detailPacket }));
      });
    });
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
    };
  }, [kind, visibleComparisonRecords]);

  return (
    <div ref={rootRef} className="flex min-h-screen flex-col bg-[#F2F4F6] font-sans text-[#1B2733] lg:h-screen lg:overflow-hidden">
      <SwfiBrandHeader searchId="global-swfi-search" searchDefaultValue={kind === "search" ? submittedQuery : ""} />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside data-gsap-reveal className="flex w-full shrink-0 flex-wrap overflow-visible bg-[#11314F] lg:block lg:w-[196px] lg:overflow-y-auto">
          {pageLinks.map(([label, href]) => (
            <a
              key={label}
              href={appHref(href)}
              className={`flex min-h-9 flex-1 basis-[132px] items-center border-l-[3px] px-3.5 text-[13.5px] no-underline lg:flex-none ${href === activeRoute || ((kind === "research" || kind === "intelligence") && href === "/reports") ? "border-[#5C9BD6] bg-white/10 text-white" : "border-transparent text-[#A7BCD0]"}`}
            >
              {label}
            </a>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-visible lg:overflow-y-auto">
          <div className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]">
            <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="m-0 text-[19px] font-bold text-[#11314F]">{config.title}</h1>
                  <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">SWFI-backed rows only; record links open the corresponding SWFI record pages.</p>
                </div>
                <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
                  {waitingForSearch
                    ? "Awaiting search"
                    : isLoading
                      ? LOADING
                    : `Showing ${visibleRows.length.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")}`}
                </div>
              </div>
            </section>

        {kind === "search" ? (
          <form
            action="/swficc/search/"
            method="get"
            data-gsap-reveal
            className="grid gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)_120px] sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = query.trim() || DEFAULT_SEARCH_QUERY;
              setQuery(clean);
              setSubmittedQuery(clean);
              window.history.replaceState(null, "", `?q=${encodeURIComponent(clean)}`);
            }}
          >
            <label htmlFor="swfi-search-input" className="text-sm font-semibold text-[#11314F]">Institution, Person, Strategy</label>
            <input
              id="swfi-search-input"
              name="q"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-h-10 rounded border border-[#C7D2DD] px-3 text-base outline-none"
              placeholder="Search SWFI.com"
            />
            <button type="submit" className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3 text-base text-[#16538C]">Search</button>
          </form>
        ) : null}

        {kind === "comparisons" ? (
          <ComparisonWorkbench records={visibleComparisonRecords} packets={comparisonPackets} />
        ) : null}

        {kind === "deals" ? (
          <DealEnginePanel />
        ) : null}

        {kind === "alerts" ? (
          <AlertsRuleManager />
        ) : null}

        {kind === "search" ? (
          <SavedSearchManager />
        ) : null}

        {supportsSectionVisualization(kind) ? (
          <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white px-4 py-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-[16px] font-bold text-[#11314F]">{sectionVisualizationTitle(kind)}</h2>
                <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Current records with data and visualization views.</p>
              </div>
              <div className="flex rounded border border-[#C7D2DD] bg-[#F7F9FA] p-1 text-sm">
                {[
                  ["data", "Data"],
                  ["visualization", "Visualization"],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSectionView(value as "data" | "visualization")}
                    className={`rounded px-3 py-1.5 font-semibold ${sectionView === value ? "bg-white text-[#11314F] shadow-sm" : "text-[#617386]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {sectionView === "visualization" ? (
              kind === "mandates"
                ? <CompassVisualization rows={visualizationRows} totalRows={totalRows} />
                : <SectionVisualization kind={kind} rows={visualizationRows} totalRows={totalRows} />
            ) : null}
          </section>
        ) : null}

        <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#41566B]">
          <strong className="text-[#11314F]">Updated from SWFI.</strong>
          <span className="mt-1 block text-[#7A8A9B]">Open any row to view the corresponding SWFI record.</span>
        </section>

        <section data-gsap-reveal className={`grid gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm sm:items-center ${kind === "allocators" ? "sm:grid-cols-[minmax(0,1fr)_180px_150px_190px]" : kind === "deals" ? "sm:grid-cols-[minmax(0,1fr)_180px_210px_150px]" : "sm:grid-cols-[minmax(0,1fr)_180px_150px]"}`}>
          <div className="font-semibold text-[#11314F]">
            {waitingForSearch
              ? "Enter an institution, person, or strategy"
              : isLoading
                ? LOADING
              : `Showing ${visibleRows.length.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")}${countDetails}${tableFilter.trim() ? ` / filtered ${filteredRows.length.toLocaleString("en-US")}` : ""}`}
          </div>
          <label className="grid gap-1">
            <span className="font-semibold text-[#41566B]">Filter</span>
            <input
              type="search"
              value={tableFilter}
              onChange={(event) => {
                setTableFilter(event.target.value);
                setPageIndex(0);
              }}
              className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none"
              placeholder="Filter rows"
            />
          </label>
          <label className="grid gap-1">
            <span className="font-semibold text-[#41566B]">Rows</span>
            <select
              value={rowLimit}
              onChange={(event) => {
                setRowLimit(Number(event.target.value));
                setPageIndex(0);
              }}
              className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
            >
              {[5, 10, 25, 50, 100].map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
	          </label>
	          {kind === "deals" ? (
	            <label className="grid gap-1">
	              <span className="font-semibold text-[#41566B]">Entity Type</span>
	              <select
	                multiple
	                value={selectedDealEntityTypes}
	                disabled={!dealEntityTypeOptions.length}
	                onChange={(event) => {
	                  const nextValues = Array.from(event.currentTarget.selectedOptions, (option) => option.value);
	                  setSelectedDealEntityTypes(nextValues);
	                  setPageIndex(0);
	                }}
	                className="min-h-[78px] rounded border border-[#C7D2DD] bg-white px-2 py-1"
	              >
	                {dealEntityTypeOptions.map((entityType) => (
	                  <option key={entityType} value={entityType}>{entityType}</option>
	                ))}
	              </select>
	              {selectedDealEntityTypes.length ? (
	                <button
	                  type="button"
	                  className="w-fit bg-transparent p-0 text-left text-[12px] font-semibold text-[#16538C] underline"
	                  onClick={() => {
	                    setSelectedDealEntityTypes([]);
	                    setPageIndex(0);
	                  }}
	                >
	                  Clear Entity Type
	                </button>
	              ) : null}
	            </label>
	          ) : null}
	          {kind === "allocators" ? (
            <label className="grid gap-1">
              <span className="font-semibold text-[#41566B]">Sort</span>
              <select
                value={allocatorSort}
                onChange={(event) => {
                  const nextSort = event.target.value;
                  setAllocatorSort(nextSort);
                  const nextColumn = allocatorColumnIndexForSort(nextSort, config.columns);
                  if (nextColumn >= 0) setSortColumn(nextColumn);
                  setPageIndex(0);
                }}
                className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
              >
                {allocatorSortOptions.map(([value, label]) => <option key={`${value}-${label}`} value={value}>{label}</option>)}
              </select>
            </label>
          ) : null}
        </section>

        <div data-gsap-reveal className="grid gap-3 sm:hidden">
          {visibleRows.length ? visibleRows.map((row, rowIndex) => (
            <article key={rowIndex} className="rounded border border-[#DCE3EA] bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(17,49,79,0.03)]">
              <div className="min-w-0 text-[15px] font-semibold leading-snug text-[#11314F]">
                {displayCell(row[0])}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px] leading-snug">
                {config.columns.slice(1).map((column, offset) => (
                  <div key={column} className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{column}</dt>
                    <dd className="mt-0.5 min-w-0 break-words text-[#41566B]">{displayCell(row[offset + 1])}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )) : (
            <div className="rounded border border-[#DCE3EA] bg-white px-3 py-2 text-sm">{emptyMessage}</div>
          )}
        </div>

        <div data-gsap-reveal className="hidden overflow-x-auto rounded border border-[#DCE3EA] bg-white sm:block">
          <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="bg-[#F7F9FA]">
                {config.columns.map((column) => (
                  <th key={column} className="border-b border-[#DCE3EA] px-3 py-2 font-semibold text-[#41566B]">
                    <button
                      type="button"
                      className="w-full bg-transparent text-left font-semibold"
                      onClick={() => {
                        const nextIndex = config.columns.indexOf(column);
                        setSortColumn(nextIndex);
                        setSortDir(sortColumn === nextIndex && sortDir === "asc" ? "desc" : "asc");
                        if (kind === "allocators") setAllocatorSort(allocatorSortParamForColumn(column));
                        setPageIndex(0);
                      }}
                    >
                      {column}{sortColumn === config.columns.indexOf(column) ? ` ${sortDir}` : ""}
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row, rowIndex) => (
                <tr key={rowIndex} className="border-b border-[#F2F5F8] last:border-b-0">
                  {config.columns.map((column, columnIndex) => (
                    <td key={column} className="px-3 py-2 align-top text-[#41566B]">
                      {displayCell(row[columnIndex])}
                    </td>
                  ))}
                </tr>
              )) : (
                <tr>
                  <td className="px-3 py-2" colSpan={config.columns.length}>{emptyMessage}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {pageCount > 1 ? (
        <div data-gsap-reveal className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#41566B]">
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
        </main>
      </div>
    </div>
  );
}

function displayCell(value?: Cell) {
  const label = cellText(value);
  if (typeof value === "object" && value?.links?.length) {
    return (
      <span className="grid gap-1">
        {value.links.map((link, index) => {
          if (!link.href) {
            return <span key={`${link.label}-${index}`}>{link.label}</span>;
          }
          const target = productHref(link.href, "/");
          return (
            <span key={`${link.label}-${index}`} className="grid gap-1">
              <a href={target} onClick={(event) => hardNavigateSameRouteFilter(event, target)} title={link.sourceHref ? "Source on file" : undefined} data-record-link={isFirstPartyRecordHref(target) ? "true" : undefined} data-source-state={link.sourceHref ? "on-file" : undefined} className="text-[#16538C] underline">{link.label}</a>
            </span>
          );
        })}
      </span>
    );
  }
  const href = cellHref(value) || linkLikeHref(label);
  if (!label || label === SOURCE_GAP || label === "Not disclosed") return NOT_DISCLOSED;
  if (href) {
    const sourceHref = typeof value === "object" && value ? value.sourceHref || sourceProvenanceHref(label) : sourceProvenanceHref(label);
    const target = productHref(href, "/");
    return (
      <span className="grid gap-1">
        <a href={target} onClick={(event) => hardNavigateSameRouteFilter(event, target)} title={sourceHref ? "Source on file" : undefined} data-record-link={isFirstPartyRecordHref(target) ? "true" : undefined} data-source-state={sourceHref ? "on-file" : undefined} className="text-[#16538C] underline">{label}</a>
      </span>
    );
  }
  return label;
}

function isFirstPartyRecordHref(href: string): boolean {
  try {
    const parsed = new URL(href, "https://swfipn.local");
    const path = parsed.pathname.replace(/^\/swficc/, "").replace(/\/?$/, "/");
    if (path === "/profiles/detail/") return Boolean(parsed.searchParams.get("slug") || parsed.searchParams.get("name") || parsed.searchParams.get("id"));
    if (path === "/people/detail/") return Boolean(parsed.searchParams.get("name") || parsed.searchParams.get("id"));
    if (path === "/transactions/detail/") return Boolean(parsed.searchParams.get("title") || parsed.searchParams.get("id"));
    if (path === "/mandates/detail/") return Boolean(parsed.searchParams.get("title") || parsed.searchParams.get("id"));
    if (path === "/research/detail/") return Boolean(parsed.searchParams.get("legacy"));
  } catch {
    return false;
  }
  return false;
}

function hardNavigateSameRouteFilter(event: MouseEvent<HTMLAnchorElement>, target: string) {
  if (typeof window === "undefined") return;
  try {
    const targetUrl = new URL(target, window.location.origin);
    if (targetUrl.origin === window.location.origin && targetUrl.pathname === window.location.pathname && targetUrl.searchParams.has("filter")) {
      event.preventDefault();
      window.location.assign(targetUrl.toString());
    }
  } catch {
    return;
  }
}

function productHref(href: string | undefined, fallback = "/"): string {
  if (!href) return appHref(fallback);
  if (isSwfiPlatformRecordHref(href)) {
    return selfContainedHref(href, fallback);
  }
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return selfContainedHref(href, fallback);
}

function searchRowsFromPackets(packets: Record<string, Packet>): Cell[][] {
  const results: Cell[][] = [];

  if (isFact(packets.institutions)) {
    rows(packets.institutions, "results").forEach((row) => {
      const href = sourceHref(row);
      results.push([
        "Institution",
        linked(text(row.name), href),
        compactParts([row.type, row.country || row.region]),
        money(row.aum || row.assets),
        citation(href, "/profiles/"),
      ]);
    });
  }

  if (isFact(packets.people)) {
    rows(packets.people).forEach((row) => {
      const href = sourceHref(row);
      results.push([
        "Person",
        personCell(row),
        compactParts([row.title, row.institution]),
        text(row.country || row.region),
        citation(href, "/people/"),
      ]);
    });
  }

  if (isFact(packets.strategy)) {
    rows(packets.strategy).forEach((row) => {
      const href = sourceHref(row);
      results.push([
        "Strategy",
        transactionCell(row),
        text(row.institution),
        compactParts([row.sector, disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value)]),
        citation(href, "/deals/"),
      ]);
    });
  }

  return results;
}

function alertsRowsFromPackets(packets: Record<string, Packet>): Cell[][] {
  const results: Cell[][] = [];

  if (isFact(packets.deals)) {
    rows(packets.deals).forEach((row) => {
      const href = sourceHref(row);
      results.push([
        transactionCell(row),
        "New deals",
        entityListCell(row, "buyer"),
        text(row.closed_at || row.announced_at || row.activity_date || row.date),
        citation(href, "/transactions/"),
      ]);
    });
  }

  if (isFact(packets.mandates)) {
    rows(packets.mandates).forEach((row) => {
      const href = sourceHref(row);
      results.push([
        mandateCell(row),
        "New mandates",
        text(row.institution),
        text(row.deadline || row.due_at || row.relevant_date),
        citation(href, "/mandates/"),
      ]);
    });
  }

  if (isFact(packets.allocators)) {
    rows(packets.allocators).forEach((row) => {
      const href = sourceHref(row);
      results.push([
        allocatorProfileCell(row),
        "Investor activity",
        compactParts([row.country, row.region]),
        text(row.latest_transaction_date || row.most_recent_activity_date || row.last_transaction_date),
        citation(href, "/allocators/"),
      ]);
    });
  }

  return results;
}

function compactParts(values: unknown[]): string {
  const parts = values
    .map((value) => text(value, ""))
    .filter(Boolean)
    .filter((value) => value !== SOURCE_GAP && value !== "Not disclosed");
  return parts.length ? parts.join(" / ") : NOT_DISCLOSED;
}

function businessText(value: unknown): string {
  const display = text(value, NOT_DISCLOSED);
  return display === SOURCE_GAP ? NOT_DISCLOSED : display;
}

function dealCountLabel(value: unknown): string {
  const numeric = numericSortValue(text(value, ""));
  if (numeric == null) return "";
  return `${numeric.toLocaleString("en-US")} ${numeric === 1 ? "deal" : "deals"}`;
}

function disclosedMoney(value: unknown): string {
  if (value == null || value === "" || value === 0 || value === "0" || value === "$0") return NOT_DISCLOSED;
  const display = money(value);
  return display === SOURCE_GAP ? NOT_DISCLOSED : display;
}

function sourceHref(row: Row): string | undefined {
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

function researchSourceHref(row: Row): string | undefined {
  const explicit = sourceHref(row);
  if (explicit) return explicit;
  const legacy = text(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id, "");
  if (/^\d+$/.test(legacy)) return `https://www.swfi.com/?p=${encodeURIComponent(legacy)}`;
  return undefined;
}

function linked(label: string, href?: string, fallback = "/"): Cell {
  return href ? { label, href: productHref(href, fallback), sourceHref: sourceProvenanceHref(href) } : label;
}

function researchCell(row: Row): Cell {
  const provenance = researchSourceHref(row);
  return {
    label: text(row.title || row.name),
    href: researchDetailHref(row, provenance),
    sourceHref: provenance,
    citationText: provenance ? "SWFI source on file" : undefined,
  };
}

function profileCell(row: Row): Cell {
  const label = text(row.name || row.institution);
  const provenance = sourceHref(row) || entitySourceUrl(comparisonRecordId(row));
  return label
    ? {
        label,
        href: profileDetailHref(row, provenance),
        sourceHref: provenance,
        citationText: provenance ? `SWFI entity source: ${provenance}` : undefined,
      }
    : NOT_DISCLOSED;
}

function allocatorProfileCell(row: Row): Cell {
  const label = text(row.name || row.institution, "");
  const entityId = text(row.entity_id || row.id || row.source_record_id, "");
  const source = sourceHref(row) || entitySourceUrl(entityId);
  return label
    ? {
        label,
        href: profileDetailHref(row, source || undefined),
        sourceHref: source || undefined,
        citationText: entityId ? "Source on file" : undefined,
      }
    : NOT_DISCLOSED;
}

function transactionCell(row: Row, label = text(row.title || row.name)): Cell {
  const provenance = sourceHref(row) || transactionSourceUrl(recordIdFromRow(row, ["transaction_id", "transactionID", "source_record_id", "id"]));
  return {
    label,
    href: transactionDetailHref(row, provenance),
    sourceHref: provenance,
    citationText: provenance ? `SWFI transaction source: ${provenance}` : undefined,
  };
}

function dealProfileCell(row: Row): Cell {
  const label = text(row.investor || row.name, "");
  if (!label) return NOT_DISCLOSED;
  const slug = text(row.slug || row.profile_slug, "");
  const source = sourceHref(row);
  if (source) return { label, href: source, sourceHref: source, citationText: "SWFI profile source on file" };
  return { label, href: `/profiles/?filter=${encodeURIComponent(label)}`, citationText: "SWFI profile lookup" };
}

function dealProfileLink(row: Row, key: string): CellLink {
  const label = text(row[key], NOT_DISCLOSED);
  if (!label || label === NOT_DISCLOSED) return { label: NOT_DISCLOSED, href: undefined };
  return { label, href: `/profiles/?filter=${encodeURIComponent(label)}` };
}

function dealTransactionCell(row: Row): Cell {
  const label = text(row.latest_transaction, "");
  if (!label) return NOT_DISCLOSED;
  const source = text(row.latest_transaction_source_url || row.transaction_source_url || row.source_url || row.swfi_url, "");
  const href = source || `/transactions/?filter=${encodeURIComponent(label)}`;
  return { label, href, sourceHref: source || undefined };
}

function personCell(row: Row): Cell {
  const provenance = sourceHref(row) || personSourceUrl(recordIdFromRow(row, ["person_id", "personID", "source_record_id", "id"]));
  return {
    label: text(row.name || row.title),
    href: personDetailHref(row, provenance),
    sourceHref: provenance,
    citationText: provenance ? `SWFI people source: ${provenance}` : undefined,
  };
}

function transactionFactCell(row: Row, label: string): Cell {
  const clean = label && label !== SOURCE_GAP && label !== "Not disclosed" ? label : NOT_DISCLOSED;
  const provenance = sourceHref(row) || transactionSourceUrl(recordIdFromRow(row, ["transaction_id", "transactionID", "source_record_id", "id"]));
  return {
    label: clean,
    href: transactionDetailHref(row, provenance),
    sourceHref: provenance,
  };
}

function entityListCell(row: Row, role: "buyer" | "seller"): Cell {
  const entities = entityLinks(row, role);
  const provenance = sourceHref(row);
  if (!entities.length) {
    return {
      label: NOT_DISCLOSED,
      href: `/deals/?filter=${encodeURIComponent(text(row.title || row.name || ""))}`,
      sourceHref: provenance,
    };
  }
  return {
    label: entities.map((entity) => entity.label).join(", "),
    links: entities,
  };
}

function entityLinks(row: Row, role: "buyer" | "seller"): CellLink[] {
  const arrayKey = role === "buyer" ? "buyer_entities" : "seller_entities";
  const nameKey = role === "buyer" ? "buyer_entity" : "seller_entity";
  const idKey = role === "buyer" ? "buyer_entity_id" : "seller_entity_id";
  const urlKey = role === "buyer" ? "buyer_entity_url" : "seller_entity_url";
  const rows = Array.isArray(row[arrayKey]) ? row[arrayKey] as Row[] : [];
  const links: CellLink[] = [];
  rows.forEach((entity) => {
      const label = text(entity.name || entity.entityName, "");
      if (!label) return;
      const source = text(entity.source_url || entity.swfi_url, "") || entitySourceUrl(text(entity.id || entity.entityID || entity.entity_id, ""));
      links.push({ label, href: profileDetailHref({ name: label, slug: entity.slug, entity_id: text(entity.id || entity.entityID || entity.entity_id, "") }, source || undefined), sourceHref: source || undefined });
  });
  if (links.length) return links;
  const label = text((role === "buyer" ? row[nameKey] || row.institution : row[nameKey]), "");
  if (!label || label === "Not disclosed") return [];
  const source = text(row[urlKey], "") || entitySourceUrl(text(row[idKey] || (role === "buyer" ? row.institution_id : ""), ""));
  return [{ label, href: profileDetailHref({ name: label, entity_id: text(row[idKey] || (role === "buyer" ? row.institution_id : ""), "") }, source || undefined), sourceHref: source || undefined }];
}

function entityTypesForTransactionRow(row: Row): string[] {
  const values: string[] = [];
  for (const key of ["buyer_entities", "seller_entities"]) {
    const entityRows = Array.isArray(row[key]) ? row[key] as Row[] : [];
    entityRows.forEach((entity) => {
      const entityType = text(entity.type || entity.entity_type, "");
      if (entityType && entityType !== NOT_DISCLOSED) values.push(entityType);
    });
  }
  for (const key of ["buyer_entity_type", "seller_entity_type", "entity_type", "type"]) {
    const entityType = text(row[key], "");
    if (entityType && entityType !== NOT_DISCLOSED) values.push(entityType);
  }
  return [...new Set(values)];
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

function recordIdFromRow(row: Row, keys: string[]): string {
  return keys.map((key) => text(row[key], "")).find((value) => /^[a-f0-9]{24}$/i.test(value)) || "";
}

function mandateCell(row: Row): Cell {
  const provenance = sourceHref(row) || mandateSourceUrl(recordIdFromRow(row, ["compass_id", "mandate_id", "rfp_id", "source_record_id", "id"]));
  return {
    label: text(row.title || row.name),
    href: mandateDetailHref(row, provenance),
    sourceHref: provenance,
    citationText: provenance ? `SWFI Compass source: ${provenance}` : undefined,
  };
}

function citation(href: string | undefined, fallback = "/"): Cell {
  const provenance = href ? sourceProvenanceHref(href) : undefined;
  if (!provenance) return NOT_DISCLOSED;
  const internalLegacyHref = legacyPostId(provenance) ? researchDetailHref({}, provenance) : firstPartyDetailHrefForSource(provenance, fallback);
  return {
    label: "Source on file",
    href: internalLegacyHref || fallback,
    sourceHref: provenance,
    citationText: "Source on file",
  };
}

function firstPartyDetailHrefForSource(provenance: string, fallback: string): string {
  if (sourceRecordIdFor(provenance, "entities")) return profileDetailHref({}, provenance);
  if (sourceRecordIdFor(provenance, "people")) return personDetailHref({}, provenance);
  if (sourceRecordIdFor(provenance, "transactions")) return transactionDetailHref({}, provenance);
  if (sourceRecordIdFor(provenance, "compass")) return mandateDetailHref({}, provenance);
  return productHref(provenance, fallback);
}

function cellText(value?: Cell): string {
  return typeof value === "object" && value ? value.label : value || "";
}

function searchableCellText(value?: Cell): string {
  if (!value) return "";
  if (typeof value !== "object") return value;
  return [
    value.label,
    value.href,
    value.sourceHref,
    value.citationText,
    ...(value.links || []).flatMap((link) => [link.label, link.href, link.sourceHref]),
  ].filter(Boolean).join(" ");
}

function cellHref(value?: Cell): string | undefined {
  return typeof value === "object" && value ? value.href : undefined;
}

function linkLikeHref(value: string): string | undefined {
  if (value.startsWith("/")) return value;
  if (value.startsWith("http://") || value.startsWith("https://")) return value;
  return undefined;
}

function compareCells(a: Cell | undefined, b: Cell | undefined, dir: "asc" | "desc") {
  const av = cellText(a);
  const bv = cellText(b);
  const an = numericSortValue(av);
  const bn = numericSortValue(bv);
  if (an !== null && bn === null) return dir === "asc" ? -1 : 1;
  if (an === null && bn !== null) return dir === "asc" ? 1 : -1;
  const result = an !== null && bn !== null
    ? an - bn
    : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

function totalCount(kind: Kind, packet: Packet | undefined, packets: Record<string, Packet>, fallback: number) {
  if (kind === "search") {
    const total = ["institutions", "people", "strategy"].reduce((sum, key) => {
      const item = packets[key];
      if (!isFact(item)) return sum;
      const value = packetNumber(item, ["count"]);
      return sum + (value ?? rows(item, key === "institutions" ? "results" : "rows").length);
    }, 0);
    return Math.max(total, fallback);
  }
  if (kind === "alerts") {
    const total = ["deals", "mandates", "allocators"].reduce((sum, key) => {
      const item = packets[key];
      if (!isFact(item)) return sum;
      const value = packetNumber(item, ["count", "row_count"]);
      return sum + (value ?? rows(item).length);
    }, 0);
    return Math.max(total, fallback);
  }
  if (!isFact(packet)) return fallback;
  return packetNumber(packet, ["source_total", "total", "count", "row_count"]) ?? fallback;
}

function isServerPagedKind(kind: Kind) {
  return kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "transactions" || kind === "deals" || kind === "allocators" || kind === "mandates" || kind === "research" || kind === "intelligence";
}

function supportsServerFilter(kind: Kind) {
  return kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "transactions" || kind === "deals" || kind === "allocators" || kind === "research" || kind === "intelligence";
}

function tableCountDetails(kind: Kind, packet: Packet | undefined, packets: Record<string, Packet>, total: number, loaded: number) {
  if (kind === "search") return "";
  const matched = packetNumber(packet, ["count", "row_count"]);
  const sourceTotal = packetNumber(packet, ["source_total"]);
  const details: string[] = [];
  if (matched && matched > loaded && matched < total) details.push(`matched ${matched.toLocaleString("en-US")}`);
  if (sourceTotal && sourceTotal > total) details.push(`source total ${sourceTotal.toLocaleString("en-US")}`);
  if (loaded < total) details.push(`loaded ${loaded.toLocaleString("en-US")}`);
  return details.length ? ` / ${details.join(" / ")}` : "";
}

function packetNumber(packet: Packet | undefined, keys: string[]) {
  if (!packet) return null;
  const payload = packetData(packet);
  for (const source of [payload, packet]) {
    for (const key of keys) {
      const value = source[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (typeof value === "string" && value.trim() && Number.isFinite(Number(value))) return Number(value);
    }
  }
  return null;
}

function supportsSectionVisualization(kind: Kind): boolean {
  return ["profiles", "comparisons", "people", "transactions", "deals", "mandates"].includes(kind);
}

function sectionVisualizationTitle(kind: Kind): string {
  if (kind === "profiles") return "Institution Data Visualization";
  if (kind === "comparisons") return "Peer Comparison Visualization";
  if (kind === "people") return "People Data Visualization";
  if (kind === "transactions" || kind === "deals") return "Transaction Data Visualization";
  if (kind === "mandates") return "Compass RFP Analytics";
  return "Data Visualization";
}

function SectionVisualization({ kind, rows: sourceRows, totalRows }: { kind: Kind; rows: Row[]; totalRows: number }) {
  const categoryRows = bucketRows(sourceRows, (row) => sectionCategoryLabel(kind, row));
  const geographyRows = bucketRows(sourceRows, (row) => businessText(row.country || row.region || row.buyer_region || row.seller_region));
  const trendRows = bucketRows(sourceRows, (row) => monthBucket(row.closed_at || row.announced_at || row.published_at || row.updated_at || row.created_at || row.last_updated)).reverse();
  const topRows = [...sourceRows].slice(0, 8);
  const summary = [
    ["Total Records", totalRows.toLocaleString("en-US")],
    ["Loaded Rows", sourceRows.length.toLocaleString("en-US")],
    ["Top Category", categoryRows[0]?.label || NOT_DISCLOSED],
  ] as const;

  return (
    <div className="grid gap-4" data-brd-section-visualization={kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1 text-[12px] text-[#7A8A9B]">
          <span>Updated from SWFI</span>
          <span>Showing {sourceRows.length.toLocaleString("en-US")} loaded rows from {totalRows.toLocaleString("en-US")} total records.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadSectionCsv(kind, sourceRows)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C]">Export CSV</button>
          <button type="button" onClick={() => downloadSectionPng(kind, sourceRows)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C]">Export PNG</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{label}</div>
            <div className="mt-1 text-[18px] font-bold text-[#11314F]">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <SectionBarChart kind={kind} title="Records by Category" rows={categoryRows} />
        <SectionBarChart kind={kind} title="Records by Geography" rows={geographyRows} />
        <SectionLineChart title="Records by Month" rows={trendRows} />
      </div>
      <SectionTopRecords kind={kind} rows={topRows} />
    </div>
  );
}

function sectionCategoryLabel(kind: Kind, row: Row): string {
  if (kind === "profiles" || kind === "comparisons") return businessText(row.type || row.entity_type);
  if (kind === "people") return businessText(row.institution || row.title || row.country);
  if (kind === "transactions" || kind === "deals") return businessText(row.industry || row.category || row.sector || row.investment_type);
  return businessText(row.type || row.strategy || row.investment_type || row.asset_class_or_strategy);
}

function SectionBarChart({ kind, title, rows: chartRows }: { kind: Kind; title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...chartRows.map((row) => row.count));
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      <div className="grid gap-2">
        {chartRows.length ? chartRows.slice(0, 8).map((row) => (
          <a key={`${title}-${row.label}`} href={appHref(`${routeByKind[kind]}/?filter=${encodeURIComponent(row.label)}`)} className="grid gap-1 text-inherit no-underline">
            <div className="flex justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
              <span className="font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
            </div>
            <div className="h-2 rounded bg-[#E8EDF2]">
              <div className="h-2 rounded bg-[#5C9BD6]" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
            </div>
          </a>
        )) : <div className="text-sm text-[#7A8A9B]">No source rows available.</div>}
      </div>
    </div>
  );
}

function SectionLineChart({ title, rows: chartRows }: { title: string; rows: { label: string; count: number }[] }) {
  const visibleRows = chartRows.filter((row) => row.label !== NOT_DISCLOSED).slice(-12);
  const max = Math.max(1, ...visibleRows.map((row) => row.count));
  const points = visibleRows.length
    ? visibleRows.map((row, index) => {
      const x = visibleRows.length === 1 ? 50 : (index / (visibleRows.length - 1)) * 100;
      const y = 90 - (row.count / max) * 72;
      return `${x},${y}`;
    }).join(" ")
    : "";
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      {visibleRows.length ? (
        <div>
          <svg viewBox="0 0 100 100" className="h-32 w-full" role="img" aria-label={title}>
            <polyline points={points} fill="none" stroke="#5C9BD6" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            {points.split(" ").map((point, index) => {
              const [x, y] = point.split(",");
              return <circle key={`${point}-${index}`} cx={x} cy={y} r="2.5" fill="#11314F" />;
            })}
          </svg>
          <div className="mt-2 flex justify-between gap-2 text-[11px] text-[#7A8A9B]">
            <span>{visibleRows[0]?.label}</span>
            <span>{visibleRows.at(-1)?.label}</span>
          </div>
        </div>
      ) : <div className="text-sm text-[#7A8A9B]">No dated source rows available.</div>}
    </div>
  );
}

function SectionTopRecords({ kind, rows: topRows }: { kind: Kind; rows: Row[] }) {
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[13px] font-bold text-[#11314F]">Top Loaded Records</h3>
        <a href={appHref(routeByKind[kind])} className="text-sm text-[#16538C] underline">Open Data View</a>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {topRows.length ? topRows.map((row, index) => {
          const source = sourceHref(row);
          const href = sectionRecordHref(kind, row, source);
          return (
            <a key={`${sectionRecordLabel(kind, row)}-${index}`} href={productHref(href, routeByKind[kind])} data-source-state={source ? "on-file" : undefined} className="rounded border border-[#E1E8EF] px-3 py-2 text-[#405062] no-underline">
              <span className="block truncate text-[12px] font-bold text-[#11314F]">{sectionRecordLabel(kind, row)}</span>
              <span className="mt-1 block truncate text-[11px] text-[#7A8A9B]">{sectionCategoryLabel(kind, row)}</span>
            </a>
          );
        }) : <div className="text-sm text-[#7A8A9B]">No source rows available.</div>}
      </div>
    </div>
  );
}

function sectionRecordLabel(kind: Kind, row: Row): string {
  if (kind === "people") return text(row.name || row.title, NOT_DISCLOSED);
  if (kind === "transactions" || kind === "deals") return text(row.title || row.name, NOT_DISCLOSED);
  return text(row.name || row.institution || row.title, NOT_DISCLOSED);
}

function sectionRecordHref(kind: Kind, row: Row, source?: string): string {
  if (source) return source;
  if (kind === "people") return personDetailHref(row, source);
  if (kind === "transactions" || kind === "deals") return transactionDetailHref(row, source);
  if (kind === "mandates") return mandateDetailHref(row, source);
  return profileDetailHref(row, source);
}

function downloadSectionCsv(kind: Kind, sourceRows: Row[]) {
  const fields = sectionCsvFields(kind);
  const lines = [
    fields.map((field) => csvEscape(field.label)).join(","),
    ...sourceRows.map((row) => fields.map((field) => csvEscape(text(row[field.key], ""))).join(",")),
  ];
  triggerDownload(`${kind}-swfi-records.csv`, "text/csv;charset=utf-8", lines.join("\n"));
}

function sectionCsvFields(kind: Kind): Array<{ key: string; label: string }> {
  if (kind === "people") return [
    { key: "name", label: "Name" },
    { key: "title", label: "Title" },
    { key: "institution", label: "Institution" },
    { key: "country", label: "Country" },
    { key: "source_url", label: "Source URL" },
  ];
  if (kind === "transactions" || kind === "deals") return [
    { key: "title", label: "Name" },
    { key: "buyer_entity", label: "Buyer Entity" },
    { key: "amount_display", label: "Amount" },
    { key: "closed_at", label: "Closed At" },
    { key: "source_url", label: "Source URL" },
  ];
  return [
    { key: "name", label: "Name" },
    { key: "type", label: "Type" },
    { key: "country", label: "Country" },
    { key: "region", label: "Region" },
    { key: "source_url", label: "Source URL" },
  ];
}

function csvEscape(value: string): string {
  return `"${value.replaceAll("\"", "\"\"")}"`;
}

function downloadSectionPng(kind: Kind, sourceRows: Row[]) {
  if (typeof document === "undefined") return;
  const rowsForChart = bucketRows(sourceRows, (row) => sectionCategoryLabel(kind, row)).slice(0, 8);
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#11314F";
  context.font = "bold 28px Arial";
  context.fillText(sectionVisualizationTitle(kind), 32, 48);
  context.fillStyle = "#617386";
  context.font = "16px Arial";
  context.fillText("Updated from SWFI", 32, 78);
  const max = Math.max(1, ...rowsForChart.map((row) => row.count));
  rowsForChart.forEach((row, index) => {
    const y = 125 + index * 46;
    const width = Math.max(18, (row.count / max) * 620);
    context.fillStyle = "#E8EDF2";
    context.fillRect(285, y - 18, 640, 24);
    context.fillStyle = "#5C9BD6";
    context.fillRect(285, y - 18, width, 24);
    context.fillStyle = "#11314F";
    context.font = "14px Arial";
    context.fillText(row.label.slice(0, 28), 32, y);
    context.fillText(row.count.toLocaleString("en-US"), 285 + width + 10, y);
  });
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    triggerDownloadUrl(`${kind}-swfi-visualization.png`, url);
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

function triggerDownload(filename: string, mimeType: string, content: string) {
  if (typeof document === "undefined") return;
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  triggerDownloadUrl(filename, url);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function triggerDownloadUrl(filename: string, url: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function CompassVisualization({ rows: sourceRows, totalRows }: { rows: Row[]; totalRows: number }) {
  const investmentTypeRows = bucketRows(sourceRows, (row) => businessText(row.investment_type || row.strategy || row.asset_class_or_strategy || row.type));
  const regionRows = bucketRows(sourceRows, (row) => businessText(row.region || row.country));
  const monthRows = bucketRows(sourceRows, (row) => monthBucket(row.posted_at || row.created_at || row.published_at || row.deadline || row.due_at)).reverse();
  const disclosedAmounts = sourceRows.map((row) => numericSortValue(disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital))).filter((value): value is number => typeof value === "number");
  const totalCapital = disclosedAmounts.reduce((sum, value) => sum + value, 0);
  const averageTicket = disclosedAmounts.length ? totalCapital / disclosedAmounts.length : 0;
  const summary = [
    ["Total Open RFPs", totalRows.toLocaleString("en-US")],
    ["Total Capital Sought", totalCapital ? compactMoney(totalCapital) : NOT_DISCLOSED],
    ["Average Ticket Size", averageTicket ? compactMoney(averageTicket) : NOT_DISCLOSED],
  ] as const;
  return (
    <div className="grid gap-4" data-brd-compass-visualization="true">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid gap-1 text-[12px] text-[#7A8A9B]">
          <span>Updated from SWFI</span>
          <span>Showing {sourceRows.length.toLocaleString("en-US")} loaded Compass rows from {totalRows.toLocaleString("en-US")} total records.</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => downloadSectionCsv("mandates", sourceRows)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C]">Export CSV</button>
          <button type="button" onClick={() => downloadSectionPng("mandates", sourceRows)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C]">Export PNG</button>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {summary.map(([label, value]) => (
          <div key={label} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{label}</div>
            <div className="mt-1 text-[19px] font-bold text-[#11314F]">{value}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <CompassBarChart title="RFPs by Investment Type" rows={investmentTypeRows} />
        <CompassBarChart title="RFPs by Region" rows={regionRows} />
        <CompassLineChart title="RFPs Posted Per Month" rows={monthRows} />
      </div>
    </div>
  );
}

function CompassBarChart({ title, rows: chartRows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...chartRows.map((row) => row.count));
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      <div className="grid gap-2">
        {chartRows.length ? chartRows.slice(0, 8).map((row) => (
          <a key={row.label} href={appHref(`/mandates/?filter=${encodeURIComponent(row.label)}`)} className="grid gap-1 text-inherit no-underline">
            <div className="flex justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
              <span className="font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
            </div>
            <div className="h-2 rounded bg-[#E8EDF2]">
              <div className="h-2 rounded bg-[#5C9BD6]" style={{ width: `${Math.max(8, (row.count / max) * 100)}%` }} />
            </div>
          </a>
        )) : <div className="text-sm text-[#7A8A9B]">No Compass rows available.</div>}
      </div>
    </div>
  );
}

function CompassLineChart({ title, rows: chartRows }: { title: string; rows: { label: string; count: number }[] }) {
  const max = Math.max(1, ...chartRows.map((row) => row.count));
  const points = chartRows.length
    ? chartRows.slice(-12).map((row, index, visibleRows) => {
      const x = visibleRows.length === 1 ? 50 : (index / (visibleRows.length - 1)) * 100;
      const y = 90 - (row.count / max) * 72;
      return `${x},${y}`;
    }).join(" ")
    : "";
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      {chartRows.length ? (
        <div>
          <svg viewBox="0 0 100 100" className="h-32 w-full" role="img" aria-label={title}>
            <polyline points={points} fill="none" stroke="#5C9BD6" strokeWidth="3" vectorEffect="non-scaling-stroke" />
            {points.split(" ").map((point, index) => {
              const [x, y] = point.split(",");
              return <circle key={`${point}-${index}`} cx={x} cy={y} r="2.5" fill="#11314F" />;
            })}
          </svg>
          <div className="mt-2 flex justify-between gap-2 text-[11px] text-[#7A8A9B]">
            <span>{chartRows[0]?.label}</span>
            <span>{chartRows.at(-1)?.label}</span>
          </div>
        </div>
      ) : <div className="text-sm text-[#7A8A9B]">No monthly Compass rows available.</div>}
    </div>
  );
}

function bucketRows(sourceRows: Row[], labelFor: (row: Row) => string) {
  const buckets = new Map<string, number>();
  sourceRows.forEach((row) => {
    const label = labelFor(row);
    const clean = label && label !== SOURCE_GAP ? label : NOT_DISCLOSED;
    buckets.set(clean, (buckets.get(clean) || 0) + 1);
  });
  return [...buckets.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

function compactMoney(value: number) {
  const units: [number, string][] = [
    [1_000_000_000_000, "T"],
    [1_000_000_000, "B"],
    [1_000_000, "M"],
    [1_000, "K"],
  ];
  const unit = units.find(([size]) => Math.abs(value) >= size);
  if (!unit) return `$${value.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  const scaled = value / unit[0];
  return `$${scaled.toLocaleString("en-US", { maximumFractionDigits: scaled >= 100 ? 0 : 1 })}${unit[1]}`;
}

function monthBucket(value: unknown) {
  const parsed = Date.parse(text(value, ""));
  if (!Number.isFinite(parsed)) return NOT_DISCLOSED;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(parsed));
}

function DealEnginePanel() {
  const [query, setQuery] = useState("infrastructure");
  const [submittedQuery, setSubmittedQuery] = useState("infrastructure");
  const [days, setDays] = useState(365);
  const [packets, setPackets] = useState<Record<string, Packet>>({});

  const sources = useMemo(() => {
    const encoded = encodeURIComponent(submittedQuery.trim() || "infrastructure");
    return {
      ticketSize: `/api/deal-intelligence/ticket-size/v1?q=${encoded}&days=${days}&limit=5`,
      frequency: `/api/deal-intelligence/investment-frequency/v1?q=${encoded}&days=${days}&limit=5`,
      coInvestments: `/api/co-investments/v1?days=${days}&limit=5`,
    };
  }, [days, submittedQuery]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) setPackets({});
    });
    Object.entries(sources).forEach(([key, endpoint]) => {
      void fetchPacket(endpoint, 120_000, { attempts: 3 }).then((packet) => {
        if (active) setPackets((current) => ({ ...current, [key]: packet }));
      });
    });
    return () => {
      active = false;
    };
  }, [sources]);

  const ticketRows = isFact(packets.ticketSize)
    ? rows(packets.ticketSize).map((row) => [
      businessText(row.label || row.band),
      dealCountLabel(row.deals || row.count),
      disclosedMoney(row.capital_display || row.capital_usd),
    ])
    : [];
  const frequencyRows = isFact(packets.frequency)
    ? rows(packets.frequency).map((row) => [
      dealProfileCell(row),
      dealCountLabel(row.deal_count || row.deals_in_window),
      compactParts([row.latest_transaction_date, row.sector, row.region]),
    ])
    : [];
  const coInvestmentRows = isFact(packets.coInvestments)
    ? rows(packets.coInvestments).map((row) => [
      {
        label: compactParts([row.investor_a, row.investor_b]),
        links: [
          dealProfileLink(row, "investor_a"),
          dealProfileLink(row, "investor_b"),
        ],
      },
      dealTransactionCell(row),
      disclosedMoney(row.amount_display || row.total_amount || row.amount),
    ])
    : [];
  const readyCount = [packets.ticketSize, packets.frequency, packets.coInvestments].filter(isFact).length;

  return (
    <section data-gsap-reveal className="grid gap-3 rounded border border-[#DCE3EA] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Capital Deal Engine</h2>
          <div className="mt-1 text-[12px] text-[#7A8A9B]">Ticket size, investment frequency, and co-investment intelligence from transaction activity.</div>
        </div>
        <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {readyCount === 3 ? "3 of 3 SWFI record sets ready" : `Loading ${readyCount} of 3 SWFI record sets`}
        </div>
      </div>

      <form
        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_140px_120px] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedQuery(query.trim() || "infrastructure");
        }}
      >
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Industry / theme</span>
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none"
            placeholder="Infrastructure"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Period</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2">
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
            <option value={1095}>3 years</option>
          </select>
        </label>
        <button type="submit" className="min-h-9 rounded border border-[#C7D2DD] bg-white px-3 text-sm font-semibold text-[#16538C]">Apply</button>
      </form>

      <div className="grid gap-3 xl:grid-cols-3">
        <DealEngineTable title="Ticket Size" columns={["Band", "Deals", "Capital"]} rows={ticketRows} />
        <DealEngineTable title="Investment Frequency" columns={["Investor", "Deals", "Latest"]} rows={frequencyRows} />
        <DealEngineTable title="Co-Investments" columns={["Investors", "Latest Deal", "Amount"]} rows={coInvestmentRows} />
      </div>
    </section>
  );
}

function DealEngineTable({ title, columns, rows: tableRows }: { title: string; columns: string[]; rows: Cell[][] }) {
  return (
    <div className="overflow-hidden rounded border border-[#DCE3EA]">
      <div className="border-b border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-sm font-bold text-[#11314F]">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[360px] border-collapse text-left text-[13px]">
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column} className="border-b border-[#E8EDF2] px-3 py-2 font-semibold text-[#41566B]">{column}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tableRows.length ? tableRows.map((row, rowIndex) => (
              <tr key={`${title}-${rowIndex}`} className="border-b border-[#F2F5F8] last:border-b-0">
                {columns.map((column, columnIndex) => (
                  <td key={column} className="px-3 py-2 align-top text-[#41566B]">{displayCell(row[columnIndex])}</td>
                ))}
              </tr>
            )) : (
              <tr>
                <td className="px-3 py-2 text-[#7A8A9B]" colSpan={columns.length}>{LOADING}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ComparisonWorkbench({ records, packets }: { records: Row[]; packets: Record<string, Packet> }) {
  const hydrated = records.map((record) => comparisonHydratedRecord(record, packets));
  const metrics = [
    ["Entity Type", (row: Row) => businessText(row.type || row.entity_type)],
    ["Country", (row: Row) => businessText(row.country)],
    ["Region", (row: Row) => businessText(row.region)],
    ["AUM", (row: Row) => disclosedMoney(row.aum || row.assets)],
    ["AUM Date", (row: Row) => businessText(row.aum_date)],
    ["Managed Assets", (row: Row) => disclosedMoney(row.managed_assets)],
    ["Peer Group", (row: Row) => businessText(row.type || row.entity_type)],
    ["Source", (row: Row) => sourceHref(row) ? "Source on file" : NOT_DISCLOSED],
  ] as const;

  return (
    <section data-gsap-reveal className="grid gap-3 rounded border border-[#DCE3EA] bg-white px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Current Peer Set</h2>
          <div className="mt-1 text-[12px] text-[#7A8A9B]">Exact profile packets hydrated: {hydrated.filter((row) => row.__profile_fact === true).length} of {hydrated.length}</div>
        </div>
        <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          Comparing {hydrated.length.toLocaleString("en-US")} institutions
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-left text-sm">
          <thead>
            <tr className="bg-[#F7F9FA]">
              <th className="w-[170px] border-b border-[#DCE3EA] px-3 py-2 text-[#41566B]">Metric</th>
              {hydrated.map((row) => {
                const source = sourceHref(row);
                const href = source || profileDetailHref(row, source);
                return (
                  <th key={comparisonRecordId(row) || comparisonName(row)} className="border-b border-[#DCE3EA] px-3 py-2 text-[#11314F]">
                    <a href={productHref(href, "/profiles/")} data-source-state={source ? "on-file" : undefined} className="text-[#16538C] underline">
                      {comparisonName(row)}
                    </a>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {metrics.map(([label, valueForMetric]) => (
              <tr key={label} className="border-b border-[#F2F5F8] last:border-b-0">
                <td className="px-3 py-2 font-semibold text-[#11314F]">{label}</td>
                {hydrated.map((row) => {
                  const value = valueForMetric(row);
                  const source = label === "Source" ? sourceHref(row) : "";
                  const profileHref = source || profileDetailHref(row, source || undefined);
                  return (
                    <td key={`${comparisonRecordId(row) || comparisonName(row)}-${label}`} className="px-3 py-2 align-top text-[#41566B]">
                      {source ? (
                        <a href={productHref(source, profileHref)} data-source-state="on-file" className="text-[#16538C] underline">
                          {value}
                        </a>
                      ) : value}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function comparisonHydratedRecord(record: Row, packets: Record<string, Packet>): Row {
  const id = comparisonRecordId(record);
  const packet = id ? packets[id] : undefined;
  const profile = isFact(packet) ? packetData(packet).profile as Row | undefined : undefined;
  if (!profile) return { ...record, __profile_fact: false };
  return {
    ...record,
    ...profile,
    source_url: sourceHref(profile) || sourceHref(record),
    swfi_url: text(profile.swfi_url || record.swfi_url, ""),
    __profile_fact: true,
  };
}

function comparisonRecordId(row: Row): string {
  return text(row.entity_id, "") || sourceRecordIdFor(sourceHref(row), "entities") || text(row.id || row.source_record_id, "");
}

function comparisonName(row: Row): string {
  return text(row.name || row.institution || row.legal_name, NOT_DISCLOSED);
}
