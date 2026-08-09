"use client";

import type { MouseEvent } from "react";
import { Fragment, useEffect, useMemo, useState } from "react";
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
import { appHref, isSwfiPlatformRecordHref, selfContainedHref, sourceProvenanceHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { legacyPostId, mandateDetailHref, personDetailHref, profileDetailHref, researchDetailHref, sourceRecordIdFor, transactionDetailHref } from "@/lib/detailRoutes";
import { closingSoonestRanking, daysUntilLabel, firstStamp, focusRanking, freshnessSummary, largestRanking, mostRecentRanking, PREVIEW_PAGE_CAP, previewPageCount, type DashRecord } from "@/lib/sectionDashboards";
import { DASHBOARD_SECTION_NAV } from "@/lib/dashboardSectionNav";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import AlertsRuleManager from "@/components/AlertsRuleManager";
import SavedSearchManager from "@/components/SavedSearchManager";
import CompetitionAnalysisWorkbench from "@/components/CompetitionAnalysisWorkbench";
import { defaultSortColumn, defaultSortDir, type Kind } from "@/lib/recordSort";
import { entityLifecycleIntent } from "@/lib/entityLifecycle";
import { eligibleTextQuery, isShortTextQuery, isTextQueryReady, MIN_TEXT_QUERY_CHARACTERS } from "@/lib/textQueryPolicy";
import {
  beginSearchSourceSettlements,
  canRenderConfirmedEmpty,
  isSearchRequestPending,
  searchRequestLifecycleState,
  searchSourceSettlementFromPacket,
  type SearchRequestLifecycleState,
  type SearchSourceSettlements,
} from "@/lib/searchRequestLifecycle";
import { searchPacketRows } from "@/lib/searchSourceCoordinator";
import {
  TRANSACTION_FILTER_OPTIONS,
  emptyTransactionFilter,
  isTransactionFilterField,
  normalizedTransactionWindow,
  transactionFilterLabel,
  transactionSourceEndpoint,
  type TransactionFilter,
} from "@/lib/transactionSourceContract";
import {
  emptyMandateFilters,
  mandateFilterSummary,
  mandateSourceEndpoint,
  normalizeMandateFilters,
  type MandateFilters,
} from "@/lib/mandateSourceContract";
import {
  emptyNewsDateFilters,
  newsFilterSummary,
  newsSourceEndpoint,
  normalizeNewsDateFilters,
  type NewsDateFilters,
} from "@/lib/newsSourceContract";
import {
  peopleFilterSummary,
  peopleSourceEndpoint,
  verifiedPeopleLinkedInProfileUrl,
} from "@/lib/peopleSourceContract";
import { comparableAumCurrency, formatDisclosedAum } from "@/lib/aumRankingContract";
import { allocatorSourceEndpoint, inspectAllocatorPacket, normalizeAllocatorRequest, type AllocatorSort, type AllocatorWindow } from "@/lib/allocatorSourceContract";
import { comparisonEntityListEndpoint } from "@/lib/comparisonSourceContract";
import { comparisonPeerTypeKey } from "@/lib/competitionAnalysis";

type Row = Record<string, unknown>;
type CellLink = { label: string; href?: string; sourceHref?: string };
// newTab: Paul-sanctioned 2026-07-06 ("can the linkedin links open in a new
// page altogether?") — auxiliary data links may open in a NEW TAB; the
// dashboard's own in-tab chain still terminates at swfi.com.
type Cell = string | { label: string; href?: string; sourceHref?: string; citationText?: string; newTab?: boolean; links?: CellLink[] };
const NOT_DISCLOSED = "Not disclosed";
const LOADING = "Loading";
const DEFAULT_SEARCH_QUERY = "";
const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
const pageLinks = DASHBOARD_SECTION_NAV;
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

function profileListUrl({
  tableFilter,
  entityType,
  region,
  includeDefunct,
  rowLimit,
  pageIndex,
  sortColumn,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  entityType: string;
  region: string;
  includeDefunct: boolean;
  rowLimit: number;
  pageIndex: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = eligibleTextQuery(tableFilter);
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  if (entityType) url.searchParams.set("entity_type", entityType);
  else url.searchParams.delete("entity_type");
  if (region) url.searchParams.set("region", region);
  else url.searchParams.delete("region");
  if (includeDefunct) url.searchParams.set("include_defunct", "true");
  else url.searchParams.delete("include_defunct");
  url.searchParams.set("rows", String(rowLimit));
  url.searchParams.set("page", String(pageIndex + 1));
  url.searchParams.set("sort", String(sortColumn));
  url.searchParams.set("dir", sortDir);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
}

function transactionListUrl({
  tableFilter,
  transactionFilter,
  rowLimit,
  pageIndex,
  sortColumn,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  transactionFilter: TransactionFilter;
  rowLimit: number;
  pageIndex: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = eligibleTextQuery(tableFilter);
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  if (transactionFilter.field && transactionFilter.value.trim()) {
    url.searchParams.set("tx_field", transactionFilter.field);
    url.searchParams.set("tx_value", transactionFilter.value.trim());
  } else {
    url.searchParams.delete("tx_field");
    url.searchParams.delete("tx_value");
  }
  url.searchParams.set("days", String(transactionFilter.days));
  url.searchParams.set("rows", String(rowLimit));
  url.searchParams.set("page", String(pageIndex + 1));
  url.searchParams.set("sort", String(sortColumn));
  url.searchParams.set("dir", sortDir);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
}

function mandateListUrl({
  tableFilter,
  mandateFilters,
  rowLimit,
  pageIndex,
  sortColumn,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  mandateFilters: MandateFilters;
  rowLimit: number;
  pageIndex: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = eligibleTextQuery(tableFilter);
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  url.searchParams.delete("investment_type");
  mandateFilters.investmentTypes.forEach((value) => url.searchParams.append("investment_type", value));
  for (const [key, value] of [
    ["ticket_min", mandateFilters.ticketMin],
    ["ticket_max", mandateFilters.ticketMax],
    ["ticket_currency", mandateFilters.ticketCurrency],
  ] as const) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  url.searchParams.set("rows", String(rowLimit));
  url.searchParams.set("page", String(pageIndex + 1));
  url.searchParams.set("sort", String(sortColumn));
  url.searchParams.set("dir", sortDir);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
}

function newsListUrl({
  tableFilter,
  dateFilters,
  rowLimit,
  pageIndex,
  sortColumn,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  dateFilters: NewsDateFilters;
  rowLimit: number;
  pageIndex: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = tableFilter.trim();
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  for (const [key, value] of [
    ["date_from", dateFilters.dateFrom],
    ["date_to", dateFilters.dateTo],
  ] as const) {
    if (value) url.searchParams.set(key, value);
    else url.searchParams.delete(key);
  }
  url.searchParams.set("rows", String(rowLimit));
  url.searchParams.set("page", String(pageIndex + 1));
  url.searchParams.set("sort", String(sortColumn));
  url.searchParams.set("dir", sortDir);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
}

function peopleListUrl({
  tableFilter,
  rowLimit,
  pageIndex,
  sortColumn,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  rowLimit: number;
  pageIndex: number;
  sortColumn: number;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = eligibleTextQuery(tableFilter);
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  url.searchParams.set("rows", String(Math.min(50, Math.max(1, rowLimit))));
  url.searchParams.set("page", String(Math.min(PREVIEW_PAGE_CAP, Math.max(0, pageIndex) + 1)));
  url.searchParams.set("sort", String(sortColumn));
  url.searchParams.set("dir", sortDir);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
}

function allocatorListUrl({
  tableFilter,
  days,
  rowLimit,
  pageIndex,
  sort,
  sortDir,
  sectionView,
}: {
  tableFilter: string;
  days: number;
  rowLimit: number;
  pageIndex: number;
  sort: string;
  sortDir: "asc" | "desc";
  sectionView: "data" | "visualization";
}): string {
  const url = new URL(window.location.href);
  const cleanFilter = eligibleTextQuery(tableFilter);
  if (cleanFilter) url.searchParams.set("q", cleanFilter);
  else url.searchParams.delete("q");
  url.searchParams.delete("filter");
  const request = normalizeAllocatorRequest({ days, limit: rowLimit, page: pageIndex + 1, sort: sort as AllocatorSort, direction: sortDir, query: cleanFilter });
  url.searchParams.set("days", String(request.days));
  url.searchParams.set("rows", String(request.limit));
  url.searchParams.set("page", String(request.page));
  url.searchParams.set("sort", request.sort);
  url.searchParams.set("dir", request.direction);
  url.searchParams.set("view", sectionView);
  return `${url.pathname}${url.search}${url.hash}`;
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

const CONFIG: Record<Kind, { title: string; endpoint: string; columns: string[]; columnsNote?: string; sources?: Record<string, string> }> = {
  profiles: {
    title: "Institutions",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=100",
    columns: ["Entity Name", "Type", "Country", "AUM", "Status"],
    columnsNote: "AUM is displayed in each record's declared native currency. The entity directory has no verified global AUM sort or exact country filter, so AUM sorting is withheld and country facets remain display-only.",
  },
  people: {
    // Live source-contract audit 2026-07-21: title and institution are present
    // in the public People projection, although many values are explicitly
    // Not disclosed. Keep the fields visible without inventing missing facts.
    title: "People",
    endpoint: "/api/source-data/search/v1?collection=people&limit=100",
    columns: ["Name", "Title", "Institution", "Country", "City", "Region", "LinkedIn", "Citation"],
    columnsNote: "People search is currently a name-substring source query. Country, region, city, title, institution, and LinkedIn-availability parameters are not sent because the live source silently ignores them. Missing role and institution values remain explicitly Not disclosed.",
  },
  transactions: {
    title: "Transactions",
    endpoint: "/api/recent-transactions/v1?days=365&limit=10&page=1",
    columns: ["Name", "Buyer Entity", "Seller Entity", "Buyer Region", "Sector", "Transaction Type", "Acquisition / Investment Type", "Amount (USD)", "Closed At"],
    columnsNote: "Buyer, seller, transaction type, and acquisition / investment type are separate source fields. Seller coverage is sparse; missing sellers remain explicitly Not disclosed.",
  },
  deals: {
    title: "Deals",
    endpoint: "/api/transactions/v1?limit=100",
    columns: ["Name", "Buyer Entity", "Buyer Region", "Sector", "Type", "Amount (USD)", "Closed At"],
    columnsNote: "Seller details are not disclosed in SWFI transaction records — columns return when the source carries them.",
  },
  allocators: {
    title: "Active Allocators",
    endpoint: "/api/allocator-activity/v1?days=90&limit=100&page=1&sort=activity_count&direction=desc",
    columns: ["Entity Name", "Entity Type", "Country", "Region", "Number of Deals", "Disclosed Deal Value", "Last Transaction Date", "Activity Evidence", "AUM"],
    columnsNote: "The default source ranking is completed buyer/acquirer deal count, disclosed deal value, then latest transaction date. The Activity Evidence link opens the latest sampled transaction; the source returns at most a sample of deal URLs, not proof of the full aggregate. AUM remains native-currency context and is not sortable.",
  },
  comparisons: {
    title: "Peer Comparisons",
    endpoint: "/api/source-data/search/v1?collection=entities&limit=100",
    columns: ["Institution", "Entity Type", "Country / Region", "AUM", "Peer Group", "Status"],
    columnsNote: "Candidate AUM preserves each record's declared native currency and source date where available. Cross-currency AUM ordering is withheld because the source supplies no approved FX conversion contract. The selected peer matrix is the separately governed panel above.",
  },
  mandates: {
    title: "RFPs / Mandates",
    endpoint: "/api/live-opportunities/v1",
    columns: ["Title", "Record Type", "Institution", "Investment Type", "Amount", "Deadline", "Citation"],
    columnsNote: "Each row keeps its source label: RFP or Opportunity. The open-record source is ordered by deadline soonest first; the broader historical Compass source total is disclosed separately and never drives this pager.",
  },
  alerts: {
    title: "Alerts",
    endpoint: "",
    columns: ["Alert", "Type", "Institution", "Date", "Citation"],
  },
  research: {
    title: "News & Articles",
    endpoint: "/api/source-intelligence/news/v1?limit=100",
    columns: ["Title", "Published", "Summary", "Citation"],
  },
  intelligence: {
    // Value-add fix 2026-07-06 (Paul: "what value add is this page
    // providing?"): the feed serves full excerpts (25/25 probe receipt) that
    // were never displayed. Published is now normalized by the backend from
    // the active WordPress date fields and leads the records view newest-first.
    title: "News & Articles",
    endpoint: "/api/source-intelligence/news/v1?limit=100",
    columns: ["Title", "Published", "Summary", "Citation"],
  },
  search: {
    title: "Smart Search",
    endpoint: "",
    columns: ["Type", "Result", "Source", "Detail", "Record"],
  },
};

function rowCells(kind: Kind, row: Row): Cell[] {
  const href = sourceHref(row);
  if (kind === "profiles") return [profileCell(row), businessText(row.entity_type || row.type), businessText(row.country || row.region), formatDisclosedAum(row), businessText(row.entity_status || (row.defunct === true ? "defunct" : "active"))];
  if (kind === "comparisons") return [profileCell(row), businessText(row.type || row.entity_type), compactParts([row.country, row.region]), formatDisclosedAum(row), businessText(row.type || row.entity_type), businessText(row.entity_status || (row.defunct === true ? "defunct" : "active"))];
  if (kind === "allocators") {
    return [
      allocatorProfileCell(row),
      text(row.entity_type || row.type, NOT_DISCLOSED),
      text(row.country, NOT_DISCLOSED),
      text(row.region, NOT_DISCLOSED),
      text(row.deal_count || row.activity_count, "0"),
      disclosedMoney(row.total_deal_value_display || row.total_deal_value),
      text(row.last_transaction_date || row.latest_transaction_date || row.most_recent_activity_date, NOT_DISCLOSED),
      linked("Latest transaction", text(row.latest_transaction_source_url, "") || undefined, "/transactions/"),
      formatDisclosedAum(row),
    ];
  }
  if (kind === "people") {
    const peopleSource = sourceHref(row);
    const linkedIn = verifiedPeopleLinkedInProfileUrl(row.linkedin_url, peopleSource);
    return [
      personCell(row),
      text(row.title),
      text(row.institution),
      text(row.country),
      text(row.city),
      text(row.region),
      // Paul 2026-07-06 (same day, after the MUST law): LinkedIn opens in a
      // NEW TAB — the in-tab chain still ends at the person's SWFI record
      // (Citation column); the profile pops a separate page.
      linkedIn ? { label: "LinkedIn profile ↗", href: linkedIn, newTab: true } : NOT_DISCLOSED,
      citation(peopleSource || href, "/people/"),
    ];
  }
  if (kind === "transactions" || kind === "deals") {
    if (kind === "deals") {
      return [
        transactionCell(row),
        entityListCell(row, "buyer"),
        transactionFactCell(row, text(row.buyer_region || row.region)),
        transactionFactCell(row, text(row.sector || row.industry)),
        transactionFactCell(row, text(row.investment_type || row.type)),
        transactionFactCell(row, disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value)),
        transactionFactCell(row, text(row.closed_at || row.announced_at || row.date)),
      ];
    }
    return [
      transactionCell(row),
      entityListCell(row, "buyer"),
      entityListCell(row, "seller"),
      transactionFactCell(row, text(row.buyer_region || row.region)),
      transactionFactCell(row, text(row.sector || row.industry)),
      transactionFactCell(row, text(row.type)),
      transactionFactCell(row, text(row.investment_type)),
      transactionFactCell(row, disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value)),
      transactionFactCell(row, text(row.closed_at || row.announced_at || row.date)),
    ];
  }
  if (kind === "mandates") return [
    mandateCell(row),
    text(row.record_type || row.opportunity_type || row.type),
    text(row.institution),
    mandateInvestmentTypeText(row),
    disclosedMoney(row.amount_display || row.amount),
    text(row.deadline || row.due_at),
    citation(href, "/mandates/"),
  ];
  if (kind === "research" || kind === "intelligence") {
    const researchHref = researchSourceHref(row);
    const excerpt = text(row.excerpt, "").replace(/\s+/g, " ").trim();
    return [
      researchCell(row),
      text(row.published_at || row.publishedAt || row.date || row.updated_at || row.updatedAt),
      excerpt ? (excerpt.length > 220 ? `${excerpt.slice(0, 219)}…` : excerpt) : NOT_DISCLOSED,
      citation(researchHref, "/intelligence/"),
    ];
  }
  if (kind === "search") return [text(row.title || row.name), linked(text(row.institution || row.name), href, "/search/"), text(row.sector), disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value), citation(href, "/search/")];
  return [];
}

const allocatorSortOptions = [
  ["activity_count", "Number of Deals"],
  ["total_deal_value", "Disclosed Deal Value"],
  ["most_recent_activity_date", "Last Transaction Date"],
  ["name", "Entity Name"],
  ["country", "Country"],
  ["entity_type", "Entity Type"],
] as const;

function columnSortSupported(kind: Kind, column: string): boolean {
  if (kind === "allocators") return allocatorSortParamForColumn(column) !== null;
  if (column.toLowerCase() !== "aum") return true;
  return kind !== "profiles" && kind !== "comparisons";
}

function requestedSortSupported(kind: Kind, columns: string[], requestedSort: number): boolean {
  return Number.isInteger(requestedSort)
    && requestedSort >= 0
    && requestedSort < columns.length
    && columnSortSupported(kind, columns[requestedSort]);
}

function unsortableColumnDisclosure(kind: Kind, column: string): { label: string; title: string } {
  if (column.toLowerCase() === "aum") {
    return { label: `${column} · source currency`, title: "Not sortable across native currencies" };
  }
  if (kind === "allocators") {
    return { label: `${column} · display only`, title: "The allocator source endpoint does not expose a sort for this field" };
  }
  return { label: column, title: "This field is not sortable" };
}

// defaultSortColumn / defaultSortDir moved to @/lib/recordSort so the
// directory defaults remain testable independently of the contract-gated
// Top-Ranked AUM source.

function allocatorSortParamForColumn(column: string): AllocatorSort | null {
  const normalized = column.toLowerCase();
  if (normalized === "entity name") return "name";
  if (normalized === "entity type") return "entity_type";
  if (normalized === "country") return "country";
  if (normalized === "number of deals") return "activity_count";
  if (normalized === "disclosed deal value") return "total_deal_value";
  if (normalized === "last transaction date") return "most_recent_activity_date";
  return null;
}

function allocatorColumnIndexForSort(sortKey: string, columns: string[]): number {
  const columnBySort: Record<string, string> = {
    activity_count: "Number of Deals",
    total_deal_value: "Disclosed Deal Value",
    most_recent_activity_date: "Last Transaction Date",
    name: "Entity Name",
    country: "Country",
    entity_type: "Entity Type",
  };
  return columns.indexOf(columnBySort[sortKey] || "Number of Deals");
}

type DealFieldFilter = { key: string; field: "industry" | "sector"; value: string };
function dealFieldOptionRows(packet: Packet | undefined, packets: Record<string, Packet>): Row[] {
  const source = packets.dealTaxonomy || packets.dealEntityTypes || packet;
  return isFact(source) ? rows(source) : [];
}

function transactionRowIdentity(row: Row): string {
  const direct = text(row.swfi_url || row.source_url || row.transaction_id || row.transactionID || row.source_record_id || row.id, "");
  if (direct && direct !== SOURCE_GAP) return direct;
  return compactParts([row.title || row.name, row.buyer_entity || row.institution, row.closed_at || row.announced_at || row.activity_date]);
}

function uniqueTransactionRows(items: Row[]): Row[] {
  const seen = new Set<string>();
  const result: Row[] = [];
  items.forEach((row) => {
    const key = transactionRowIdentity(row);
    if (seen.has(key)) return;
    seen.add(key);
    result.push(row);
  });
  return result;
}

function mandateFacetOptions(packet: Packet | undefined, key: "investment_types" | "ticket_currencies", selected: string[]): string[] {
  const values = new Set(selected.map((value) => value.trim()).filter(Boolean));
  if (!isFact(packet)) return [...values];
  const facets = packetData(packet).facets;
  if (!facets || typeof facets !== "object" || Array.isArray(facets)) return [...values];
  const candidates = (facets as Record<string, unknown>)[key];
  if (!Array.isArray(candidates)) return [...values];
  candidates.forEach((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return;
    const name = text((candidate as Record<string, unknown>).name, "").trim();
    if (name) values.add(name);
  });
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function fieldOptionsForRows(items: Row[], field: "industry" | "sector", selected: string[]): string[] {
  const values = new Set<string>(selected);
  items.forEach((row) => {
    const value = businessText(row[field]);
    if (value && value !== NOT_DISCLOSED) values.add(value);
  });
  return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function MultiSelectField({
  label,
  options,
  value,
  onChange,
  testId,
  allowCustom = false,
  maxSelections = 8,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (value: string[]) => void;
  testId: string;
  allowCustom?: boolean;
  maxSelections?: number;
}) {
  const [customValue, setCustomValue] = useState("");
  const selected = new Set(value);
  const atLimit = value.length >= maxSelections;

  function toggle(option: string) {
    if (selected.has(option)) {
      onChange(value.filter((item) => item !== option));
      return;
    }
    if (!atLimit) onChange([...value, option]);
  }

  function addCustomValue() {
    const clean = customValue.trim();
    if (!clean || selected.has(clean) || atLimit) return;
    onChange([...value, clean]);
    setCustomValue("");
  }

  return (
    <div className="grid min-w-0 gap-1" data-testid={testId}>
      <span className="font-semibold text-[#41566B]">{label}</span>
      <details className="relative rounded border border-[#C7D2DD] bg-white">
        <summary className="min-h-9 cursor-pointer list-none px-2 py-2 text-sm text-[#41566B] marker:hidden">
          {value.length ? `${value.length} selected` : `Select ${label.toLowerCase()}`}
        </summary>
        <div className="absolute z-30 mt-1 grid max-h-64 w-[min(320px,85vw)] gap-1 overflow-y-auto rounded border border-[#C7D2DD] bg-white p-2 shadow-lg" role="group" aria-label={`${label} options`}>
          {options.length ? options.map((option) => (
            <label key={option} className="flex min-h-8 items-center gap-2 rounded px-2 py-1 text-sm hover:bg-[#F2F6F9]">
              <input
                type="checkbox"
                checked={selected.has(option)}
                disabled={!selected.has(option) && atLimit}
                onChange={() => toggle(option)}
              />
              <span>{option}</span>
            </label>
          )) : (
            <span className="px-2 py-1 text-xs text-[#5C6D7E]">No loaded source values</span>
          )}
          {allowCustom ? (
            <div className="mt-1 flex gap-1 border-t border-[#E1E7ED] pt-2">
              <input
                type="search"
                value={customValue}
                onChange={(event) => setCustomValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  event.preventDefault();
                  addCustomValue();
                }}
                placeholder={`Add ${label.toLowerCase()}`}
                className="min-h-8 min-w-0 flex-1 rounded border border-[#C7D2DD] px-2 text-sm outline-none"
              />
              <button type="button" onClick={addCustomValue} disabled={!customValue.trim() || atLimit} className="rounded border border-[#C7D2DD] px-2 text-xs font-semibold text-[#16538C] disabled:opacity-50">Add</button>
            </div>
          ) : null}
        </div>
      </details>
      {value.length ? (
        <div className="flex max-w-[320px] flex-wrap gap-1" aria-label={`Selected ${label.toLowerCase()}`}>
          {value.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => onChange(value.filter((item) => item !== option))}
              className="max-w-full truncate rounded-full bg-[#E8F0F7] px-2 py-1 text-left text-[11px] font-semibold text-[#16538C]"
              aria-label={`Remove ${option}`}
            >
              {option} ×
            </button>
          ))}
          <button type="button" onClick={() => onChange([])} className="px-1 text-[11px] font-semibold text-[#6B7785] underline">Clear all</button>
        </div>
      ) : null}
      <span className="sr-only">Select up to {maxSelections}; matching uses any selected value.</span>
    </div>
  );
}

export default function SourceListPage({ kind }: { kind: Kind }) {
  const rootRef = useGsapReveal<HTMLDivElement>();
  const config = CONFIG[kind];
  const [packets, setPackets] = useState<Record<string, Packet>>({});
  const [sourceSettlements, setSourceSettlements] = useState<SearchSourceSettlements>({});
  const [sourceRetryKey, setSourceRetryKey] = useState(0);
  const [query, setQuery] = useState(DEFAULT_SEARCH_QUERY);
  const [submittedQuery, setSubmittedQuery] = useState(DEFAULT_SEARCH_QUERY);
  const [searchInputIssue, setSearchInputIssue] = useState("");
  const [tableFilter, setTableFilter] = useState("");
  const [serverFilterTerm, setServerFilterTerm] = useState("");
  const [sortColumn, setSortColumn] = useState(() => defaultSortColumn(kind));
  const [sortDir, setSortDir] = useState<"asc" | "desc">(() => defaultSortDir(kind));
  const [allocatorSort, setAllocatorSort] = useState<AllocatorSort>("activity_count");
  const [allocatorDays, setAllocatorDays] = useState<AllocatorWindow>(90);
  const [allocatorUrlReady, setAllocatorUrlReady] = useState(() => kind !== "allocators");
  const [selectedDealEntityTypes, setSelectedDealEntityTypes] = useState<string[]>([]);
  const [selectedDealIndustries, setSelectedDealIndustries] = useState<string[]>([]);
  const [selectedDealSectors, setSelectedDealSectors] = useState<string[]>([]);
  const [mandateFilterDraft, setMandateFilterDraft] = useState<MandateFilters>(emptyMandateFilters);
  const [mandateFilters, setMandateFilters] = useState<MandateFilters | null>(() => (
    kind === "mandates" ? null : emptyMandateFilters()
  ));
  const [mandateFilterIssue, setMandateFilterIssue] = useState("");
  const [newsDateFilterDraft, setNewsDateFilterDraft] = useState<NewsDateFilters>(emptyNewsDateFilters);
  const [newsDateFilters, setNewsDateFilters] = useState<NewsDateFilters | null>(() => (
    kind === "research" || kind === "intelligence" ? null : emptyNewsDateFilters()
  ));
  const [newsDateFilterIssue, setNewsDateFilterIssue] = useState("");
  const [includeDefunct, setIncludeDefunct] = useState(false);
  const [routeEntityType, setRouteEntityType] = useState<string | null>(() => (
    kind === "profiles" || kind === "comparisons" ? null : ""
  ));
  const [entityTypeDraft, setEntityTypeDraft] = useState("");
  const [entityTypeIssue, setEntityTypeIssue] = useState("");
  const [routeRegion, setRouteRegion] = useState("");
  const [regionDraft, setRegionDraft] = useState("");
  const [regionIssue, setRegionIssue] = useState("");
  const [transactionFilter, setTransactionFilter] = useState<TransactionFilter | null>(() => (
    kind === "transactions" ? null : emptyTransactionFilter()
  ));
  const [transactionFilterDraft, setTransactionFilterDraft] = useState<TransactionFilter>(emptyTransactionFilter);
  const [transactionFilterIssue, setTransactionFilterIssue] = useState("");
  const [peopleUrlReady, setPeopleUrlReady] = useState(() => kind !== "people");
  const [sectionView, setSectionView] = useState<"data" | "visualization">(() => supportsSectionVisualization(kind) ? "visualization" : "data");
  // Meeting decision: transaction searches and Active Allocators open with 10
  // rows. Other list kinds retain the 25-row preview.
  const [rowLimit, setRowLimit] = useState(() => (kind === "allocators" || kind === "transactions" ? 10 : 25));
  // Paul-reported live bug 2026-07-06 (/mandates/?filter=...: "this site
  // links dont lead anywhere"): arriving with ?filter= means the visitor
  // clicked a chart segment and came for RECORDS — but the default
  // Visualization view hid the record table (and its swfi.com handoffs)
  // behind the Data toggle. A filter arrival lands on Data. (Effect, not
  // state initializer: the static export pre-renders without the query
  // string, so deciding at hydration time would mismatch — React #418.)
  const [pageIndex, setPageIndex] = useState(0);

  useEffect(() => {
    function restoreUrlContext() {
      try {
        const params = new URLSearchParams(window.location.search);
        if (kind === "people") {
          const requestedRows = Number(params.get("rows"));
          const requestedPage = Number(params.get("page"));
          const requestedSort = Number(params.get("sort"));
          const requestedDir = params.get("dir");
          const requestedView = params.get("view");
          const urlQuery = params.get("q")?.trim() || params.get("filter")?.trim() || "";
          setTableFilter(urlQuery);
          setServerFilterTerm(eligibleTextQuery(urlQuery));
          if ([5, 10, 25, 50].includes(requestedRows)) setRowLimit(requestedRows);
          if (Number.isInteger(requestedPage) && requestedPage > 0) setPageIndex(Math.min(PREVIEW_PAGE_CAP, requestedPage) - 1);
          if (params.has("sort") && requestedSortSupported(kind, config.columns, requestedSort)) setSortColumn(requestedSort);
          if ((requestedDir === "asc" || requestedDir === "desc") && (!params.has("sort") || requestedSortSupported(kind, config.columns, requestedSort))) setSortDir(requestedDir);
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (urlQuery) setSectionView("data");
          setPeopleUrlReady(true);
          return;
        }
        if (kind === "profiles" || kind === "comparisons") {
          const entityType = params.get("entity_type")?.trim() || "";
          const region = params.get("region")?.trim() || "";
          const urlFilter = params.get("q")?.trim() || params.get("filter")?.trim() || "";
          const requestedRows = Number(params.get("rows"));
          const requestedPage = Number(params.get("page"));
          const requestedSort = Number(params.get("sort"));
          const requestedDir = params.get("dir");
          const requestedView = params.get("view");
          setRouteEntityType(entityType);
          setEntityTypeDraft(entityType);
          setRouteRegion(region);
          setRegionDraft(region);
          setTableFilter(urlFilter);
          setServerFilterTerm(eligibleTextQuery(urlFilter));
          setIncludeDefunct(params.get("include_defunct") === "true");
          if ([5, 10, 25, 50].includes(requestedRows)) setRowLimit(requestedRows);
          if (Number.isInteger(requestedPage) && requestedPage > 0) setPageIndex(requestedPage - 1);
          if (params.has("sort") && requestedSortSupported(kind, config.columns, requestedSort)) setSortColumn(requestedSort);
          if ((requestedDir === "asc" || requestedDir === "desc") && (!params.has("sort") || requestedSortSupported(kind, config.columns, requestedSort))) setSortDir(requestedDir);
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (entityType || region || urlFilter || params.get("include_defunct") === "true") setSectionView("data");
          return;
        }
        if (kind === "transactions") {
          const requestedField = params.get("tx_field")?.trim() || "";
          const requestedValue = params.get("tx_value")?.trim() || "";
          const requestedDays = normalizedTransactionWindow(Number(params.get("days")));
          const requestedRows = Number(params.get("rows"));
          const requestedPage = Number(params.get("page"));
          const requestedSort = Number(params.get("sort"));
          const requestedDir = params.get("dir");
          const requestedView = params.get("view");
          const restoredFilter: TransactionFilter = {
            field: isTransactionFilterField(requestedField) ? requestedField : "",
            value: isTransactionFilterField(requestedField) ? requestedValue : "",
            days: requestedDays,
          };
          setTransactionFilter(restoredFilter);
          setTransactionFilterDraft(restoredFilter);
          setTableFilter(params.get("q")?.trim() || params.get("filter")?.trim() || "");
          if ([5, 10, 25, 50, 100].includes(requestedRows)) setRowLimit(requestedRows);
          if (Number.isInteger(requestedPage) && requestedPage > 0) setPageIndex(requestedPage - 1);
          if (params.has("sort") && requestedSortSupported(kind, config.columns, requestedSort)) setSortColumn(requestedSort);
          if ((requestedDir === "asc" || requestedDir === "desc") && (!params.has("sort") || requestedSortSupported(kind, config.columns, requestedSort))) setSortDir(requestedDir);
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (restoredFilter.field || params.has("q") || params.has("filter")) setSectionView("data");
          return;
        }
        if (kind === "mandates") {
          const restoredFilters: MandateFilters = {
            investmentTypes: params.getAll("investment_type").map((value) => value.trim()).filter(Boolean),
            ticketMin: params.get("ticket_min")?.trim() || "",
            ticketMax: params.get("ticket_max")?.trim() || "",
            ticketCurrency: params.get("ticket_currency")?.trim().toUpperCase() || "",
          };
          const restoredValidation = normalizeMandateFilters(restoredFilters);
          const restoredSourceFilters = restoredValidation.ok ? restoredValidation.filters : emptyMandateFilters();
          const requestedRows = Number(params.get("rows"));
          const requestedPage = Number(params.get("page"));
          const requestedSort = Number(params.get("sort"));
          const requestedDir = params.get("dir");
          const requestedView = params.get("view");
          setMandateFilters(restoredSourceFilters);
          setMandateFilterDraft(restoredValidation.filters);
          setMandateFilterIssue(restoredValidation.issue);
          setTableFilter(params.get("q")?.trim() || params.get("filter")?.trim() || "");
          if ([5, 10, 25, 50, 100].includes(requestedRows)) setRowLimit(requestedRows);
          if (Number.isInteger(requestedPage) && requestedPage > 0) setPageIndex(requestedPage - 1);
          if (params.has("sort") && requestedSortSupported(kind, config.columns, requestedSort)) setSortColumn(requestedSort);
          if ((requestedDir === "asc" || requestedDir === "desc") && (!params.has("sort") || requestedSortSupported(kind, config.columns, requestedSort))) setSortDir(requestedDir);
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (restoredFilters.investmentTypes.length || restoredFilters.ticketMin || restoredFilters.ticketMax || restoredFilters.ticketCurrency || params.has("q") || params.has("filter")) setSectionView("data");
          return;
        }
        if (kind === "research" || kind === "intelligence") {
          const restoredDates: NewsDateFilters = {
            dateFrom: params.get("date_from")?.trim() || "",
            dateTo: params.get("date_to")?.trim() || "",
          };
          const restoredValidation = normalizeNewsDateFilters(restoredDates);
          const requestedRows = Number(params.get("rows"));
          const requestedPage = Number(params.get("page"));
          const requestedSort = Number(params.get("sort"));
          const requestedDir = params.get("dir");
          const requestedView = params.get("view");
          const urlQuery = params.get("q")?.trim() || params.get("filter")?.trim() || "";
          setNewsDateFilters(restoredValidation.ok ? restoredValidation.filters : emptyNewsDateFilters());
          setNewsDateFilterDraft(restoredValidation.filters);
          setNewsDateFilterIssue(restoredValidation.issue);
          setTableFilter(urlQuery);
          setServerFilterTerm(eligibleTextQuery(urlQuery));
          if ([5, 10, 25, 50].includes(requestedRows)) setRowLimit(requestedRows);
          if (Number.isInteger(requestedPage) && requestedPage > 0) setPageIndex(requestedPage - 1);
          if (params.has("sort") && requestedSortSupported(kind, config.columns, requestedSort)) setSortColumn(requestedSort);
          if ((requestedDir === "asc" || requestedDir === "desc") && (!params.has("sort") || requestedSortSupported(kind, config.columns, requestedSort))) setSortDir(requestedDir);
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (urlQuery || restoredDates.dateFrom || restoredDates.dateTo) setSectionView("data");
          return;
        }
        if (params.has("filter")) setSectionView("data");
        if (kind === "allocators") {
          const restored = normalizeAllocatorRequest({
            days: Number(params.get("days")),
            limit: Number(params.get("rows")),
            page: Number(params.get("page")),
            sort: params.get("sort") || "activity_count",
            direction: params.get("dir") === "asc" ? "asc" : "desc",
            query: params.get("q")?.trim() || params.get("filter")?.trim() || "",
          });
          const requestedView = params.get("view");
          setAllocatorDays(restored.days);
          setAllocatorSort(restored.sort);
          setRowLimit([5, 10].includes(restored.limit) ? restored.limit : 10);
          setPageIndex(restored.page - 1);
          setSortColumn(allocatorColumnIndexForSort(restored.sort, config.columns));
          setSortDir(restored.direction);
          setTableFilter(restored.query);
          setServerFilterTerm(eligibleTextQuery(restored.query));
          if (requestedView === "data" || requestedView === "visualization") setSectionView(requestedView);
          else if (restored.query || params.has("days") || params.has("sort") || params.has("page")) setSectionView("data");
          setAllocatorUrlReady(true);
        }
      } catch {
        if (kind === "people") setPeopleUrlReady(true);
        if (kind === "profiles" || kind === "comparisons") setRouteEntityType("");
        if (kind === "transactions") setTransactionFilter(emptyTransactionFilter());
        if (kind === "mandates") setMandateFilters(emptyMandateFilters());
        if (kind === "research" || kind === "intelligence") setNewsDateFilters(emptyNewsDateFilters());
        if (kind === "allocators") setAllocatorUrlReady(true);
        /* no window or malformed query: keep the default view */
      }
    }

    const restoreTimer = window.setTimeout(restoreUrlContext, 0);
    window.addEventListener("popstate", restoreUrlContext);
    return () => {
      window.clearTimeout(restoreTimer);
      window.removeEventListener("popstate", restoreUrlContext);
    };
  }, [config.columns, config.columns.length, kind]);
  const serverPageIndex = isServerPagedKind(kind) ? pageIndex : 0;
  const serverRowLimit = isServerPagedKind(kind) ? rowLimit : 0;
  const activeTableFilter = eligibleTextQuery(tableFilter);
  const serverSortDir = kind === "allocators" ? sortDir : "desc";

  useEffect(() => {
    if (kind !== "people" || !peopleUrlReady) return;
    const timer = window.setTimeout(() => {
      const nextUrl = peopleListUrl({
        tableFilter: serverFilterTerm,
        rowLimit,
        pageIndex,
        sortColumn,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind, pageIndex, peopleUrlReady, rowLimit, sectionView, serverFilterTerm, sortColumn, sortDir]);

  useEffect(() => {
    if ((kind !== "profiles" && kind !== "comparisons") || routeEntityType === null) return;
    const timer = window.setTimeout(() => {
      const nextUrl = profileListUrl({
        tableFilter: serverFilterTerm,
        entityType: routeEntityType,
        region: routeRegion,
        includeDefunct,
        rowLimit,
        pageIndex,
        sortColumn,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [includeDefunct, kind, pageIndex, routeEntityType, routeRegion, rowLimit, sectionView, serverFilterTerm, sortColumn, sortDir]);

  useEffect(() => {
    if (kind !== "transactions" || transactionFilter === null) return;
    const timer = window.setTimeout(() => {
      const nextUrl = transactionListUrl({
        tableFilter,
        transactionFilter,
        rowLimit,
        pageIndex,
        sortColumn,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind, pageIndex, rowLimit, sectionView, sortColumn, sortDir, tableFilter, transactionFilter]);

  useEffect(() => {
    if (kind !== "mandates" || mandateFilters === null) return;
    const timer = window.setTimeout(() => {
      const nextUrl = mandateListUrl({
        tableFilter,
        mandateFilters,
        rowLimit,
        pageIndex,
        sortColumn,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind, mandateFilters, pageIndex, rowLimit, sectionView, sortColumn, sortDir, tableFilter]);

  useEffect(() => {
    if ((kind !== "research" && kind !== "intelligence") || newsDateFilters === null) return;
    const timer = window.setTimeout(() => {
      const nextUrl = newsListUrl({
        tableFilter,
        dateFilters: newsDateFilters,
        rowLimit,
        pageIndex,
        sortColumn,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [kind, newsDateFilters, pageIndex, rowLimit, sectionView, sortColumn, sortDir, tableFilter]);

  useEffect(() => {
    if (kind !== "allocators" || !allocatorUrlReady) return;
    const timer = window.setTimeout(() => {
      const nextUrl = allocatorListUrl({
        tableFilter,
        days: allocatorDays,
        rowLimit,
        pageIndex,
        sort: allocatorSort,
        sortDir,
        sectionView,
      });
      const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      if (nextUrl !== currentUrl) window.history.replaceState(null, "", nextUrl);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [allocatorDays, allocatorSort, allocatorUrlReady, kind, pageIndex, rowLimit, sectionView, sortDir, tableFilter]);

  useEffect(() => {
    if (!supportsServerFilter(kind)) return;
    if (kind === "people" && !peopleUrlReady) return;
    if (kind === "allocators" && !allocatorUrlReady) return;
    if ((kind === "profiles" || kind === "comparisons") && routeEntityType === null) return;
    const clean = tableFilter.trim();
    // A short typed value is deliberately inert: retain the last served packet and
    // do not convert one or two characters into either a broad q= request or a
    // fallback-list refresh. Clearing the field intentionally restores the list.
    if (isShortTextQuery(clean)) return;
    const timer = globalThis.setTimeout(() => setServerFilterTerm(clean), clean ? 250 : 0);
    return () => globalThis.clearTimeout(timer);
  }, [allocatorUrlReady, kind, peopleUrlReady, routeEntityType, tableFilter]);
  const dealFieldFilters = useMemo<DealFieldFilter[]>(() => {
    if (kind !== "deals") return [];
    return [
      ...selectedDealIndustries.map((value, index) => ({ key: `industry-${index}`, field: "industry" as const, value })),
      ...selectedDealSectors.map((value, index) => ({ key: `sector-${index}`, field: "sector" as const, value })),
    ].filter((filter) => filter.value.trim());
  }, [kind, selectedDealIndustries, selectedDealSectors]);

  const sources = useMemo(() => {
    if (kind !== "search") {
      if (kind === "profiles" || kind === "comparisons") {
        if (routeEntityType === null) return {};
        return { main: comparisonEntityListEndpoint({
          query: serverFilterTerm,
          entityType: routeEntityType,
          region: routeRegion,
          includeDefunct,
          limit: serverRowLimit,
          page: serverPageIndex + 1,
        }) };
      }
      if (kind === "people") {
        if (!peopleUrlReady) return {};
        return { main: peopleSourceEndpoint(serverFilterTerm, serverRowLimit, serverPageIndex) };
      }
      if (kind === "transactions") {
        if (transactionFilter === null) return {};
        return { main: transactionSourceEndpoint(transactionFilter, serverRowLimit, serverPageIndex) };
      }
      if (kind === "deals") {
        const taxonomySource = { dealTaxonomy: "/api/transactions/v1?limit=100&page=1" };
        if (dealFieldFilters.length) {
          const fieldSources = Object.fromEntries(dealFieldFilters.map((filter, index) => [
            `dealField:${index}:${filter.field}`,
            `/api/transaction-drilldown/v1?field=${filter.field}&value=${encodeURIComponent(filter.value)}&days=365&limit=${serverRowLimit}&page=${serverPageIndex + 1}`,
          ]));
          return { ...fieldSources, ...taxonomySource };
        }
        const transactionQuery = serverFilterTerm ? `&q=${encodeURIComponent(serverFilterTerm)}` : "";
        const main = `/api/transactions/v1?limit=${serverRowLimit}&page=${serverPageIndex + 1}${transactionQuery}`;
        return { main, ...taxonomySource };
      }
      if (kind === "allocators") {
        if (!allocatorUrlReady) return {};
        return { main: allocatorSourceEndpoint({
          days: allocatorDays,
          limit: serverRowLimit,
          page: serverPageIndex + 1,
          query: serverFilterTerm,
          sort: allocatorSort,
          direction: serverSortDir,
        }) };
      }
      if (kind === "mandates") {
        if (mandateFilters === null) return {};
        return { main: mandateSourceEndpoint(mandateFilters, serverRowLimit, serverPageIndex) };
      }
      if (kind === "alerts") {
        return {
          deals: "/api/recent-transactions/v1?days=30&limit=100&page=1",
          mandates: "/api/live-opportunities/v1?limit=100&page=1",
          allocators: "/api/allocator-activity/v1?days=90&limit=100&page=1&sort=activity_count&direction=desc",
        };
      }
      if (kind === "research" || kind === "intelligence") {
        if (newsDateFilters === null) return {};
        return { main: newsSourceEndpoint(serverFilterTerm, newsDateFilters, serverRowLimit, serverPageIndex) };
      }
      return config.sources || (config.endpoint ? { main: config.endpoint } : {});
    }
    const clean = submittedQuery.trim();
    if (!isTextQueryReady(clean)) return {};
    const encoded = encodeURIComponent(clean);
    const lifecycleIntent = entityLifecycleIntent(clean);
    if (lifecycleIntent.explicitDefunctRequest) {
      const sourceQuery = lifecycleIntent.sourceQuery ? `&q=${encodeURIComponent(lifecycleIntent.sourceQuery)}` : "";
      return { institutions: `/api/source-data/search/v1?collection=entities${sourceQuery}&entity_status=defunct&limit=${rowLimit}` };
    }
    return {
      institutions: `/api/v1/public/search?q=${encoded}&limit=${rowLimit}`,
    };
  }, [allocatorDays, allocatorSort, allocatorUrlReady, config.endpoint, config.sources, dealFieldFilters, includeDefunct, kind, mandateFilters, newsDateFilters, peopleUrlReady, routeEntityType, routeRegion, rowLimit, serverFilterTerm, serverPageIndex, serverRowLimit, serverSortDir, submittedQuery, transactionFilter]);

  useEffect(() => {
    let active = true;
    const controllers: AbortController[] = [];
    const resetTimer = globalThis.setTimeout(() => {
      if (active) {
        setSourceSettlements(beginSearchSourceSettlements(Object.keys(sources)));
        setPackets((current) => (kind === "search" && current.institutions ? current : {}));
      }
    }, 0);
    Object.entries(sources).forEach(([key, endpoint]) => {
      const controller = new AbortController();
      controllers.push(controller);
      const timeout = kind === "search" || kind === "profiles" || kind === "people" || kind === "transactions" || kind === "research" || kind === "intelligence" ? 180_000 : 150_000;
      void fetchPacket(endpoint, timeout, { signal: controller.signal, attempts: 3 }).then((packet) => {
        if (active) {
          setPackets((current) => ({ ...current, [key]: packet }));
          setSourceSettlements((current) => ({
            ...current,
            [key]: searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length),
          }));
        }
      });
    });
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
      globalThis.clearTimeout(resetTimer);
    };
  }, [kind, sourceRetryKey, sources]);

  useEffect(() => {
    if (kind !== "search" || typeof window === "undefined") return;
    const urlQuery = new URLSearchParams(window.location.search).get("q")?.trim() || DEFAULT_SEARCH_QUERY;
    if (!urlQuery) return;
    if (!isTextQueryReady(urlQuery)) {
      const shortTimer = window.setTimeout(() => {
        setQuery(urlQuery);
        setSubmittedQuery("");
        setSearchInputIssue(`Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters to search.`);
      }, 0);
      return () => window.clearTimeout(shortTimer);
    }
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
    if (!isTextQueryReady(clean) || !packets.institutions || packets.people || packets.strategy) return;
    if (entityLifecycleIntent(clean).explicitDefunctRequest) return;
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
    if (kind === "profiles" || kind === "comparisons") return;
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
  const allocatorContract = useMemo(() => inspectAllocatorPacket(packet, {
    days: allocatorDays,
    limit: serverRowLimit || rowLimit,
    page: serverPageIndex + 1,
    sort: allocatorSort,
    direction: serverSortDir,
    query: serverFilterTerm,
  }), [allocatorDays, allocatorSort, packet, rowLimit, serverFilterTerm, serverPageIndex, serverRowLimit, serverSortDir]);
  const sourceKeys = Object.keys(sources);
  const hasSectionVisualization = supportsSectionVisualization(kind);
  const showRecordData = !hasSectionVisualization || sectionView === "data";
  const searchPacketsComplete = kind === "search" && sourceKeys.length > 0 && sourceKeys.every((key) => packets[key]);
  const searchHasRenderableRows = kind === "search" && sourceKeys.some((key) => {
    const item = packets[key];
    if (!isFact(item)) return false;
    return rows(item, key === "institutions" ? "results" : "rows").length > 0;
  });
  const allSourcesReady = kind === "search"
    ? sourceKeys.length > 0 && (searchHasRenderableRows || searchPacketsComplete)
    : sourceKeys.every((key) => packets[key]);
  const routeFiltersLoading = ((kind === "profiles" || kind === "comparisons") && routeEntityType === null)
    || (kind === "people" && !peopleUrlReady)
    || (kind === "allocators" && !allocatorUrlReady)
    || (kind === "transactions" && transactionFilter === null)
    || (kind === "mandates" && mandateFilters === null)
    || ((kind === "research" || kind === "intelligence") && newsDateFilters === null);
  const governedEntityList = kind === "profiles" || kind === "comparisons";
  const governedPeopleList = kind === "people";
  const governedTransactionList = kind === "transactions";
  const governedMandateList = kind === "mandates";
  const governedNewsList = kind === "research" || kind === "intelligence";
  const governedAllocatorList = kind === "allocators";
  const governedSourceList = governedEntityList || governedPeopleList || governedTransactionList || governedMandateList || governedNewsList || governedAllocatorList;
  const sourceListLifecycle: SearchRequestLifecycleState = routeFiltersLoading
    ? "loading"
    : governedAllocatorList && allocatorContract.state === "invalid"
      ? "error"
    : governedSourceList && sourceKeys.length > 0
      ? searchRequestLifecycleState({
        queryEligibility: "ready",
        requiredSources: sourceKeys,
        settlements: sourceSettlements,
        resultCount: sourceKeys.reduce((total, key) => total + searchPacketRows(packets[key]).length, 0),
      })
      : "idle";
  const isLoading = governedSourceList
    ? isSearchRequestPending(sourceListLifecycle)
    : routeFiltersLoading || (sourceKeys.length > 0 && !allSourcesReady);
  const governedSourceNoun = governedPeopleList ? "People" : governedTransactionList ? "transaction" : governedMandateList ? "RFP / Opportunity" : governedNewsList ? "news / article" : governedAllocatorList ? "active allocator" : "entity";
  const emptyMessage = governedSourceList
    ? sourceListLifecycle === "timed_out"
      ? `The SWFI ${governedSourceNoun} source timed out before these results could be verified. Retry the request.`
      : sourceListLifecycle === "error"
        ? `The SWFI ${governedSourceNoun} source returned an invalid or failed response. Retry the request.`
        : sourceListLifecycle === "unavailable"
          ? governedPeopleList
            ? "The SWFI People source did not return a verifiable result. Its current contract does not distinguish a name with zero matches from temporary unavailability. Retry or adjust the name query."
            : `The SWFI ${governedSourceNoun} source is currently unavailable. Retry when the source is reachable.`
          : sourceListLifecycle === "cancelled"
            ? `The ${governedSourceNoun} request was cancelled before it settled. Retry the request.`
            : canRenderConfirmedEmpty(sourceListLifecycle)
              ? governedTransactionList
                ? "No verified transactions match the exact filter and selected source window."
                : governedAllocatorList
                  ? "No verified active allocators match the query and selected activity window."
                : governedPeopleList
                  ? "No verified people match the active name query."
                : governedMandateList
                  ? "No verified open RFPs or Opportunities match the supported source filters."
                  : governedNewsList
                    ? (packetNumber(packet, ["count", "row_count"]) ?? 0) > 0
                      ? "That page is outside the verified match range. Returning to the last available page…"
                      : /\s/.test(serverFilterTerm.trim())
                        ? "The source returned zero matches. Try the institution acronym or one distinctive term."
                        : "No verified news or articles match the active query and date filters."
                    : "No verified entities match the active filters."
              : isLoading
                ? `Loading and verifying SWFI ${governedSourceNoun} records…`
                : "No records match the current local filter."
    : isLoading
      ? LOADING
      : kind === "search" && !submittedQuery.trim()
        ? "Enter an institution, person, or strategy"
        : NOT_DISCLOSED;
  const waitingForSearch = kind === "search" && !submittedQuery.trim();
  const serverPaged = kind === "transactions"
    ? true
    : isServerPagedKind(kind) && (!activeTableFilter || supportsServerFilter(kind));
  const appliesLocalTableFilter = Boolean(activeTableFilter)
    && !((governedNewsList || governedPeopleList) && Boolean(serverFilterTerm));

  const sourceRows = useMemo(() => {
    if (isLoading) return [];
    if (kind === "search") return searchRowsFromPackets(packets);
    if (kind === "alerts") return alertsRowsFromPackets(packets);
    if (!isFact(packet) && !(kind === "deals" && dealFieldFilters.length)) return [];
    const packetRows = kind === "allocators"
      ? allocatorContract.rows
      : kind === "deals" && dealFieldFilters.length
      ? uniqueTransactionRows(Object.entries(packets)
        .filter(([key, value]) => key.startsWith("dealField:") && isFact(value))
        .flatMap(([, value]) => rows(value)))
      : rows(packet);
    const exactEntityRows = governedEntityList && routeEntityType
      ? packetRows.filter((row) => comparisonPeerTypeKey(row) === normalizedEntityTypeKey(routeEntityType))
      : packetRows;
    const scopedRows = kind === "deals" && selectedDealEntityTypes.length
      ? exactEntityRows.filter((row) => {
        const rowTypes = entityTypesForTransactionRow(row);
        return selectedDealEntityTypes.some((entityType) => rowTypes.includes(entityType));
      })
      : exactEntityRows;
    return scopedRows.map((row) => rowCells(kind, row));
  }, [allocatorContract.rows, dealFieldFilters.length, governedEntityList, isLoading, kind, packet, packets, routeEntityType, selectedDealEntityTypes]);
  const dealFieldFilterTotal = useMemo(() => {
    if (kind !== "deals" || !dealFieldFilters.length) return null;
    if (dealFieldFilters.length > 1) return sourceRows.length;
    const total = Object.entries(packets)
      .filter(([key, value]) => key.startsWith("dealField:") && isFact(value))
      .reduce((sum, [, value]) => sum + (packetNumber(value, ["count", "row_count"]) ?? rows(value).length), 0);
    return total || sourceRows.length;
  }, [dealFieldFilters.length, kind, packets, sourceRows.length]);
  const totalRows = dealFieldFilterTotal ?? totalCount(kind, packet, packets, sourceRows.length);
  const incompleteCoverage = kind === "mandates" ? incompletePacketCoverage(packet) : null;
  const filteredRows = useMemo(() => {
    const clean = activeTableFilter.toLowerCase();
    const filtered = appliesLocalTableFilter
      ? sourceRows.filter((row) => row.some((cell) => searchableCellText(cell).toLowerCase().includes(clean)))
      : sourceRows;
    if (kind === "allocators") return filtered;
    return [...filtered].sort((a, b) => compareCells(a[sortColumn], b[sortColumn], sortDir));
  }, [activeTableFilter, appliesLocalTableFilter, kind, sourceRows, sortColumn, sortDir]);
  const fullPageCount = incompleteCoverage
    ? 1
    : Math.max(1, Math.ceil((serverPaged ? totalRows : filteredRows.length) / rowLimit));
  // Dashboard 2.0 P02/P03: the Data view is a limited preview — the pager stops
  // at the cap and hands off to SWFI sign-in for the full universe.
  // Allocators are capped at the 10 most recent (single page, no deeper paging);
  // other kinds keep the multi-page preview handoff.
  const pageCount = governedNewsList ? fullPageCount : previewPageCount(fullPageCount);
  const previewCapped = !governedNewsList && fullPageCount > pageCount;
  const safePageIndex = Math.min(pageIndex, pageCount - 1);
  useEffect(() => {
    if ((!governedNewsList && !governedAllocatorList) || isLoading || pageIndex < pageCount) return;
    const timer = window.setTimeout(() => setPageIndex(Math.max(0, pageCount - 1)), 0);
    return () => window.clearTimeout(timer);
  }, [governedAllocatorList, governedNewsList, isLoading, pageCount, pageIndex]);
  const pageStart = serverPaged ? 0 : safePageIndex * rowLimit;
  // A partial packet has no proven cursor or deeper page. Keep every observed row
  // browseable on the single local page instead of silently dropping rowLimit+1.
  const visibleRows = incompleteCoverage
    ? filteredRows
    : filteredRows.slice(pageStart, pageStart + rowLimit);
  const comparisonRecords = useMemo(() => {
    if (kind !== "comparisons" || !isFact(packet)) return [];
    const clean = activeTableFilter.toLowerCase();
    const source = routeEntityType
      ? rows(packet).filter((row) => comparisonPeerTypeKey(row) === normalizedEntityTypeKey(routeEntityType))
      : rows(packet);
    const filtered = clean
      ? source.filter((row) => rowCells("comparisons", row).some((cell) => searchableCellText(cell).toLowerCase().includes(clean)))
      : source;
    return [...filtered].sort((a, b) => compareCells(rowCells("comparisons", a)[sortColumn], rowCells("comparisons", b)[sortColumn], sortDir));
  }, [activeTableFilter, kind, packet, routeEntityType, sortColumn, sortDir]);
  const countDetails = tableCountDetails(kind, packet, packets, totalRows, sourceRows.length);
  const visualizationRows = useMemo(() => {
    const source = kind === "allocators" ? allocatorContract.rows : isFact(packet) ? rows(packet) : [];
    return governedEntityList && routeEntityType
      ? source.filter((row) => comparisonPeerTypeKey(row) === normalizedEntityTypeKey(routeEntityType))
      : source;
  }, [allocatorContract.rows, governedEntityList, kind, packet, routeEntityType]);
  const dealEntityTypeOptions = useMemo(() => {
    if (kind !== "deals") return [];
    const values = new Set<string>(selectedDealEntityTypes);
    dealFieldOptionRows(packet, packets).forEach((row) => {
      entityTypesForTransactionRow(row).forEach((entityType) => values.add(entityType));
    });
    return [...values].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
  }, [kind, packet, packets, selectedDealEntityTypes]);
  const dealIndustryOptions = useMemo(() => (
    kind === "deals" ? fieldOptionsForRows(dealFieldOptionRows(packet, packets), "industry", selectedDealIndustries) : []
  ), [kind, packet, packets, selectedDealIndustries]);
  const dealSectorOptions = useMemo(() => (
    kind === "deals" ? fieldOptionsForRows(dealFieldOptionRows(packet, packets), "sector", selectedDealSectors) : []
  ), [kind, packet, packets, selectedDealSectors]);
  const mandateInvestmentTypeOptions = useMemo(() => (
    kind === "mandates" ? mandateFacetOptions(packet, "investment_types", mandateFilterDraft.investmentTypes) : []
  ), [kind, mandateFilterDraft.investmentTypes, packet]);
  const mandateCurrencyOptions = useMemo(() => (
    kind === "mandates" ? mandateFacetOptions(packet, "ticket_currencies", mandateFilterDraft.ticketCurrency ? [mandateFilterDraft.ticketCurrency] : []) : []
  ), [kind, mandateFilterDraft.ticketCurrency, packet]);
  const activeRoute = routeByKind[kind];
  const visibleCountLabel = governedEntityList && routeEntityType
    ? `Showing ${visibleRows.length.toLocaleString("en-US")} exact-type rows on this loaded page; upstream broad-match count ${totalRows.toLocaleString("en-US")}`
    : incompleteCoverage
    ? `Loaded Compass rows observed: ${sourceRows.length.toLocaleString("en-US")}; ${visibleRows.length.toLocaleString("en-US")} shown. Coverage partial: ${incompleteCoverage.reasonLabel}.`
      : `Showing ${visibleRows.length.toLocaleString("en-US")} of ${totalRows.toLocaleString("en-US")}`;
  const governedSourceFailed = governedSourceList && ["timed_out", "error", "unavailable", "cancelled"].includes(sourceListLifecycle);
  const displayedEmptyMessage = governedEntityList && routeEntityType && isFact(packet) && rows(packet).length > 0 && sourceRows.length === 0
    ? `No exact ${routeEntityType} rows appear on this loaded page. The upstream entity_type filter is broad-match, so its count cannot prove the exact-type universe.`
    : emptyMessage;

  return (
    <div ref={rootRef} className="flex min-h-screen flex-col bg-[#F2F4F6] font-sans text-[#1B2733] lg:h-screen lg:overflow-hidden" data-entity-type-context={routeEntityType || undefined} data-region-context={routeRegion || undefined}>
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
          <div className="mx-auto grid w-full max-w-[1188px] grid-cols-1 gap-4 p-4 sm:p-[20px_22px_30px]">
            <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="m-0 text-[19px] font-bold text-[#11314F]">{config.title}</h1>
	                  <p className="m-0 mt-1 text-[12px] text-[#5C6D7E]">Use filters, sorting, and row links to move from dashboard insight into the matching SWFI page.</p>
                </div>
                <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
                  {waitingForSearch
                    ? "Awaiting search"
                    : isLoading
                      ? "Loading and verifying source data"
                      : governedSourceFailed
                        ? "Source not verified"
                        : visibleCountLabel}
                </div>
              </div>
            </section>

        {kind === "search" ? (
          <form
            action="/swficc/search/"
            method="get"
            data-gsap-reveal
            className="grid grid-cols-1 gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 sm:grid-cols-[180px_minmax(0,1fr)_120px] sm:items-center"
            onSubmit={(event) => {
              event.preventDefault();
              const clean = query.trim();
              if (!isTextQueryReady(clean)) {
                setSearchInputIssue(clean ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters to search.` : "Enter a search query.");
                return;
              }
              setQuery(clean);
              setSubmittedQuery(clean);
              setSearchInputIssue("");
              window.history.replaceState(null, "", `?q=${encodeURIComponent(clean)}`);
            }}
          >
            <label htmlFor="swfi-search-input" className="text-sm font-semibold text-[#11314F]">Institution, Person, Strategy</label>
            <input
              id="swfi-search-input"
              name="q"
              type="search"
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                if (!isShortTextQuery(event.target.value)) setSearchInputIssue("");
              }}
              minLength={MIN_TEXT_QUERY_CHARACTERS}
              aria-describedby="swfi-search-minimum"
              className="min-h-10 rounded border border-[#C7D2DD] px-3 text-base outline-none"
              placeholder="Search institutions, people, strategies"
            />
            <button type="submit" disabled={!isTextQueryReady(query)} className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3 text-base text-[#16538C] disabled:cursor-not-allowed disabled:text-[#8A96A3]">Search</button>
            <span id="swfi-search-minimum" className="text-[11px] text-[#6B7785] sm:col-start-2" aria-live="polite">
              {searchInputIssue || `Search starts at ${MIN_TEXT_QUERY_CHARACTERS} characters.`}
            </span>
          </form>
        ) : null}

        {kind === "comparisons" ? (
          <CompetitionAnalysisWorkbench
            seedRecords={comparisonRecords}
            includeDefunct={includeDefunct}
            entityTypeContext={routeEntityType || ""}
            regionContext={routeRegion}
            directoryLifecycle={isLoading ? "loading" : governedSourceFailed ? "failed" : comparisonRecords.length ? "ready" : "empty"}
            onRetryDirectory={() => setSourceRetryKey((current) => current + 1)}
          />
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

        {hasSectionVisualization ? (
          <section data-gsap-reveal className="rounded border border-[#DCE3EA] bg-white px-4 py-3">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="m-0 text-[16px] font-bold text-[#11314F]">{sectionVisualizationTitle(kind)}</h2>
                <p className="m-0 mt-1 text-[12px] text-[#5C6D7E]">Visualization-first view. Select Data for records, filters, and pagination.</p>
              </div>
              <div className="flex rounded border border-[#C7D2DD] bg-[#F7F9FA] p-1 text-sm">
                {[
                  ["visualization", "Visualization"],
                  ["data", "Records"],
                ].map(([value, label]) => (
	                  <button
	                    key={value}
	                    type="button"
	                    onClick={() => setSectionView(value as "data" | "visualization")}
	                    aria-pressed={sectionView === value}
	                    className={`rounded px-3 py-1.5 font-semibold ${sectionView === value ? "bg-white text-[#11314F] shadow-sm" : "text-[#617386]"}`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            {sectionView === "visualization" ? (
              isLoading
                ? <div className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3 text-sm text-[#41566B]" role="status">Loading and verifying source data before drawing this visualization…</div>
                : governedSourceFailed
                  ? <div className="rounded border border-[#D79A3B] bg-[#FFF8E8] px-3 py-3 text-sm text-[#6B4A10]">The visualization is withheld because its source data was not verified.</div>
                  : kind === "mandates"
                    ? <CompassVisualization rows={visualizationRows} totalRows={totalRows} incompleteCoverage={incompleteCoverage} mandateContext={mandateFilters || emptyMandateFilters()} />
                    : <SectionVisualization
                      kind={kind}
                      rows={visualizationRows}
                      totalRows={totalRows}
                      entityTypeContext={governedEntityList ? routeEntityType || "" : ""}
                      regionContext={governedEntityList ? routeRegion : ""}
                      includeDefunct={governedEntityList && includeDefunct}
                      transactionContext={governedTransactionList ? transactionFilter || emptyTransactionFilter() : undefined}
                      newsContext={governedNewsList ? { query: serverFilterTerm, dateFilters: newsDateFilters || emptyNewsDateFilters() } : undefined}
                      peopleQueryContext={governedPeopleList ? serverFilterTerm : undefined}
                      allocatorContext={governedAllocatorList ? { query: serverFilterTerm, days: allocatorDays, sort: allocatorSort, direction: sortDir, rowLimit, pageIndex } : undefined}
                    />
            ) : null}
          </section>
        ) : null}

        {governedSourceFailed ? (
          <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-[#D79A3B] bg-[#FFF8E8] px-4 py-3 text-sm text-[#6B4A10]" role="alert" data-testid={governedPeopleList ? "people-source-failure" : governedTransactionList ? "transaction-source-failure" : governedMandateList ? "mandate-source-failure" : governedNewsList ? "news-source-failure" : governedAllocatorList ? "allocator-source-failure" : "entity-source-failure"}>
            <span>{displayedEmptyMessage}</span>
            <button
              type="button"
              onClick={() => setSourceRetryKey((current) => current + 1)}
              className="min-h-9 rounded border border-[#8A5A08] bg-white px-3 font-semibold text-[#6B4A10] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
              data-testid={governedPeopleList ? "people-source-retry" : governedTransactionList ? "transaction-source-retry" : governedMandateList ? "mandate-source-retry" : governedNewsList ? "news-source-retry" : governedAllocatorList ? "allocator-source-retry" : "entity-source-retry"}
            >
              Retry
            </button>
          </section>
        ) : null}

        <section data-gsap-reveal className={`rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#41566B] ${showRecordData ? "" : "hidden"}`}>
		          <strong className="text-[#11314F]">Data view — a limited preview, not the database.</strong>
		          <span className="mt-1 block text-[#5C6D7E]">{kind === "profiles" || kind === "comparisons" ? (includeDefunct ? "Explicit lifecycle view: active and defunct entities are included and labeled by the source API." : "Active entities only by default. Defunct=true records are excluded from results, counts, rankings, and visualizations.") : kind === "people" ? `Verified SWFI People records for ${peopleFilterSummary(serverFilterTerm)}. The source query currently matches names only; header sorting applies only to the loaded page.` : kind === "transactions" ? transactionFilter?.field && transactionFilter.value ? `Exact source matches within the selected ${transactionFilter.days}-day window. The loaded page is sorted newest-first; the exact drill-down endpoint does not expose a verified global date-sort contract.` : `Newest verified recent records first within the selected ${transactionFilter?.days || 365}-day source window. The full historical universe remains on SWFI; this dashboard does not call a 12-month result complete history.` : kind === "allocators" ? `Verified active buyer/acquirer entities from completed transactions in the selected ${allocatorDays}-day window. The default ranking is Number of Deals descending, then disclosed deal value, then latest transaction date.` : kind === "mandates" ? `Currently open records from the combined source: ${mandateFilterSummary(mandateFilters || emptyMandateFilters())}. Every row keeps its RFP or Opportunity label. The source orders deadlines soonest first; header sorting and Filter loaded page apply only to the loaded page.` : kind === "research" || kind === "intelligence" ? `Newest source records first for ${newsFilterSummary(serverFilterTerm, newsDateFilters || emptyNewsDateFilters())}. Relevant historical records remain pageable without an age cutoff; header sorting applies only to the loaded page.` : "Reached from a chart, ranking, or filter, this table shows the matching records; unfiltered, it shows the first preview pages only. Every row links to its SWFI platform page, where the full record lives."}</span>
	              {kind === "profiles" || kind === "comparisons" ? <span className="mt-1 block text-[#5C6D7E]">Name, type, country, and status sorting applies only to the loaded preview page. AUM preserves source currency and is not sortable across currencies; the upstream entity endpoint exposes no verified global AUM sort. Its entity_type parameter is broad-match, so visible rows are exact-type guarded locally and its broad count is never labeled the exact-type universe.</span> : null}
              {kind === "people" ? <span className="mt-1 block text-[#5C6D7E]">Only approved SWFI-record LinkedIn profile URLs are exposed, in a separate tab. Email, phone, automated follow, connect, message, and contact actions are not exposed. Exact People category filters remain blocked until SWFI approves the list and the source implements them.</span> : null}
              {kind === "transactions" ? <span className="mt-1 block text-[#5C6D7E]">Closed At defaults to newest-first on the loaded page. Unfiltered recent paging is source-ordered; exact-filter paging is not claimed globally ordered. Header sorting and Filter loaded page never claim a source-wide sort.</span> : null}
              {kind === "allocators" ? <span className="mt-1 block text-[#5C6D7E]">Name query, activity window, sort, direction, rows, page, and view are source-backed and retained in the URL. Country, region, and entity-type filters remain display-only because the live endpoint currently ignores them. AUM remains native-currency data and is not sortable.</span> : null}
              {kind === "mandates" ? <span className="mt-1 block text-[#5C6D7E]">Record type and region filters are not sent because the combined endpoint does not support them. SWFI still owes the complete approved category-filter list and the product definition of Period.</span> : null}
              {kind === "research" || kind === "intelligence" ? <span className="mt-1 block text-[#5C6D7E]">The source supports exact date bounds and single-token matching. Multi-word phrase search is currently an upstream gap, and SWFI still owes the complete approved News / Articles filter list. The API supplies a legacy record ID but no canonical row-level source URL.</span> : null}
        </section>

        <section data-gsap-reveal className={`grid grid-cols-1 gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm sm:items-center ${showRecordData ? "" : "hidden"} ${kind === "allocators" ? "sm:grid-cols-[minmax(0,1fr)_180px_150px_190px]" : kind === "deals" ? "sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_120px_180px_180px_180px]" : kind === "mandates" ? "sm:grid-cols-2 xl:grid-cols-[minmax(0,1fr)_160px_100px_190px_100px_120px_120px]" : "sm:grid-cols-[minmax(0,1fr)_180px_150px]"}`}>
          <div className="font-semibold text-[#11314F]">
            {waitingForSearch
              ? "Enter an institution, person, or strategy"
              : isLoading
                ? "Loading and verifying source data"
                : governedSourceFailed
                  ? "Source not verified"
                  : `${visibleCountLabel}${incompleteCoverage ? "" : countDetails}${appliesLocalTableFilter ? ` / filtered ${filteredRows.length.toLocaleString("en-US")}` : ""}`}
          </div>
          <label className="grid grid-cols-1 gap-1">
            <span className="font-semibold text-[#41566B]">{kind === "people" ? "Search people by name" : kind === "allocators" ? "Search allocator records" : kind === "research" || kind === "intelligence" ? "Search news & articles" : supportsServerFilter(kind) ? "Filter" : "Filter loaded page"}</span>
            <input
              type="search"
              value={tableFilter}
              onChange={(event) => {
                setTableFilter(event.target.value);
                setPageIndex(0);
              }}
              minLength={MIN_TEXT_QUERY_CHARACTERS}
              aria-describedby="source-table-filter-minimum"
              className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
              placeholder={kind === "people" ? `Search names (${MIN_TEXT_QUERY_CHARACTERS}+ characters)` : kind === "allocators" ? `Search name, type, country, or region (${MIN_TEXT_QUERY_CHARACTERS}+ characters)` : kind === "research" || kind === "intelligence" ? `Search titles and content (${MIN_TEXT_QUERY_CHARACTERS}+ characters)` : `Filter rows (${MIN_TEXT_QUERY_CHARACTERS}+ characters)`}
              data-testid="source-table-filter"
            />
            <span id="source-table-filter-minimum" className="text-[10px] font-normal text-[#5C6D7E]" aria-live="polite">
              {isShortTextQuery(tableFilter) ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters; no query has run.` : `Filtering starts at ${MIN_TEXT_QUERY_CHARACTERS} characters.`}
            </span>
          </label>
          <label className="grid grid-cols-1 gap-1">
            <span className="font-semibold text-[#41566B]">Rows</span>
            <select
              value={rowLimit}
              onChange={(event) => {
                setRowLimit(Number(event.target.value));
                setPageIndex(0);
              }}
              className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
              data-testid="source-row-limit"
            >
              {(kind === "allocators" ? [5, 10] : kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "research" || kind === "intelligence" ? [5, 10, 25, 50] : [5, 10, 25, 50, 100]).map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
	          </label>
	          {kind === "transactions" && transactionFilter ? (
              <form
                className="grid gap-2 border-t border-[#E1E7ED] pt-3 sm:col-span-3 sm:grid-cols-2 xl:grid-cols-[170px_minmax(220px,1fr)_150px_auto_auto] xl:items-end"
                data-testid="transactions-exact-filter-form"
                data-contract-status="single-exact-filter"
                onSubmit={(event) => {
                  event.preventDefault();
                  const field = transactionFilterDraft.field;
                  const value = transactionFilterDraft.value.trim();
                  if ((field && !value) || (!field && value)) {
                    setTransactionFilterIssue("Choose one exact field and enter its value, or clear both for recent transactions.");
                    return;
                  }
                  if (value && isShortTextQuery(value)) {
                    setTransactionFilterIssue(`Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters for an exact source filter.`);
                    return;
                  }
                  const nextFilter = { ...transactionFilterDraft, value };
                  window.history.pushState(null, "", transactionListUrl({
                    tableFilter,
                    transactionFilter: nextFilter,
                    rowLimit,
                    pageIndex: 0,
                    sortColumn,
                    sortDir,
                    sectionView: "data",
                  }));
                  setTransactionFilter(nextFilter);
                  setTransactionFilterDraft(nextFilter);
                  setTransactionFilterIssue("");
                  setPageIndex(0);
                  setSectionView("data");
                }}
              >
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold text-[#41566B]">Exact source field</span>
                  <select
                    value={transactionFilterDraft.field}
                    onChange={(event) => {
                      const value = event.target.value;
                      setTransactionFilterDraft((current) => ({ ...current, field: isTransactionFilterField(value) ? value : "" }));
                      setTransactionFilterIssue("");
                    }}
                    className="min-h-9 min-w-0 rounded border border-[#C7D2DD] bg-white px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="transactions-filter-field"
                  >
                    <option value="">Recent transactions</option>
                    {TRANSACTION_FILTER_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </label>
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold text-[#41566B]">Exact source value</span>
                  <input
                    type="search"
                    value={transactionFilterDraft.value}
                    onChange={(event) => {
                      setTransactionFilterDraft((current) => ({ ...current, value: event.target.value }));
                      setTransactionFilterIssue("");
                    }}
                    minLength={MIN_TEXT_QUERY_CHARACTERS}
                    placeholder="e.g. Salesforce, Inc."
                    className="min-h-9 min-w-0 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="transactions-filter-value"
                  />
                </label>
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold text-[#41566B]">Source window</span>
                  <select
                    value={transactionFilterDraft.days}
                    onChange={(event) => setTransactionFilterDraft((current) => ({ ...current, days: normalizedTransactionWindow(Number(event.target.value)) }))}
                    className="min-h-9 min-w-0 rounded border border-[#C7D2DD] bg-white px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="transactions-filter-days"
                  >
                    <option value={30}>Last 30 days</option>
                    <option value={90}>Last 90 days</option>
                    <option value={180}>Last 180 days</option>
                    <option value={365}>Last 12 months</option>
                  </select>
                </label>
                <button
                  type="submit"
                  className="min-h-9 rounded border border-[#16538C] bg-white px-3 font-semibold text-[#16538C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="transactions-filter-apply"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cleared = emptyTransactionFilter();
                    window.history.pushState(null, "", transactionListUrl({
                      tableFilter,
                      transactionFilter: cleared,
                      rowLimit,
                      pageIndex: 0,
                      sortColumn,
                      sortDir,
                      sectionView,
                    }));
                    setTransactionFilterDraft(cleared);
                    setTransactionFilter(cleared);
                    setTransactionFilterIssue("");
                    setPageIndex(0);
                  }}
                  className="min-h-9 rounded border border-[#C7D2DD] bg-white px-3 font-semibold text-[#5C6D7E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="transactions-filter-clear"
                >
                  Clear
                </button>
                <span className={`sm:col-span-2 xl:col-span-5 text-[10px] ${transactionFilterIssue ? "text-[#9B2C2C]" : "text-[#5C6D7E]"}`} aria-live="polite" data-testid="transactions-filter-help">
                  {transactionFilterIssue || (transactionFilter.field && transactionFilter.value ? `Applied ${transactionFilterLabel(transactionFilter)} = ${transactionFilter.value} within ${transactionFilter.days} days. One exact source field is supported per request. The meeting's broader “Period” calculation remains pending SWFI's definition.` : `Recent transactions within ${transactionFilter.days} days. The meeting's broader “Period” calculation remains pending SWFI's definition.`)}
                </span>
              </form>
	          ) : null}
	          {kind === "profiles" || kind === "comparisons" ? (
              <form
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:col-span-2 xl:col-span-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const clean = entityTypeDraft.trim();
                  if (isShortTextQuery(clean)) {
                    setEntityTypeIssue(`Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters or clear the field.`);
                    return;
                  }
                  setEntityTypeIssue("");
                  setRouteEntityType(clean);
                  setEntityTypeDraft(clean);
                  setPageIndex(0);
                  setSectionView("data");
                }}
                data-testid="entity-type-filter-form"
              >
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold text-[#41566B]">Entity type (broad source match)</span>
                  <input
                    type="search"
                    value={entityTypeDraft}
                    onChange={(event) => {
                      setEntityTypeDraft(event.target.value);
                      setEntityTypeIssue("");
                    }}
                    minLength={MIN_TEXT_QUERY_CHARACTERS}
                    aria-describedby="entity-type-filter-help"
                    className="min-h-9 min-w-0 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    placeholder="e.g. Sovereign Wealth Fund"
                    data-testid="entity-type-filter"
                  />
                </label>
                <button
                  type="submit"
                  className="min-h-9 rounded border border-[#16538C] bg-white px-3 font-semibold text-[#16538C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="entity-type-apply"
                >
                  Apply
                </button>
                <span id="entity-type-filter-help" className={`col-span-2 text-[10px] ${entityTypeIssue ? "text-[#9B2C2C]" : "text-[#5C6D7E]"}`} aria-live="polite">
                  {entityTypeIssue || (routeEntityType ? `Applied source type match: ${routeEntityType}. Returned rows are exact-type guarded on this loaded page; the upstream total remains broad-match. Clear and Apply to remove.` : "The upstream type parameter is broad-match; typing alone does not apply it, and loaded rows are exact-type guarded before display.")}
                </span>
              </form>
	          ) : null}
	          {kind === "profiles" || kind === "comparisons" ? (
              <form
                className="grid grid-cols-[minmax(0,1fr)_auto] items-end gap-2 sm:col-span-2 xl:col-span-1"
                onSubmit={(event) => {
                  event.preventDefault();
                  const clean = regionDraft.trim();
                  if (isShortTextQuery(clean)) {
                    setRegionIssue(`Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters or clear the field.`);
                    return;
                  }
                  setRegionIssue("");
                  setRouteRegion(clean);
                  setRegionDraft(clean);
                  setPageIndex(0);
                  setSectionView("data");
                }}
                data-testid="region-filter-form"
              >
                <label className="grid min-w-0 gap-1">
                  <span className="font-semibold text-[#41566B]">Source region</span>
                  <input
                    type="search"
                    value={regionDraft}
                    onChange={(event) => {
                      setRegionDraft(event.target.value);
                      setRegionIssue("");
                    }}
                    minLength={MIN_TEXT_QUERY_CHARACTERS}
                    aria-describedby="region-filter-help"
                    className="min-h-9 min-w-0 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    placeholder="e.g. Middle East"
                    data-testid="region-filter"
                  />
                </label>
                <button
                  type="submit"
                  className="min-h-9 rounded border border-[#16538C] bg-white px-3 font-semibold text-[#16538C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="region-apply"
                >
                  Apply
                </button>
                <span id="region-filter-help" className={`col-span-2 text-[10px] ${regionIssue ? "text-[#9B2C2C]" : "text-[#5C6D7E]"}`} aria-live="polite">
                  {regionIssue || (routeRegion ? `Applied exact source region: ${routeRegion}. Clear and Apply to remove.` : "Exact upstream region only. MENA, CALA, and Southeast Asia mappings remain awaiting SWFI's approved crosswalk.")}
                </span>
              </form>
	          ) : null}
	          {kind === "profiles" || kind === "comparisons" ? (
	            <label className="flex min-h-9 items-center gap-2 self-end rounded border border-[#C7D2DD] bg-white px-2">
	              <input
	                type="checkbox"
	                checked={includeDefunct}
	                onChange={(event) => {
	                  const checked = event.target.checked;
	                  setIncludeDefunct(checked);
	                  setPageIndex(0);
	                }}
	                data-testid="include-defunct-entities"
	              />
	              <span className="font-semibold text-[#41566B]">Include defunct entities</span>
	            </label>
	          ) : null}
	          {kind === "deals" ? (
              <MultiSelectField
                label="Entity Type"
                options={dealEntityTypeOptions}
                value={selectedDealEntityTypes}
                onChange={(nextValues) => {
                  setSelectedDealEntityTypes(nextValues);
                  setPageIndex(0);
                }}
                testId="deals-entity-type-multiselect"
              />
	          ) : null}
	          {kind === "deals" ? (
              <MultiSelectField
                label="Industry"
                options={dealIndustryOptions}
                value={selectedDealIndustries}
                onChange={(nextValues) => {
                  setSelectedDealIndustries(nextValues);
                  setPageIndex(0);
                }}
                testId="deals-industry-multiselect"
                allowCustom
                maxSelections={5}
              />
	          ) : null}
	          {kind === "deals" ? (
              <MultiSelectField
                label="Sector"
                options={dealSectorOptions}
                value={selectedDealSectors}
                onChange={(nextValues) => {
                  setSelectedDealSectors(nextValues);
                  setPageIndex(0);
                }}
                testId="deals-sector-multiselect"
                allowCustom
                maxSelections={5}
              />
	          ) : null}
	          {kind === "mandates" && mandateFilters ? (
              <form
                className="grid gap-2 border-t border-[#E1E7ED] pt-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-7 xl:grid-cols-[minmax(220px,1fr)_140px_140px_120px_auto_auto] xl:items-end"
                data-testid="mandates-supported-filters"
                data-contract-status="source-backed-subset"
                onSubmit={(event) => {
                  event.preventDefault();
                  const validation = normalizeMandateFilters(mandateFilterDraft);
                  if (!validation.ok) {
                    setMandateFilterIssue(validation.issue);
                    return;
                  }
                  window.history.pushState(null, "", mandateListUrl({
                    tableFilter,
                    mandateFilters: validation.filters,
                    rowLimit,
                    pageIndex: 0,
                    sortColumn,
                    sortDir,
                    sectionView: "data",
                  }));
                  setMandateFilters(validation.filters);
                  setMandateFilterDraft(validation.filters);
                  setMandateFilterIssue("");
                  setPageIndex(0);
                  setSectionView("data");
                }}
              >
                <MultiSelectField
                  label="Investment type"
                  options={mandateInvestmentTypeOptions}
                  value={mandateFilterDraft.investmentTypes}
                  onChange={(investmentTypes) => {
                    setMandateFilterDraft((current) => ({ ...current, investmentTypes }));
                    setMandateFilterIssue("");
                  }}
                  testId="mandates-investment-type-filter"
                  allowCustom
                  maxSelections={5}
                />
                <label className="grid gap-1">
                  <span className="font-semibold text-[#41566B]">Minimum ticket</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={mandateFilterDraft.ticketMin}
                    onChange={(event) => {
                      setMandateFilterDraft((current) => ({ ...current, ticketMin: event.target.value }));
                      setMandateFilterIssue("");
                    }}
                    className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="mandates-ticket-min-filter"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-semibold text-[#41566B]">Maximum ticket</span>
                  <input
                    type="number"
                    min="1"
                    step="1"
                    value={mandateFilterDraft.ticketMax}
                    onChange={(event) => {
                      setMandateFilterDraft((current) => ({ ...current, ticketMax: event.target.value }));
                      setMandateFilterIssue("");
                    }}
                    className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="mandates-ticket-max-filter"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-semibold text-[#41566B]">Currency</span>
                  <input
                    type="text"
                    inputMode="text"
                    maxLength={3}
                    list="mandates-ticket-currencies"
                    value={mandateFilterDraft.ticketCurrency}
                    onChange={(event) => {
                      setMandateFilterDraft((current) => ({ ...current, ticketCurrency: event.target.value }));
                      setMandateFilterIssue("");
                    }}
                    className="min-h-9 rounded border border-[#C7D2DD] px-2 uppercase outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="mandates-ticket-currency-filter"
                  />
                  <datalist id="mandates-ticket-currencies">{mandateCurrencyOptions.map((currency) => <option key={currency} value={currency} />)}</datalist>
                </label>
                <button type="submit" className="min-h-9 self-end rounded border border-[#11314F] bg-[#11314F] px-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]" data-testid="mandates-apply-filters">
                  Apply
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cleared = emptyMandateFilters();
                    window.history.pushState(null, "", mandateListUrl({
                      tableFilter,
                      mandateFilters: cleared,
                      rowLimit,
                      pageIndex: 0,
                      sortColumn,
                      sortDir,
                      sectionView,
                    }));
                    setMandateFilters(cleared);
                    setMandateFilterDraft(cleared);
                    setMandateFilterIssue("");
                    setPageIndex(0);
                  }}
                  className="min-h-9 self-end rounded border border-[#C7D2DD] bg-white px-3 font-semibold text-[#5C6D7E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="mandates-clear-filters"
                >
                  Clear
                </button>
                <span className={`text-[11px] sm:col-span-2 xl:col-span-6 ${mandateFilterIssue ? "text-[#9B2C2C]" : "text-[#5C6D7E]"}`} aria-live="polite" data-testid="mandates-filter-help">
                  {mandateFilterIssue || `Applied source scope: ${mandateFilterSummary(mandateFilters)}. Investment types combine with OR; ticket bounds combine with them using AND. Ticket amounts are compared only within the selected currency; no currency conversion is claimed. Record type, region, the complete filter list, and Period remain pending source/product contracts.`}
                </span>
              </form>
	          ) : null}
	          {(kind === "research" || kind === "intelligence") && newsDateFilters ? (
              <form
                className="grid gap-2 border-t border-[#E1E7ED] pt-3 sm:col-span-2 sm:grid-cols-2 xl:col-span-3 xl:grid-cols-[minmax(150px,1fr)_minmax(150px,1fr)_auto_auto] xl:items-end"
                data-testid="news-date-filters"
                data-contract-status="source-backed-subset"
                onSubmit={(event) => {
                  event.preventDefault();
                  const validation = normalizeNewsDateFilters(newsDateFilterDraft);
                  if (!validation.ok) {
                    setNewsDateFilterIssue(validation.issue);
                    return;
                  }
                  window.history.pushState(null, "", newsListUrl({
                    tableFilter,
                    dateFilters: validation.filters,
                    rowLimit,
                    pageIndex: 0,
                    sortColumn,
                    sortDir,
                    sectionView: "data",
                  }));
                  setNewsDateFilters(validation.filters);
                  setNewsDateFilterDraft(validation.filters);
                  setNewsDateFilterIssue("");
                  setPageIndex(0);
                  setSectionView("data");
                }}
              >
                <label className="grid gap-1">
                  <span className="font-semibold text-[#41566B]">Published from</span>
                  <input
                    type="date"
                    value={newsDateFilterDraft.dateFrom}
                    onChange={(event) => {
                      setNewsDateFilterDraft((current) => ({ ...current, dateFrom: event.target.value }));
                      setNewsDateFilterIssue("");
                    }}
                    className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="news-date-from-filter"
                  />
                </label>
                <label className="grid gap-1">
                  <span className="font-semibold text-[#41566B]">Published to</span>
                  <input
                    type="date"
                    value={newsDateFilterDraft.dateTo}
                    onChange={(event) => {
                      setNewsDateFilterDraft((current) => ({ ...current, dateTo: event.target.value }));
                      setNewsDateFilterIssue("");
                    }}
                    className="min-h-9 rounded border border-[#C7D2DD] px-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                    data-testid="news-date-to-filter"
                  />
                </label>
                <button type="submit" className="min-h-9 self-end rounded border border-[#11314F] bg-[#11314F] px-3 font-semibold text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]" data-testid="news-apply-date-filters">
                  Apply dates
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const cleared = emptyNewsDateFilters();
                    window.history.pushState(null, "", newsListUrl({
                      tableFilter,
                      dateFilters: cleared,
                      rowLimit,
                      pageIndex: 0,
                      sortColumn,
                      sortDir,
                      sectionView,
                    }));
                    setNewsDateFilters(cleared);
                    setNewsDateFilterDraft(cleared);
                    setNewsDateFilterIssue("");
                    setPageIndex(0);
                  }}
                  className="min-h-9 self-end rounded border border-[#C7D2DD] bg-white px-3 font-semibold text-[#5C6D7E] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
                  data-testid="news-clear-date-filters"
                >
                  Clear dates
                </button>
                <span className={`text-[11px] sm:col-span-2 xl:col-span-4 ${newsDateFilterIssue ? "text-[#9B2C2C]" : "text-[#5C6D7E]"}`} aria-live="polite" data-testid="news-date-filter-help">
                  {newsDateFilterIssue || `Applied source scope: ${newsFilterSummary(serverFilterTerm, newsDateFilters)}. Date bounds combine with the text query using AND. Newest records remain first; no automatic age cutoff is applied.`}
                </span>
              </form>
	          ) : null}
	          {kind === "allocators" ? (
            <>
              <label className="grid grid-cols-1 gap-1">
                <span className="font-semibold text-[#41566B]">Activity window</span>
                <select
                  value={allocatorDays}
                  onChange={(event) => {
                    setAllocatorDays(normalizeAllocatorRequest({ days: Number(event.target.value) }).days);
                    setPageIndex(0);
                  }}
                  className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
                  data-testid="allocator-window-filter"
                >
                  <option value={30}>Last 30 days</option>
                  <option value={60}>Last 60 days</option>
                  <option value={90}>Last 90 days</option>
                  <option value={365}>Last 12 months</option>
                </select>
              </label>
              <label className="grid grid-cols-1 gap-1">
                <span className="font-semibold text-[#41566B]">Sort</span>
                <select
                  value={allocatorSort}
                  onChange={(event) => {
                    const nextSort = event.target.value as AllocatorSort;
                    setAllocatorSort(nextSort);
                    const nextColumn = allocatorColumnIndexForSort(nextSort, config.columns);
                    if (nextColumn >= 0) setSortColumn(nextColumn);
                    setPageIndex(0);
                  }}
                  className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
                  data-testid="allocator-sort"
                >
                  {allocatorSortOptions.map(([value, label]) => <option key={`${value}-${label}`} value={value}>{label}</option>)}
                </select>
              </label>
            </>
          ) : null}
        </section>

        <div data-gsap-reveal className={`grid grid-cols-1 gap-3 sm:hidden ${showRecordData ? "" : "hidden"}`}>
          {visibleRows.length ? visibleRows.map((row, rowIndex) => (
            <article key={rowIndex} className="rounded border border-[#DCE3EA] bg-white px-3 py-2.5 shadow-[0_1px_0_rgba(17,49,79,0.03)]">
              <div className="min-w-0 text-[15px] font-semibold leading-snug text-[#11314F]">
                {displayCell(row[0])}
              </div>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[12.5px] leading-snug">
                {config.columns.slice(1).map((column, offset) => (
                  <div key={column} className="min-w-0">
                    <dt className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{column}</dt>
                    <dd className="mt-0.5 min-w-0 break-words text-[#41566B]">{displayCell(row[offset + 1])}</dd>
                  </div>
                ))}
              </dl>
            </article>
          )) : (
            <div className="rounded border border-[#DCE3EA] bg-white px-3 py-2 text-sm">{displayedEmptyMessage}</div>
          )}
        </div>

        <div data-gsap-reveal className={showRecordData ? "hidden overflow-x-auto rounded border border-[#DCE3EA] bg-white sm:block" : "hidden"}>
          {config.columnsNote ? (
            <div className="border-b border-[#EDF1F5] px-3 py-1.5 text-[11px] font-semibold text-[#5C6D7E]">{config.columnsNote}</div>
          ) : null}
          <table className="w-full min-w-[720px] border-collapse text-left text-[14px]">
            <thead>
              <tr className="bg-[#F7F9FA]">
                {config.columns.map((column, columnIndex) => {
                  const sortable = columnSortSupported(kind, column);
                  return (
                    <th
                      key={column}
                      aria-sort={sortable && sortColumn === columnIndex ? (sortDir === "asc" ? "ascending" : "descending") : undefined}
                      className="border-b border-[#DCE3EA] px-3 py-2 font-semibold text-[#41566B]"
                    >
                      {sortable ? (
                        <button
                          type="button"
                          className="w-full bg-transparent text-left font-semibold"
                          onClick={() => {
                            setSortColumn(columnIndex);
                            setSortDir(sortColumn === columnIndex && sortDir === "asc" ? "desc" : "asc");
                            if (kind === "allocators") {
                              const nextSort = allocatorSortParamForColumn(column);
                              if (nextSort) setAllocatorSort(nextSort);
                            }
                            setPageIndex(0);
                          }}
                        >
                          {column}{sortColumn === columnIndex ? ` ${sortDir}` : ""}
                        </button>
                      ) : (() => {
                        const disclosure = unsortableColumnDisclosure(kind, column);
                        return <span className="block" title={disclosure.title}>{disclosure.label}</span>;
                      })()}
                    </th>
                  );
                })}
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
                  <td className="px-3 py-2" colSpan={config.columns.length}>{displayedEmptyMessage}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {showRecordData && pageCount > 1 ? (
        <div data-gsap-reveal className="flex flex-wrap items-center justify-between gap-2 rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#41566B]">
          <div>
            Page {(safePageIndex + 1).toLocaleString("en-US")} of {pageCount.toLocaleString("en-US")}{previewCapped ? " preview pages" : ""}
            {previewCapped ? <span className="ml-2 text-[12px] text-[#5C6D7E]">This dashboard shows a limited preview of SWFI data.</span> : null}
          </div>
          <div className="flex flex-wrap items-center gap-2">
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
            {previewCapped && safePageIndex >= pageCount - 1 ? (
              <a href="https://www.swfi.com/v1/signin/?msg=auth" className="rounded border border-[#16538C] bg-[#16538C] px-3 py-1 font-semibold text-white no-underline">
                Continue on SWFI →
              </a>
            ) : null}
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
      <span className="grid grid-cols-1 gap-1">
        {value.links.map((link, index) => {
          if (!link.href) {
            return <span key={`${link.label}-${index}`}>{link.label}</span>;
          }
          const preferredHref = link.sourceHref && isSwfiPlatformRecordHref(link.sourceHref) ? link.sourceHref : link.href;
          const target = productHref(preferredHref, "/");
          return (
            <span key={`${link.label}-${index}`} className="grid grid-cols-1 gap-1">
              <a href={target} onClick={(event) => hardNavigateSameRouteFilter(event, target)} title={link.sourceHref ? "View details" : undefined} data-record-link={isFirstPartyRecordHref(target) ? "true" : undefined} data-source-state={link.sourceHref ? "on-file" : undefined} className="text-[#16538C] underline">{link.label}</a>
            </span>
          );
        })}
      </span>
    );
  }
  const href = cellHref(value) || linkLikeHref(label);
  if (!label || label === SOURCE_GAP || label === "Not disclosed") return NOT_DISCLOSED;
  if (href) {
    // newTab cells (Paul-sanctioned auxiliary data links, e.g. LinkedIn)
    // pop a separate page; the in-tab chain still ends at swfi.com.
    if (typeof value === "object" && value?.newTab) {
      return (
        <span className="grid grid-cols-1 gap-1">
          <a href={href} target="_blank" rel="noopener noreferrer" className="text-[#16538C] underline">{label}</a>
        </span>
      );
    }
    const sourceHref = typeof value === "object" && value ? value.sourceHref || sourceProvenanceHref(label) : sourceProvenanceHref(label);
    const preferredHref = sourceHref && isSwfiPlatformRecordHref(sourceHref) ? sourceHref : href;
    const target = productHref(preferredHref, "/");
    return (
      <span className="grid grid-cols-1 gap-1">
        <a href={target} onClick={(event) => hardNavigateSameRouteFilter(event, target)} title={sourceHref ? "View details" : undefined} data-record-link={isFirstPartyRecordHref(target) ? "true" : undefined} data-source-state={sourceHref ? "on-file" : undefined} className="text-[#16538C] underline">{label}</a>
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
    return swfiAuthHandoffHref(href);
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
      const href = text(row.latest_transaction_source_url, "") || sourceHref(row);
      results.push([
        allocatorProfileCell(row),
        "Completed allocator transaction activity",
        compactParts([row.country, row.region]),
        text(row.most_recent_activity_date || row.latest_transaction_date),
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
  if (/^\d+$/.test(legacy)) return `https://www.swfi.com/v1/news/${encodeURIComponent(legacy)}`;
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
        citationText: provenance ? "SWFI profile on file" : undefined,
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
        citationText: entityId ? "View details" : undefined,
      }
    : NOT_DISCLOSED;
}

function transactionCell(row: Row, label = text(row.title || row.name)): Cell {
  const provenance = sourceHref(row) || transactionSourceUrl(recordIdFromRow(row, ["transaction_id", "transactionID", "source_record_id", "id"]));
  return {
    label,
    href: transactionDetailHref(row, provenance),
    sourceHref: provenance,
    citationText: provenance ? "SWFI transaction on file" : undefined,
  };
}

function dealProfileCell(row: Row): Cell {
  const label = text(row.investor || row.name, "");
  if (!label) return NOT_DISCLOSED;
  const source = sourceHref(row);
  if (source) return { label, href: source, sourceHref: source, citationText: "SWFI profile on file" };
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
    citationText: provenance ? "SWFI person on file" : undefined,
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

function normalizedEntityTypeKey(value: unknown): string {
  return text(value, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function mandateInvestmentTypeText(row: Row): string {
  const values = [row.investment_type || row.strategy || row.asset_class_or_strategy];
  for (const key of ["investment_type_children", "investment_types"] as const) {
    const candidates = row[key];
    if (Array.isArray(candidates)) values.push(...candidates);
  }
  const labels = [...new Set(values.map((value) => text(value, "").trim()).filter(Boolean))];
  return labels.length ? labels.join(" · ") : NOT_DISCLOSED;
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
    citationText: provenance ? "SWFI RFP / mandate on file" : undefined,
  };
}

function citation(href: string | undefined, fallback = "/"): Cell {
  const provenance = href ? sourceProvenanceHref(href) : undefined;
  if (!provenance) return NOT_DISCLOSED;
  const internalLegacyHref = legacyPostId(provenance) ? researchDetailHref({}, provenance) : firstPartyDetailHrefForSource(provenance, fallback);
  return {
    label: "View details",
    href: internalLegacyHref || fallback,
    sourceHref: provenance,
    citationText: "View details",
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
  const ad = isoDateSortValue(av);
  const bd = isoDateSortValue(bv);
  if (ad !== null || bd !== null) {
    if (ad !== null && bd === null) return -1;
    if (ad === null && bd !== null) return 1;
    const result = (ad || 0) - (bd || 0);
    return dir === "asc" ? result : -result;
  }
  const an = numericSortValue(av);
  const bn = numericSortValue(bv);
  // Missing / "Not disclosed" values always sink to the bottom, regardless of sort
  // direction — a "Not disclosed" AUM must never outrank a real maximum in a descending
  // sort (KP feedback 2026-07-06). Only the real numeric values obey the direction.
  if (an !== null && bn === null) return -1;
  if (an === null && bn !== null) return 1;
  const result = an !== null && bn !== null
    ? an - bn
    : av.localeCompare(bv, undefined, { numeric: true, sensitivity: "base" });
  return dir === "asc" ? result : -result;
}

function isoDateSortValue(value: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}(?:[T\s]|$)/.test(value.trim())) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  // Transaction list endpoints expose `count` for the selected source window
  // or exact drill-down and `source_total` for all historical transactions.
  // Pagination belongs to the matched count, not the all-time universe.
  if (kind === "transactions" || kind === "mandates" || kind === "research" || kind === "intelligence") {
    return packetNumber(packet, ["count", "row_count"]) ?? fallback;
  }
  return packetNumber(packet, ["source_total", "total", "count", "row_count"]) ?? fallback;
}

type IncompletePacketCoverage = { complete: false; reasonLabel: string };

function incompletePacketCoverage(packet: Packet | undefined): IncompletePacketCoverage | null {
  if (!packet) return null;
  const payload = packetData(packet);
  for (const source of [payload, packet]) {
    const candidate = source.coverage;
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const coverage = candidate as Record<string, unknown>;
    if (coverage.complete === false) {
      return { complete: false, reasonLabel: coverageReasonLabel(coverage.reason) };
    }
  }
  return null;
}

function coverageReasonLabel(value: unknown): string {
  const reason = typeof value === "string" ? value.trim().toLowerCase() : "";
  const labels: Record<string, string> = {
    count_unavailable: "record count unavailable",
    partial_response: "backend returned a partial response",
    source_total_unavailable: "source total unavailable",
    stable_snapshot_or_cursor_contract_unavailable: "complete source snapshot unavailable",
    upstream_limit: "upstream source limit reached",
    upstream_partial: "upstream source returned partial coverage",
  };
  return labels[reason] || "backend did not verify the complete record set";
}

function isServerPagedKind(kind: Kind) {
  return kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "transactions" || kind === "deals" || kind === "allocators" || kind === "mandates" || kind === "research" || kind === "intelligence";
}

function supportsServerFilter(kind: Kind) {
  return kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "deals" || kind === "allocators" || kind === "research" || kind === "intelligence";
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
  // allocators + intelligence added 2026-07-06 (Paul: "every page should
  // have a visual graph or relevant"; audit receipt: both were table-only).
  return ["profiles", "comparisons", "people", "transactions", "deals", "mandates", "allocators", "intelligence"].includes(kind);
}

function sectionVisualizationTitle(kind: Kind): string {
  if (kind === "profiles") return "Institution Data Visualization";
  if (kind === "comparisons") return "Comparison Candidate Directory Visualization";
  if (kind === "people") return "People Data Visualization";
  if (kind === "transactions" || kind === "deals") return "Transaction Data Visualization";
  if (kind === "mandates") return "Compass RFP / Opportunity Analytics";
  if (kind === "allocators") return "Allocator Activity Visualization";
  if (kind === "intelligence") return "News & Article Visualization";
  return "Data Visualization";
}

type FacetBlock = { field: string; label: string; rows: { label: string; count: number }[]; covered: number; disclosed_of_total: number };

const FACET_COLLECTIONS: Partial<Record<Kind, string>> = {
  profiles: "entities",
  comparisons: "entities",
  people: "people",
  transactions: "transactions",
  deals: "transactions",
  mandates: "compass",
};

function SectionVisualization({
  kind,
  rows: sourceRows,
  totalRows,
  entityTypeContext = "",
  regionContext = "",
  includeDefunct = false,
  transactionContext,
  newsContext,
  peopleQueryContext,
  allocatorContext,
}: {
  kind: Kind;
  rows: Row[];
  totalRows: number;
  entityTypeContext?: string;
  regionContext?: string;
  includeDefunct?: boolean;
  transactionContext?: TransactionFilter;
  newsContext?: { query: string; dateFilters: NewsDateFilters };
  peopleQueryContext?: string;
  allocatorContext?: { query: string; days: number; sort: AllocatorSort; direction: "asc" | "desc"; rowLimit: number; pageIndex: number };
}) {
  // Minutes item D: distributions computed source-side over the WHOLE
  // collection. Current-page charts remain only as the disclosed fallback
  // while facets are pending or unavailable.
  const scopedEntityView = (kind === "profiles" || kind === "comparisons") && Boolean(entityTypeContext || regionContext || includeDefunct);
  const scopedTransactionView = kind === "transactions";
  const scopedPeopleView = kind === "people" && Boolean(peopleQueryContext?.trim());
  // The current facets endpoint does not honor entity_type or include_defunct.
  // Never broaden a scoped entity visualization with unscoped universe facets.
  const facetCollection = scopedEntityView || scopedTransactionView || scopedPeopleView ? undefined : FACET_COLLECTIONS[kind];
  const [facetPacket, setFacetPacket] = useState<Packet | undefined>(undefined);
  useEffect(() => {
    if (!facetCollection) return;
    const controller = new AbortController();
    void fetchPacket(`/api/source-data/facets/v1?collection=${facetCollection}`, 120_000, { signal: controller.signal, attempts: 2 }).then((packet) => {
      if (!controller.signal.aborted) setFacetPacket(packet ?? null);
    });
    return () => controller.abort();
  }, [facetCollection]);
  const facetData = facetCollection && facetPacket && isFact(facetPacket) ? (packetData(facetPacket) as { total?: number; facets?: FacetBlock[] }) : undefined;
  const universeFacets = (facetData?.facets || []).filter((facet) => facet.rows.length > 0);
  const universeTotal = typeof facetData?.total === "number" ? facetData.total : 0;
  // Quick Counts uses the source-side facet fields the two universe charts below
  // do NOT already show, so the rail adds counts instead of repeating the charts.
  const quickCountFacets = kind === "people" ? [] : universeFacets.slice(2, 4).filter((facet) => facet.rows.length > 1);

  const categoryRows = bucketRows(sourceRows, (row) => sectionCategoryLabel(kind, row));
  const geographyRows = bucketRows(sourceRows, (row) => businessText(row.country || row.region || row.buyer_region || row.seller_region));
  const trendRows = bucketRows(sourceRows, (row) => monthBucket(row.most_recent_activity_date || row.latest_transaction_date || row.closed_at || row.announced_at || row.published_at || row.updated_at || row.created_at || row.last_updated)).reverse();
  const topRows = [...sourceRows].slice(0, 8);
  const { focusTerms, toggleFocusTerm, clearFocusTerms } = useFocusTerms();
  const now = useNowOnce();
  const rankingTabs = sectionRankingTabs(kind, sourceRows, now, focusTerms);
  const aumRankingBlocked = (kind === "profiles" || kind === "comparisons" || kind === "allocators")
    && sourceRows.some((row) => (numericSortValue(String(row.aum ?? row.assets ?? "")) ?? 0) > 0)
    && !comparableAumCurrency(sourceRows);
  const focusChips = [
    ...categoryRows.filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 5).map((bucket) => bucket.label),
    ...geographyRows.filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 5).map((bucket) => bucket.label),
  ];
  // P04: every tile carries a destination — the Data-view records, or the
  // leading category's filtered records.
  const contextParams = new URLSearchParams();
  if (entityTypeContext) contextParams.set("entity_type", entityTypeContext);
  if (regionContext) contextParams.set("region", regionContext);
  if (includeDefunct) contextParams.set("include_defunct", "true");
  if (kind === "transactions" && transactionContext) appendTransactionContext(contextParams, transactionContext);
  if ((kind === "research" || kind === "intelligence") && newsContext) appendNewsContext(contextParams, newsContext);
  if (kind === "people" && peopleQueryContext?.trim()) contextParams.set("q", peopleQueryContext.trim());
  if (kind === "allocators" && allocatorContext) {
    if (allocatorContext.query.trim()) contextParams.set("q", allocatorContext.query.trim());
    contextParams.set("days", String(allocatorContext.days));
    contextParams.set("rows", String(allocatorContext.rowLimit));
    contextParams.set("page", String(allocatorContext.pageIndex + 1));
    contextParams.set("sort", allocatorContext.sort);
    contextParams.set("dir", allocatorContext.direction);
  }
  contextParams.set("view", "data");
  const dataViewHref = appHref(`${routeByKind[kind]}/?${contextParams.toString()}`);
  // Client fix (7-Jul): "Total in SWFI" is the platform's full universe, so on
  // Active Allocators it hands off to the SWFI platform (auth-gated) rather than
  // the dashboard's own empty ?filter= preview. Other sections keep the in-tab
  // records link. Mirrors the swfiAuthHandoffHref sign-in convention used across
  // this repo for platform handoffs.
  const totalInSwfiHref = kind === "allocators" ? "https://www.swfi.com/v1/signin/?msg=auth" : dataViewHref;
  const totalInSwfiCta = kind === "allocators" ? "Open on SWFI →" : "Click → the records";
  const leadingCategory = categoryRows[0]?.label;
  const newsKind = kind === "research" || kind === "intelligence";
  const scopedTotalLabel = kind === "transactions"
    ? transactionContext?.field && transactionContext.value ? "Exact matches in source window" : "Transactions in source window"
    : newsKind
      ? "News / article matches"
    : kind === "people" && peopleQueryContext?.trim()
      ? "People name matches"
      : kind === "people"
        ? "People in source"
    : "Total in SWFI";
  const oldestNewsStamp = newsKind
    ? Math.min(...sourceRows.map((row) => firstStamp([row.published_at, row.updated_at])).filter((stamp) => stamp > 0))
    : 0;
  const summary: readonly (readonly [string, string, string, string])[] = newsKind
    ? [
      [scopedTotalLabel, totalRows.toLocaleString("en-US"), dataViewHref, "Click → the records"],
      ["Items in View", sourceRows.length.toLocaleString("en-US"), dataViewHref, "Click → the records"],
      ["Oldest Published in View", Number.isFinite(oldestNewsStamp) && oldestNewsStamp > 0 ? sectionDateDisplay(oldestNewsStamp) : NOT_DISCLOSED, dataViewHref, "Open this page of records"],
    ]
    : [
      [scopedTotalLabel, totalRows.toLocaleString("en-US"), totalInSwfiHref, totalInSwfiCta],
      ["Items in View", sourceRows.length.toLocaleString("en-US"), dataViewHref, "Click → the records"],
      [
        "Leading Category",
        leadingCategory || NOT_DISCLOSED,
        leadingCategory && leadingCategory !== NOT_DISCLOSED && kind !== "people" && kind !== "allocators"
          ? sectionChartRecordsHref(kind, leadingCategory, kind === "profiles" || kind === "comparisons" ? "entity_type" : kind === "transactions" ? "transaction_industry" : "filter", includeDefunct, entityTypeContext, regionContext, transactionContext)
          : dataViewHref,
        kind === "people" ? "Open this page of records" : "Click → its records",
      ],
    ];

  return (
    <div className="grid grid-cols-1 gap-4" data-brd-section-visualization={kind}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-1 gap-1 text-[12px] text-[#5C6D7E]">
          <span>SWFI platform data</span>
          <span>This view summarizes {sourceRows.length.toLocaleString("en-US")} visible items from {totalRows.toLocaleString("en-US")} {kind === "transactions" ? `items matched within the ${transactionContext?.days || 365}-day source window` : kind === "allocators" && allocatorContext ? `active buyer/acquirer entities from completed transactions in the selected ${allocatorContext.days}-day window` : newsKind ? "news / article matches in the current source scope" : kind === "people" && peopleQueryContext?.trim() ? "People records matched by the active name query" : "total items"}.</span>
          {kind === "transactions" ? <span>The source window is a verified day filter. The meeting&apos;s broader “Period” calculation remains pending SWFI&apos;s definition.</span> : null}
          {newsKind ? <span>Newest source records appear first. Historical matches remain pageable without an automatic age cutoff; charts describe only the loaded page.</span> : null}
	          {kind === "people" ? <span>People category facets are display-only because the live list source does not yet honor exact country, region, city, title, institution, or LinkedIn-availability filters.</span> : null}
	          {kind === "comparisons" ? <span>This section describes the governed candidate directory scope, not the selected two-to-four institution peer set. Selected-peer metrics and evidence remain in the Competition Analysis panel above.</span> : null}
	          {kind === "allocators" ? <span>Allocator entity type and geography distributions describe only the loaded packet and are display-only; the source does not honor those exact filters.</span> : null}
	          {aumRankingBlocked ? <span role="note" data-aum-ranking-state="blocked-mixed-currency">Largest AUM ranking is withheld in this view because the loaded records use multiple native currencies and the source supplies no approved FX conversion contract.</span> : null}
        </div>
        {/* Dashboard 2.0 P05: data export requires SWFI authentication — no public downloads. */}
        <a href="https://www.swfi.com/v1/signin/?msg=auth" className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C] no-underline">
          {newsKind ? "Sign in on SWFI to export (query transfer unavailable)" : kind === "people" ? "Sign in on SWFI to export (People scope transfer unavailable)" : kind === "allocators" ? "Sign in on SWFI to export (allocator scope transfer unavailable)" : kind === "comparisons" ? "Sign in on SWFI to export (selected peer scope transfer unavailable)" : "Sign in on SWFI to export"}
        </a>
      </div>
      <div
        className="grid grid-cols-1 gap-3 sm:grid-cols-3"
        data-display-id={`summary-tiles-${kind}`}
        data-display-type="metric"
        data-title="Summary tiles"
        data-purpose="Headline counts for this view: collection total, items in view, leading category."
        data-source="SWFI platform data"
        data-primary-cta="Click a tile to open its records"
        data-cta-href={dataViewHref}
      >
        {summary.map(([label, value, href, cta]) => (
          <a key={label} href={href} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3 no-underline">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{label}</div>
            <div className="swfi-numeral mt-1 text-[18px] font-bold text-[#11314F]">{value}</div>
            <div className="mt-1 text-[11px] font-semibold text-[#16538C]">{cta}</div>
          </a>
        ))}
      </div>
      <SectionFreshness kind={kind} rows={sourceRows} />
      <SectionInsights kind={kind} rows={sourceRows} entityTypeContext={entityTypeContext} regionContext={regionContext} includeDefunct={includeDefunct} transactionContext={transactionContext} />
      <SectionFocusLens chips={focusChips} focusTerms={focusTerms} onToggle={toggleFocusTerm} onClear={clearFocusTerms} />
      {rankingTabs.length > 0 || quickCountFacets.length > 0 ? (
        <div className="grid items-start gap-4 xl:grid-cols-[1.6fr_1fr]">
          <SectionRankings kind={kind} tabs={rankingTabs} rowCount={sourceRows.length} />
          <SectionQuickCounts kind={kind} facets={quickCountFacets} universeTotal={universeTotal} />
        </div>
      ) : null}
      {universeFacets.length > 0 ? (
        <div className="grid grid-cols-1 gap-4" data-brd-universe-facets={kind}>
          <div className="text-[12px] text-[#5C6D7E]">
            Distributions below cover all {universeTotal.toLocaleString("en-US")} records in SWFI (computed at source), not just this page. Top 12 values shown; blanks excluded and disclosed per chart.
          </div>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {universeFacets.slice(0, 2).map((facet) => (
              <div key={facet.field} className="grid grid-cols-1 gap-1">
                <SectionBarChart
                  kind={kind}
                  title={`All records by ${facet.label}`}
                  rows={facet.rows}
                  filterParam={kind === "people" ? null : (kind === "profiles" || kind === "comparisons") && facet.field === "type" ? "entity_type" : (kind === "profiles" || kind === "comparisons") && facet.field === "country" ? null : "filter"}
                  includeDefunct={includeDefunct}
                  regionContext={regionContext}
                  transactionContext={transactionContext}
                />
                {facet.covered < facet.disclosed_of_total ? (
                  <div className="text-[11px] text-[#5C6D7E]">
                    {facet.covered.toLocaleString("en-US")} of {facet.disclosed_of_total.toLocaleString("en-US")} records disclose {facet.label.toLowerCase()}.
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* NEVER_LYING: without source-side facets these charts describe the
           CURRENT PAGE of records, not the whole universe — say so in the
           titles, don't draw a "trend" from a handful of dated rows (a
           3-point line across years reads as market history that never
           happened), and never render an EMPTY chart frame (a chart with no
           rows is a dead element — minutes F). */
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {kind !== "allocators" && categoryRows.length > 1 ? (
            <SectionBarChart
              kind={kind}
              title="Records by Category (current page)"
              rows={categoryRows}
              filterParam={kind === "people" ? null : kind === "profiles" || kind === "comparisons" ? "entity_type" : kind === "transactions" ? "transaction_industry" : "filter"}
              entityTypeContext={entityTypeContext}
              regionContext={regionContext}
              includeDefunct={includeDefunct}
              transactionContext={transactionContext}
            />
          ) : null}
          {geographyRows.length > 1 ? (
            <SectionBarChart
              kind={kind}
              title="Records by Geography (current page)"
              rows={geographyRows}
              filterParam={kind === "profiles" || kind === "comparisons" || kind === "people" || kind === "transactions" || kind === "allocators" ? null : "filter"}
              entityTypeContext={entityTypeContext}
              regionContext={regionContext}
              includeDefunct={includeDefunct}
              transactionContext={transactionContext}
            />
          ) : null}
          {trendRows.length >= 4 ? (
            <SectionLineChart title="Records by Month (current page)" rows={trendRows} recordsHref={dataViewHref} />
          ) : (
            <div className="grid place-items-center rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3 text-center text-[12px] text-[#5C6D7E]">
              Too few dated records on this page for a meaningful monthly view — open Data for the records themselves.
            </div>
          )}
        </div>
      )}
      <SectionHeatmap kind={kind} rows={sourceRows} entityTypeContext={entityTypeContext} regionContext={regionContext} includeDefunct={includeDefunct} transactionContext={transactionContext} />
      {/* Client fix (7-Jul): "Highlighted SWFI Pages" removed from the Active
          Allocators view; other sections keep the shortcut cards. */}
      {kind === "allocators" ? null : <SectionTopRecords kind={kind} rows={topRows} />}
    </div>
  );
}

function sectionCategoryLabel(kind: Kind, row: Row): string {
  if (kind === "profiles" || kind === "comparisons") return businessText(row.type || row.entity_type);
  if (kind === "people") return businessText(row.institution || row.title || row.country);
  if (kind === "transactions" || kind === "deals") return businessText(row.industry || row.category || row.sector || row.investment_type);
  if (kind === "allocators") return businessText(row.entity_type || row.type);
  if (kind === "intelligence") return businessText(row.source);
  return businessText(row.type || row.strategy || row.investment_type || row.asset_class_or_strategy);
}

function sectionChartRecordsHref(
  kind: Kind,
  label: string,
  filterParam: "filter" | "entity_type" | "transaction_industry",
  includeDefunct = false,
  entityTypeContext = "",
  regionContext = "",
  transactionContext?: TransactionFilter,
): string {
  const params = new URLSearchParams();
  if (entityTypeContext) params.set("entity_type", entityTypeContext);
  if (regionContext) params.set("region", regionContext);
  if (kind === "transactions" && transactionContext) appendTransactionContext(params, transactionContext);
  if (filterParam === "transaction_industry") {
    params.set("tx_field", "industry");
    params.set("tx_value", label);
  } else {
    params.set(filterParam, label);
  }
  if (includeDefunct) params.set("include_defunct", "true");
  params.set("view", "data");
  return appHref(`${routeByKind[kind]}/?${params.toString()}`);
}

function appendTransactionContext(params: URLSearchParams, context: TransactionFilter): void {
  if (context.field && context.value.trim()) {
    params.set("tx_field", context.field);
    params.set("tx_value", context.value.trim());
  }
  params.set("days", String(context.days));
}

function appendNewsContext(params: URLSearchParams, context: { query: string; dateFilters: NewsDateFilters }): void {
  if (context.query.trim()) params.set("q", context.query.trim());
  if (context.dateFilters.dateFrom) params.set("date_from", context.dateFilters.dateFrom);
  if (context.dateFilters.dateTo) params.set("date_to", context.dateFilters.dateTo);
}

function SectionBarChart({
  kind,
  title,
  rows: chartRows,
  filterParam = "filter",
  entityTypeContext = "",
  regionContext = "",
  includeDefunct = false,
  transactionContext,
}: {
  kind: Kind;
  title: string;
  rows: { label: string; count: number }[];
  filterParam?: "filter" | "entity_type" | "transaction_industry" | null;
  entityTypeContext?: string;
  regionContext?: string;
  includeDefunct?: boolean;
  transactionContext?: TransactionFilter;
}) {
  const max = Math.max(1, ...chartRows.map((row) => row.count));
  const recordsParams = new URLSearchParams();
  if (entityTypeContext) recordsParams.set("entity_type", entityTypeContext);
  if (regionContext) recordsParams.set("region", regionContext);
  if (kind === "transactions" && transactionContext) appendTransactionContext(recordsParams, transactionContext);
  if (includeDefunct) recordsParams.set("include_defunct", "true");
  recordsParams.set("view", "data");
  const recordsHref = appHref(`${routeByKind[kind]}/?${recordsParams.toString()}`);
  const firstHref = chartRows[0] && filterParam
    ? sectionChartRecordsHref(kind, chartRows[0].label, filterParam, includeDefunct, entityTypeContext, regionContext, transactionContext)
    : recordsHref;
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-display-id={`bar-chart-${kind}-${slugForDisplayId(title)}`}
      data-display-type="chart"
      data-purpose={title}
      data-source="SWFI platform data"
      data-primary-cta={filterParam ? "Click a bar to open the matching records" : "Open the underlying records; exact facet filtering is unavailable"}
      data-cta-href={firstHref}
    >
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      <div className="grid grid-cols-1 gap-2">
        {chartRows.length ? chartRows.slice(0, 8).map((row) => {
          const href = filterParam ? sectionChartRecordsHref(kind, row.label, filterParam, includeDefunct, entityTypeContext, regionContext, transactionContext) : "";
          const content = (
            <>
            <div className="flex justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
              <span className="font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
            </div>
            <div className="h-2 rounded bg-[#E8EDF2]">
              <div className="h-2 rounded bg-[#5C9BD6]" style={{ width: `${Math.max(1.5, (row.count / max) * 100)}%` }} />
            </div>
            </>
          );
          return href ? (
            <a key={`${title}-${row.label}`} href={href} className="grid grid-cols-1 gap-1 text-inherit no-underline">{content}</a>
          ) : (
            <div key={`${title}-${row.label}`} className="grid grid-cols-1 gap-1" title="The upstream API does not currently support an exact filter for this facet.">{content}</div>
          );
        }) : <div className="text-sm text-[#5C6D7E]">No source rows available.</div>}
        {!filterParam && chartRows.length ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[#5C6D7E]">
            <span>Display only: the current upstream API does not expose an exact filter for this facet.</span>
            <a href={recordsHref} className="font-semibold text-[#16538C] no-underline">Open the underlying records →</a>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function slugForDisplayId(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
}

function SectionLineChart({ title, rows: chartRows, recordsHref }: { title: string; rows: { label: string; count: number }[]; recordsHref?: string }) {
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
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-display-id={`line-chart-${slugForDisplayId(title)}`}
      data-display-type="chart"
      data-purpose={title}
      data-source="Dates carried on the SWFI records loaded in this view"
      data-primary-cta="Open the dated records"
      data-cta-href={recordsHref || ""}
    >
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
          <div className="mt-2 flex justify-between gap-2 text-[11px] text-[#5C6D7E]">
            <span>{visibleRows[0]?.label}</span>
            {recordsHref ? <a href={recordsHref} className="font-semibold text-[#16538C] no-underline">Open the dated records →</a> : null}
            <span>{visibleRows.at(-1)?.label}</span>
          </div>
        </div>
      ) : <div className="text-sm text-[#5C6D7E]">No dated source rows available.</div>}
    </div>
  );
}

function SectionTopRecords({ kind, rows: topRows }: { kind: Kind; rows: Row[] }) {
  const firstTop = topRows[0];
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-display-id={`top-records-${kind}`}
      data-display-type="card"
      data-purpose="Shortcut cards into the first records of this view."
      data-source="SWFI platform records loaded in this view"
      data-primary-cta="Click a card to open its SWFI page"
      data-cta-href={firstTop ? productHref(sectionRecordHref(kind, firstTop, sourceHref(firstTop)), routeByKind[kind]) : ""}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[13px] font-bold text-[#11314F]">Highlighted SWFI Pages</h3>
        <span className="text-sm font-semibold text-[#5C6D7E]">Use Data for the analytical table</span>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {topRows.length ? topRows.map((row, index) => {
          const source = sourceHref(row);
          const href = sectionRecordHref(kind, row, source);
          return (
            <a key={`${sectionRecordLabel(kind, row)}-${index}`} href={productHref(href, routeByKind[kind])} data-source-state={source ? "on-file" : undefined} className="rounded border border-[#E1E8EF] px-3 py-2 text-[#405062] no-underline">
              <span className="block truncate text-[12px] font-bold text-[#11314F]">{sectionRecordLabel(kind, row)}</span>
              <span className="mt-1 block truncate text-[11px] text-[#5C6D7E]">{sectionCategoryLabel(kind, row)}</span>
            </a>
          );
        }) : <div className="text-sm text-[#5C6D7E]">No source rows available.</div>}
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
  if (kind === "research" || kind === "intelligence") return researchDetailHref(row, researchSourceHref(row));
  if (source) return source;
  if (kind === "people") return personDetailHref(row, source);
  if (kind === "transactions" || kind === "deals") return transactionDetailHref(row, source);
  if (kind === "mandates") return mandateDetailHref(row, source);
  return profileDetailHref(row, source);
}

// Dashboard 2.0 (team principles v1.0, 2026-07-08). P03: tables only as rankings;
// P04: every row/count is a link with a named destination; P05: the public export
// buttons were replaced by the SWFI sign-in link; P06: plain user-facing labels.

function sectionNoun(kind: Kind): string {
  if (kind === "profiles" || kind === "comparisons") return "institutions";
  if (kind === "people") return "people";
  if (kind === "transactions") return "transactions";
  if (kind === "deals") return "deals";
  if (kind === "allocators") return "active allocators";
  if (kind === "mandates") return "opportunities";
  if (kind === "alerts") return "deadlines";
  if (kind === "research" || kind === "intelligence") return "articles";
  return "results";
}

function sectionMoneyDisplay(kind: Kind, row: Row): string {
  if (kind === "transactions" || kind === "deals") return disclosedMoney(row.amount_display || row.amount || row.value);
  if (kind === "mandates" || kind === "alerts") return disclosedMoney(row.amount_display || row.amount);
  return formatDisclosedAum(row);
}

function sectionDateDisplay(stamp: number): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(stamp));
}

type RankedRow = DashRecord & { row: Row };

// One descriptor per row feeds every Dashboard 2.0 panel; the ranking math
// itself lives in src/lib/sectionDashboards.ts and is fixture-tested under
// node by scripts/swfipn-section-dashboard-logic-test.mjs.
function dashRecordFor(kind: Kind, row: Row): RankedRow {
  const sizeDisplay = sectionMoneyDisplay(kind, row);
  return {
    row,
    label: sectionRecordLabel(kind, row),
    category: sectionCategoryLabel(kind, row),
    geography: sectionGeographyLabel(row),
    sizeDisplay,
    sizeValue: numericSortValue(sizeDisplay),
    dateStamp: firstStamp([row.closed_at, row.announced_at, row.published_at, row.deadline, row.due_at, row.most_recent_activity_date, row.updated_at, row.created_at, row.last_updated]),
    createdStamp: firstStamp([row.created_at, row.posted_at, row.announced_at, row.published_at]),
    updatedStamp: firstStamp([row.updated_at, row.last_updated, row.most_recent_activity_date]),
    deadlineStamp: firstStamp([row.deadline, row.due_at]),
  };
}

type RankingTab = { id: string; label: string; explain: string; entries: { row: Row; value: string }[] };

function sectionRankingTabs(kind: Kind, sourceRows: Row[], now: number, focusTerms: string[]): RankingTab[] {
  const records = sourceRows.map((row) => dashRecordFor(kind, row));
  const aumKind = kind === "profiles" || kind === "comparisons" || kind === "allocators";
  const aumCurrency = aumKind ? comparableAumCurrency(sourceRows) : "not-applicable";
  const rankingRecords = aumKind && !aumCurrency
    ? records.map((record) => ({ ...record, sizeValue: null }))
    : records;
  const tabs: RankingTab[] = [];
  if (kind === "allocators") {
    const byActivity = [...sourceRows]
      .sort((left, right) => Number(right.activity_count || right.deal_count || 0) - Number(left.activity_count || left.deal_count || 0)
        || Number(right.total_deal_value || 0) - Number(left.total_deal_value || 0)
        || firstStamp([right.most_recent_activity_date, right.latest_transaction_date]) - firstStamp([left.most_recent_activity_date, left.latest_transaction_date]))
      .slice(0, 5);
    if (byActivity.length) {
      tabs.push({
        id: "active",
        label: "Most active",
        explain: "Ranked within the loaded source packet by completed buyer/acquirer deal count, disclosed deal value, then latest transaction date,",
        entries: byActivity.map((row) => ({ row, value: `${Number(row.activity_count || row.deal_count || 0).toLocaleString("en-US")} deals` })),
      });
    }
  }
  const byFocus = focusRanking(rankingRecords, focusTerms);
  if (byFocus.length) {
    tabs.push({
      id: "focus",
      label: "Your focus",
      explain: `Records matching the focus you chose (${focusTerms.join(", ")})${aumKind && !aumCurrency ? ", without cross-currency AUM ordering," : ", largest first,"}`,
      entries: byFocus.map((record) => ({ row: record.row, value: record.sizeValue ? record.sizeDisplay : record.dateStamp ? sectionDateDisplay(record.dateStamp) : record.category })),
    });
  }
  const byDeadline = closingSoonestRanking(rankingRecords, now);
  if (byDeadline.length) {
    tabs.push({
      id: "closing",
      label: "Closing soonest",
      explain: "Ranked by each record's stated deadline, soonest first,",
      entries: byDeadline.map((record) => ({ row: record.row, value: `${daysUntilLabel(record.deadlineStamp, now)} · ${sectionDateDisplay(record.deadlineStamp)}` })),
    });
  }
  const bySize = aumKind && !aumCurrency ? [] : largestRanking(rankingRecords);
  if (bySize.length) {
    tabs.push({
      id: "largest",
      label: kind === "transactions" || kind === "deals" || kind === "mandates" || kind === "alerts" ? "Largest disclosed value" : "Largest disclosed AUM",
      explain: "Ranked by the figure disclosed on each record, largest first,",
      entries: bySize.map((record) => ({ row: record.row, value: record.sizeDisplay })),
    });
  }
  const byDate = mostRecentRanking(rankingRecords);
  if (byDate.length) {
    tabs.push({
      id: "recent",
      label: "Most recent",
      explain: "Ranked by each record's own most recent date, newest first,",
      entries: byDate.map((record) => ({ row: record.row, value: sectionDateDisplay(record.dateStamp) })),
    });
  }
  return tabs;
}

// The clock is read once per mount (lazy state initializer), so renders stay
// pure (react-hooks/purity) and re-renders never shift the rankings mid-view.
function useNowOnce(): number {
  const [now] = useState(() => Date.now());
  return now;
}

// Focus terms persist in this browser only (localStorage) — P02: no login and
// no server-side profile; the panels state the chosen terms in plain language.
// Lazy initializer instead of an effect: at prerender there is no window, so
// the server markup and the first client render both start from the same
// empty-rows null panels and no hydration mismatch is possible.
function useFocusTerms(): { focusTerms: string[]; toggleFocusTerm: (term: string) => void; clearFocusTerms: () => void } {
  const [focusTerms, setFocusTerms] = useState<string[]>(() => {
    if (typeof window === "undefined") return [];
    try {
      const parsed = JSON.parse(window.localStorage.getItem("swfipn.focus.v1") || "{}") as { terms?: unknown };
      return Array.isArray(parsed.terms) ? parsed.terms.filter((term): term is string => typeof term === "string").slice(0, 8) : [];
    } catch {
      return [];
    }
  });
  const persist = (next: string[]) => {
    try {
      window.localStorage.setItem("swfipn.focus.v1", JSON.stringify({ terms: next }));
    } catch {
      /* storage unavailable: focus lasts for this visit only */
    }
  };
  const toggleFocusTerm = (term: string) => setFocusTerms((current) => {
    const next = current.includes(term) ? current.filter((existing) => existing !== term) : [...current, term].slice(0, 8);
    persist(next);
    return next;
  });
  const clearFocusTerms = () => setFocusTerms(() => {
    persist([]);
    return [];
  });
  return { focusTerms, toggleFocusTerm, clearFocusTerms };
}

function SectionFocusLens({ chips, focusTerms, onToggle, onClear }: { chips: string[]; focusTerms: string[]; onToggle: (term: string) => void; onClear: () => void }) {
  if (chips.length < 2 && !focusTerms.length) return null;
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-focus="true"
      data-display-id="focus-lens"
      data-display-type="control"
      data-purpose="Optional lens: pin records matching your chosen category or geography terms first under Top rankings."
      data-source="Your selection, stored only in this browser"
      data-primary-cta="Toggle a term to focus the rankings"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="m-0 text-[13px] font-bold text-[#11314F]">Focus (optional)</h3>
        {focusTerms.length ? <button type="button" onClick={onClear} className="rounded border border-[#C7D2DD] bg-white px-2 py-0.5 text-[11px] font-semibold text-[#16538C]">Clear focus</button> : null}
      </div>
      <div className="mb-2 mt-1 text-[12px] text-[#5C6D7E]">Pick terms to pin matching records first under Top rankings. Your choice is stored only in this browser.</div>
      <div className="flex flex-wrap gap-1.5">
        {[...new Set([...focusTerms, ...chips])].map((term) => {
          const active = focusTerms.includes(term);
          return (
            <button key={term} type="button" aria-pressed={active} onClick={() => onToggle(term)} className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${active ? "border-[#16538C] bg-[#16538C] text-white" : "border-[#C7D2DD] bg-white text-[#41566B]"}`}>
              {term}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SectionFreshness({ kind, rows: sourceRows }: { kind: Kind; rows: Row[] }) {
  const now = useNowOnce();
  const summary = freshnessSummary(sourceRows.map((row) => dashRecordFor(kind, row)), now);
  if (!summary) return null;
  const firstFresh = summary.entries[0];
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-freshness={kind}
      data-display-id={`freshness-${kind}`}
      data-display-type="card"
      data-purpose={kind === "allocators" ? "Most recent completed buyer/acquirer transaction activity among the loaded allocator rows." : "What changed recently: records added or updated inside the stated window, newest first."}
      data-source="Dates carried on the SWFI records loaded in this view"
      data-primary-cta="Click a name to open its SWFI page"
      data-cta-href={firstFresh ? productHref(sectionRecordHref(kind, firstFresh.record.row, sourceHref(firstFresh.record.row)), routeByKind[kind]) : ""}
      data-updated-at={firstFresh ? new Date(firstFresh.stamp).toISOString() : ""}
    >
      <h3 className="m-0 mb-1 text-[13px] font-bold text-[#11314F]">{kind === "allocators" ? "Recent allocator activity in this view" : "New & updated in this view"}</h3>
      <div className="mb-2 text-[12px] text-[#5C6D7E]">
        {kind === "allocators"
          ? `${summary.entries.length.toLocaleString("en-US")} loaded allocators with recent completed transaction activity. These dates are activity dates, not entity-profile update dates.`
          : `${summary.newCount.toLocaleString("en-US")} new and ${summary.updatedCount.toLocaleString("en-US")} updated records among the ones loaded in this view, dated within the last ${summary.windowDays} days. Click a name to open its SWFI page.`}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {summary.entries.map(({ record, changeKind, stamp }, index) => {
          const source = sourceHref(record.row);
          const href = productHref(sectionRecordHref(kind, record.row, source), routeByKind[kind]);
          return (
            <a key={`${changeKind}-${index}`} href={href} data-source-state={source ? "on-file" : undefined} className="flex items-center gap-3 rounded border border-[#EEF2F6] px-3 py-1.5 no-underline hover:bg-[#F7F9FA]">
              <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.08em] ${changeKind === "new" && kind !== "allocators" ? "bg-[#E7F2EA] text-[#1F7A3D]" : "bg-[#EAF1F8] text-[#16538C]"}`}>{kind === "allocators" ? "activity" : changeKind}</span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-[#11314F]">{record.label}</span>
              <span className="shrink-0 text-[12px] text-[#5C6D7E]">{sectionDateDisplay(stamp)}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SectionRankings({ kind, tabs, rowCount }: { kind: Kind; tabs: RankingTab[]; rowCount: number }) {
  const [activeTab, setActiveTab] = useState(0);
  const tab = tabs[Math.min(activeTab, Math.max(0, tabs.length - 1))];
  if (!tab) return null;
  const firstEntry = tab.entries[0];
  const primaryHref = firstEntry ? productHref(sectionRecordHref(kind, firstEntry.row, sourceHref(firstEntry.row)), routeByKind[kind]) : "";
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-rankings={kind}
      data-display-id={`rankings-${kind}`}
      data-display-type="ranking"
      data-purpose="Ranks the records loaded in this view by disclosed size, recency, deadline, or your chosen focus."
      data-source="SWFI platform records loaded in this view"
      data-primary-cta="Click a row to open its SWFI record page"
      data-cta-href={primaryHref}
    >
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="m-0 text-[13px] font-bold text-[#11314F]">Top {sectionNoun(kind)}</h3>
        {tabs.length > 1 ? (
          <div className="flex gap-1 rounded bg-[#EDF1F5] p-1 text-[12px]" role="tablist" aria-label={`Top ${sectionNoun(kind)} ranking`}>
            {tabs.map((entry, index) => (
              <button key={entry.id} type="button" role="tab" aria-selected={index === activeTab} onClick={() => setActiveTab(index)} className={`rounded px-2.5 py-1 font-semibold ${index === activeTab ? "bg-white text-[#11314F] shadow-sm" : "text-[#617386]"}`}>
                {entry.label}
              </button>
            ))}
          </div>
        ) : <span className="text-[12px] font-semibold text-[#5C6D7E]">{tab.label}</span>}
      </div>
      <div className="mb-2 text-[12px] text-[#5C6D7E]">{tab.explain} among the {rowCount.toLocaleString("en-US")} records loaded in this view. Click a name to open its SWFI page.</div>
      <div className="grid grid-cols-1 gap-1">
        {tab.entries.map(({ row, value }, index) => {
          const source = sourceHref(row);
          const href = productHref(sectionRecordHref(kind, row, source), routeByKind[kind]);
          return (
            <a key={`${tab.id}-${index}`} href={href} data-source-state={source ? "on-file" : undefined} className="flex items-center gap-3 rounded border border-[#EEF2F6] px-3 py-2 no-underline hover:bg-[#F7F9FA]">
              <span className="w-5 shrink-0 text-[12px] font-bold text-[#5C6D7E]">{index + 1}</span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-[#11314F]">{sectionRecordLabel(kind, row)}</span>
                <span className="block truncate text-[11px] text-[#5C6D7E]">{sectionCategoryLabel(kind, row)}</span>
              </span>
              <span className="swfi-tabular shrink-0 text-[12px] font-bold text-[#16538C]">{value}</span>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function SectionQuickCounts({ kind, facets, universeTotal }: { kind: Kind; facets: FacetBlock[]; universeTotal: number }) {
  if (!facets.length) return null;
  const firstCount = facets[0]?.rows[0];
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-quick-counts={kind}
      data-display-id={`quick-counts-${kind}`}
      data-display-type="counts"
      data-purpose="Whole-collection counts for facet fields the universe charts do not already show."
      data-source="SWFI source-side facet counts, computed at source"
      data-primary-cta="Click a value to filter this page to it"
      data-cta-href={firstCount ? appHref(`${routeByKind[kind]}/?filter=${encodeURIComponent(firstCount.label)}`) : ""}
    >
      <h3 className="m-0 mb-1 text-[13px] font-bold text-[#11314F]">Quick Counts</h3>
      <div className="mb-2 text-[12px] text-[#5C6D7E]">
        Counts cover all {universeTotal.toLocaleString("en-US")} records in SWFI, computed at source. Click a value to filter this page to it.
      </div>
      <div className="grid grid-cols-1 gap-3">
        {facets.map((facet) => (
          <div key={facet.field}>
            <div className="mb-1 text-[11px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{facet.label}</div>
            <div className="grid grid-cols-1 gap-1">
              {facet.rows.slice(0, 5).map((row) => (
                <a key={`${facet.field}-${row.label}`} href={appHref(`${routeByKind[kind]}/?filter=${encodeURIComponent(row.label)}`)} className="flex items-center justify-between gap-2 rounded px-1 py-0.5 text-[12px] no-underline hover:bg-[#F7F9FA]">
                  <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
                  <span className="swfi-tabular shrink-0 font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
                </a>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function sectionGeographyLabel(row: Row): string {
  return businessText(row.country || row.region || row.buyer_region || row.seller_region);
}

// Dashboard 2.0 P01.1: rich visualization beyond bars — a category x geography
// heatmap over the records loaded in this view. Renders nothing below 2x2
// disclosed dimensions (no empty frames, minutes F).
function SectionHeatmap({
  kind,
  rows: sourceRows,
  entityTypeContext = "",
  regionContext = "",
  includeDefunct = false,
  transactionContext,
}: {
  kind: Kind;
  rows: Row[];
  entityTypeContext?: string;
  regionContext?: string;
  includeDefunct?: boolean;
  transactionContext?: TransactionFilter;
}) {
  // The live People source does not honor exact category/geography filters.
  // A clickable heatmap would therefore broaden or misroute the user rather
  // than retain context; the source-side distribution bars remain available
  // as explicitly display-only visualization.
  if (kind === "people" || kind === "allocators") return null;
  const categories = bucketRows(sourceRows, (row) => sectionCategoryLabel(kind, row)).filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 6);
  const geographies = bucketRows(sourceRows, sectionGeographyLabel).filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 6);
  if (categories.length < 2 || geographies.length < 2) return null;
  const entityKind = kind === "profiles" || kind === "comparisons";
  const transactionKind = kind === "transactions";
  const categoryHref = (label: string) => sectionChartRecordsHref(kind, label, entityKind ? "entity_type" : transactionKind ? "transaction_industry" : "filter", includeDefunct, entityTypeContext, regionContext, transactionContext);
  const cellCounts = new Map<string, number>();
  sourceRows.forEach((row) => {
    const key = `${sectionCategoryLabel(kind, row)}::${sectionGeographyLabel(row)}`;
    cellCounts.set(key, (cellCounts.get(key) || 0) + 1);
  });
  const max = Math.max(1, ...categories.flatMap((category) => geographies.map((geo) => cellCounts.get(`${category.label}::${geo.label}`) || 0)));
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-heatmap={kind}
      data-display-id={`heatmap-${kind}`}
      data-display-type="chart"
      data-purpose="Shows where the records loaded in this view concentrate, by category and geography."
      data-source="SWFI platform records loaded in this view"
      data-primary-cta={entityKind ? "Click a category or cell to open that entity type" : transactionKind ? "Click a category or cell to open that exact industry" : "Click any cell or label to open the matching records"}
      data-cta-href={categoryHref(categories[0].label)}
    >
      <h3 className="m-0 mb-1 text-[13px] font-bold text-[#11314F]">Where {sectionNoun(kind)} concentrate</h3>
      <div className="mb-3 text-[12px] text-[#5C6D7E]">
        Records loaded in this view, counted by category and geography. Darker cells hold more records. {entityKind ? "Click a category or cell to open that exact entity type; geography labels are display-only until the source exposes an exact filter." : transactionKind ? "Click a category or cell to open that exact industry; geography labels are display-only because buyer geography and target geography are distinct source concepts." : "Click any cell or label to open the matching records."}
      </div>
      <div className="overflow-x-auto">
        <div className="grid min-w-[560px] gap-1" style={{ gridTemplateColumns: `minmax(130px, 1.3fr) repeat(${geographies.length}, minmax(64px, 1fr))` }}>
          <span />
          {geographies.map((geo) => entityKind || transactionKind ? (
            <span key={`geo-${geo.label}`} className="truncate text-center text-[11px] font-bold text-[#41566B]" title={`${geo.label} — display only; exact upstream filtering unavailable`}>
              {geo.label}
            </span>
          ) : (
            <a key={`geo-${geo.label}`} href={sectionChartRecordsHref(kind, geo.label, "filter", false, "", "", transactionContext)} className="truncate text-center text-[11px] font-bold text-[#41566B] no-underline" title={geo.label}>
              {geo.label}
            </a>
          ))}
          {categories.map((category) => (
            <Fragment key={`heat-${category.label}`}>
              <a href={categoryHref(category.label)} className="truncate py-1 text-[11px] font-bold text-[#41566B] no-underline" title={category.label}>
                {category.label}
              </a>
              {geographies.map((geo) => {
                const count = cellCounts.get(`${category.label}::${geo.label}`) || 0;
                const strength = count / max;
                return (
                  <a
                    key={`cell-${category.label}-${geo.label}`}
                    href={categoryHref(category.label)}
                    className="grid place-items-center rounded py-1 text-[11px] font-bold no-underline"
                    style={{ backgroundColor: count ? `rgba(22, 83, 140, ${0.12 + strength * 0.78})` : "#F2F5F8", color: strength > 0.5 ? "#FFFFFF" : "#11314F" }}
                    title={`${category.label} · ${geo.label}: ${count.toLocaleString("en-US")} — click to open this category's records`}
                  >
                    {count ? count.toLocaleString("en-US") : ""}
                  </a>
                );
              })}
            </Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

// Dashboard 2.0 P01.2: computed observations that are not written anywhere on
// the page as raw data — concentration, recency, and the largest disclosed
// figure, each linking to its records. Renders nothing below 2 findings.
function SectionInsights({
  kind,
  rows: sourceRows,
  entityTypeContext = "",
  regionContext = "",
  includeDefunct = false,
  transactionContext,
}: {
  kind: Kind;
  rows: Row[];
  entityTypeContext?: string;
  regionContext?: string;
  includeDefunct?: boolean;
  transactionContext?: TransactionFilter;
}) {
  const total = sourceRows.length;
  const chips: { text: string; href: string; linkLabel: string }[] = [];
  const entityKind = kind === "profiles" || kind === "comparisons";
  const transactionKind = kind === "transactions";
  const newsKind = kind === "research" || kind === "intelligence";
  const peopleKind = kind === "people";
  const allocatorKind = kind === "allocators";
  if (total >= 10 && !newsKind && !peopleKind && !allocatorKind) {
    const topCategory = bucketRows(sourceRows, (row) => sectionCategoryLabel(kind, row)).filter((bucket) => bucket.label !== NOT_DISCLOSED)[0];
    if (topCategory && topCategory.count >= 3) {
      chips.push({
        text: `${topCategory.label} leads this view with ${topCategory.count.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} records (${Math.round((topCategory.count / total) * 100)}%).`,
        href: sectionChartRecordsHref(kind, topCategory.label, entityKind ? "entity_type" : transactionKind ? "transaction_industry" : "filter", includeDefunct, entityTypeContext, regionContext, transactionContext),
        linkLabel: "See them",
      });
    }
    const topGeography = bucketRows(sourceRows, sectionGeographyLabel).filter((bucket) => bucket.label !== NOT_DISCLOSED)[0];
    if (!entityKind && !transactionKind && topGeography && topGeography.count >= 3) {
      chips.push({
        text: `${topGeography.label} is the most represented geography: ${topGeography.count.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} records (${Math.round((topGeography.count / total) * 100)}%).`,
        href: appHref(`${routeByKind[kind]}/?filter=${encodeURIComponent(topGeography.label)}`),
        linkLabel: "See them",
      });
    }
  }
  const records = sourceRows.map((row) => dashRecordFor(kind, row));
  const newest = mostRecentRanking(records, 1, 1)[0];
  if (newest) {
    chips.push({
      text: `Newest dated record in this view: ${newest.label} (${sectionDateDisplay(newest.dateStamp)}).`,
      href: productHref(sectionRecordHref(kind, newest.row, sourceHref(newest.row)), routeByKind[kind]),
      linkLabel: "Open it",
    });
  }
  const largest = largestRanking(records, 1, 1)[0];
  const comparableMoney = kind !== "profiles" && kind !== "comparisons" ? true : Boolean(comparableAumCurrency(sourceRows));
  if (largest && !allocatorKind && comparableMoney) {
    chips.push({
      text: `Largest disclosed figure in this view: ${largest.sizeDisplay} (${largest.label}).`,
      href: productHref(sectionRecordHref(kind, largest.row, sourceHref(largest.row)), routeByKind[kind]),
      linkLabel: "Open it",
    });
  }
  if (chips.length < 2) return null;
  return (
    <div
      className="rounded border border-[#DCE3EA] bg-white p-3"
      data-brd-section-insights={kind}
      data-display-id={`insights-${kind}`}
      data-display-type="insight"
      data-purpose="Computed observations that appear nowhere on the page as raw data: concentration, recency, largest disclosed figure."
      data-source="SWFI platform records loaded in this view"
      data-primary-cta="Each line links to its records"
      data-cta-href={chips[0].href}
    >
      <h3 className="m-0 mb-1 text-[13px] font-bold text-[#11314F]">What stands out</h3>
      <div className="mb-2 text-[12px] text-[#5C6D7E]">Computed from the records loaded in this view. Each line links to its records.</div>
      <div className="grid grid-cols-1 gap-1.5">
        {chips.map((chip) => (
          <div key={chip.text} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 rounded border border-[#EEF2F6] px-3 py-1.5 text-[12px]">
            <span className="min-w-0 flex-1 text-[#41566B]">{chip.text}</span>
            <a href={chip.href} className="shrink-0 font-bold text-[#16538C] no-underline">{chip.linkLabel} →</a>
          </div>
        ))}
      </div>
    </div>
  );
}

function mandateRecordsHref(context: MandateFilters, investmentTypes = context.investmentTypes): string {
  const params = new URLSearchParams();
  investmentTypes.forEach((value) => params.append("investment_type", value));
  if (context.ticketMin) params.set("ticket_min", context.ticketMin);
  if (context.ticketMax) params.set("ticket_max", context.ticketMax);
  if ((context.ticketMin || context.ticketMax) && context.ticketCurrency) params.set("ticket_currency", context.ticketCurrency);
  params.set("view", "data");
  return appHref(`/mandates/?${params.toString()}`);
}

function CompassVisualization({
  rows: sourceRows,
  totalRows,
  incompleteCoverage,
  mandateContext,
}: {
  rows: Row[];
  totalRows: number;
  incompleteCoverage: IncompletePacketCoverage | null;
  mandateContext: MandateFilters;
}) {
  const recordTypeRows = bucketRows(sourceRows, (row) => businessText(row.record_type || row.opportunity_type || row.type));
  const investmentTypeRows = bucketRows(sourceRows, (row) => businessText(row.investment_type || row.strategy || row.asset_class_or_strategy || row.type));
  const regionRows = bucketRows(sourceRows, (row) => businessText(row.region || row.country));
  const monthRows = bucketRows(sourceRows, (row) => monthBucket(row.posted_at || row.created_at || row.published_at || row.deadline || row.due_at)).reverse();
  const disclosedTicketCount = sourceRows.filter((row) => row.amount != null || row.amount_display != null).length;
  const recordsHref = mandateRecordsHref(mandateContext);
  const summary = [
    [incompleteCoverage ? "Observed open records" : "Open matches in source scope", (incompleteCoverage ? sourceRows.length : totalRows).toLocaleString("en-US")],
    ["Records loaded in this view", sourceRows.length.toLocaleString("en-US")],
    ["Loaded rows with disclosed ticket", `${disclosedTicketCount.toLocaleString("en-US")} of ${sourceRows.length.toLocaleString("en-US")}`],
  ] as const;
  const { focusTerms, toggleFocusTerm, clearFocusTerms } = useFocusTerms();
  const now = useNowOnce();
  const rankingTabs = sectionRankingTabs("mandates", sourceRows, now, focusTerms);
  const focusChips = [
    ...investmentTypeRows.filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 5).map((bucket) => bucket.label),
    ...regionRows.filter((bucket) => bucket.label !== NOT_DISCLOSED).slice(0, 5).map((bucket) => bucket.label),
  ];
  return (
    <div
      className="grid grid-cols-1 gap-4"
      data-brd-compass-visualization="true"
      data-display-id="compass-visualization"
      data-display-type="chart"
      data-title="Compass open-record visualization"
      data-purpose="Summarizes the loaded open RFP and Opportunity records by source type, investment type, region, and posted month."
      data-source="SWFI Compass open records loaded in this view"
      data-primary-cta="Investment-type bars open exact source-filtered records; type and region remain display-only"
      data-cta-href={recordsHref}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="grid grid-cols-1 gap-1 text-[12px] text-[#5C6D7E]">
          <span>Updated from SWFI</span>
          {incompleteCoverage ? (
            <span>Analyzing {sourceRows.length.toLocaleString("en-US")} loaded Compass rows. Coverage partial: {incompleteCoverage.reasonLabel}.</span>
          ) : (
            <span>Showing {sourceRows.length.toLocaleString("en-US")} loaded open records from {totalRows.toLocaleString("en-US")} matches in the current source scope. Visual counts cover loaded rows only.</span>
          )}
        </div>
        <a href="https://www.swfi.com/v1/signin/?msg=auth" className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 text-sm font-semibold text-[#16538C] no-underline">
          Sign in on SWFI to export (filter transfer unavailable)
        </a>
      </div>
      <SectionFreshness kind="mandates" rows={sourceRows} />
      <SectionFocusLens chips={focusChips} focusTerms={focusTerms} onToggle={toggleFocusTerm} onClear={clearFocusTerms} />
      {rankingTabs.length ? <SectionRankings kind="mandates" tabs={rankingTabs} rowCount={sourceRows.length} /> : null}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {summary.map(([label, value]) => (
          <a key={label} href={recordsHref} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3 no-underline">
            <div className="text-[11px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{label}</div>
            <div className="swfi-numeral mt-1 text-[19px] font-bold text-[#11314F]">{value}</div>
            <div className="mt-1 text-[11px] font-semibold text-[#16538C]">Click → the records</div>
          </a>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CompassBarChart title="Open records by source type" rows={recordTypeRows} displayOnlyReason="The combined source does not accept a record-type filter." />
        <CompassBarChart title="Open records by investment type" rows={investmentTypeRows} recordsHref={(label) => mandateRecordsHref(mandateContext, [label])} />
        <CompassBarChart title="Open records by region" rows={regionRows} displayOnlyReason="The combined source does not accept a region filter." />
        <CompassLineChart title="Open records posted per month" rows={monthRows} recordsHref={recordsHref} />
      </div>
    </div>
  );
}

function CompassBarChart({
  title,
  rows: chartRows,
  recordsHref,
  displayOnlyReason,
}: {
  title: string;
  rows: { label: string; count: number }[];
  recordsHref?: (label: string) => string;
  displayOnlyReason?: string;
}) {
  const max = Math.max(1, ...chartRows.map((row) => row.count));
  return (
    <div className="rounded border border-[#DCE3EA] bg-white p-3">
      <h3 className="m-0 mb-3 text-[13px] font-bold text-[#11314F]">{title}</h3>
      {displayOnlyReason ? <div className="mb-2 text-[11px] text-[#5C6D7E]">Display only. {displayOnlyReason}</div> : null}
      <div className="grid grid-cols-1 gap-2">
        {chartRows.length ? chartRows.slice(0, 8).map((row) => {
          const content = (
            <>
            <div className="flex justify-between gap-3 text-[12px]">
              <span className="truncate font-semibold text-[#41566B]">{row.label}</span>
              <span className="font-bold text-[#11314F]">{row.count.toLocaleString("en-US")}</span>
            </div>
            <div className="h-2 rounded bg-[#E8EDF2]">
              <div className="h-2 rounded bg-[#5C9BD6]" style={{ width: `${Math.max(1.5, (row.count / max) * 100)}%` }} />
            </div>
            </>
          );
          return recordsHref ? (
            <a key={row.label} href={recordsHref(row.label)} className="grid grid-cols-1 gap-1 text-inherit no-underline">{content}</a>
          ) : (
            <div key={row.label} className="grid grid-cols-1 gap-1" title={displayOnlyReason}>{content}</div>
          );
        }) : <div className="text-sm text-[#5C6D7E]">No Compass rows available.</div>}
      </div>
    </div>
  );
}

function CompassLineChart({ title, rows: chartRows, recordsHref }: { title: string; rows: { label: string; count: number }[]; recordsHref?: string }) {
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
          <div className="mt-2 flex justify-between gap-2 text-[11px] text-[#5C6D7E]">
            <span>{chartRows[0]?.label}</span>
            {recordsHref ? <a href={recordsHref} className="font-semibold text-[#16538C] no-underline">Open the dated records →</a> : null}
            <span>{chartRows.at(-1)?.label}</span>
          </div>
        </div>
      ) : <div className="text-sm text-[#5C6D7E]">No monthly Compass rows available.</div>}
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

function monthBucket(value: unknown) {
  const parsed = Date.parse(text(value, ""));
  if (!Number.isFinite(parsed)) return NOT_DISCLOSED;
  return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(parsed));
}

function DealEnginePanel() {
  const [selectedValues, setSelectedValues] = useState<string[]>([]);
  const [submittedValues, setSubmittedValues] = useState<string[]>([]);
  const [drilldownField, setDrilldownField] = useState<"industry" | "sector">("industry");
  const [days, setDays] = useState(365);
  const [packets, setPackets] = useState<Record<string, Packet>>({});

  const sources = useMemo(() => {
    const commonSources = {
      taxonomy: "/api/transactions/v1?limit=100&page=1",
      coInvestments: `/api/co-investments/v1?days=${days}&limit=5`,
    };
    if (!submittedValues.length) return commonSources;

    const primary = encodeURIComponent(submittedValues[0]);
    const fieldSources = Object.fromEntries(submittedValues.map((value, index) => [
      `latestTransactions:${index}`,
      `/api/transaction-drilldown/v1?field=${drilldownField}&value=${encodeURIComponent(value)}&days=${days}&limit=100&page=1`,
    ]));
    return {
      // Industry and sector are distinct backend fields. Keep the user's mode
      // explicit so values such as "Technology" query industry rather than the
      // differently named sector field (for example, "Information Technology").
      ...fieldSources,
      ...commonSources,
      ticketSize: `/api/deal-intelligence/ticket-size/v1?q=${primary}&days=${days}&limit=5`,
      frequency: `/api/deal-intelligence/investment-frequency/v1?q=${primary}&days=${days}&limit=5`,
    };
  }, [days, drilldownField, submittedValues]);

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
  const latestTransactionDate = (row: Row): string => text(row.activity_date || row.announced_at || row.relevant_date || row.closed_at || row.date, "");
  const latestSourceRows = uniqueTransactionRows(Object.entries(packets)
    .filter(([key, packet]) => key.startsWith("latestTransactions:") && isFact(packet))
    .flatMap(([, packet]) => rows(packet)));
  const latestTransactionRows: Cell[][] = latestSourceRows.length
    ? latestSourceRows
      // ISO YYYY-MM-DD sorts lexicographically == chronologically; newest first.
      .slice()
      .sort((a, b) => latestTransactionDate(b).localeCompare(latestTransactionDate(a)))
      .map((row) => [
        transactionCell(row),
        entityListCell(row, "buyer"),
        transactionFactCell(row, text(row.industry || row.sector)),
        transactionFactCell(row, disclosedMoney(row.amount_display || row.capital_display || row.amount || row.capital || row.value)),
        transactionFactCell(row, latestTransactionDate(row) || NOT_DISCLOSED),
      ])
    : [];
  const readySourceKeys = Object.keys(sources).filter((key) => key !== "taxonomy");
  const readyCount = readySourceKeys.filter((key) => isFact(packets[key])).length;
  const drilldownFieldLabel = drilldownField === "industry" ? "Industry" : "Sector";
  const taxonomyRows = isFact(packets.taxonomy) ? rows(packets.taxonomy) : [];
  const fieldOptions = fieldOptionsForRows(taxonomyRows, drilldownField, selectedValues);
  const selectedLabel = submittedValues.join(", ") || "No filter selected";
  const selectionChanged = selectedValues.length !== submittedValues.length
    || selectedValues.some((value, index) => value !== submittedValues[index]);

  return (
    <section data-gsap-reveal className="grid grid-cols-1 gap-3 rounded border border-[#DCE3EA] bg-white px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Capital Deal Engine</h2>
          <div className="mt-1 text-[12px] text-[#5C6D7E]">Latest transactions matching the selected industry or sector (newest first), plus analytical deal records: ticket size, investment frequency, and co-investment intelligence from transaction activity.</div>
        </div>
        <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {readyCount === readySourceKeys.length ? `${readyCount} of ${readySourceKeys.length} SWFI record sets ready` : `Loading ${readyCount} of ${readySourceKeys.length} SWFI record sets`}
        </div>
      </div>

      <form
        className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_170px_140px_120px] sm:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setSubmittedValues(selectedValues);
        }}
      >
        <MultiSelectField
          label={drilldownFieldLabel}
          options={fieldOptions}
          value={selectedValues}
          onChange={setSelectedValues}
          testId="capital-deal-engine-multiselect"
          allowCustom
          maxSelections={5}
        />
        <fieldset className="grid grid-cols-1 gap-1 border-0 p-0 text-sm">
          <legend className="font-semibold text-[#41566B]">Match by</legend>
          <div className="grid min-h-9 grid-cols-2 overflow-hidden rounded border border-[#C7D2DD] bg-white">
            {(["industry", "sector"] as const).map((field) => (
              <button
                key={field}
                type="button"
                aria-pressed={drilldownField === field}
                onClick={() => setDrilldownField(field)}
                className={`px-2 text-sm font-semibold ${drilldownField === field ? "bg-[#0A3A7A] text-white" : "bg-white text-[#41566B]"}`}
              >
                {field === "industry" ? "Industry" : "Sector"}
              </button>
            ))}
          </div>
        </fieldset>
        <label className="grid grid-cols-1 gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Period</span>
          <select value={days} onChange={(event) => setDays(Number(event.target.value))} className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2">
            <option value={90}>90 days</option>
            <option value={365}>1 year</option>
          </select>
        </label>
        <button type="submit" disabled={!selectionChanged} className="min-h-9 rounded border border-[#C7D2DD] bg-white px-3 text-sm font-semibold text-[#16538C] disabled:opacity-50">Apply</button>
      </form>

      <div className="text-[11px] text-[#6C7A89]">
        {submittedValues.length
          ? `Latest transactions match any selected ${drilldownFieldLabel.toLowerCase()} and are de-duplicated. Ticket-size and frequency analytics retain the first selection (${submittedValues[0]}) because those source endpoints accept one value.`
          : `Select and apply at least one ${drilldownFieldLabel.toLowerCase()} to load filtered transaction, ticket-size, and frequency records.`}
      </div>

      <DealEngineTable
        title={`Latest transactions by ${drilldownFieldLabel.toLowerCase()} — ${selectedLabel} (newest first)`}
        columns={["Transaction", "Investors", "Industry", "Amount", "Date"]}
        rows={latestTransactionRows}
      />

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
        {/* Audit 2026-07-06: the Deal Engine's own data was table-only —
            deal-count micro-bars (one unit, nothing converted) make the
            band and investor distributions readable at a glance. */}
        <div className="grid content-start gap-2">
          <DealEngineBars
            title="Deals by band"
            rows={isFact(packets.ticketSize) ? rows(packets.ticketSize).map((row) => ({ label: businessText(row.label || row.band), count: numericSortValue(text(row.deals || row.count, "")) || 0 })) : []}
          />
          <DealEngineTable title="Ticket Size" columns={["Band", "Deals", "Capital"]} rows={ticketRows} />
        </div>
        <div className="grid content-start gap-2">
          <DealEngineBars
            title="Deals by investor"
            rows={isFact(packets.frequency) ? rows(packets.frequency).map((row) => ({ label: businessText(row.investor || row.name), count: numericSortValue(text(row.deal_count || row.deals_in_window, "")) || 0 })) : []}
          />
          <DealEngineTable title="Investment Frequency" columns={["Investor", "Deals", "Latest"]} rows={frequencyRows} />
        </div>
        <DealEngineTable title="Co-Investments" columns={["Investors", "Latest Deal", "Amount"]} rows={coInvestmentRows} />
      </div>
    </section>
  );
}

function DealEngineBars({ title, rows: barRows }: { title: string; rows: { label: string; count: number }[] }) {
  const shown = barRows.filter((row) => row.label && row.label !== "Not disclosed" && row.count > 0).slice(0, 5);
  if (!shown.length) return null;
  const max = Math.max(1, ...shown.map((row) => row.count));
  return (
    <div className="grid grid-cols-1 gap-1 rounded border border-[#EDF1F5] bg-[#FBFCFE] p-2" role="img" aria-label={title}>
      <div className="text-[10px] font-extrabold uppercase tracking-[0.08em] text-[#7B8996]">{title}</div>
      {shown.map((row) => (
        <div key={row.label} className="grid grid-cols-[minmax(0,1fr)_30px] items-center gap-2">
          <span className="min-w-0">
            <span className="block truncate text-[10.5px] font-bold text-[#41566B]">{row.label}</span>
            <span className="block h-[5px] overflow-hidden rounded bg-[#EAF1F7]">
              <span className="block h-full rounded bg-[#0A66C2]" style={{ width: `${Math.max(1.5, (row.count / max) * 100)}%` }} />
            </span>
          </span>
          <span className="text-right text-[11px] font-extrabold text-[#0A3A7A]">{row.count}</span>
        </div>
      ))}
    </div>
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
                <td className="px-3 py-2 text-[#5C6D7E]" colSpan={columns.length}>{LOADING}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function comparisonRecordId(row: Row): string {
  return text(row.entity_id, "") || sourceRecordIdFor(sourceHref(row), "entities") || text(row.id || row.source_record_id, "");
}
