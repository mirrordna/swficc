"use client";

import type { AnchorHTMLAttributes, CSSProperties, KeyboardEvent as ReactKeyboardEvent, ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
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
import WorldCapitalMap, { type WorldFlowPair } from "@/components/WorldCapitalMap";

// Deal-flow pairs for the map's interactive layer (Paul 2026-07-06: "where
// the flows are going"). Data truth (fan-out probe receipt): every loaded
// deal carries buyer_entities[].country inline (59/59) and a deal-location
// country (25/25) — flows anchor on THOSE fields only; buyer countries are
// never resolved by name search (probe caught 2/5 wrong-entity matches).
// Weights are DEAL COUNTS (full coverage); USD sums ride along with their
// own disclosed-deal coverage, never imputed.
function worldFlowPairs(transactionRows: Record<string, unknown>[]): WorldFlowPair[] {
  const pairs = new Map<string, WorldFlowPair>();
  for (const row of transactionRows) {
    const target = brdText(row.country, "");
    if (!target) continue;
    const buyers = Array.isArray(row.buyer_entities) ? (row.buyer_entities as Record<string, unknown>[]) : [];
    const usd = text(row.currency, "").trim().toUpperCase() === "USD" ? (numberValue(row.amount) || 0) : 0;
    const sources = new Set<string>();
    for (const buyer of buyers) {
      const source = brdText(buyer.country, "");
      if (source) sources.add(source);
    }
    for (const source of sources) {
      const key = `${source}→${target}`;
      const current = pairs.get(key) || { source, target, deals: 0, buyers: 0, usd: 0, usdDeals: 0 };
      current.deals += 1;
      current.buyers += buyers.filter((buyer) => brdText(buyer.country, "") === source).length;
      if (usd) {
        current.usd += usd;
        current.usdDeals += 1;
      }
      pairs.set(key, current);
    }
  }
  return [...pairs.values()].sort((a, b) => b.deals - a.deals);
}
import { useDashboardSessionDisplayName } from "@/lib/dashboardAuth";
import { aumRankingEndpoint, inspectAumRankingPacket, type AumRankingState } from "@/lib/aumRankingContract";
import { allocatorCountEndpoint, inspectAllocatorCountPacket, inspectAllocatorPacket, type AllocatorState } from "@/lib/allocatorSourceContract";
import { aggregateEntitySearchRecords, businessSearchQueryVariants, dedupeSearchRecords, rankSearchRecords, searchRelevanceScore as businessSearchRelevanceScore, type SearchKind } from "@/lib/searchRelevance";
import { filterSmartSearchIntentRows, smartSearchIntentForQuery, type SmartSearchIntent } from "@/lib/smartSearchIntent";
import { entityLifecycleIntent } from "@/lib/entityLifecycle";
import { isShortTextQuery, isTextQueryReady, MIN_TEXT_QUERY_CHARACTERS, textQueryEligibility } from "@/lib/textQueryPolicy";
import {
  beginSearchSourceSettlements,
  canRenderConfirmedEmpty,
  combineSearchSourceSettlements,
  completedSearchSource,
  isSearchRequestPending,
  searchRequestLifecycleState,
  searchSourceSettlementFromPacket,
  type SearchRequestLifecycleState,
  type SearchSourceSettlement,
  type SearchSourceSettlements,
} from "@/lib/searchRequestLifecycle";
import { fetchAllOpportunitySearchPackets, searchPacketRows } from "@/lib/searchSourceCoordinator";

const ENDPOINTS = {
  metrics: "/api/swfi/dashboard-metrics/v1",
  institutionTypes: "/api/institution-types/v1?limit=8",
  allocators30: "/api/allocator-activity/v1?days=30&limit=25&page=1&sort=most_recent_activity_date&direction=desc",
  allocators90: allocatorCountEndpoint(90),
  rfps: "/api/live-opportunities/v1?limit=25&page=1",
  transactions30: "/api/recent-transactions/v1?days=30&limit=50&page=1",
  entities: "/api/source-data/search/v1?collection=entities&limit=25&page=1",
  people: "/api/source-data/search/v1?collection=people&limit=25&page=1",
  top20: aumRankingEndpoint(),
  news: "/api/source-intelligence/news/v1?limit=25",
  sectorFlows: "/api/sector-flows/v1?days=365",
};

const LOADING = "Loading";
const DASHBOARD_EMPTY = "No current items available";
const NEWS_REFRESH_INTERVAL_MS = 5 * 60_000;
const NEWS_REFRESH_MIN_GAP_MS = 60_000;
const NEWS_REFRESH_EVENT = "swfi:refresh-news";
const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
// The first usable dashboard state depends on these four source packets. They
// run together before the secondary visualizations so twelve simultaneous
// source requests cannot starve the records needed for first use. The
// integrated shadow receipt showed the same entity query at 5.6s amid the
// homepage fan-out versus 1.1s on /profiles after that fan-out had settled.
const DASHBOARD_PRIMARY_LOAD_ORDER: PacketKey[] = ["metrics", "rfps", "transactions30", "entities"];
const DASHBOARD_SECONDARY_LOAD_ORDER: PacketKey[] = ["top20", "allocators30", "sectorFlows", "institutionTypes", "allocators90", "people", "news"];
const SEARCH_CATEGORY_LABELS = ["All", "Entities", "RFPs & Opportunities", "Transactions", "News & Articles", "People"] as const;
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
  prefetchRow?: Record<string, unknown>;
};

type BrdSearchGroup = {
  label: string;
  items: BrdSearchItem[];
};
type SearchCategoryLabel = (typeof SEARCH_CATEGORY_LABELS)[number];
type SearchResultCategoryLabel = Exclude<SearchCategoryLabel, "All">;
type DashboardSearchSourceKey = "public" | "entities" | "transactions" | "opportunities" | "news" | "people" | "intent";
type SearchCategoryLifecycleStates = Record<SearchResultCategoryLabel, SearchRequestLifecycleState>;

function storeRenderedSearchPrefetch(query: string, groups: BrdSearchGroup[]): void {
  if (typeof window === "undefined" || !isTextQueryReady(query)) return;
  const results = groups.flatMap((group) => group.items.map((item) => {
    const sourceUrl = item.prefetchRow ? sourceHref(item.prefetchRow) || "" : "";
    if (!item.prefetchRow || !sourceUrl.startsWith("https://www.swfi.com/")) return null;
    return {
      ...item.prefetchRow,
      name: brdText(item.prefetchRow.name || item.prefetchRow.title || item.label),
      source_url: sourceUrl,
    };
  })).filter((row): row is Record<string, unknown> & { name: string; source_url: string } => row !== null);
  if (!results.length) return;
  try {
    window.sessionStorage.setItem(searchPrefetchCacheKey(query), JSON.stringify({
      query: query.trim(),
      stored_at: Date.now(),
      packet: { status: "ok", fact: true, data: { results } },
    }));
  } catch {
    // Session storage is an optimization only; the results page still fetches live.
  }
}

export default function DashboardPage() {
  const rootRef = useGsapReveal<HTMLDivElement>();
  const router = useRouter();
  const [packets, setPackets] = useState<Packets>({} as Packets);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchPacket, setSearchPacket] = useState<Packet | undefined>();
  const [searchEntityPackets, setSearchEntityPackets] = useState<Packet[]>([]);
  // Entity->transactions join: when the query resolves to a strong entity, we fetch
  // THAT entity's transactions so the Transactions category is populated by the
  // buyer/seller entity reference join instead of a text match that never hits
  // (transactions reference entities by a reference id, not by their display name).
  const [searchTransactionPacket, setSearchTransactionPacket] = useState<Packet | undefined>();
  // People live search: the homepage otherwise ranks only the 25 pre-loaded peopleRows,
  // so it can't find most people. Once the shared minimum is met we fetch the PII-safe
  // /api/people/search/v1 live and feed its matches into the People search category as
  // the primary source (same shape as the entity->transactions join above).
  const [searchPeoplePacket, setSearchPeoplePacket] = useState<Packet | undefined>();
  const [searchOpportunityPackets, setSearchOpportunityPackets] = useState<Packet[]>([]);
  const [searchNewsPacket, setSearchNewsPacket] = useState<Packet | undefined>();
  const [searchIntentPackets, setSearchIntentPackets] = useState<Packet[]>([]);
  const [searchSourceSettlements, setSearchSourceSettlements] = useState<SearchSourceSettlements<DashboardSearchSourceKey>>({});
  const [searchCachedSources, setSearchCachedSources] = useState<Partial<Record<DashboardSearchSourceKey, boolean>>>({});
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [activeSearchIndex, setActiveSearchIndex] = useState(0);
  const [newsTab, setNewsTab] = useState<"latest" | "referenced" | "topics">("latest");
  const [recentTab, setRecentTab] = useState<"transactions" | "rfps" | "opportunities" | "people">("transactions");
  const [topTab, setTopTab] = useState<"compass" | "sector">("compass");
  const [expandedPanel, setExpandedPanel] = useState("");
  const [clientHydrated, setClientHydrated] = useState(false);
  const visualControls = useMemo<DashboardTableControls>(() => ({ rowLimit: 5, sortColumn: 0, sortDir: "asc" }), []);

  useEffect(() => {
    const timer = window.setTimeout(() => setClientHydrated(true), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    router.prefetch("/search/");
  }, [router]);

  useEffect(() => {
    let active = true;
    const controller = new AbortController();
    const snapshot = freshHomeSnapshot();
    const snapshotTimer = window.setTimeout(() => {
      if (active && Object.keys(snapshot).length) {
        setPackets((current) => ({ ...snapshot, ...current }));
      }
    }, 0);
    void loadDashboardPackets((key, packet) => {
      if (!active) return;
      setPackets((current) => ({
        ...current,
        [key]: shouldReplacePacket(current[key], packet) ? packet : current[key],
      }));
    }, controller.signal);
    return () => {
      active = false;
      controller.abort();
      window.clearTimeout(snapshotTimer);
    };
  }, []);

  useEffect(() => {
    let active = true;
    let refreshing = false;
    let lastRefreshAt = Date.now();
    const refreshNews = async (force = false) => {
      if (refreshing || (!force && Date.now() - lastRefreshAt < NEWS_REFRESH_MIN_GAP_MS)) return;
      refreshing = true;
      try {
        const packet = await fetchPacket(ENDPOINTS.news, 30_000, { attempts: 2 });
        if (!active) return;
        setPackets((current) => ({
          ...current,
          news: shouldReplacePacket(current.news, packet) ? packet : current.news,
        }));
      } finally {
        lastRefreshAt = Date.now();
        refreshing = false;
      }
    };
    const onRefreshNews = () => { void refreshNews(true); };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshNews();
    };
    const interval = window.setInterval(() => { void refreshNews(); }, NEWS_REFRESH_INTERVAL_MS);
    window.addEventListener(NEWS_REFRESH_EVENT, onRefreshNews);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener(NEWS_REFRESH_EVENT, onRefreshNews);
      document.removeEventListener("visibilitychange", onVisibilityChange);
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
  // #8 "Most Recent Disclosed Deals" needs >=10 DISCLOSED deals. Only ~half of any
  // 30-day window has a disclosed amount, so that widget alone reads the fuller 50-row
  // transactions30 fetch instead of the 25-row transactionRows every other panel slices.
  // The first 25 rows of the limit=50 response are row-for-row the old limit=25 response
  // (verified 2026-07-10: 13 disclosed either way), so transactionRows and its consumers
  // do not change; limit=50 yields 28 disclosed, so the widget's own filter->sort->slice(0,10)
  // reliably lands 10. Same endpoint, no padding with undisclosed rows.
  const disclosedDealRows = factRows(packets.transactions30).slice(0, 50);
  // The governed combined source returns both RFP and Opportunity records with
  // an explicit record_type. Reuse that one packet everywhere instead of also
  // loading the legacy /api/live-mandates route on first paint.
  const rfpRows = factRows(packets.rfps).slice(0, 25);
  const newsRows = useMemo(() => newestNewsRows(factRows(packets.news).slice(0, 25)), [packets.news]);
  const allocator30Contract = useMemo(() => inspectAllocatorPacket(packets.allocators30, {
    days: 30,
    limit: 25,
    page: 1,
    sort: "most_recent_activity_date",
    direction: "desc",
  }), [packets.allocators30]);
  const allocator90CountContract = useMemo(() => inspectAllocatorCountPacket(packets.allocators90, 90), [packets.allocators90]);
  const allocatorRows = allocator30Contract.rows;
  const institutionTypeRows = institutionTypeFacetRows(packets.institutionTypes).slice(0, 8);
  const sectorRows = sectorFacetRows(packets.sectorFlows).slice(0, 10);
  // The approved ranking contract owns scope, order, lifecycle counts, and
  // canonical entity identity. Never substitute generic entity rows or
  // silently re-rank a packet that failed those checks.
  const topAumContract = useMemo(() => inspectAumRankingPacket(packets.top20), [packets.top20]);
  const topAumRows = topAumContract.rows;
  const dashboardEntitySearchRows = useMemo(() => dedupeSearchRecords([...topAumRows, ...entityRows]), [entityRows, topAumRows]);
  const dashboardPrimaryReady = useMemo(() => {
    return DASHBOARD_PRIMARY_LOAD_ORDER.every((key) => isFact(packets[key]));
  }, [packets]);
  const dashboardReady = useMemo(() => {
    return ["metrics", "institutionTypes", "sectorFlows", "rfps", "transactions30", "entities", "news"]
      .every((key) => isFact(packets[key as PacketKey]))
      && ["ready", "empty"].includes(topAumContract.state)
      && ["ready", "empty"].includes(allocator30Contract.state)
      && ["ready", "empty"].includes(allocator90CountContract.state);
  }, [allocator30Contract.state, allocator90CountContract.state, packets, topAumContract.state]);
  const dataAsOfLabel = useMemo(() => dataAsOfLabelFor(packets.metrics), [packets.metrics]);
  const sessionDisplayName = useDashboardSessionDisplayName();
  const unifiedRows = useMemo(() => unifiedIntelligenceRows({
    topInvestors: allocatorRows,
    marketRows: transactionRows,
    fundraisingRows: rfpRows,
    newsRows,
    sectorRows,
  }), [allocatorRows, transactionRows, rfpRows, newsRows, sectorRows]);
  const dashboardSearchGroups = useMemo(() => brdSearchGroups({
    query: searchQuery,
    entityRows: dashboardEntitySearchRows,
    peopleRows,
    transactionRows,
    rfpRows,
    newsRows,
  }), [searchQuery, dashboardEntitySearchRows, peopleRows, transactionRows, rfpRows, newsRows]);
  const liveSearchGroups = useMemo(() => brdPublicSearchGroups(searchQuery, searchPacket, searchEntityPackets), [searchQuery, searchPacket, searchEntityPackets]);
  const searchIntent = useMemo(
    () => isTextQueryReady(searchQuery) ? smartSearchIntentForQuery(searchQuery) : null,
    [searchQuery],
  );
  const intentSearchGroups = useMemo(
    () => smartSearchGroups(searchIntent, searchIntentPackets),
    [searchIntent, searchIntentPackets],
  );
  const dedicatedCategorySearchGroups = useMemo(() => brdSearchGroups({
    query: searchQuery,
    entityRows: [],
    peopleRows: [],
    transactionRows: [],
    rfpRows: dedupeSearchRecords(searchOpportunityPackets.flatMap((packet) => searchPacketRows(packet))),
    newsRows: searchPacketRows(searchNewsPacket),
  }), [searchNewsPacket, searchOpportunityPackets, searchQuery]);
  const baseSearchGroups = useMemo(
    () => mergeSearchGroups(intentSearchGroups, mergeSearchGroups(
      dedicatedCategorySearchGroups,
      mergeSearchGroups(liveSearchGroups, dashboardSearchGroups),
    )),
    [dashboardSearchGroups, dedicatedCategorySearchGroups, intentSearchGroups, liveSearchGroups],
  );
  const searchGroups = useMemo(() => {
    const clean = searchQuery.trim();
    if (isShortTextQuery(clean)) return completeSearchGroups([]);
    if (isTextQueryReady(clean)) {
      // Live groups are PRIMARY so a resolved entity's real transactions lead the
      // Transactions category (fills the "No matches" gap) and the live /api/people/search
      // matches lead the People category instead of the 25-row pre-loaded slice.
      const primaryLiveGroups = [
        ...entityTransactionSearchGroups(searchTransactionPacket, clean),
        ...peopleSearchGroups(searchPeoplePacket, clean),
      ];
      return completeSearchGroups(mergeSearchGroups(primaryLiveGroups, baseSearchGroups));
    }
    return dashboardSearchGroups;
  }, [baseSearchGroups, dashboardSearchGroups, searchQuery, searchTransactionPacket, searchPeoplePacket]);
  const searchItems = useMemo(() => searchGroups.flatMap((group) => group.items), [searchGroups]);
  const requiredSearchSources = useMemo(() => dashboardRequiredSearchSources(searchQuery), [searchQuery]);
  const hasCachedSearchResults = useMemo(
    () => requiredSearchSources.some((source) => searchCachedSources[source]),
    [requiredSearchSources, searchCachedSources],
  );
  const searchRequestLifecycle = useMemo(() => searchRequestLifecycleState<DashboardSearchSourceKey>({
    queryEligibility: textQueryEligibility(searchQuery),
    requiredSources: requiredSearchSources,
    settlements: searchSourceSettlements,
    resultCount: searchItems.length,
    hasCachedResults: hasCachedSearchResults,
  }), [hasCachedSearchResults, requiredSearchSources, searchItems.length, searchQuery, searchSourceSettlements]);
  const searchCategoryLifecycleStates = useMemo(() => dashboardCategoryLifecycleStates({
    query: searchQuery,
    groups: searchGroups,
    settlements: searchSourceSettlements,
    cachedSources: searchCachedSources,
  }), [searchCachedSources, searchGroups, searchQuery, searchSourceSettlements]);

  useEffect(() => {
    const timer = window.setTimeout(() => setActiveSearchIndex(0), 0);
    return () => window.clearTimeout(timer);
  }, [searchQuery, searchOpen]);

  useEffect(() => {
    if (!searchOpen) return;
    const clean = searchQuery.trim();
    const requiredSources = dashboardRequiredSearchSources(clean);
    let active = true;
    const controller = new AbortController();
    const unexpectedFailure = (reason: string): SearchSourceSettlement => ({
      state: "error",
      itemCount: 0,
      reason,
    });
    const settleSource = (source: DashboardSearchSourceKey, settlement: SearchSourceSettlement) => {
      if (!active) return;
      setSearchSourceSettlements((current) => ({ ...current, [source]: settlement }));
    };
    const settlePacket = (source: DashboardSearchSourceKey, packet: Packet | null | undefined) => {
      settleSource(source, searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length));
    };
    const markCachedSource = (source: DashboardSearchSourceKey, cached: boolean) => {
      if (!active) return;
      setSearchCachedSources((current) => ({ ...current, [source]: cached }));
    };
    const resetTimer = window.setTimeout(() => {
      if (!active) return;
      setSearchPacket(undefined);
      setSearchEntityPackets([]);
      setSearchTransactionPacket(undefined);
      setSearchPeoplePacket(undefined);
      setSearchOpportunityPackets([]);
      setSearchNewsPacket(undefined);
      setSearchIntentPackets([]);
      setSearchCachedSources({});
      setSearchSourceSettlements(beginSearchSourceSettlements(requiredSources));
    }, 0);

    if (!isTextQueryReady(clean)) {
      return () => {
        active = false;
        window.clearTimeout(resetTimer);
        controller.abort();
      };
    }

    const requestTimer = window.setTimeout(() => {
      const lifecycleIntent = entityLifecycleIntent(clean);
      const interpretedIntent = lifecycleIntent.explicitDefunctRequest ? null : smartSearchIntentForQuery(clean);
      if (interpretedIntent) {
        void Promise.all(interpretedIntent.requests.map((request) => (
          fetchPacket(request.endpoint, 25_000, { signal: controller.signal, attempts: 2 })
        ))).then((nextPackets) => {
          if (!active) return;
          setSearchIntentPackets(nextPackets.filter(isFact));
          settleSource("intent", combineSearchSourceSettlements(nextPackets.map((packet) => (
            searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length)
          ))));
        }).catch(() => settleSource("intent", unexpectedFailure("intent_search_rejected")));
        return;
      }

      const sourceQuery = lifecycleIntent.sourceQuery || clean;
      const entityVariants = businessSearchQueryVariants(sourceQuery);
      const lifecycleQuery = lifecycleIntent.explicitDefunctRequest ? "&entity_status=defunct" : "";
      const entitySearch = Promise.all(entityVariants.map((variant) => (
        fetchPacket(`/api/source-data/search/v1?collection=entities&q=${encodeURIComponent(variant)}${lifecycleQuery}&limit=100`, 25_000, {
          signal: controller.signal,
          attempts: 2,
        })
      ))).then((nextPackets) => {
        const factPackets = nextPackets.filter(isFact);
        const settlement = combineSearchSourceSettlements(nextPackets.map((packet) => (
          searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length)
        )));
        if (active) {
          setSearchEntityPackets(factPackets);
          settleSource("entities", settlement);
        }
        return { packets: factPackets, settlement };
      }).catch(() => {
        const settlement = unexpectedFailure("entity_search_rejected");
        settleSource("entities", settlement);
        return { packets: [] as Packet[], settlement };
      });

      if (lifecycleIntent.explicitDefunctRequest) {
        void entitySearch;
        return;
      }

      const publicSearch = fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(clean)}&limit=100`, 20_000, {
        signal: controller.signal,
        attempts: 2,
      }).then((packet) => {
        const settlement = searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length);
        if (active) {
          setSearchPacket(isFact(packet) ? packet : undefined);
          settleSource("public", settlement);
          if (isFact(packet)) {
            try {
              window.sessionStorage.setItem(searchPrefetchCacheKey(clean), JSON.stringify({
                query: clean,
                stored_at: Date.now(),
                packet,
              }));
            } catch {
              // Session storage is an optimization only; search still fetches live.
            }
          }
        }
        return { packet, settlement };
      }).catch(() => {
        const settlement = unexpectedFailure("public_search_rejected");
        settleSource("public", settlement);
        return { packet: null, settlement };
      });

      const peopleSearch = (async () => {
        const cached = cachedPeoplePacket(clean);
        if (cached && active) {
          setSearchPeoplePacket(cached);
          markCachedSource("people", true);
        }
        const packet = await fetchPeopleSearchLive(clean, controller.signal).catch(() => undefined);
        if (!packet) {
          settleSource("people", unexpectedFailure("people_search_rejected"));
          return;
        }
        if (!active) return;
        settlePacket("people", packet);
        if (isFact(packet)) {
          setSearchPeoplePacket(packet);
          storePeoplePacket(clean, packet);
          markCachedSource("people", false);
        } else if (!cached) {
          setSearchPeoplePacket(undefined);
        }
      })();

      const opportunitySearch = fetchAllOpportunitySearchPackets(controller.signal).then(({ packets: nextPackets, settlement }) => {
        if (!active) return;
        setSearchOpportunityPackets(nextPackets.filter(isFact));
        settleSource("opportunities", settlement);
      }).catch(() => settleSource("opportunities", unexpectedFailure("opportunity_search_rejected")));

      const newsSearch = fetchPacket(`/api/source-intelligence/news/v1?q=${encodeURIComponent(clean)}&limit=100&page=1`, 25_000, {
        signal: controller.signal,
        attempts: 2,
      }).then((packet) => {
        if (!active) return;
        settlePacket("news", packet);
        setSearchNewsPacket(isFact(packet) ? packet : undefined);
      }).catch(() => settleSource("news", unexpectedFailure("news_search_rejected")));

      const transactionSearch = Promise.all([publicSearch, entitySearch]).then(async ([publicResult, entityResult]) => {
        if (!active) return;
        const upstreamSettlement = combineSearchSourceSettlements([
          publicResult.settlement,
          entityResult.settlement,
        ]);
        const publicEntityRows = searchPacketRows(publicResult.packet)
          .filter((row) => brdPublicSearchGroupLabel(row) === "Entities");
        const sourceEntityRows = entityResult.packets.flatMap((packet) => searchPacketRows(packet));
        const resolvedEntities = aggregateEntitySearchRecords(publicEntityRows, sourceEntityRows, clean);
        const candidateNames = [...new Set([
          ...businessSearchQueryVariants(clean, resolvedEntities).slice(1),
          ...resolvedEntities.slice(0, 4).map((row) => brdText(row.name || row.title || row.institution, "")),
        ].filter(Boolean))].slice(0, 4);

        if (!candidateNames.length) {
          setSearchTransactionPacket(undefined);
          settleSource("transactions", upstreamSettlement.state === "success"
            ? completedSearchSource(0)
            : { ...upstreamSettlement, itemCount: 0 });
          return;
        }

        const cached = candidateNames.map(cachedTxnPacket)
          .find((packet) => packet && searchPacketRows(packet).length);
        if (cached && active) {
          setSearchTransactionPacket(cached);
          markCachedSource("transactions", true);
        }
        const nextPackets = await Promise.all(candidateNames.map((entityName) => (
          fetchEntityTransactionsLive(entityName, controller.signal).catch(() => undefined)
        )));
        if (!active) return;
        const concretePackets = nextPackets.filter((packet): packet is Packet => Boolean(packet));
        if (!concretePackets.length) {
          settleSource("transactions", unexpectedFailure("transaction_search_rejected"));
          return;
        }
        const hitIndex = nextPackets.findIndex((packet) => packet && isFact(packet) && searchPacketRows(packet).length > 0);
        const hit = hitIndex >= 0 ? nextPackets[hitIndex] : undefined;
        if (hit && isFact(hit)) {
          setSearchTransactionPacket(hit);
          storeTxnPacket(candidateNames[hitIndex], hit);
          markCachedSource("transactions", false);
        } else if (concretePackets.some(isFact)) {
          setSearchTransactionPacket(undefined);
          markCachedSource("transactions", false);
        } else if (!cached) {
          setSearchTransactionPacket(undefined);
        }
        settleSource("transactions", combineSearchSourceSettlements(concretePackets.map((packet) => (
          searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length)
        ))));
      }).catch(() => settleSource("transactions", unexpectedFailure("transaction_search_rejected")));

      void Promise.allSettled([publicSearch, entitySearch, peopleSearch, opportunitySearch, newsSearch, transactionSearch]);
    }, 120);

    return () => {
      active = false;
      window.clearTimeout(resetTimer);
      window.clearTimeout(requestTimer);
      controller.abort();
    };
  }, [searchOpen, searchQuery, searchRetryKey]);

  function togglePanel(id: string) {
    setExpandedPanel((current) => current === id ? "" : id);
  }

  async function retryTopAumRanking() {
    setPackets((current) => ({ ...current, top20: undefined }));
    const packet = await fetchPacket(ENDPOINTS.top20, dashboardTimeout("top20"), { attempts: dashboardAttempts("top20") });
    setPackets((current) => ({ ...current, top20: packet }));
  }

  return (
    <div
      ref={rootRef}
      data-client-hydrated={clientHydrated ? "true" : "false"}
      data-dashboard-primary-ready={dashboardPrimaryReady ? "true" : "false"}
      data-dashboard-ready={dashboardReady ? "true" : "false"}
      className="min-h-screen bg-[#F4F6F8] font-sans text-[#101827]"
    >
      <div className="min-h-screen xl:grid xl:grid-cols-[238px_minmax(0,1fr)]">
        <BrdCommandCenterSidebar topRows={topAumRows} rankingState={topAumContract.state} onRetry={() => { void retryTopAumRanking(); }} />
        <div className="min-w-0">
          <BrdTopNavigation onSearchOpen={() => setSearchOpen(true)} dataAsOfLabel={dataAsOfLabel} displayName={sessionDisplayName} />
          <VisualExecutiveOverview
            packets={packets}
            topAumRows={topAumRows}
            topAumState={topAumContract.state}
            allocatorCount={allocator90CountContract.count}
            allocatorCountState={allocator90CountContract.state}
            onTopAumRetry={() => { void retryTopAumRanking(); }}
            institutionTypeRows={institutionTypeRows}
            allocatorRows={allocatorRows}
            transactionRows={transactionRows}
            disclosedDealRows={disclosedDealRows}
            rfpRows={rfpRows}
            newsRows={newsRows}
            sectorRows={sectorRows}
            unifiedRows={unifiedRows}
            expandedPanel={expandedPanel}
            onTogglePanel={togglePanel}
            controls={visualControls}
          />
          <main className="mx-auto grid max-w-[1440px] gap-x-6 gap-y-6 px-4 py-6 sm:px-5 xl:grid-cols-[minmax(0,1fr)_320px]">
            <BrdNewsFeed rows={newsRows} revision={brdText(packets.news?.generated_at, "initial")} tab={newsTab} onTabChange={setNewsTab} />
            <BrdRightRail sectorRows={sectorRows} />
            <BrdRecentActivity
              tab={recentTab}
              onTabChange={setRecentTab}
              transactionRows={transactionRows}
              rfpRows={rfpRows}
              peopleRows={peopleRows}
            />
            <BrdTopTen tab={topTab} onTabChange={setTopTab} rfpRows={rfpRows} sectorRows={sectorRows} />
          </main>
        </div>
      </div>
      {searchOpen ? (
        <BrdSearchModal
          query={searchQuery}
          groups={searchGroups}
          activeIndex={activeSearchIndex}
          onQueryChange={(nextQuery) => {
            setSearchPacket(undefined);
            setSearchEntityPackets([]);
            setSearchTransactionPacket(undefined);
            setSearchPeoplePacket(undefined);
            setSearchOpportunityPackets([]);
            setSearchNewsPacket(undefined);
            setSearchIntentPackets([]);
            setSearchCachedSources({});
            setSearchSourceSettlements(beginSearchSourceSettlements(dashboardRequiredSearchSources(nextQuery)));
            setSearchQuery(nextQuery);
          }}
          onActiveIndexChange={setActiveSearchIndex}
          onClose={() => setSearchOpen(false)}
          onRetry={() => {
            setSearchSourceSettlements(beginSearchSourceSettlements(dashboardRequiredSearchSources(searchQuery)));
            setSearchRetryKey((value) => value + 1);
          }}
          flatItems={searchItems}
          requestLifecycle={searchRequestLifecycle}
          categoryLifecycleStates={searchCategoryLifecycleStates}
        />
      ) : null}
    </div>
  );
}

function BrdCommandCenterSidebar({ topRows, rankingState, onRetry }: { topRows: Record<string, unknown>[]; rankingState: AumRankingState; onRetry: () => void }) {
  const sidebarNav = [
    // Minutes F: every nav item needs a distinct, truthful destination — one
    // label per page, SWFIPN vocabulary (minutes M-1), no duplicate targets,
    // no "Events & Forums" label on RFP data. "Deals & Pipelines" targets
    // /transactions per the team's own KP acceptance contract
    // (dashboardSectionLinks: "Deals" -> /transactions/); "Capital Flows"
    // carries the /deals surface.
    ["Executive Overview", "/"],
    ["Contacts & Relationships", "/people"],
    ["Institutions", "/profiles"],
    ["Deals & Pipelines", "/transactions"],
    ["Capital Flows", "/deals"],
    ["Active Allocators", "/allocators"],
    ["Peer Comparisons", "/comparisons"],
    ["Research & Analytics", "/intelligence"],
    ["RFPs & Mandates", "/mandates"],
    // Paul-approved 2026-07-06 ("link it"): the historical AUM chart page
    // joins the nav — it was live and working but unreachable.
    ["AUM History", "/aggregates"],
    ["Reports & Dashboards", "/reports"],
    ["Settings", "/account"],
  ] as const;
  const watched = topRows.slice(0, 4);
  return (
    <aside className="border-b border-[#E5E8EF] bg-white xl:sticky xl:top-0 xl:h-screen xl:border-b-0 xl:border-r xl:border-[#E5E8EF]">
      <div className="flex h-[78px] items-center border-b border-[#E5E8EF] bg-[#B90D12] px-5 text-white">
        <Image src={assetHref("/swfi-assets/logo.svg")} alt="SWFI Sovereign Wealth Fund Institute" width={161} height={59} className="h-11 w-[132px] object-contain" />
      </div>
      <div className="px-4 py-3">
        <div className="mb-2 text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#4A5665]">Dashboard Navigation</div>
        <nav className="grid gap-1">
          {sidebarNav.map(([label, href], index) => (
            <DashboardLink
              key={label}
              href={href}
              className={`flex items-center gap-2 rounded-[6px] px-2.5 py-2 text-[12px] font-semibold no-underline ${index === 0 ? "bg-[#071F48] text-white" : "text-[#1E2B3A] hover:bg-[#F0F3F7]"}`}
            >
              <MiniIcon index={index} />
              <span className="truncate">{label}</span>
            </DashboardLink>
          ))}
        </nav>
      </div>
      <div className="mx-4 border-t border-[#E8ECF1] py-4" data-aum-ranking-state={rankingState}>
        <div className="mb-2 flex items-center justify-between text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#4A5665]">
          {/* Honest label 2026-07-06: these are the top-AUM ranked rows, not a
              user-curated watchlist (this preview has no accounts). */}
          <span>Top Ranked AUM</span>
          <span className="text-[#7B8996]">USD AUM</span>
        </div>
        <p className="mb-2 text-[10px] leading-snug text-[#657282]">Ranked by comparable USD AUM from the verified source. Each source AUM date is shown when supplied.</p>
        <div className="grid gap-2">
          {watched.length ? watched.map((row, index) => (
            <DataLink key={`${brdText(row.name)}-${index}`} href={dashboardProfileHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[minmax(0,1fr)_82px] gap-2 text-inherit no-underline">
              <span className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-[#223244]">{brdText(row.name)}</span>
                <span className="block truncate text-[9px] text-[#7B8996]">{aumDateDisplay(row)}</span>
              </span>
              <span className="text-right text-[11px] font-bold text-[#071F48]">{aumDisplay(row)}</span>
            </DataLink>
          )) : rankingState === "pending" ? (
            <div className="rounded-[6px] bg-[#F6F8FA] px-3 py-2 text-[11px] font-semibold text-[#657282]" role="status" aria-live="polite">Loading verified ranking…</div>
          ) : rankingState === "empty" ? (
            <div className="rounded-[6px] bg-[#F6F8FA] px-3 py-2 text-[11px] font-semibold text-[#657282]">No active ranked institutions in the verified source.</div>
          ) : (
            <div className="grid gap-2 rounded-[6px] bg-[#FFF7F7] px-3 py-2 text-[11px] font-semibold text-[#8B2B2B]" role="alert">
              <span>Top AUM ranking temporarily unavailable.</span>
              <button type="button" onClick={onRetry} className="w-fit border border-[#D7A7A7] bg-white px-2 py-1 text-[10px] font-bold text-[#7C1F1F]">Retry ranking</button>
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}

function BrdTopNavigation({ onSearchOpen, dataAsOfLabel, displayName }: { onSearchOpen: () => void; dataAsOfLabel: string; displayName: string }) {
  const greeting = useLocalGreeting();
  const currentDateLabel = useCurrentDateLabel();
  const actionNav = [
    ["Profiles", "/profiles"],
    ["Reports", "/reports"],
    ["Insights", "/intelligence"],
    ["Alerts", "/alerts"],
  ] as const;
  const canonicalNav = [
    ["Dashboard", "/"],
    ["News", "/intelligence"],
    ["Entities", "/profiles"],
    ["People", "/people"],
    ["Transactions", "/transactions"],
    ["Compass", "/mandates"],
    ["Reports", "/reports"],
  ] as const;
  return (
    <header data-gsap-reveal className="bg-[#B90D12] text-white shadow-[0_1px_8px_rgba(20,32,50,0.18)]">
      <div className="mx-auto grid min-h-[78px] max-w-[1440px] gap-3 px-4 py-3 sm:px-5 lg:grid-cols-[minmax(260px,1fr)_minmax(340px,520px)_auto] lg:items-center">
        <div className="flex min-w-0 items-center gap-3">
          {/* Stable brand mark on every viewport — before this, the header's
              only "SWFI" was the data-dependent freshness label, so branding
              (and the acceptance gate) raced hydration. */}
          <DashboardLink href="/" className="shrink-0" aria-label="SWFI dashboard home">
            <Image src={assetHref("/swfi-assets/logo.svg")} alt="SWFI Sovereign Wealth Fund Institute" width={161} height={59} className="h-9 w-[104px] object-contain" />
          </DashboardLink>
          <div className="min-w-0">
            <h1 className="text-[22px] font-extrabold leading-tight text-white sm:text-[24px]">{displayName ? `${greeting}, ${displayName}.` : `${greeting}.`}</h1>
            <p className="mt-1 text-[12px] font-medium text-white/78">Here&apos;s your intelligence and pipeline overview.</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onSearchOpen}
          className="flex min-h-[38px] min-w-0 items-center justify-between gap-3 rounded-[5px] bg-white px-3 text-left text-[12px] text-[#5E6A78] shadow-[0_1px_6px_rgba(40,20,20,0.18)]"
          aria-label="Open Global Search"
        >
          <span className="truncate">Search for contacts, insights, reports...</span>
          <kbd className="shrink-0 rounded border border-[#DEE2E7] bg-[#F4F5F7] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[#2D3446]">⌘ K</kbd>
        </button>
        <div className="flex min-w-0 items-center justify-between gap-3 lg:justify-end">
          <nav className="hidden items-center gap-2 2xl:flex" aria-label="Quick navigation">
            {actionNav.map(([label, href]) => (
              <DashboardLink key={label} href={href} className="grid h-9 place-items-center rounded-[5px] border border-white/18 bg-white/8 px-2.5 text-[11px] font-bold text-white no-underline hover:bg-white/16">
                {label}
              </DashboardLink>
            ))}
          </nav>
          <div className="hidden text-right text-[11px] leading-tight text-white/82 2xl:block">
            <div className="font-extrabold text-white">{currentDateLabel}</div>
            <div>{dataAsOfLabel}</div>
          </div>
          <DashboardLink href="/intelligence" className="hidden rounded-[8px] border border-white/16 bg-white/10 px-3 py-2 text-[11px] font-bold text-white no-underline 2xl:block">
            AI Insights
          </DashboardLink>
        </div>
      </div>
      <nav className="mx-auto flex max-w-[1440px] gap-1 overflow-x-auto border-t border-white/14 px-4 text-[12px] font-bold sm:px-5" aria-label="SWFI platform navigation">
        {canonicalNav.map(([label, href]) => (
          <DashboardLink key={label} href={href} className="shrink-0 px-3 py-2 text-white/86 no-underline hover:bg-white/10 hover:text-white">
            {label}
          </DashboardLink>
        ))}
      </nav>
    </header>
  );
}

function useLocalGreeting() {
  const [greeting, setGreeting] = useState("Good day");
  useEffect(() => {
    const update = () => setGreeting(greetingForHour(new Date().getHours()));
    update();
    const timer = window.setInterval(update, 60_000);
    return () => window.clearInterval(timer);
  }, []);
  return greeting;
}

function useCurrentDateLabel() {
  const [label, setLabel] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLabel(new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date()));
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);
  return label;
}

function greetingForHour(hour: number) {
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function VisualExecutiveOverview({
  packets,
  topAumRows,
  topAumState,
  allocatorCount,
  allocatorCountState,
  onTopAumRetry,
  institutionTypeRows,
  allocatorRows,
  transactionRows,
  disclosedDealRows,
  rfpRows,
  newsRows,
  sectorRows,
  unifiedRows,
  expandedPanel,
  controls,
  onTogglePanel,
}: {
  packets: Packets;
  topAumRows: Record<string, unknown>[];
  topAumState: AumRankingState;
  allocatorCount: number;
  allocatorCountState: AllocatorState;
  onTopAumRetry: () => void;
  institutionTypeRows: Record<string, unknown>[];
  allocatorRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  disclosedDealRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
  unifiedRows: UnifiedInsight[];
  expandedPanel: string;
  controls: DashboardTableControls;
  onTogglePanel: (id: string) => void;
}) {
  const kpis = dashboardMetricCards(packets, topAumRows, sectorRows, topAumState, allocatorCount, allocatorCountState);
  const topRows = topAumRows;

  return (
    <section data-gsap-reveal className="border-b border-[#E0DDD6] bg-[#EEF1F4] px-4 py-4 sm:px-5">
      <div className="mx-auto grid max-w-[1440px] gap-3">
        <div className="grid gap-2 md:grid-cols-3 2xl:grid-cols-6">
          {kpis.map((kpi) => (
            <ConceptKpiCard key={kpi.label} {...kpi} />
          ))}
        </div>
        <div className="grid gap-3">
          <MostRecentDisclosedDeals rows={disclosedDealRows} />
          <div className="grid gap-3 md:grid-cols-2">
            <DashboardLink href="/mandates" className="border border-[#C9D3DE] bg-white px-3 py-2.5 text-inherit no-underline shadow-[0_1px_2px_rgba(20,44,70,0.05)] hover:border-[#D51E29]/50">
              <span className="block text-[10px] font-extrabold tracking-[0.08em] text-[#7B8996]">Live RFPs &amp; Opportunities</span>
              <span className="mt-1 block text-[13px] font-semibold text-[#304153]">Open Compass RFP and opportunity records. No fundraising lifecycle is inferred.</span>
            </DashboardLink>
            <DashboardLink href="/deals" className="border border-[#C9D3DE] bg-white px-3 py-2.5 text-inherit no-underline shadow-[0_1px_2px_rgba(20,44,70,0.05)] hover:border-[#D51E29]/50">
              <span className="block text-[10px] font-extrabold tracking-[0.08em] text-[#7B8996]">Investment Trends by Sector</span>
              <span className="mt-1 block text-[13px] font-semibold text-[#304153]">Sector activity from disclosed transactions and market-flow records.</span>
            </DashboardLink>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start 2xl:grid-cols-[minmax(340px,1fr)_minmax(340px,1.18fr)_330px]">
            {/* 2026-07-06 v2 (Paul: "i dont see a map... check out amcharts
                for inspiration"): REAL geography now — Natural Earth country
                shapes, not the old invented dot-continents (which also only
                knew 14 hardcoded countries). Every country in the data is
                drawn or explicitly disclosed as not-drawable; the ranked
                list stays as the precise reading of the same numbers. */}
            <ExpandablePanel
              id="institution-overview"
              title="Global Capital Map"
              href="/profiles/?entity_type=Sovereign%20Wealth%20Fund"
              expanded={expandedPanel === "institution-overview"}
              onToggle={onTogglePanel}
              detail={<TotalAumInsightDetail topRows={topRows} institutionTypeRows={institutionTypeRows} transactionRows={transactionRows} rfpRows={rfpRows} sectorRows={sectorRows} />}
              explain="Real world map, two views: Institutions (where SWFI's validated ranking institutions are based; bubble = count) and Deal flows (arrows from buyer country to deal location, width = connecting deals; hover for values). The ranking is withheld when comparable-currency or provenance checks fail. Country marks remain display-only until the source accepts an exact country filter."
            >
              <CapitalByCountry
                topPacket={packets.top20}
                topRows={topRows}
                sectorRows={sectorRows}
                flows={worldFlowPairs(transactionRows)}
                rankingState={topAumState}
                onRetry={onTopAumRetry}
              />
            </ExpandablePanel>
            <ExpandablePanel
              id="capital-flows"
              title="Capital Flows & Allocation Trends"
              href="/deals"
              expanded={expandedPanel === "capital-flows"}
              onToggle={onTogglePanel}
              detail={<ExpandedSectorRows rows={sectorRows} controls={controls} />}
              explain="Where buyer capital flows: buyer region → industry from the deals loaded on this page, USD-disclosed values only (coverage stated under the chart). Click a band → those deals; expand for the sector table."
            >
              <CapitalFlowSankey rows={transactionRows} />
            </ExpandablePanel>
            <ExpandablePanel
              id="ai-insights"
              title="Capital Curiosity"
              href="/intelligence"
              expanded={expandedPanel === "ai-insights"}
              onToggle={onTogglePanel}
              detail={<ExpandedUnifiedInsightRows rows={unifiedRows} controls={controls} />}
              explain="Signals from the data already on this page: allocator activity, disclosed deals, Compass RFPs/opportunities, intelligence, and the Competition Analysis path. No generated values."
            >
              <AiInsightsPanel topInvestors={allocatorRows} marketRows={transactionRows} fundraisingRows={rfpRows} newsRows={newsRows} sectorRows={sectorRows} />
            </ExpandablePanel>
          </div>
          <div className="grid gap-3 xl:grid-cols-2 xl:items-start 2xl:grid-cols-[minmax(320px,1fr)_minmax(250px,0.72fr)_minmax(250px,0.72fr)_330px]">
            <ExpandablePanel
              id="pipeline"
              title="SWFI Discovery Pathways"
              href="/profiles/"
              expanded={expandedPanel === "pipeline"}
              onToggle={onTogglePanel}
              detail={<PipelineInsightDetail transactionRows={transactionRows} rfpRows={rfpRows} sectorRows={sectorRows} />}
              explain="Shortcuts into common SWFI research journeys, sized by the records currently loaded. Click a step → the matching SWFI list."
            >
              <PipelineFunnelPanel packets={packets} allocatorCount={allocatorCount} allocatorCountState={allocatorCountState} topRows={topRows} marketRows={transactionRows} fundraisingRows={rfpRows} />
            </ExpandablePanel>
            <ExpandablePanel
              id="relationships"
              title="Latest Institutional Activity"
              href="/allocators?days=30"
              expanded={expandedPanel === "relationships"}
              onToggle={onTogglePanel}
              detail={<ExpandedInvestorRows rows={allocatorRows} controls={controls} />}
              explain="Latest buyer-side investment activity from recorded allocator transactions. Click a name → its SWFI profile."
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
              explain="Latest SWFI intelligence articles. Click a headline → the article; Open records → the intelligence list."
            >
              <ResearchHubPanel rows={newsRows} />
            </ExpandablePanel>
            <div className="grid gap-3">
              <ExpandablePanel
                id="market-intelligence"
                title="Market Intelligence"
                href="/deals"
                expanded={expandedPanel === "market-intelligence"}
                onToggle={onTogglePanel}
                detail={<ExpandedSectorRows rows={sectorRows} controls={controls} />}
                explain="Sector activity summary from loaded transaction records. Click a sector → filtered deals."
              >
                <MarketIntelligencePanel rows={sectorRows} />
              </ExpandablePanel>
              <ExpandablePanel
                id="deal-intelligence"
                title="Deal Intelligence"
                href="/deals"
                expanded={expandedPanel === "deal-intelligence"}
                onToggle={onTogglePanel}
                detail={<ExpandedDealRows rows={transactionRows} controls={controls} />}
                explain="Most recent recorded transactions. Click a deal → its SWFI record (login handoff for gated detail)."
              >
                <DealIntelligencePanel rows={transactionRows} sectorRows={sectorRows} />
              </ExpandablePanel>
            </div>
          </div>
          <div className="grid gap-3 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,0.75fr)] xl:items-start">
            <ExpandablePanel
              id="engagements"
              title="Upcoming Events & Engagements"
              href="/mandates"
              expanded={expandedPanel === "engagements"}
              onToggle={onTogglePanel}
              detail={<ExpandedMandateRows rows={rfpRows} controls={controls} />}
              explain="Open RFPs and mandates presented as engagement opportunities (this card is RFP data, not an events calendar). Click → the RFP on SWFI."
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
              explain="Latest recorded activity across deals, news, and Compass RFPs/opportunities, newest first. Each line links to its source record."
            >
              <ActivityFeedPanel marketRows={transactionRows} newsRows={newsRows} fundraisingRows={rfpRows} />
            </ExpandablePanel>
          </div>
        </div>
        <div className="overflow-hidden bg-[#071F48] text-white">
          <NewsTicker rows={newsRows} />
        </div>
      </div>
    </section>
  );
}

function BrdNewsFeed({ rows: sourceRows, revision, tab, onTabChange }: {
  rows: Record<string, unknown>[];
  revision: string;
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
        Latest market intelligence appears first. Use the other views to browse frequently referenced items and topics.
      </DashboardSectionNote>
      {featured ? (
        <div data-testid="featured-news-story" data-news-story-id={newsStoryKey(featured)} className="mt-8 grid gap-10 lg:grid-cols-[minmax(260px,340px)_minmax(320px,1fr)_minmax(220px,310px)]">
          <DataLink href={researchRecordHref(featured)} sourceHref={sourceHref(featured)} className="block text-inherit no-underline">
            <div className="text-[10px] font-black uppercase tracking-[0.12em] text-[#A51C30]">{tab === "latest" ? "Top story now" : "Featured story"}</div>
            <h2 className="font-serif text-[34px] leading-[1.18] text-[#253047] sm:text-[40px]">{brdText(featured.title || featured.name)}</h2>
            <p className="mt-4 line-clamp-3 text-[14px] leading-5 text-[#24304B]">{brdExcerpt(featured)}</p>
            <div className="mt-4 flex items-center gap-4 text-[12px] text-[#5A6372]">
              <span>{brdReadTime(featured)}</span>
              <span>{recordDate(featured)}</span>
              {brdPopularBadge(featured, sourceRows) ? <span className="bg-[#D8D9D5] px-2 py-0.5 text-[10px] font-black uppercase tracking-[0.12em] text-[#41464F]">Popular</span> : null}
            </div>
          </DataLink>
          <DataLink href={researchRecordHref(featured)} sourceHref={sourceHref(featured)} className="block min-h-[200px] overflow-hidden bg-[#D8DDE6] text-inherit no-underline">
            <span className="sr-only">{brdText(featured.title || featured.name)}</span>
            <NewsPreviewImage key={`${newsStoryKey(featured)}-${revision}`} row={featured} featured />
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
            <NewsPreviewImage key={`${newsStoryKey(row)}-${revision}`} row={row} />
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

function BrdRecentActivity({ tab, onTabChange, transactionRows, rfpRows, peopleRows }: {
  tab: "transactions" | "rfps" | "opportunities" | "people";
  onTabChange: (tab: "transactions" | "rfps" | "opportunities" | "people") => void;
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  peopleRows: Record<string, unknown>[];
}) {
  const rowsToUse = brdNewestRows(tab, transactionRows, rfpRows, peopleRows);
  return (
    <section data-gsap-reveal className="min-w-0">
      <h2 className="font-serif text-[28px] leading-none text-[#22293C]">Recent Activity</h2>
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
        Five current items by category, with dates where available. Select an item to continue into SWFI.
      </DashboardSectionNote>
      <BrdActivityCards headers={rowsToUse.headers} rows={rowsToUse.rows} empty={DASHBOARD_EMPTY} />
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
        A compact ranking of current activity. Open a ranking item to continue into the matching SWFI view.
      </DashboardSectionNote>
      <BrdRankingVisual headers={["Inv Type", "Amount (USD)", "Count"]} rows={rowsToUse} empty={DASHBOARD_EMPTY} />
    </section>
  );
}

function BrdSearchModal({
  query,
  groups,
  activeIndex,
  flatItems,
  requestLifecycle,
  categoryLifecycleStates,
  onQueryChange,
  onActiveIndexChange,
  onClose,
  onRetry,
}: {
  query: string;
  groups: BrdSearchGroup[];
  activeIndex: number;
  flatItems: BrdSearchItem[];
  requestLifecycle: SearchRequestLifecycleState;
  categoryLifecycleStates: SearchCategoryLifecycleStates;
  onQueryChange: (query: string) => void;
  onActiveIndexChange: (index: number) => void;
  onClose: () => void;
  onRetry: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const [filter, setFilter] = useState<SearchCategoryLabel>("All");
  const availableFilters = SEARCH_CATEGORY_LABELS;
  const selectedFilter = availableFilters.some((label) => label === filter) ? filter : "All";
  const queryReady = isTextQueryReady(query);
  const queryShort = isShortTextQuery(query);
  const interpretedIntent = queryReady ? smartSearchIntentForQuery(query) : null;
  const visibleGroups = selectedFilter === "All" ? groups : groups.filter((group) => group.label === selectedFilter);
  const visibleItems = visibleGroups.flatMap((group) => group.items);
  const activeItem = visibleItems[Math.min(activeIndex, Math.max(0, visibleItems.length - 1))];
  const selectedLifecycle = selectedFilter === "All" ? requestLifecycle : categoryLifecycleStates[selectedFilter];
  const selectedIssue = dashboardSearchLifecycleIssue(selectedLifecycle);
  const selectedPending = isSearchRequestPending(selectedLifecycle);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) || [])].filter((element) => !element.hasAttribute("hidden"));
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (first && last && event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (first && last && !event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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
      return;
    }
    if (event.key === "Enter" && queryReady) {
      event.preventDefault();
      window.location.assign(dashboardResolvedHref(brdSearchResultsHref(query, selectedFilter)));
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-start bg-[#050915]/65 px-3 py-4 backdrop-blur-sm sm:px-4 sm:py-20"
      role="dialog"
      aria-modal="true"
      aria-label="Global Search"
      aria-busy={selectedPending}
      data-search-query={query.trim().toLowerCase()}
      data-search-request-lifecycle={requestLifecycle}
      data-search-selected-lifecycle={selectedLifecycle}
    >
      <div ref={dialogRef} className="mx-auto w-full max-w-[860px] overflow-hidden bg-white shadow-[0_30px_70px_rgba(0,0,0,0.35)]" onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-3 border-b border-[#E2E6ED] px-5 py-4">
          <svg viewBox="0 0 24 24" className="h-5 w-5 text-[#1E2940]" aria-hidden="true">
            <path d="M10.8 18.2a7.4 7.4 0 1 1 0-14.8 7.4 7.4 0 0 1 0 14.8Zm5.4-1.8 4.2 4.2" fill="none" stroke="currentColor" strokeLinecap="round" strokeWidth="2.2" />
          </svg>
          <input
            autoFocus
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            placeholder="Search entities, people, transactions, RFPs, news..."
            className="min-h-11 min-w-0 flex-1 text-[16px] text-[#152039] placeholder:text-[#6B7585] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C] sm:text-[17px]"
            aria-label="Search query"
            aria-describedby="smart-search-minimum"
          />
          {query ? (
            <button type="button" onClick={() => onQueryChange("")} className="border border-[#C5CCD6] px-3 py-2 text-[12px] font-bold text-[#2F3A4C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]">
              Clear
            </button>
          ) : null}
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center text-[22px] text-[#2F3A4C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]" aria-label="Close search">×</button>
        </div>
        <div id="smart-search-minimum" className="border-b border-[#E2E6ED] px-5 py-2 text-[11px] text-[#536173]" aria-live="polite">
          {queryShort ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters to search.` : `Search starts at ${MIN_TEXT_QUERY_CHARACTERS} characters.`}
        </div>
        <div className="flex gap-2 overflow-x-auto border-b border-[#E2E6ED] px-5 py-3">
          {availableFilters.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => {
                setFilter(label);
                onActiveIndexChange(0);
              }}
              aria-pressed={selectedFilter === label}
              className={`shrink-0 rounded-full px-3 py-1.5 text-[12px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C] ${selectedFilter === label ? "bg-[#0B132B] text-white" : "bg-[#ECEFF4] text-[#35445A]"}`}
            >
              {label}
            </button>
          ))}
        </div>
        {interpretedIntent ? (
          <div className="border-b border-[#D7E5F2] bg-[#F2F7FB] px-5 py-2 text-[12px] text-[#234968]" data-testid="smart-search-interpretation">
            <span className="font-bold">Interpreted as:</span> {interpretedIntent.explanation}
          </div>
        ) : null}
        <div className="max-h-[56vh] overflow-y-auto px-5 py-4">
          {visibleGroups.map((group) => {
            const category = group.label as SearchResultCategoryLabel;
            const categoryLifecycle = categoryLifecycleStates[category];
            const categoryIssue = dashboardSearchLifecycleIssue(categoryLifecycle);
            const categoryPending = isSearchRequestPending(categoryLifecycle);
            return (
              <section key={group.label} className="mb-5 last:mb-0" data-search-category={group.label} data-search-category-lifecycle={categoryLifecycle}>
                <h3 className="mb-2 text-[12px] font-extrabold uppercase tracking-[0.08em] text-[#566273]">{group.label}</h3>
                <div className="grid gap-1">
                  {group.items.length ? group.items.map((item) => {
                    const itemIndex = visibleItems.indexOf(item);
                    return (
                      <DataLink
                        key={`${group.label}-${item.label}-${item.href}`}
                        href={item.href}
                        sourceHref={item.sourceHref}
                        className={`grid gap-1 px-3 py-2 text-inherit no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C] ${itemIndex === activeIndex ? "bg-[#EEF2F7]" : "hover:bg-[#F6F8FA]"}`}
                      >
                        <span className="truncate text-[14px] font-bold text-[#152039]">{item.label}</span>
                        <span className="truncate text-[12px] text-[#536173]">{item.detail}</span>
                      </DataLink>
                    );
                  }) : (
                    <div className="px-3 py-2 text-[12px] text-[#536173]" aria-live="polite" data-testid={`homepage-search-category-status-${dashboardSearchCategorySlug(category)}`}>
                      {dashboardSearchCategoryMessage(categoryLifecycle, queryShort, interpretedIntent, category)}
                    </div>
                  )}
                  {group.items.length && (categoryPending || categoryIssue) ? (
                    <div className={`mx-3 mt-1 border-l-2 px-2 py-1 text-[11px] ${categoryIssue ? "border-[#B7791F] bg-[#FFF9EC] text-[#6A4B12]" : "border-[#4676A8] bg-[#F2F7FB] text-[#234968]"}`} aria-live="polite">
                      {categoryIssue || "Partial results are available; checking the remaining source…"}
                    </div>
                  ) : null}
                </div>
              </section>
            );
          })}
          {selectedFilter === "All" && !flatItems.length ? (
            <div className="py-8 text-center text-[14px] text-[#536173]" aria-live="polite" data-testid="homepage-search-status">
              {dashboardSearchOverallMessage(requestLifecycle, queryShort)}
            </div>
          ) : null}
          {selectedIssue && visibleItems.length ? (
            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border border-[#D6A548] bg-[#FFF9EC] px-3 py-2 text-[12px] text-[#6A4B12]" role="alert" data-testid="homepage-search-partial-warning">
              <span>{selectedIssue}</span>
              <button type="button" onClick={onRetry} className="border border-[#8A6118] bg-white px-3 py-1 font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#8A6118]">Retry search</button>
            </div>
          ) : null}
          {selectedIssue && !visibleItems.length ? (
            <div className="mt-3 flex justify-center">
              <button type="button" onClick={onRetry} className="border border-[#16538C] bg-white px-3 py-1 text-[12px] font-semibold text-[#16538C] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]">Retry search</button>
            </div>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#E2E6ED] px-5 py-3 text-[12px] text-[#536173]">
          <span>Use ↑↓ to move, Enter to open, Escape to close.</span>
          {queryReady ? (
            <Link
              href={brdSearchResultsHref(query, selectedFilter)}
              className="font-bold text-[#0B4A83] underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#16538C]"
              onClick={() => storeRenderedSearchPrefetch(query, visibleGroups)}
            >
              View all results
            </Link>
          ) : (
            <span className="font-semibold text-[#5F6D7D]">View all results after {MIN_TEXT_QUERY_CHARACTERS} characters</span>
          )}
        </div>
      </div>
    </div>
  );
}

function brdSearchResultsHref(query: string, category: SearchCategoryLabel): string {
  const params = new URLSearchParams({ q: query.trim() });
  const categoryParam = category === "Entities"
    ? "entities"
    : category === "RFPs & Opportunities"
      ? "opportunities"
      : category === "Transactions"
        ? "transactions"
        : category === "News & Articles"
          ? "news"
          : category === "People"
            ? "people"
            : "";
  if (categoryParam) params.set("category", categoryParam);
  return `/search/?${params.toString()}`;
}

function dashboardRequiredSearchSources(query: string): DashboardSearchSourceKey[] {
  if (!isTextQueryReady(query)) return [];
  const lifecycleIntent = entityLifecycleIntent(query);
  if (lifecycleIntent.explicitDefunctRequest) return ["entities"];
  if (smartSearchIntentForQuery(query)) return ["intent"];
  return ["public", "entities", "transactions", "opportunities", "news", "people"];
}

function dashboardCategorySearchSources(
  query: string,
  category: SearchResultCategoryLabel,
): DashboardSearchSourceKey[] {
  if (!isTextQueryReady(query)) return [];
  const lifecycleIntent = entityLifecycleIntent(query);
  if (lifecycleIntent.explicitDefunctRequest) return category === "Entities" ? ["entities"] : [];
  const interpretedIntent = smartSearchIntentForQuery(query);
  if (interpretedIntent) return dashboardIntentCategoryLabel(interpretedIntent) === category ? ["intent"] : [];
  if (category === "Entities") return ["public", "entities"];
  if (category === "Transactions") return ["public", "entities", "transactions"];
  if (category === "RFPs & Opportunities") return ["opportunities"];
  if (category === "News & Articles") return ["news"];
  return ["people"];
}

function dashboardCategoryLifecycleStates({
  query,
  groups,
  settlements,
  cachedSources,
}: {
  query: string;
  groups: BrdSearchGroup[];
  settlements: SearchSourceSettlements<DashboardSearchSourceKey>;
  cachedSources: Partial<Record<DashboardSearchSourceKey, boolean>>;
}): SearchCategoryLifecycleStates {
  const eligibility = textQueryEligibility(query);
  return Object.fromEntries(SEARCH_CATEGORY_LABELS.filter((label): label is SearchResultCategoryLabel => label !== "All").map((category) => {
    const requiredSources = dashboardCategorySearchSources(query, category);
    if (!requiredSources.length) {
      return [category, eligibility === "short_query" ? "short_query" : "idle"];
    }
    const resultCount = groups.find((group) => group.label === category)?.items.length || 0;
    return [category, searchRequestLifecycleState<DashboardSearchSourceKey>({
      queryEligibility: eligibility,
      requiredSources,
      settlements,
      resultCount,
      hasCachedResults: requiredSources.some((source) => cachedSources[source]),
    })];
  })) as SearchCategoryLifecycleStates;
}

function dashboardIntentCategoryLabel(intent: SmartSearchIntent): SearchResultCategoryLabel {
  if (intent.category === "entities") return "Entities";
  if (intent.category === "opportunities") return "RFPs & Opportunities";
  return "Transactions";
}

function dashboardSearchLifecycleIssue(state: SearchRequestLifecycleState): string {
  if (state === "timed_out") return "Search timed out before every required source settled; visible results are unconfirmed.";
  if (state === "error") return "A required search source failed; visible results may be incomplete.";
  if (state === "unavailable") return "A required search source is unavailable; visible results may be incomplete.";
  if (state === "cancelled") return "Search was cancelled before every required source settled.";
  return "";
}

function dashboardSearchOverallMessage(state: SearchRequestLifecycleState, queryShort: boolean): string {
  if (queryShort) return `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters.`;
  if (state === "idle") return "Enter a search term to begin.";
  if (state === "debouncing") return "Preparing search…";
  if (state === "cached_stale") return "Showing cached results while required sources refresh…";
  if (state === "partial_category_loading") return "Partial results are available; loading the remaining sources…";
  if (state === "loading") return "Searching all required SWFI sources…";
  const issue = dashboardSearchLifecycleIssue(state);
  if (issue) return issue;
  if (canRenderConfirmedEmpty(state)) return "No matching SWFI records.";
  return "Search status is not yet confirmed.";
}

function dashboardSearchCategoryMessage(
  state: SearchRequestLifecycleState,
  queryShort: boolean,
  interpretedIntent: SmartSearchIntent | null,
  category: SearchResultCategoryLabel,
): string {
  if (queryShort) return `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters to search.`;
  if (state === "idle" && interpretedIntent) {
    return `This interpreted request targets ${dashboardIntentCategoryLabel(interpretedIntent)}, not ${category}.`;
  }
  if (state === "idle") return "Enter a search term to begin.";
  if (isSearchRequestPending(state)) return state === "cached_stale"
    ? "Showing cached matches while this category refreshes…"
    : "Searching this category…";
  const issue = dashboardSearchLifecycleIssue(state);
  if (issue) return issue;
  if (canRenderConfirmedEmpty(state)) return "No matches in this category.";
  return "This category has no confirmed visible rows.";
}

function dashboardSearchCategorySlug(category: SearchResultCategoryLabel): string {
  return category.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
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

function BrdActivityCards({ headers, rows: sourceRows, empty }: { headers: string[]; rows: Cell[][]; empty: string }) {
  const visible = sourceRows.slice(0, 5);
  return (
    <div className="mt-5 grid gap-3 md:grid-cols-2">
      {visible.length ? visible.map((row, index) => (
        <div key={`${cellText(row[0])}-${index}`} className="min-w-0 border border-[#D8DEE8] bg-white/85 p-3 shadow-[0_1px_2px_rgba(20,44,70,0.04)]">
          <div className="grid grid-cols-[28px_minmax(0,1fr)] gap-2">
            <span className="grid h-7 w-7 place-items-center rounded-full bg-[#EEF2F7] text-[11px] font-extrabold text-[#B90D12]">{index + 1}</span>
            <div className="min-w-0 text-[13px] font-bold text-[#14213D]">{displayCell(row[0])}</div>
          </div>
          <div className="mt-3 grid gap-2 text-[11.5px] text-[#526171] sm:grid-cols-2">
            {row.slice(1).map((cell, detailIndex) => (
              <div key={`${headers[detailIndex + 1] || detailIndex}-${detailIndex}`} className="min-w-0 rounded-[5px] bg-[#F5F7FA] px-2 py-2">
                <div className="text-[9.5px] font-extrabold uppercase tracking-[0.1em] text-[#8290A0]">{headers[detailIndex + 1]}</div>
                <div className="mt-1 break-words font-bold text-[#2F3A4F]">{displayCell(cell)}</div>
              </div>
            ))}
          </div>
        </div>
      )) : (
        <div className="border border-[#D8DEE8] bg-white px-3 py-4 text-[13px] text-[#606A7C] md:col-span-2">{empty}</div>
      )}
      {sourceRows.length > visible.length ? (
        <div className="text-[11px] font-semibold text-[#667386] md:col-span-2">Showing top 5 dashboard signals</div>
      ) : (
        <div className="sr-only md:col-span-2">Showing top 5 dashboard signals</div>
      )}
    </div>
  );
}

function BrdRankingVisual({ headers, rows: sourceRows, empty }: { headers: string[]; rows: Cell[][]; empty: string }) {
  const visible = sourceRows.slice(0, 10);
  const max = Math.max(1, ...visible.map(rankingMetricValue));
  return (
    <div className="mt-5 grid gap-2">
      {visible.length ? visible.map((row, index) => {
        const value = rankingMetricValue(row);
        return (
          <div key={`${cellText(row[0])}-${index}`} className="grid gap-2 border border-[#D8DEE8] bg-white/85 px-3 py-2.5 shadow-[0_1px_2px_rgba(20,44,70,0.04)]">
            <div className="grid grid-cols-[32px_minmax(0,1fr)_minmax(82px,120px)] items-start gap-2">
              <span className="text-[18px] font-extrabold leading-none text-[#B90D12]">{index + 1}</span>
              <div className="min-w-0 text-[13px] font-bold text-[#14213D]">{displayCell(row[0])}</div>
              <div className="text-right text-[11.5px] font-extrabold text-[#13283D]">{cellText(row[1]) !== "Not disclosed" ? displayCell(row[1]) : displayCell(row[2])}</div>
            </div>
            <div className="h-2 overflow-hidden rounded bg-[#E8EDF2]" aria-hidden="true">
              <div className="h-full rounded bg-[#2C78D2]" style={{ width: `${Math.max(4, Math.min(100, (value / max) * 100))}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-[#667386]">
              <span>{headers[1]}: {displayCell(row[1])}</span>
              <span>{headers[2]}: {displayCell(row[2])}</span>
            </div>
          </div>
        );
      }) : (
        <div className="border border-[#D8DEE8] bg-white px-3 py-4 text-[13px] text-[#606A7C]">{empty}</div>
      )}
    </div>
  );
}

function mergeSearchGroups(primaryGroups: BrdSearchGroup[], secondaryGroups: BrdSearchGroup[]): BrdSearchGroup[] {
  const merged = new Map<string, BrdSearchItem[]>();
  for (const group of [...primaryGroups, ...secondaryGroups]) {
    const current = merged.get(group.label) || [];
    const seen = new Set(current.map((item) => `${item.label}|${item.href}`));
    const next = [...current];
    for (const item of group.items) {
      const key = `${item.label}|${item.href}`;
      if (seen.has(key)) continue;
      seen.add(key);
      next.push(item);
    }
    merged.set(group.label, next.slice(0, 5));
  }
  return [...merged.entries()].map(([label, items]) => ({ label, items }));
}

function completeSearchGroups(groups: BrdSearchGroup[]): BrdSearchGroup[] {
  const byLabel = new Map(groups.map((group) => [group.label, group.items] as const));
  return SEARCH_CATEGORY_LABELS
    .filter((label) => label !== "All")
    .map((label) => ({ label, items: byLabel.get(label) || [] }));
}

function smartSearchGroups(intent: SmartSearchIntent | null, packets: Packet[]): BrdSearchGroup[] {
  if (!intent) return [];
  const sourceRows = dedupeSearchRecords(packets.flatMap((packet) => {
    const resultRows = rows(packet, "results");
    return resultRows.length ? resultRows : rows(packet);
  }));
  const matchedRows = filterSmartSearchIntentRows(intent, sourceRows);
  const label = intent.category === "entities"
    ? "Entities"
    : intent.category === "opportunities"
      ? "RFPs & Opportunities"
      : "Transactions";
  const items = matchedRows.slice(0, 5).map((row) => brdPublicSearchItem(row, label));
  return items.length ? [{ label, items }] : [];
}

function brdPublicSearchGroups(query: string, packet?: Packet, entityPackets: Packet[] = []): BrdSearchGroup[] {
  if (!isTextQueryReady(query)) return [];
  const grouped = new Map<string, BrdSearchItem[]>();
  const candidates: { row: Record<string, unknown>; label: string; kind: SearchKind }[] = [];
  const entityRows = dedupeSearchRecords(entityPackets.flatMap((entityPacket) => [
    ...rows(entityPacket, "results"),
    ...rows(entityPacket),
  ]));
  for (const row of entityRows) {
    candidates.push({ row, label: "Entities", kind: "entity" });
  }
  if (packet && isFact(packet)) {
    for (const row of rows(packet, "results")) {
      const label = brdPublicSearchGroupLabel(row);
      candidates.push({ row, label, kind: brdSearchKindForLabel(label) });
    }
  }
  const seen = new Set<string>();
  const sorted = candidates
    .map((candidate, index) => ({
      ...candidate,
      index,
      score: businessSearchRelevanceScore(candidate.row, query, candidate.kind),
      key: `${candidate.label}:${searchRowKey(candidate.row)}`,
    }))
    .filter((candidate) => candidate.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index);
  for (const candidate of sorted) {
    if (seen.has(candidate.key)) continue;
    seen.add(candidate.key);
    const current = grouped.get(candidate.label) || [];
    if (current.length >= 5) continue;
    current.push(brdPublicSearchItem(candidate.row, candidate.label));
    grouped.set(candidate.label, current);
  }
  return [...grouped.entries()]
    .map(([label, items]) => ({ label, items }))
    .filter((group) => group.items.length);
}

function brdPublicSearchGroupLabel(row: Record<string, unknown>): string {
  const source = sourceHref(row) || "";
  if (/\/v1\/people\//i.test(source)) return "People";
  if (/\/v1\/transactions\//i.test(source)) return "Transactions";
  if (/\/v1\/compass\//i.test(source)) return "RFPs & Opportunities";
  if (/\?p=\d+/i.test(source) || /\/news\//i.test(source)) return "News & Articles";
  return "Entities";
}

function brdPublicSearchItem(row: Record<string, unknown>, group: string): BrdSearchItem {
  const label = brdText(row.name || row.title || row.institution, "Result");
  const source = sourceHref(row);
  const detail = group === "Transactions"
    ? transactionSearchDetail(row)
    : group === "Entities" && Number(row.activity_count || row.deal_count || 0) > 0
      ? [
          brdText(row.type || row.entity_type, ""),
          brdText(row.country || row.region, ""),
          `${Number(row.activity_count || row.deal_count).toLocaleString("en-US")} completed buyer/acquirer deals`,
          brdText(row.activity_reason, ""),
        ].filter(Boolean).join(" · ")
    : [
        brdText(row.type || row.entity_type || row.title, ""),
        brdText(row.country || row.region || row.institution, ""),
      ].filter(Boolean).join(" · ");
  const href = group === "People"
    ? dashboardPersonHref(row)
    : group === "Transactions"
      ? dashboardTransactionHref(row)
      : group === "RFPs & Opportunities"
        ? dashboardMandateHref(row)
        : group === "News & Articles"
          ? researchRecordHref(row)
          : dashboardProfileHref(row);
  return { label, detail, href, sourceHref: source, prefetchRow: row };
}

function brdSearchKindForLabel(label: string): SearchKind {
  if (label === "People") return "person";
  if (label === "Transactions") return "transaction";
  if (label === "RFPs & Opportunities") return "rfp";
  if (label === "News & Articles") return "news";
  return "entity";
}

// Client-side KV-style cache for entity->transactions results (sessionStorage, 5-min TTL),
// keyed by exact entity name. Makes repeat and pre-warmed lookups instant, so the
// Transactions section does not flash "No matches" while a cold fetch is in flight.
const TXN_CACHE_PREFIX = "swfipn.entityTxn.v1:";
function txnCacheKey(name: string): string {
  return `${TXN_CACHE_PREFIX}${name.trim().toLowerCase()}`;
}
function cachedTxnPacket(name: string): Packet | undefined {
  if (typeof window === "undefined" || !name.trim()) return undefined;
  try {
    const raw = window.sessionStorage.getItem(txnCacheKey(name));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { stored_at?: number; packet?: Packet };
    if (!parsed.stored_at || Date.now() - parsed.stored_at > 300_000) return undefined;
    return parsed.packet && isFact(parsed.packet) ? parsed.packet : undefined;
  } catch {
    return undefined;
  }
}
function storeTxnPacket(name: string, packet: Packet): void {
  if (typeof window === "undefined" || !name.trim() || !isFact(packet)) return;
  try {
    window.sessionStorage.setItem(txnCacheKey(name), JSON.stringify({ stored_at: Date.now(), packet }));
  } catch {
    // sessionStorage is an optimization only; the live fetch still runs.
  }
}

// Same client-side KV cache pattern as the entity->transactions lookup above, keyed by the
// lowercased people-search query. Cached rows may render immediately, but they never settle
// the request: a live refresh still runs before the UI may claim success or confirmed empty.
const PEOPLE_CACHE_PREFIX = "swfipn.peopleSearch.v1:";
function peopleCacheKey(query: string): string {
  return `${PEOPLE_CACHE_PREFIX}${query.trim().toLowerCase()}`;
}
function cachedPeoplePacket(query: string): Packet | undefined {
  if (typeof window === "undefined" || !query.trim()) return undefined;
  try {
    const raw = window.sessionStorage.getItem(peopleCacheKey(query));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { stored_at?: number; packet?: Packet };
    if (!parsed.stored_at || Date.now() - parsed.stored_at > 300_000) return undefined;
    return parsed.packet && isFact(parsed.packet) ? parsed.packet : undefined;
  } catch {
    return undefined;
  }
}
function storePeoplePacket(query: string, packet: Packet): void {
  if (typeof window === "undefined" || !query.trim() || !isFact(packet)) return;
  try {
    window.sessionStorage.setItem(peopleCacheKey(query), JSON.stringify({ stored_at: Date.now(), packet }));
  } catch {
    // sessionStorage is an optimization only; the live fetch still runs.
  }
}
async function fetchEntityTransactionsLive(name: string, signal: AbortSignal): Promise<Packet> {
  return fetchPacket(`/api/entity-transactions/v1?name=${encodeURIComponent(name)}&limit=8`, 20_000, {
    signal,
    attempts: 2,
  });
}

// Live people lookup for Smart Search. Cache display and live settlement are intentionally
// separate. /api/people/search/v1 is PII-safe (name/title/institution/
// city/region/country/linkedin_url/photo_url/source_url only) and returns swfi.com record
// URLs, so results link straight to the SWFI platform per the source-of-truth rule.
async function fetchPeopleSearchLive(query: string, signal: AbortSignal): Promise<Packet> {
  return fetchPacket(`/api/people/search/v1?q=${encodeURIComponent(query)}&limit=100`, 25_000, {
    signal,
    attempts: 2,
  });
}

function transactionSearchDetail(row: Record<string, unknown>, buyerFallback = ""): string {
  const buyer = transactionBuyerName(row, buyerFallback);
  const amount = sourcedSearchDetail(cleanMoney(row.amount_display || row.capital_display || row.native_amount_display || row.amount || row.capital));
  const date = sourcedSearchDetail(recordDate(row));
  const country = sourcedSearchDetail(brdText(row.country || row.region, ""));
  const industry = sourcedSearchDetail(brdText(row.industry || row.sector, ""));
  const investmentType = industry ? "" : sourcedSearchDetail(brdText(row.investment_type || row.type, ""));
  return [
    buyer ? `Buyer: ${buyer}` : "",
    amount ? `Amount: ${amount}` : "",
    date ? `Date: ${date}` : "",
    country ? `Country: ${country}` : "",
    industry ? `Industry: ${industry}` : "",
    investmentType ? `Type: ${investmentType}` : "",
  ].filter(Boolean).join(" · ");
}

function transactionBuyerName(row: Record<string, unknown>, buyerFallback = ""): string {
  const direct = sourcedSearchDetail(brdText(row.buyer_entity || row.institution, ""));
  if (direct) return direct;
  const buyers = Array.isArray(row.buyer_entities) ? row.buyer_entities : [];
  for (const buyer of buyers) {
    if (!buyer || typeof buyer !== "object") continue;
    const name = sourcedSearchDetail(brdText((buyer as Record<string, unknown>).name, ""));
    if (name) return name;
  }
  return /buyer/i.test(brdText(row.role, "")) ? sourcedSearchDetail(buyerFallback) : "";
}

function sourcedSearchDetail(value: string): string {
  const clean = value.trim();
  return !clean || /^(not disclosed|unavailable|loading)$/i.test(clean) ? "" : clean;
}

function packetEntityName(packet: Packet): string {
  const entity = packetData(packet).entity;
  return entity && typeof entity === "object"
    ? sourcedSearchDetail(brdText((entity as Record<string, unknown>).name, ""))
    : "";
}

// Build the Transactions search group from an entity's real transactions
// (/api/entity-transactions/v1, the buyer/seller entity reference join). Rows arrive
// pre-built with swfi.com transaction URLs (source_url/swfi_url), so links resolve to
// the SWFI platform per the source-of-truth rule.
function entityTransactionSearchGroups(packet: Packet | undefined, query: string): BrdSearchGroup[] {
  if (!packet || !isFact(packet) || !isTextQueryReady(query)) return [];
  const txnRows = rows(packet, "results").length ? rows(packet, "results") : rows(packet);
  const resolvedEntityName = packetEntityName(packet);
  const items = txnRows.slice(0, 5).map((row) => ({
    label: brdText(row.name || row.title, "Transaction"),
    detail: transactionSearchDetail(row, resolvedEntityName),
    href: dashboardTransactionHref(row),
    sourceHref: sourceHref(row),
    prefetchRow: row,
  }));
  return items.length ? [{ label: "Transactions", items }] : [];
}

// Build the People search group from the live /api/people/search/v1 packet. Row shape is
// kept identical to the pre-loaded People group in brdSearchGroups (label=name,
// detail=title · institution, href=dashboardPersonHref, sourceHref=sourceHref) so the two
// merge into one visually-consistent category, with these live matches leading.
function peopleSearchGroups(packet: Packet | undefined, query: string): BrdSearchGroup[] {
  if (!packet || !isFact(packet) || !isTextQueryReady(query)) return [];
  const peopleResults = rows(packet, "results").length ? rows(packet, "results") : rows(packet);
  const items = peopleResults.slice(0, 8).map((row) => ({
    label: brdText(row.name),
    detail: [brdText(row.title, ""), brdText(row.institution, "")].filter(Boolean).join(" · "),
    href: dashboardPersonHref(row),
    sourceHref: sourceHref(row),
    prefetchRow: row,
  }));
  return items.length ? [{ label: "People", items }] : [];
}

function brdSearchGroups({ query, entityRows, peopleRows, transactionRows, rfpRows, newsRows }: {
  query: string;
  entityRows: Record<string, unknown>[];
  peopleRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
}): BrdSearchGroup[] {
  const filter = (row: Record<string, unknown>, kind: SearchKind) => {
    const clean = query.trim().toLowerCase();
    if (!clean) return true;
    return businessSearchRelevanceScore(row, clean, kind) > 0
      || Object.values(row).some((value) => typeof value === "string" && value.toLowerCase().includes(clean));
  };
  const group = (label: string, items: BrdSearchItem[]): BrdSearchGroup => ({ label, items: items.slice(0, 5) });
  return [
    group("Entities", rankRecordsForQuery(entityRows.filter((row) => filter(row, "entity")), query, "entity").map((row) => ({
      label: brdText(row.name),
      detail: [brdText(row.type || row.entity_type, "Entity"), brdText(row.country, "")].filter(Boolean).join(" · "),
      href: dashboardProfileHref(row),
      sourceHref: sourceHref(row),
      prefetchRow: row,
    }))),
    group("RFPs & Opportunities", rankRecordsForQuery(rfpRows.filter((row) => filter(row, "rfp")), query, "rfp").map((row) => ({
      label: brdText(row.title || row.name),
      detail: [brdText(row.institution, ""), brdText(row.strategy || row.asset_class_or_strategy, "")].filter(Boolean).join(" · "),
      href: dashboardMandateHref(row),
      sourceHref: sourceHref(row),
      prefetchRow: row,
    }))),
    group("Transactions", rankRecordsForQuery(transactionRows.filter((row) => filter(row, "transaction")), query, "transaction").map((row) => ({
      label: brdText(row.title || row.name),
      detail: transactionSearchDetail(row),
      href: dashboardTransactionHref(row),
      sourceHref: sourceHref(row),
      prefetchRow: row,
    }))),
    group("News & Articles", rankRecordsForQuery(newsRows.filter((row) => filter(row, "news")), query, "news").map((row) => ({
      label: brdText(row.title || row.name),
      detail: [brdReadTime(row), brdText(row.source, "")].filter(Boolean).join(" · "),
      href: researchRecordHref(row),
      sourceHref: sourceHref(row),
      prefetchRow: row,
    }))),
    group("People", rankRecordsForQuery(peopleRows.filter((row) => filter(row, "person")), query, "person").map((row) => ({
      label: brdText(row.name),
      detail: [brdText(row.title, ""), brdText(row.institution, "")].filter(Boolean).join(" · "),
      href: dashboardPersonHref(row),
      sourceHref: sourceHref(row),
      prefetchRow: row,
    }))),
  ].filter((searchGroup) => searchGroup.items.length);
}

function rankRecordsForQuery(rowsToUse: Record<string, unknown>[], query: string, kind: "entity" | "person" | "transaction" | "rfp" | "news") {
  return rankSearchRecords(rowsToUse, query, kind);
}


function searchRowKey(row: Record<string, unknown>): string {
  return brdText(row.source_url || row.swfi_url || row.url || row.profile_url || row.slug || row.name || row.title, "");
}

function brdNewestRows(
  tab: "transactions" | "rfps" | "opportunities" | "people",
  transactionRows: Record<string, unknown>[],
  rfpRows: Record<string, unknown>[],
  peopleRows: Record<string, unknown>[],
): { headers: string[]; rows: Cell[][] } {
  if (tab === "transactions") {
    return {
      headers: ["Name", "Buyer Entity", "Amount (USD)", "Date"],
      rows: transactionRows.map((row) => [
        dealCell(row),
        buyerCell(row),
        cleanMoney(row.amount_display || row.capital_display || row.amount),
        recordDate(row),
      ]),
    };
  }
  if (tab === "people") {
    return {
      headers: ["Name", "Title", "Institution", "Updated"],
      rows: peopleRows.map((row) => [
        personCell(row),
        brdText(row.title),
        brdText(row.institution),
        recordDate(row),
      ]),
    };
  }
  const visibleRfps = tab === "opportunities"
    ? rfpRows.filter((row) => /^(opportunity|mandate)$/i.test(brdText(row.record_type || row.opportunity_type, "")))
    : rfpRows.filter((row) => /^rfp$/i.test(brdText(row.record_type || row.opportunity_type, "")));
  return {
    headers: ["Name", "Institution", "Deadline", "Action"],
    rows: visibleRfps.map((row) => [
      mandateCell(row),
      brdText(row.institution),
      timelineDate(row),
      "Review mandate",
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
      { label, href: `/mandates/?investment_type=${encodeURIComponent(label)}&view=data` },
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

function newestNewsRows(rowsToUse: Record<string, unknown>[]) {
  return rowsToUse
    .map((row, index) => ({ row, index, stamp: newsPublishedStamp(row), legacy: Number(brdText(row.legacy_post || row.legacy_post_id, "0")) || 0 }))
    .sort((left, right) => right.stamp - left.stamp || right.legacy - left.legacy || left.index - right.index)
    .map((entry) => entry.row);
}

function newsPublishedStamp(row: Record<string, unknown>) {
  const parsed = Date.parse(brdText(row.published_at || row.updated_at || row.date, ""));
  return Number.isFinite(parsed) ? parsed : 0;
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

function newsStoryKey(row: Record<string, unknown>) {
  return brdText(row.legacy_post || row.legacy_post_id || row.id || row.source_url || row.title || row.name, "news-story");
}

function newsPreviewSource(row: Record<string, unknown>) {
  const value = brdText(row.preview_image_url, "");
  return /^\/api\/source-intelligence\/news\/preview-image\/v1\?legacy_id=\d{1,12}$/.test(value) ? value : "";
}

function newsFallbackSource(row: Record<string, unknown>) {
  const title = brdText(row.title || row.name, "SWFI intelligence");
  const key = `${newsStoryKey(row)}|${title}`;
  let hash = 0;
  for (let index = 0; index < key.length; index += 1) hash = ((hash << 5) - hash + key.charCodeAt(index)) | 0;
  const palette = [
    ["#071F48", "#2A6BA8"],
    ["#3B173F", "#A33F68"],
    ["#12372A", "#388C69"],
    ["#49320C", "#BD7A1D"],
    ["#4A1820", "#B83245"],
  ][Math.abs(hash) % 5];
  const initials = title.split(/\s+/).filter(Boolean).slice(0, 3).map((part) => part[0]).join("").toUpperCase();
  const shortTitle = title.length > 54 ? `${title.slice(0, 53)}…` : title;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="420" viewBox="0 0 720 420"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="${palette[0]}"/><stop offset="1" stop-color="${palette[1]}"/></linearGradient></defs><rect width="720" height="420" fill="url(#g)"/><circle cx="622" cy="82" r="132" fill="white" fill-opacity=".08"/><text x="46" y="66" fill="white" fill-opacity=".72" font-family="Arial,sans-serif" font-size="18" font-weight="700" letter-spacing="3">SWFI INTELLIGENCE</text><text x="46" y="225" fill="white" font-family="Arial,sans-serif" font-size="82" font-weight="700">${xmlText(initials || "SWFI")}</text><text x="46" y="292" fill="white" fill-opacity=".9" font-family="Arial,sans-serif" font-size="22">${xmlText(shortTitle)}</text><text x="46" y="365" fill="white" fill-opacity=".62" font-family="Arial,sans-serif" font-size="15">Editorial image unavailable</text></svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function xmlText(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character] || character);
}

function NewsPreviewImage({ row, featured = false }: { row: Record<string, unknown>; featured?: boolean }) {
  const preview = newsPreviewSource(row);
  const fallback = newsFallbackSource(row);
  const [imageSource, setImageSource] = useState(fallback);
  const [sourceState, setSourceState] = useState("story-fallback");
  const storyKey = newsStoryKey(row);

  useEffect(() => {
    if (!preview) return;
    let active = true;
    let objectUrl = "";
    void fetch(preview, {
      headers: { Accept: "image/avif,image/webp,image/png,image/jpeg,image/gif" },
    }).then(async (response) => {
      const mediaType = response.headers.get("content-type") || "";
      if (!response.ok || !mediaType.startsWith("image/")) {
        await response.arrayBuffer();
        return;
      }
      const blob = await response.blob();
      if (!active) return;
      objectUrl = URL.createObjectURL(blob);
      setImageSource(objectUrl);
      setSourceState("editorial");
    }).catch(() => {
      if (active) {
        setImageSource(fallback);
        setSourceState("story-fallback");
      }
    });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallback, preview]);

  return (
    <Image
      data-testid={featured ? "featured-news-image" : "news-preview-image"}
      data-news-story-id={storyKey}
      data-news-image-source={sourceState}
      src={imageSource}
      onError={() => {
        if (imageSource !== fallback) {
          setImageSource(fallback);
          setSourceState("story-fallback");
        }
      }}
      alt={brdText(row.title || row.name, "SWFI news story")}
      loading={featured ? "eager" : "lazy"}
      fetchPriority={featured ? "high" : "auto"}
      decoding="async"
      width={featured ? 720 : 100}
      height={featured ? 420 : 100}
      unoptimized
      className={featured ? "h-full min-h-[250px] w-full object-cover" : "h-[100px] w-[100px] object-cover"}
    />
  );
}

function brdExcerpt(row: Record<string, unknown>) {
  const value = brdText(row.excerpt || row.summary || row.content, "");
  if (!value) return "SWFI intelligence item";
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

function compactMoneyDisplay(value: unknown) {
  const display = cleanMoney(value);
  if (display === "Not disclosed") return display;
  const numeric = numericSortValue(display);
  return numeric && numeric > 0 ? compactMoney(numeric) : display;
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
    citationText: "View details",
  };
}

function dashboardResolvedHref(href: string) {
  if (href.startsWith("#")) return href;
  if (href.startsWith("http://") || href.startsWith("https://")) {
    return isSwfiPlatformRecordHref(href) ? swfiAuthHandoffHref(href) : href;
  }
  return appHref(href);
}

function ConceptKpiCard({ label, value, note, href, series, color, statusLabel = "", sourceLabel = "", explain = "" }: {
  label: string;
  value: string;
  note: string;
  href: string;
  series: number[];
  color: string;
  statusLabel?: string;
  sourceLabel?: string;
  explain?: string;
}) {
  return (
    <DashboardLink
      href={href}
      title={explain || undefined}
      data-qa-min="150"
      data-kpi-label={label}
      data-display-id={`home-kpi-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`}
      data-display-type="metric"
      data-title={label}
      data-purpose={explain}
      data-source="Verified SWFI source API"
      data-primary-cta="Open source records"
      data-cta-href={href}
      className="min-w-0 border border-[#C9D3DE] bg-white px-3 py-2.5 text-inherit no-underline shadow-[0_1px_2px_rgba(20,44,70,0.05)] hover:border-[#D51E29]/50"
    >
      <div className="text-[9px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">{label}</div>
      <div className="mt-1 flex items-end justify-between gap-2">
        <div className="swfi-numeral break-words text-[20px] font-extrabold leading-none text-[#13283D]">{value}</div>
        <MiniSparkline series={series} color={color} large />
      </div>
      <div className="mt-2 flex min-h-[14px] items-center justify-between gap-2 text-[10.5px]">
        {statusLabel ? <span className={`shrink-0 font-bold ${/blocked|unavailable/i.test(statusLabel) ? "text-[#9B2C2C]" : "text-[#1A9A68]"}`}>{statusLabel}</span> : null}
        <span className="min-w-0 truncate text-[#7B8996]">{note}</span>
      </div>
      {explain ? <div className="mt-1.5 line-clamp-2 text-[9px] leading-snug text-[#657282]">{explain}</div> : null}
      {sourceLabel ? <span hidden data-source-label={sourceLabel} /> : null}
    </DashboardLink>
  );
}

function ExpandablePanel({ id, title, href, expanded, onToggle, children, detail, explain, className = "" }: {
  id: string;
  title: string;
  href: string;
  expanded: boolean;
  onToggle: (id: string) => void;
  children: ReactNode;
  detail?: ReactNode;
  explain?: string;
  className?: string;
}) {
  return (
    <section id={id} data-panel-id={id} className={`min-w-0 overflow-hidden border border-[#C9D3DE] bg-white shadow-[0_1px_2px_rgba(20,44,70,0.05)] ${expanded ? "ring-2 ring-[#D51E29]/15" : ""} ${className}`}>
      <div className="flex items-center justify-between gap-2 border-b border-[#E3EAF1] bg-[#F8FAFC] px-3 py-2">
        <button type="button" data-panel-toggle={id} aria-expanded={expanded} aria-controls={`${id}-detail`} aria-label={`${expanded ? "Collapse" : "Expand"} ${title}`} onClick={() => onToggle(id)} className="flex min-w-0 flex-1 items-center gap-2 bg-transparent p-0 text-left">
          <span className="grid h-5 min-w-12 place-items-center border border-[#C9D3DE] bg-white px-2 text-[10px] font-black uppercase tracking-[0.08em] text-[#D51E29]">{expanded ? "Close" : "Open"}</span>
          <span className="truncate text-[12px] font-extrabold text-[#1E3145]">{title}</span>
        </button>
        <DashboardLink href={href} className="border border-[#C9D3DE] bg-white px-2 py-1 text-[10px] font-bold text-[#0A3A7A] no-underline">Open records</DashboardLink>
      </div>
      {/* Minutes F: every box carries a one-line meaning + destination. */}
      {explain ? <div className="border-b border-[#EEF2F5] bg-[#FBFCFE] px-3 py-1 text-[10px] leading-snug text-[#7B8996]">{explain}</div> : null}
      <div className="p-3">{children}</div>
      {expanded && detail ? (
        <div id={`${id}-detail`} className="border-t border-[#EEF2F5] bg-[#F8FAFC] p-3">{detail}</div>
      ) : null}
    </section>
  );
}

function CapitalByCountry({ topPacket, topRows, sectorRows, flows = [], rankingState, onRetry }: { topPacket?: Packet; topRows: Record<string, unknown>[]; sectorRows: Record<string, unknown>[]; flows?: WorldFlowPair[]; rankingState: AumRankingState; onRetry: () => void }) {
  const totalAum = totalAumValue(topPacket, topRows);
  const sectorCapital = sumNumbers(sectorRows.map(sectorValue));
  // Ranked by institution count (always known, one unit) — never by a bar
  // scale that mixes AUM currencies with row counts. Currency-backed AUM
  // shows as a text value per row.
  const nodes = [...countryCapitalRows(topRows)].sort((a, b) => b.count - a.count || a.topRank - b.topRank || a.country.localeCompare(b.country));
  const display = nodes.slice(0, 8);
  const maxCount = Math.max(1, ...display.map((node) => node.count));
  const topCountry = display[0];
  const topCountryShare = topCountry?.aum && topCountry.aumCurrency === "USD" && totalAum ? Math.round((topCountry.aum / totalAum) * 100) : 0;
  const countries = knownDistinctCount(topRows.map((row) => row.country));
  const stats = [
    { label: "Countries", value: countries ? compactNumber(countries) : "Not disclosed", href: "/profiles/?entity_type=Sovereign%20Wealth%20Fund", note: "Loaded ranking locations" },
    { label: "Profiles", value: topRows.length ? compactNumber(topRows.length) : "Not disclosed", href: "/profiles/?entity_type=Sovereign%20Wealth%20Fund", note: "Loaded ranking rows" },
    { label: "Top country", value: topCountry ? topCountry.country : "Not disclosed", href: "", note: topCountryShare ? `${topCountryShare}% of displayed AUM` : "Display only; country filter unavailable" },
    { label: "Ranking total", value: totalAum ? compactNumber(totalAum) : "Not disclosed", href: "/profiles/?entity_type=Sovereign%20Wealth%20Fund", note: "Active SWF records; ranking order is not transferred" },
  ];
  return (
    <div className="grid gap-3" data-aum-ranking-state={rankingState}>
      <div className="overflow-hidden rounded-[6px] border border-[#C8D8E8] bg-white shadow-[0_1px_4px_rgba(20,44,70,0.08)]">
        {display.length ? (
          <div className="grid gap-1.5 p-3">
            <WorldCapitalMap rows={nodes} flows={flows} />
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">Institutions by country</span>
              <span className="text-[9.5px] font-semibold text-[#7B8996]">from the loaded SWFI ranking rows</span>
            </div>
            {display.map((node, index) => (
              <div
                key={node.country}
                className="grid grid-cols-[20px_minmax(0,1fr)_auto] items-center gap-2 rounded px-1.5 py-1 text-inherit"
              >
                <span className="text-[11px] font-black text-[#7B8996]">{index + 1}</span>
                <span className="min-w-0">
                  {/* The country name is the point of the row — it never
                      truncates; the top-institution note yields instead. */}
                  <span className="flex min-w-0 items-baseline gap-2">
                    <span className="flex-none whitespace-nowrap text-[12.5px] font-bold text-[#13283D]">{node.country}</span>
                    {node.topName ? <span className="hidden min-w-0 flex-1 truncate text-[10px] font-semibold text-[#7B8996] sm:block">top: {node.topName}</span> : null}
                  </span>
                  <span className="mt-1 block h-[6px] w-full overflow-hidden rounded bg-[#EAF1F7]">
                    <span className="block h-full rounded bg-[#0A66C2]" style={{ width: `${Math.max(6, Math.round((node.count / maxCount) * 100))}%` }} />
                  </span>
                </span>
                <span className="text-right">
                  <span className="block text-[12px] font-extrabold text-[#0A3A7A]">{node.count} {node.count === 1 ? "institution" : "institutions"}</span>
                  <span className="block text-[10px] font-semibold text-[#667386]">
                    {node.aum && node.aumCurrency ? (node.aumCurrency === "USD" ? compactMoney(node.aum) : `${node.aumCurrency} ${compactNumber(node.aum)}`) : "Mixed currencies"}
                  </span>
                </span>
              </div>
            ))}
          </div>
        ) : (
          <AumRankingFallback state={rankingState} onRetry={onRetry} />
        )}
        {rankingState === "ready" ? (
          <div className="grid border-t border-[#D7E3EF] bg-white text-[11px] sm:grid-cols-4">
            {stats.map((stat) => (
              stat.href ? <DashboardLink key={stat.label} href={stat.href} className="min-w-0 border-r border-[#E1E8EF] px-3 py-2 text-inherit no-underline last:border-r-0">
                <span className="block truncate text-[10px] font-bold text-[#7B8996]">{stat.label}</span>
                {/* Values wrap rather than truncate — "United Arab Emirates"
                    cut to "United ..." hides the answer the tile exists for. */}
                <span className="mt-1 block text-[15px] font-extrabold leading-tight text-[#0A3A7A]">{stat.value}</span>
                {"note" in stat && stat.note ? <span className="mt-0.5 block truncate text-[9.5px] font-semibold text-[#7B8996]">{stat.note}</span> : null}
              </DashboardLink> : <div key={stat.label} className="min-w-0 border-r border-[#E1E8EF] px-3 py-2 text-inherit last:border-r-0" data-filter-support="display-only">
                <span className="block truncate text-[10px] font-bold text-[#7B8996]">{stat.label}</span>
                <span className="mt-1 block text-[15px] font-extrabold leading-tight text-[#0A3A7A]">{stat.value}</span>
                {stat.note ? <span className="mt-0.5 block truncate text-[9.5px] font-semibold text-[#7B8996]">{stat.note}</span> : null}
              </div>
            ))}
          </div>
        ) : null}
      </div>
      {rankingState === "ready" && sectorCapital ? (
        <div className="text-[10.5px] font-semibold text-[#7B8996]">Market activity total: {compactMoney(sectorCapital)}</div>
      ) : null}
    </div>
  );
}

function AumRankingFallback({ state, onRetry }: { state: AumRankingState; onRetry: () => void }) {
  if (state === "pending") {
    return (
      <div
        data-map-loading-state="true"
        data-aum-ranking-state="pending"
        className="grid min-h-[360px] content-center gap-5 overflow-hidden bg-[#F4F8FC] px-5 py-8"
        role="status"
        aria-label="Loading Global Capital Map"
        aria-busy="true"
      >
        <div aria-hidden="true" className="mx-auto h-3 w-32 animate-pulse rounded-full bg-[#D6E2ED]" />
        <div aria-hidden="true" className="relative mx-auto h-48 w-full max-w-[520px] overflow-hidden rounded-[8px] border border-[#D7E3EF] bg-white">
          <span className="absolute left-[14%] top-[28%] h-14 w-20 animate-pulse rounded-[45%] bg-[#E3ECF4]" />
          <span className="absolute left-[34%] top-[18%] h-20 w-28 animate-pulse rounded-[48%] bg-[#E3ECF4]" />
          <span className="absolute right-[17%] top-[34%] h-16 w-24 animate-pulse rounded-[46%] bg-[#E3ECF4]" />
          <span className="absolute bottom-[16%] right-[27%] h-10 w-16 animate-pulse rounded-[48%] bg-[#E3ECF4]" />
        </div>
      </div>
    );
  }

  if (state === "empty") {
    return (
      <div className="grid min-h-[360px] content-center gap-2 bg-[#F8FAFC] px-5 py-8 text-center" data-aum-ranking-state="empty">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#6A7888]">Verified active scope</div>
        <div className="text-[15px] font-bold text-[#26394D]">No ranked institutions were returned.</div>
      </div>
    );
  }

  return (
    <div className="grid min-h-[360px] content-center bg-[#FFF7F7] px-5 py-8" role="alert" data-aum-ranking-state={state}>
      <div className="mx-auto grid max-w-md gap-3 border border-[#E6BDBD] bg-white p-4 text-center shadow-[0_8px_22px_rgba(92,24,24,0.08)]">
        <div>
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#9B3A3A]">Top AUM source unavailable</div>
          <div className="mt-1 text-[15px] font-extrabold text-[#472424]">The map is withheld rather than populated from a different entity source.</div>
        </div>
        <button type="button" onClick={onRetry} className="mx-auto border border-[#D7A7A7] bg-white px-3 py-1.5 text-[11px] font-bold text-[#7C1F1F]">Retry ranking</button>
      </div>
    </div>
  );
}

type FlowLink = { source: string; target: string; value: number; deals: number };

function CapitalFlowSankey({ rows: transactionRows }: { rows: Record<string, unknown>[] }) {
  const eligible = transactionRows.filter((row) => brdText(row.buyer_region, "") && brdText(row.industry, ""));
  const usdValue = (row: Record<string, unknown>) => (text(row.currency, "").trim().toUpperCase() === "USD" ? (numberValue(row.amount) || 0) : 0);
  const totalUsd = sumNumbers(eligible.map(usdValue));
  const useUsd = totalUsd > 0;
  const metric = (row: Record<string, unknown>) => (useUsd ? usdValue(row) : 1);

  const linkMap = new Map<string, FlowLink>();
  for (const row of eligible) {
    const value = metric(row);
    if (!value) continue;
    const source = brdText(row.buyer_region, "");
    const target = brdText(row.industry, "");
    const key = `${source}→${target}`;
    const current = linkMap.get(key) || { source, target, value: 0, deals: 0 };
    current.value += value;
    current.deals += 1;
    linkMap.set(key, current);
  }
  const allLinks = [...linkMap.values()].sort((a, b) => b.value - a.value);
  // Cap the right column at 5 named industries; the rest aggregate into an
  // explicitly-labeled Other bucket (grouping disclosed, nothing dropped).
  const industryTotals = new Map<string, number>();
  for (const link of allLinks) industryTotals.set(link.target, (industryTotals.get(link.target) || 0) + link.value);
  const namedIndustries = new Set([...industryTotals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name]) => name));
  const otherCount = [...industryTotals.keys()].filter((name) => !namedIndustries.has(name)).length;
  const links: FlowLink[] = [];
  for (const link of allLinks) {
    const target = namedIndustries.has(link.target) ? link.target : `Other (${otherCount} industries)`;
    const existing = links.find((entry) => entry.source === link.source && entry.target === target);
    if (existing) {
      existing.value += link.value;
      existing.deals += link.deals;
    } else {
      links.push({ ...link, target });
    }
  }

  const usdDeals = eligible.filter((row) => usdValue(row) > 0).length;
  if (!links.length) {
    return (
      <div className="grid min-h-[172px] content-center rounded-[6px] bg-[#F7FAFD] p-3 text-center text-[12px] font-semibold text-[#526171]">
        {DASHBOARD_EMPTY}
      </div>
    );
  }

  const width = 560;
  const height = 250;
  const nodeWidth = 8;
  const labelGutter = 148;
  const gap = 8;
  const sources = [...new Set(links.map((link) => link.source))];
  const targets = [...new Set(links.map((link) => link.target))];
  const sum = (names: string[], side: "source" | "target") =>
    names.map((name) => links.filter((link) => link[side] === name).reduce((acc, link) => acc + link.value, 0));
  const sourceSums = sum(sources, "source");
  const targetSums = sum(targets, "target");
  const totalValue = sourceSums.reduce((acc, value) => acc + value, 0);
  const usable = (names: string[]) => height - gap * (names.length - 1) - 24;
  const scaleFor = (sums: number[], names: string[]) => usable(names) / Math.max(1, sums.reduce((a, b) => a + b, 0));
  const sourceScale = scaleFor(sourceSums, sources);
  const targetScale = scaleFor(targetSums, targets);

  const sourcePos = new Map<string, { y: number; h: number; offset: number }>();
  let cursor = 12;
  sources.forEach((name, index) => {
    const h = Math.max(10, sourceSums[index] * sourceScale);
    sourcePos.set(name, { y: cursor, h, offset: 0 });
    cursor += h + gap;
  });
  const targetPos = new Map<string, { y: number; h: number; offset: number }>();
  cursor = 12;
  targets.forEach((name, index) => {
    const h = Math.max(10, targetSums[index] * targetScale);
    targetPos.set(name, { y: cursor, h, offset: 0 });
    cursor += h + gap;
  });

  const leftX = labelGutter;
  const rightX = width - labelGutter - nodeWidth;
  const valueLabel = (value: number, deals: number) =>
    useUsd ? compactMoney(value) : `${deals} ${deals === 1 ? "deal" : "deals"}`;
  const flowFilters = [...new Set([...sources, ...targets.map((name) => (name.startsWith("Other (") ? "Other" : name))])]
    .filter(Boolean)
    .slice(0, 6);

  return (
    <div className="grid gap-2">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`Capital flows from buyer regions into industries, ${useUsd ? "by USD-disclosed value" : "by deal count"}`}>
        {links.map((link) => {
          const source = sourcePos.get(link.source)!;
          const target = targetPos.get(link.target)!;
          const sourceH = Math.max(2, (link.value / Math.max(1, sourceSums[sources.indexOf(link.source)])) * source.h);
          const targetH = Math.max(2, (link.value / Math.max(1, targetSums[targets.indexOf(link.target)])) * target.h);
          const y0 = source.y + source.offset;
          const y1 = target.y + target.offset;
          source.offset += sourceH;
          target.offset += targetH;
          const x0 = leftX + nodeWidth;
          const x1 = rightX;
          const cx = (x0 + x1) / 2;
          const d = `M${x0},${y0} C${cx},${y0} ${cx},${y1} ${x1},${y1} L${x1},${y1 + targetH} C${cx},${y1 + targetH} ${cx},${y0 + sourceH} ${x0},${y0 + sourceH} Z`;
          return (
            <g key={`${link.source}-${link.target}`}>
              <path d={d} fill="#0A66C2" opacity="0.22" className="hover:opacity-40">
                <title>{`${link.source} → ${link.target}: ${valueLabel(link.value, link.deals)} across ${link.deals} ${link.deals === 1 ? "deal" : "deals"}`}</title>
              </path>
            </g>
          );
        })}
        {sources.map((name) => {
          const pos = sourcePos.get(name)!;
          const total = sourceSums[sources.indexOf(name)];
          const deals = links.filter((link) => link.source === name).reduce((acc, link) => acc + link.deals, 0);
          return (
            <g key={`src-${name}`}>
              <rect x={leftX} y={pos.y} width={nodeWidth} height={pos.h} rx="2" fill="#0A3A7A" />
              <text x={leftX - 6} y={pos.y + pos.h / 2 + 3} textAnchor="end" fontSize="10" fontWeight="800" fill="#2E4157">{name}</text>
              <text x={leftX - 6} y={pos.y + pos.h / 2 + 13} textAnchor="end" fontSize="8.5" fontWeight="700" fill="#7B8996">{valueLabel(total, deals)}</text>
            </g>
          );
        })}
        {targets.map((name) => {
          const pos = targetPos.get(name)!;
          const total = targetSums[targets.indexOf(name)];
          const deals = links.filter((link) => link.target === name).reduce((acc, link) => acc + link.deals, 0);
          return (
            <g key={`tgt-${name}`}>
              <rect x={rightX} y={pos.y} width={nodeWidth} height={pos.h} rx="2" fill="#16538C" />
              <text x={rightX + nodeWidth + 6} y={pos.y + pos.h / 2 + 3} fontSize="10" fontWeight="800" fill="#2E4157">{name.length > 26 ? `${name.slice(0, 25)}…` : name}</text>
              <text x={rightX + nodeWidth + 6} y={pos.y + pos.h / 2 + 13} fontSize="8.5" fontWeight="700" fill="#7B8996">{valueLabel(total, deals)}</text>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap items-baseline justify-between gap-2 text-[10px] font-semibold text-[#7B8996]">
        <span>
          {useUsd
            ? `USD-disclosed value only: ${compactMoney(totalValue)} across ${usdDeals} of ${eligible.length} loaded deals with region + industry.`
            : `No USD-disclosed values in the loaded deals — bands show deal counts (${eligible.length} deals).`}
        </span>
        <span>Buyer region → industry. Seller regions are not disclosed in the loaded rows.</span>
      </div>
      {flowFilters.length ? (
        <div className="flex flex-wrap gap-1.5" aria-label="Open capital flow records">
          {flowFilters.map((filter) => (
            <DashboardLink key={filter} href={`/deals/?filter=${encodeURIComponent(filter)}`} className="rounded-[4px] border border-[#DCE5EE] bg-[#F8FAFC] px-2 py-1 text-[10px] font-bold text-[#0A3A7A] no-underline hover:bg-[#EEF4FA]">
              {filter}
            </DashboardLink>
          ))}
        </div>
      ) : null}
    </div>
  );
}

// CapitalFlowPanel + SectorRibbonChart deleted 2026-07-06: the ribbon's wavy
// shapes were decorative curves, not data (Paul: "dont like the capital
// flows chart") — replaced by CapitalFlowSankey above.

function AiInsightsPanel({ topInvestors, marketRows, fundraisingRows, newsRows, sectorRows }: {
  topInvestors: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}) {
  const curiosityRows = capitalCuriosityRows({ sectorRows, marketRows, fundraisingRows, newsRows }).slice(0, 3);
  const insights = [
    { label: "Latest allocator activity", row: topInvestors[0], href: "/allocators?days=30", detail: topInvestors[0] ? `${brdText(topInvestors[0].name)} · ${recordDate(topInvestors[0])}` : DASHBOARD_EMPTY },
    { label: "Largest recent deal", row: marketRows[0], href: "/deals", detail: marketRows[0] ? `${brdText(marketRows[0].title || marketRows[0].name)} · ${cleanMoney(marketRows[0].amount_display || marketRows[0].capital_display || marketRows[0].amount)}` : DASHBOARD_EMPTY },
    { label: "Open mandate deadline", row: fundraisingRows[0], href: "/mandates", detail: fundraisingRows[0] ? `${brdText(fundraisingRows[0].title || fundraisingRows[0].name)} · ${timelineDate(fundraisingRows[0])}` : DASHBOARD_EMPTY },
    { label: "Latest intelligence", row: newsRows[0], href: newsRows[0] ? researchRecordHref(newsRows[0]) : "/intelligence", detail: newsRows[0] ? brdText(newsRows[0].title || newsRows[0].name) : DASHBOARD_EMPTY },
  ];
  return (
    <div className="grid gap-2">
      <div className="grid grid-cols-2 gap-1 sm:grid-cols-4">
        <DashboardLink key="Competition Analysis" href="/comparisons/?filter=Sovereign%20Wealth%20Fund&entity_type=Sovereign%20Wealth%20Fund" className="rounded-[5px] border border-[#E2E8EF] bg-[#F8FAFC] px-2 py-1.5 text-center text-[10.5px] font-extrabold text-[#0A3A7A] no-underline hover:bg-[#EEF4FA]">
          Competition Analysis
        </DashboardLink>
        {insightNav.map(([label, href]) => (
          <DashboardLink key={label} href={href} className="rounded-[5px] border border-[#E2E8EF] bg-[#F8FAFC] px-2 py-1.5 text-center text-[10.5px] font-extrabold text-[#0A3A7A] no-underline hover:bg-[#EEF4FA]">
            {label}
          </DashboardLink>
        ))}
      </div>
      <DashboardLink href="/comparisons/?filter=Sovereign%20Wealth%20Fund&entity_type=Sovereign%20Wealth%20Fund" className="rounded-[6px] border border-[#DCE5EE] bg-[#F8FAFC] px-2.5 py-2 text-inherit no-underline hover:bg-white">
        <span className="block text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#B90D12]">What piqued your curiosity?</span>
        <span className="mt-1 block text-[12px] font-bold text-[#203448]">Compare institutions by AUM, region, transaction activity, and allocation signals.</span>
      </DashboardLink>
      {curiosityRows.length ? (
        <div className="grid gap-1.5 rounded-[6px] border border-[#DCE5EE] bg-white px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] font-extrabold uppercase tracking-[0.1em] text-[#B90D12]">Capital Curiosity Radar</span>
            <DashboardLink href="/deals" className="text-[10.5px] font-extrabold text-[#0A3A7A] underline">Open deals</DashboardLink>
          </div>
          {curiosityRows.map((row) => (
            <DashboardLink key={row.sector} href={row.href} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-[5px] bg-[#F8FAFC] px-2 py-1.5 text-inherit no-underline hover:bg-[#EEF4FA]">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{row.sector}</span>
                <span className="mt-0.5 block truncate text-[10.5px] text-[#7B8996]">{row.detail}</span>
              </span>
              <span className="text-right text-[10.5px] font-extrabold text-[#13283D]">{row.metric}</span>
            </DashboardLink>
          ))}
        </div>
      ) : null}
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

function PipelineFunnelPanel({ packets, allocatorCount, allocatorCountState, topRows, marketRows, fundraisingRows }: {
  packets: Packets;
  allocatorCount: number;
  allocatorCountState: AllocatorState;
  topRows: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
}) {
  const stages = [
    { label: "Institutions", value: metricNumber(packets.metrics, "institutions"), preview: topRows.length, href: "/profiles/", color: "#0A66C2" },
    { label: "Active Allocators", value: allocatorCount, preview: 0, href: "/allocators", color: "#16538C", sourceState: allocatorCountState },
    { label: "Deals", value: metricNumber(packets.metrics, "transactions"), preview: marketRows.length, href: "/deals", color: "#5C9BD6" },
    { label: "Live RFPs", value: metricNumber(packets.metrics, "rfps"), preview: fundraisingRows.length, href: "/mandates", color: "#7A8A9B" },
    { label: "Top AUM ranking", value: null, preview: topRows.length, href: "/profiles/?entity_type=Sovereign%20Wealth%20Fund", color: "#B90D12", sourceState: packets.top20 === undefined ? "pending" : topRows.length ? "ready" : "blocked" },
  ];
  return (
    <div className="grid gap-2 lg:grid-cols-[minmax(0,1fr)_132px]">
      <svg viewBox="0 0 380 218" className="h-[176px] w-full" role="img" aria-label="SWFI discovery pathways by record group">
        {stages.map((stage, index) => {
          const topWidth = 320 - index * 48;
          const bottomWidth = 320 - (index + 1) * 48;
          const y = 12 + index * 36;
          const cx = 190;
          const d = `M${cx - topWidth / 2} ${y} L${cx + topWidth / 2} ${y} L${cx + bottomWidth / 2} ${y + 29} L${cx - bottomWidth / 2} ${y + 29} Z`;
          return (
            <g key={stage.label}>
              <path d={d} fill={stage.color} opacity={0.92} />
              <text x={cx} y={y + 19} textAnchor="middle" fill="white" fontSize="12" fontWeight="800">{stage.label}</text>
            </g>
          );
        })}
      </svg>
      <div className="grid content-center gap-2">
        {stages.map((stage) => (
          <DashboardLink key={stage.label} href={stage.href} className="flex items-center justify-between gap-2 rounded-[5px] px-2 py-1.5 text-[11px] text-[#405062] no-underline hover:bg-[#F5F8FB]">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ backgroundColor: stage.color }} />{stage.label}</span>
            <span className="font-extrabold text-[#13283D]">
              {"sourceState" in stage && (stage.sourceState === "blocked" || stage.sourceState === "invalid" || stage.sourceState === "unavailable")
                ? "Source blocked"
                : "sourceState" in stage && stage.sourceState === "empty"
                  ? "0"
                  : typeof stage.value === "number" && stage.value > 0
                    ? compactNumber(stage.value)
                    : stage.preview > 0 ? `Preview ${stage.preview}` : "Pending source"}
            </span>
          </DashboardLink>
        ))}
        <div className="text-[10px] font-semibold text-[#7B8996]">Widths show the discovery sequence only. Preview counts are never presented as universe totals.</div>
      </div>
    </div>
  );
}

function RelationshipPanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const visible = sourceRows.slice(0, 5);
  const max = Math.max(1, ...visible.map(activityCountValue));
  if (!visible.length) {
    return (
      <div className="grid min-h-[118px] content-center gap-2 rounded-[6px] border border-[#E5EBF1] bg-[#F8FAFC] px-3 py-4 text-center">
        <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">Latest investor activity</div>
        <div className="text-[13px] font-bold text-[#203448]">No current investor activity available</div>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      {visible.map((row, index) => {
        const value = activityCountValue(row);
        return (
          <DataLink key={`${brdText(row.name)}-${index}`} href={dashboardProfileHref(row)} sourceHref={sourceHref(row)} className="grid gap-1 rounded-[5px] px-2 py-1.5 text-[#405062] no-underline hover:bg-[#F5F8FB]">
            <span className="grid grid-cols-[22px_minmax(0,1fr)_76px] items-center gap-2">
              <span className="font-extrabold text-[#8A97A4]">{index + 1}</span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.name)}</span>
                <span className="block truncate text-[10.5px] text-[#7B8996]">{allocatorMeta(row)}</span>
              </span>
              <span className="text-right text-[11px] font-extrabold text-[#1A9A68]">{dealCountLabel(value)}</span>
            </span>
            <Bar value={value} max={max} />
          </DataLink>
        );
      })}
    </div>
  );
}

function ResearchHubPanel({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const images = ["investor.webp", "deal_trends.webp", "industry.webp", "fundraising.webp"];
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {sourceRows.slice(0, 4).map((row, index) => (
        <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={researchRecordHref(row)} sourceHref={sourceHref(row)} className="overflow-hidden rounded-[6px] border border-[#E4EAF0] bg-[#F8FAFC] text-inherit no-underline">
          <Image src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" width={4960} height={1488} className="h-16 w-full object-cover" />
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
          <Image src={assetHref(`/swfi-assets/images/${images[index % images.length]}`)} alt="" width={4960} height={1488} className="h-16 w-full object-cover" />
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
          <div className="text-[10px] font-extrabold uppercase tracking-[0.12em] text-[#7B8996]">Largest sector share</div>
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

// Client item #8 (SWFI): "Restrict Disclosed Deal Value to the 10 most recent
// disclosed deals only." The DISCLOSED DEAL VALUE KPI above stays as the headline
// sum; this panel is the required list. It reads disclosedDealRows — the fuller 50-row
// slice of the same already-loaded ENDPOINTS.transactions30 fetch (no new endpoint) and:
//   1. keeps only DISCLOSED deals — a positive transaction value on file, the same
//      amountValue gate DealIntelligencePanel sorts by, so "Not disclosed" rows drop out;
//   2. orders by transaction date, newest first (recordDateValue: closed_at → announced_at);
//   3. takes the top 10.
// Honest scope: the source window is the loaded rows only, so if fewer than 10 of them
// are disclosed the panel shows every disclosed deal it has (up to 10) and never pads
// with undisclosed rows. Each deal links to its swfi.com transaction record exactly like
// every other deal link on this page (dashboardTransactionHref + sourceHref).
function MostRecentDisclosedDeals({ rows: sourceRows }: { rows: Record<string, unknown>[] }) {
  const deals = [...sourceRows]
    .filter((row) => amountValue(row) > 0)
    .sort((a, b) => recordDateValue(b) - recordDateValue(a))
    .slice(0, 10);
  return (
    <VisualPanel title="Most Recent Disclosed Deals" source={ENDPOINTS.transactions30} empty={DASHBOARD_EMPTY} hasRows={deals.length > 0}>
      <div className="grid gap-1.5 sm:grid-cols-2">
        {deals.map((row, index) => (
          <DataLink
            key={`${brdText(row.title || row.name)}-${index}`}
            href={dashboardTransactionHref(row)}
            sourceHref={sourceHref(row)}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-2 rounded-[5px] border border-[#E5EBF1] bg-[#F8FAFC] px-2.5 py-2 text-inherit no-underline hover:bg-white"
          >
            <span className="min-w-0">
              <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
              <span className="mt-0.5 block truncate text-[11px] text-[#7B8996]">{brdText(row.buyer_entity || row.institution, "Not disclosed")}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="block text-[12px] font-extrabold text-[#13283D]">{cleanMoney(row.amount_display || row.capital_display || row.amount)}</span>
              <span className="mt-0.5 block text-[11px] text-[#7B8996]">{recordDate(row)}</span>
            </span>
          </DataLink>
        ))}
      </div>
    </VisualPanel>
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

type CapitalCuriosity = {
  sector: string;
  href: string;
  detail: string;
  metric: string;
  signalCount: number;
  latestMs: number;
  flowCount: number;
};

function rowMatchesTerm(row: Record<string, unknown>, fields: string[], term: string): boolean {
  const cleanTerm = term.trim().toLowerCase();
  if (!cleanTerm) return false;
  return fields.map((field) => brdText(row[field], "")).join(" ").toLowerCase().includes(cleanTerm);
}

function capitalCuriosityRows({
  sectorRows,
  marketRows,
  fundraisingRows,
  newsRows,
}: {
  sectorRows: Record<string, unknown>[];
  marketRows: Record<string, unknown>[];
  fundraisingRows: Record<string, unknown>[];
  newsRows: Record<string, unknown>[];
}): CapitalCuriosity[] {
  return sectorRows
    .map((sectorRow) => {
      const sector = brdText(sectorRow.name || sectorRow.value, "");
      if (!sector) return null;
      const dealMatches = marketRows.filter((row) => rowMatchesTerm(row, ["sector", "industry"], sector));
      const mandateMatches = fundraisingRows.filter((row) => rowMatchesTerm(row, ["strategy", "asset_class_or_strategy", "title", "name"], sector));
      const newsMatches = newsRows.filter((row) => rowMatchesTerm(row, ["title", "name", "excerpt", "summary"], sector));
      const flowCount = numericSortValue(brdText(sectorRow.count, "")) || 0;
      const latest = dealMatches.slice().sort((a, b) => recordDateValue(b) - recordDateValue(a))[0];
      const latestMs = latest ? recordDateValue(latest) : 0;
      const signalCount = [
        flowCount > 0,
        dealMatches.length > 0,
        mandateMatches.length > 0,
        newsMatches.length > 0,
      ].filter(Boolean).length;
      if (!signalCount) return null;
      const parts = [
        `${signalCount}/4 source lanes`,
        `${compactNumber(flowCount)} sector-flow records`,
        `${dealMatches.length} loaded deals`,
        mandateMatches.length ? `${mandateMatches.length} open mandates` : "",
        newsMatches.length ? `${newsMatches.length} intelligence mentions` : "",
      ].filter(Boolean);
      return {
        sector,
        href: `/deals/?filter=${encodeURIComponent(sector)}`,
        detail: latest ? `${parts.join(" · ")} · latest: ${brdText(latest.title || latest.name)} (${recordDate(latest)})` : parts.join(" · "),
        metric: `${signalCount}/4`,
        signalCount,
        latestMs,
        flowCount,
      };
    })
    .filter((row): row is CapitalCuriosity => Boolean(row))
    .sort((a, b) => b.signalCount - a.signalCount || b.latestMs - a.latestMs || b.flowCount - a.flowCount || a.sector.localeCompare(b.sector));
}

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

function dashboardMetricCards(
  packets: Packets,
  topAumRows: Record<string, unknown>[],
  sectorRows: Record<string, unknown>[],
  topAumState: AumRankingState,
  activeAllocators: number,
  allocatorCountState: AllocatorState,
) {
  const totalAum = totalAumValue(packets.top20, topAumRows);
  const sectorCapital = sumNumbers(sectorRows.map(sectorValue));
  const rfps = metricNumber(packets.metrics, "rfps") || packetCountNumber(packets.rfps) || 0;
  const swfs = metricNumber(packets.metrics, "swfs") || 0;
  const research = metricNumber(packets.metrics, "news") || packetCountNumber(packets.news) || 0;
  // Pending ≠ absent: while a card's backing packet has not resolved yet,
  // say "Loading…" — "Not disclosed" is reserved for loaded-but-undisclosable
  // (a fetched packet whose value cannot be honestly shown).
  const LOADING_LABEL = "Loading…";
  const settled = (packet: Packet | undefined, display: string) => (packet === undefined ? LOADING_LABEL : display);
  return [
    {
      label: "TOP-RANKED AUM TOTAL",
      value: topAumState === "pending" ? LOADING_LABEL : topAumState === "ready" ? totalAumDisplay(packets.top20, topAumRows) : topAumState === "empty" ? "0" : "Unavailable",
      note: "Top AUM ranking",
      href: "/profiles/?entity_type=Sovereign%20Wealth%20Fund",
      // Rank-order AUM values are a distribution, not a time series — drawn
      // as a line they read as a downtrend that never happened (minutes F).
      series: [],
      color: "#0A66C2",
      statusLabel: topAumState === "invalid" || topAumState === "unavailable" ? "Source blocked" : topAumState === "ready" && !totalAum ? "Not disclosed" : "",
      sourceLabel: topAumState,
      explain: "Sum of comparable USD AUM for the currently loaded top-ranked active sovereign wealth funds; this is not a date count. Shown only when the source proves active scope, canonical identities, stable rank order, comparable currency, and FX provenance. Click → active Sovereign Wealth Fund records; the directory does not preserve ranking order.",
    },
    {
      label: "ACTIVE ALLOCATORS",
      value: allocatorCountState === "pending" ? LOADING_LABEL : allocatorCountState === "ready" ? compactNumber(activeAllocators) : allocatorCountState === "empty" ? "0" : "Unavailable",
      note: "Last 90 days",
      href: "/allocators",
      series: seriesFromNumbers([activeAllocators]),
      color: "#16538C",
      statusLabel: allocatorCountState === "invalid" || allocatorCountState === "unavailable" ? "Source blocked" : "",
      sourceLabel: allocatorCountState,
      explain: "Distinct resolved active buyer/acquirer entities with completed transactions in the last 90 days. The count is verified independently from the loaded row preview. Click → the active allocators list.",
    },
    {
      label: "DISCLOSED DEAL VALUE",
      value: settled(packets.sectorFlows ?? packets.metrics, sectorCapital ? compactMoney(sectorCapital) : metricCard(packets.metrics, "transactions")),
      note: "Market activity",
      href: "/deals",
      // Per-sector totals are a distribution across sectors, not a trend.
      series: [],
      color: "#5C9BD6",
      explain: "Sum of disclosed transaction values in the loaded records (undisclosed deals excluded). Click → deals.",
    },
    {
      label: "LIVE RFPS / MANDATES",
      value: settled(packets.metrics ?? packets.rfps, rfps ? compactNumber(rfps) : "Not disclosed"),
      note: "Live RFPs",
      href: "/mandates",
      series: seriesFromNumbers([rfps]),
      color: "#7A8A9B",
      explain: "Open requests-for-proposal and mandates currently live on SWFI. Click → the RFPs list.",
    },
    {
      label: "SWF PROFILES",
      value: settled(packets.metrics, swfs ? compactNumber(swfs) : "Not disclosed"),
      note: "SWF profiles",
      href: "/profiles/?filter=Sovereign%20Wealth%20Fund&entity_type=Sovereign%20Wealth%20Fund",
      series: seriesFromNumbers([swfs]),
      color: "#B90D12",
      explain: "Sovereign wealth fund profiles tracked on SWFI. Click → SWF-filtered institutions.",
    },
    {
      label: "INTELLIGENCE ITEMS",
      value: settled(packets.metrics ?? packets.news, research ? compactNumber(research) : packetCount(packets.news, "count")),
      note: "Intelligence items",
      href: "/intelligence",
      series: seriesFromNumbers([research]),
      color: "#2C78D2",
      explain: "Published SWFI intelligence articles and research items. Click → the intelligence list.",
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

function MiniSparkline({ series, color, large = false }: { series: number[]; color: string; large?: boolean }) {
  const values = seriesFromNumbers(series);
  if (values.length < 2) return null; // no data -> no line (nothing fabricated)
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

function TotalAumInsightDetail({ topRows, institutionTypeRows, transactionRows, rfpRows, sectorRows }: {
  topRows: Record<string, unknown>[];
  institutionTypeRows: Record<string, unknown>[];
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}) {
  const typeRows = institutionTypeRows.slice(0, 6);
  const countryRows = groupedCountRows(topRows, (row) => brdText(row.country, "")).slice(0, 6);
  const fundraisingRows = rfpRows.slice(0, 5);
  const trendRows = sectorRows.slice(0, 6);
  const maxTrend = Math.max(1, ...trendRows.map(sectorValue));
  return (
    <div className="grid gap-3 xl:grid-cols-2">
      <VisualPanel title="Institutions by Entity Type" source={ENDPOINTS.institutionTypes} empty={DASHBOARD_EMPTY} hasRows={typeRows.length > 0}>
        <div className="grid gap-2">
          {typeRows.map((row) => (
            <div key={brdText(row.name || row.type)} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-bold text-[#203448]">{brdText(row.name || row.type)}</span>
                <span className="font-extrabold text-[#0A3A7A]">{compactNumber(numericSortValue(text(row.count, "")) ?? 0)}</span>
              </div>
              <Bar value={numericSortValue(text(row.count, "")) ?? 0} max={numericSortValue(text(typeRows[0]?.count, "")) || 1} />
            </div>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Country Coverage in Top AUM Ranking" source={ENDPOINTS.top20} empty={DASHBOARD_EMPTY} hasRows={countryRows.length > 0}>
        <div className="grid gap-2">
          {countryRows.map((row) => (
            <div key={row.label} className="grid gap-1">
              <div className="flex items-center justify-between gap-2 text-[12px]">
                <span className="truncate font-bold text-[#203448]">{row.label}</span>
                <span className="font-extrabold text-[#0A3A7A]">{compactNumber(row.value)}</span>
              </div>
              <Bar value={row.value} max={countryRows[0]?.value || 1} />
            </div>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Live RFPs & Opportunities" source={ENDPOINTS.rfps} empty={DASHBOARD_EMPTY} hasRows={fundraisingRows.length > 0}>
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
      <VisualPanel title="Investment Trends by Sector" source={ENDPOINTS.sectorFlows} empty={DASHBOARD_EMPTY} hasRows={trendRows.length > 0}>
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

function PipelineInsightDetail({ transactionRows, rfpRows, sectorRows }: {
  transactionRows: Record<string, unknown>[];
  rfpRows: Record<string, unknown>[];
  sectorRows: Record<string, unknown>[];
}) {
  const dealRows = [...transactionRows].sort((a, b) => amountValue(b) - amountValue(a)).slice(0, 5);
  const fundraisingRows = [...rfpRows].sort((a, b) => deadlineTime(a) - deadlineTime(b)).slice(0, 5);
  const trendRows = sectorRows.slice(0, 6);
  const maxDeal = Math.max(1, ...dealRows.map(amountValue));
  const maxTrend = Math.max(1, ...trendRows.map(sectorValue));
  return (
    <div className="grid gap-3 xl:grid-cols-3">
      <VisualPanel title="Largest Recent Deals" source={ENDPOINTS.transactions30} empty={DASHBOARD_EMPTY} hasRows={dealRows.length > 0}>
        <div className="grid gap-2">
          {dealRows.map((row, index) => {
            const value = amountValue(row);
            return (
              <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={dashboardTransactionHref(row)} sourceHref={sourceHref(row)} className="grid gap-1 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline">
                <span className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate font-bold text-[#0A3A7A]">{brdText(row.title || row.name)}</span>
                  <span className="shrink-0 font-extrabold text-[#41566B]">{cleanMoney(row.amount_display || row.capital_display || row.amount)}</span>
                </span>
                <Bar value={value} max={maxDeal} />
                <span className="text-[10.5px] text-[#7B8996]">{brdText(row.buyer_entity || row.institution)} · {brdText(row.sector || row.industry || row.category)}</span>
              </DataLink>
            );
          })}
        </div>
      </VisualPanel>
      <VisualPanel title="Live RFPs & Opportunities" source={ENDPOINTS.rfps} empty={DASHBOARD_EMPTY} hasRows={fundraisingRows.length > 0}>
        <div className="grid gap-2">
          {fundraisingRows.map((row, index) => (
            <DataLink key={`${brdText(row.title || row.name)}-${index}`} href={dashboardMandateHref(row)} sourceHref={sourceHref(row)} className="grid grid-cols-[minmax(0,1fr)_72px] gap-2 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline">
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-[#0A3A7A]">{brdText(row.institution || row.name)}</span>
                <span className="block truncate text-[10.5px] text-[#7B8996]">{brdText(row.strategy || row.asset_class_or_strategy || row.title)}</span>
              </span>
              <span className="text-right text-[11px] font-extrabold text-[#41566B]">{timelineDate(row)}</span>
            </DataLink>
          ))}
        </div>
      </VisualPanel>
      <VisualPanel title="Investment Trends by Sector" source={ENDPOINTS.sectorFlows} empty={DASHBOARD_EMPTY} hasRows={trendRows.length > 0}>
        <div className="grid gap-2">
          {trendRows.map((row, index) => {
            const value = sectorValue(row);
            return (
              <DataLink key={`${brdText(row.name || row.value)}-${index}`} href={`/deals/?filter=${encodeURIComponent(brdText(row.name || row.value, ""))}`} sourceHref={sourceHref(row)} className="grid gap-1 rounded-[5px] border border-[#E5EBF1] px-2 py-2 text-inherit no-underline">
                <span className="flex items-center justify-between gap-2 text-[12px]">
                  <span className="truncate font-bold text-[#0A3A7A]">{brdText(row.name || row.value)}</span>
                  <span className="shrink-0 font-extrabold text-[#41566B]">{capitalOrCountDisplay(row)}</span>
                </span>
                <Bar value={value} max={maxTrend} />
              </DataLink>
            );
          })}
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
      headers={["Headline", "Publisher", "Published", "Open"]}
      rows={sourceRows.map((row) => [researchCell(row), brdText(row.source), brdText(row.published_at || row.date, "Not disclosed"), sourceDetailCell("View details", sourceHref(row) || researchSourceUrl(row))])}
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
      headers={["Signal", "Record", "Metric", "Context"]}
      rows={insights.map((insight) => [
        insight.label,
        { label: insight.title, href: insight.href, sourceHref: insight.sourceHref, citationText: "View details" },
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
      <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#7B8996]">Top analytical view</div>
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

type CountryCapitalRow = {
  country: string;
  count: number;
  topRank: number;
  aum: number;
  aumCurrency: string;
  topName: string;
  topAum: number;
};

function countryCapitalRows(rowsToUse: Record<string, unknown>[]): CountryCapitalRow[] {
  const grouped = new Map<string, CountryCapitalRow>();
  // Per-country currency tracking: a country's AUM sum is only meaningful when
  // every contributing row shares one declared currency (same laundered-number
  // guard as the headline total — rows arrive in 12 native currencies).
  const currencies = new Map<string, string | null>();
  for (const row of rowsToUse) {
    const country = brdText(row.country, "");
    // 2026-07-06: the old map dropped any country without a hand-mapped
    // coordinate (14 hardcoded points) — every country in the data counts.
    if (!country) continue;
    const rank = numericSortValue(text(row.rank, "")) || Number.MAX_SAFE_INTEGER;
    const current = grouped.get(country) || {
      country,
      count: 0,
      topRank: rank,
      aum: 0,
      aumCurrency: "",
      topName: brdText(row.name, ""),
      topAum: 0,
    };
    const rowAum = aumValue(row);
    const rowCurrency = text(row.aum_currency, "").trim();
    const seen = currencies.get(country);
    if (seen === undefined) currencies.set(country, rowCurrency || null);
    else if (seen !== null && rowCurrency !== seen) currencies.set(country, null);
    current.count += 1;
    current.aum += rowAum;
    if (rank < current.topRank) {
      current.topRank = rank;
      current.topName = brdText(row.name, "");
    }
    if (rowAum > current.topAum) current.topAum = rowAum;
    grouped.set(country, current);
  }
  return [...grouped.values()]
    .map((node) => {
      const currency = currencies.get(node.country);
      // Mixed or undeclared currencies: zero the sum (row falls back to its
      // count; captions fall back to their no-AUM wording) instead of
      // shipping a cross-currency number.
      return currency ? { ...node, aumCurrency: currency } : { ...node, aum: 0, aumCurrency: "" };
    })
    .sort((a, b) => a.topRank - b.topRank || a.country.localeCompare(b.country));
}

function DonutGauge({ value }: { value: number }) {
  const safe = Math.max(0, Math.min(100, value));
  const circumference = 2 * Math.PI * 27;
  const dash = (safe / 100) * circumference;
  return (
    <svg viewBox="0 0 72 72" className="h-16 w-16 shrink-0" role="img" aria-label={`${safe}% largest sector share`}>
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
  // Currency guard (verified 2026-07-05): the top20 fact's total_assets spans
  // rows in 12 NATIVE currencies with no currency field and no FX data — a
  // raw cross-currency sum is numerically meaningless (Norway's 2T NOK alone
  // adds ~1.9T phantom "dollars"). Only trust a total that a single declared
  // currency backs; otherwise report nothing rather than a laundered number.
  if (isFact(packet)) {
    const data = packetData(packet);
    // Preferred: the backend's explicitly-USD total (doctrine amendment
    // 2026-07-05 — verified-USD snapshot per entity, summed in one currency).
    const usd = numberValue(data.total_assets_usd);
    if (usd) return usd;
    const direct = numberValue(data.total_assets || data.total_aum || data.aum_total);
    const currency = text(data.total_assets_currency || data.total_aum_currency || data.aum_total_currency, "").trim();
    if (direct && currency) return direct;
  }
  return commonAumCurrency(topRows) ? sumNumbers(topRows.map(aumValue)) : 0;
}

function totalAumDisplay(packet: Packet | undefined, topRows: Record<string, unknown>[]) {
  if (isFact(packet)) {
    const data = packetData(packet);
    // Preferred: explicitly-USD total from the doctrine-amended backend.
    const usd = numberValue(data.total_assets_usd);
    if (usd) return compactCurrency(usd, text(data.total_assets_usd_currency, "USD").trim().toUpperCase() || "USD");
    const direct = numberValue(data.total_assets || data.total_aum || data.aum_total);
    const currency = text(data.total_assets_currency || data.total_aum_currency || data.aum_total_currency, "").trim().toUpperCase();
    if (direct && currency) return compactCurrency(direct, currency);
    // No currency on the fact -> do NOT print a bare magnitude (the old
    // compactNumber branch rendered the undefined "16.9T" the client
    // repeatedly questioned). Fall through to the same-currency row total.
  }
  const total = sumNumbers(topRows.map(aumValue));
  const currency = commonAumCurrency(topRows);
  return total && currency ? compactCurrency(total, currency) : "Not disclosed";
}

function metricNumber(packet: Packet | undefined, key: string) {
  if (!packet || !isFact(packet)) return undefined;
  const data = packetData(packet) as Record<string, unknown> | undefined;
  const direct = numberValue(data?.[key]);
  if (direct != null) return direct;
  const cards = data?.cards;
  if (!cards || typeof cards !== "object" || Array.isArray(cards)) return undefined;
  const card = (cards as Record<string, unknown>)[key];
  if (!card || typeof card !== "object" || Array.isArray(card)) return undefined;
  return numberValue((card as Record<string, unknown>).value);
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

function aumCurrency(row: Record<string, unknown>) {
  return text(row.aum_currency || row.currency, "").trim().toUpperCase();
}

function commonAumCurrency(rowsToUse: Record<string, unknown>[]) {
  const currencies = new Set(rowsToUse
    .filter((row) => aumValue(row) > 0)
    .map(aumCurrency)
    .filter(Boolean));
  return currencies.size === 1 ? [...currencies][0] : "";
}

function sumNumbers(values: number[]) {
  return values.reduce((total, value) => total + (Number.isFinite(value) ? value : 0), 0);
}

function knownDistinctCount(values: unknown[]) {
  return new Set(values
    .map((value) => brdText(value, "").trim())
    .filter((value) => value && value !== "Not disclosed" && value !== SOURCE_GAP && value !== LOADING)).size;
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

function compactCurrency(value: number, currency: string) {
  if (!Number.isFinite(value) || !currency) return "Not disclosed";
  if (currency === "USD" || currency === "$") return compactMoney(value);
  return `${currency} ${compactNumber(value)}`;
}

function capitalOrCountDisplay(row: Record<string, unknown>) {
  const capital = compactMoneyDisplay(row.capital_display || row.capital_deployed || row.capital);
  if (capital !== "Not disclosed") return capital;
  const countValue = numericSortValue(text(row.count, ""));
  return countValue ? `${countValue.toLocaleString("en-US")} transactions` : "Not disclosed";
}

function seriesFromNumbers(values: number[]) {
  const clean = values.filter((value) => Number.isFinite(value) && value > 0);
  if (clean.length >= 2) return clean.slice(0, 8);
  // Never fabricate a line: the old [seed, seed] fallback drew a flat
  // sparkline even when there was NO data (seed defaulted to a literal 10).
  // Minutes F: no chart may exist unless it means something.
  return [];
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
  const source = sourceHref(row) || researchSourceUrl(row);
  if (source) return source;
  return dashboardSearchFallback(row, "/intelligence");
}

async function loadDashboardPackets(onPacket: (key: PacketKey, packet: Packet) => void, signal: AbortSignal) {
  for (const keys of [DASHBOARD_PRIMARY_LOAD_ORDER, DASHBOARD_SECONDARY_LOAD_ORDER]) {
    await Promise.all(keys.map(async (key) => {
      const packet = await fetchPacket(ENDPOINTS[key], dashboardTimeout(key), { attempts: dashboardAttempts(key), signal });
      onPacket(key, packet);
    }));
    if (signal.aborted) return;
  }
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

function institutionTypeFacetRows(packet?: Packet) {
  return factRows(packet)
    .map((row) => {
      const label = brdText(row.name || row.type || row.entity_type, "");
      const value = numericSortValue(text(row.count, "")) ?? 0;
      return {
        ...row,
        name: label,
        type: label,
        count: value,
      };
    })
    .filter((row) => row.name && row.count > 0);
}

function dataAsOfLabelFor(packet?: Packet) {
  const provenance = packet?.provenance && typeof packet.provenance === "object" && !Array.isArray(packet.provenance)
    ? packet.provenance as Record<string, unknown>
    : {};
  const value = text(packet?.generated_at || provenance.fetched_at, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "Data as of latest SWFI update";
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
  const value = metricNumber(packet, key);
  return typeof value === "number" ? value.toLocaleString("en-US") : "Not disclosed";
}

function VisualPanel({ title, source, empty, hasRows, children }: { title: string; source: string; empty: string; hasRows: boolean; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded border border-[#DCE3EA] bg-white p-3">
      <div className="mb-2.5">
        <div className="text-[13px] font-bold tracking-[0.07em] text-[#41566B]">{title}</div>
        <span hidden data-source-path={source} />
      </div>
      {hasRows ? children : <div className="rounded-[5px] bg-[#F8FAFC] px-2.5 py-2 text-[12px] font-semibold text-[#5F6E7E]">{empty}</div>}
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

function recordDateValue(row: Record<string, unknown>) {
  // Sortable transaction timestamp, same field precedence as recordDate() below.
  // Undated rows return 0 so they sink to the bottom of a most-recent-first sort.
  const value = text(row.latest_transaction_date || row.activity_date || row.relevant_date || row.closed_at || row.announced_at || row.deadline || row.due_at || row.published_at || row.updated_at || row.last_updated || row.created_at || row.date, "");
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function recordDate(row: Record<string, unknown>) {
  const value = text(row.latest_transaction_date || row.activity_date || row.relevant_date || row.closed_at || row.announced_at || row.deadline || row.due_at || row.published_at || row.updated_at || row.last_updated || row.created_at || row.date, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return brdText(value, "Not disclosed");
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(parsed));
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
  const numeric = numericSortValue(text(row.aum_usd, ""));
  if (numeric == null) return "Not disclosed";
  return `$${compactNumber(numeric)}`;
}

function aumDateDisplay(row: Record<string, unknown>) {
  const value = text(row.aum_date, "");
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return "AUM date not disclosed";
  return `AUM as of ${new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(parsed))}`;
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

function researchSourceUrl(row: Record<string, unknown>): string {
  const legacy = text(row.legacy_post || row.legacy_post_id || row.post_id || row.wordpress_id || (String(row.id || "").match(/^\d+$/) ? row.id : ""), "");
  return legacy ? `https://www.swfi.com/?p=${encodeURIComponent(legacy)}` : "";
}

function dashboardProfileHref(row: Record<string, unknown>): string {
  const entityId = text(row.entity_id || row.entityID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || entitySourceUrl(entityId);
  return source || dashboardSearchFallback(row, "/profiles");
}

function dashboardTransactionHref(row: Record<string, unknown>): string {
  const transactionId = text(row.transaction_id || row.transactionID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || transactionSourceUrl(transactionId);
  return source || dashboardSearchFallback(row, "/deals");
}

function dashboardMandateHref(row: Record<string, unknown>): string {
  const mandateId = text(row.compass_id || row.mandate_id || row.rfp_id || row.source_record_id || row.id, "");
  const source = sourceHref(row) || mandateSourceUrl(mandateId);
  return source || dashboardSearchFallback(row, "/mandates");
}

function dashboardPersonHref(row: Record<string, unknown>): string {
  const personId = text(row.person_id || row.personID || row.source_record_id || row.id, "");
  const source = sourceHref(row) || personSourceUrl(personId);
  return source || dashboardSearchFallback(row, "/people");
}

function dashboardSearchFallback(row: Record<string, unknown>, fallback: string): string {
  const query = brdText(row.name || row.title || row.institution || row.buyer_entity, "");
  return query ? `/search/?q=${encodeURIComponent(query)}` : fallback;
}

function dealCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: dashboardTransactionHref(row),
    sourceHref: source,
    citationText: "View details",
  };
}

function mandateCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: dashboardMandateHref(row),
    sourceHref: source,
    citationText: "View details",
  };
}

function researchCell(row: Record<string, unknown>): Cell {
  const source = sourceHref(row);
  return {
    label: brdText(row.title || row.name),
    href: researchRecordHref(row),
    sourceHref: source,
    citationText: "View details",
  };
}

function sourceDetailCell(label: string, href?: string): Cell {
  const provenance = href ? sourceProvenanceHref(href) : undefined;
  if (!provenance) return label;
  return { label, href: provenance, sourceHref: provenance, citationText: "View details" };
}

function cellText(cell: Cell): string {
  return cleanDisplayValue(typeof cell === "string" ? cell : cell.label);
}

function rankingMetricValue(row: Cell[]) {
  const amount = numericSortValue(cellText(row[1]));
  if (amount && amount > 0) return amount;
  const countValue = numericSortValue(cellText(row[2]));
  return countValue && countValue > 0 ? countValue : 0;
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
      {hasSource ? <span className="text-[10.5px] leading-tight text-[#7A8A9B]">{cell.citationText || "View details"}</span> : null}
    </span>
  );
}

function DataLink({ href, sourceHref, className, style, children }: { href: string; sourceHref?: string; className: string; style?: CSSProperties; children: React.ReactNode }) {
  const target = href;
  const provenance = sourceHref || sourceProvenanceHref(href);
  const recordLink = isCanonicalSwfiRecordHref(href);
  return <DashboardLink href={target} title={provenance ? "View details" : undefined} data-record-link={recordLink ? "true" : undefined} data-source-state={provenance ? "on-file" : undefined} className={className} style={style}>{children}</DashboardLink>;
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
    citationText: "View details",
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
    citationText: "View details",
  };
}

function sectorCell(row: Record<string, unknown>): Cell {
  const label = brdText(row.name || row.value);
  return {
    label,
    href: `/deals/?filter=${encodeURIComponent(label)}`,
    citationText: "View details",
  };
}
