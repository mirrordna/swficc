"use client";

import { useEffect, useMemo, useState } from "react";
import SavedSearchManager from "@/components/SavedSearchManager";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, money, packetReason, rows, text } from "@/lib/sourcePackets";
import { appHref, isSwfiPlatformRecordHref, selfContainedHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { businessSearchQueryVariants, dedupeSearchRecords, mergeSearchRecordsPreferPrimary, rankSearchRecords } from "@/lib/searchRelevance";
import { filterSmartSearchIntentRows, smartSearchIntentForQuery } from "@/lib/smartSearchIntent";
import { entityLifecycleIntent } from "@/lib/entityLifecycle";
import { isShortTextQuery, isTextQueryReady, MIN_TEXT_QUERY_CHARACTERS } from "@/lib/textQueryPolicy";
import { balanceSearchResultRows, searchResultCategoryCounts, searchResultRecordType } from "@/lib/searchResultPresentation";

const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
const SEARCH_CATEGORIES = ["all", "entities", "opportunities", "transactions", "news", "people"] as const;
type SearchCategory = (typeof SEARCH_CATEGORIES)[number];
type CategorizedSearchRow = Record<string, unknown> & { __searchCategory: Exclude<SearchCategory, "all"> };
type SearchFilterKey = "geography" | "recordType" | "transactionType" | "buyer" | "seller" | "sector" | "strategy" | "source" | "institution" | "role";
type SearchFilters = Record<SearchFilterKey, string>;
type SearchFilterDefinition = { key: SearchFilterKey; label: string; allLabel: string };

const EMPTY_SEARCH_FILTERS: SearchFilters = {
  geography: "",
  recordType: "",
  transactionType: "",
  buyer: "",
  seller: "",
  sector: "",
  strategy: "",
  source: "",
  institution: "",
  role: "",
};

function searchPrefetchCacheKey(query: string): string {
  return `${SEARCH_PREFETCH_CACHE_PREFIX}${query.trim().toLowerCase()}`;
}

function queryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.trim() || "";
}

function categoryFromUrl(): SearchCategory {
  if (typeof window === "undefined") return "all";
  const value = new URLSearchParams(window.location.search).get("category")?.trim().toLowerCase() || "all";
  return SEARCH_CATEGORIES.includes(value as SearchCategory) ? value as SearchCategory : "all";
}

function cachedPacket(query: string): Packet | null {
  if (typeof window === "undefined" || !query) return null;
  try {
    const raw = window.sessionStorage.getItem(searchPrefetchCacheKey(query));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { query?: string; stored_at?: number; packet?: Packet };
    if (String(parsed.query || "").trim().toLowerCase() !== query.trim().toLowerCase()) return null;
    if (!parsed.stored_at || Date.now() - parsed.stored_at > 60_000) return null;
    if (!parsed.packet || parsed.packet.prefetch_only !== true || parsed.packet.fact !== false) return null;
    const previewRows = packetRows(parsed.packet);
    const sourceBound = previewRows.length > 0 && previewRows.every((row) => sourceHref(row).startsWith("https://www.swfi.com/"));
    return sourceBound ? parsed.packet : null;
  } catch {
    return null;
  }
}

export default function SearchResultsPage() {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<SearchCategory>("all");
  const [packet, setPacket] = useState<Packet | null>(null);
  const [entityPackets, setEntityPackets] = useState<Packet[]>([]);
  const [transactionPacket, setTransactionPacket] = useState<Packet | null>(null);
  const [peoplePacket, setPeoplePacket] = useState<Packet | null>(null);
  const [opportunityPackets, setOpportunityPackets] = useState<Packet[]>([]);
  const [newsPacket, setNewsPacket] = useState<Packet | null>(null);
  const [intentPackets, setIntentPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchIssue, setSearchIssue] = useState("");
  const [retryKey, setRetryKey] = useState(0);
  const [rowLimit, setRowLimit] = useState(10);
  const [allCategoryLimit, setAllCategoryLimit] = useState(5);
  const [sortKey, setSortKey] = useState<"relevance" | "type" | "result" | "source" | "detail">("relevance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [searchFilters, setSearchFilters] = useState<SearchFilters>(() => ({ ...EMPTY_SEARCH_FILTERS }));

  useEffect(() => {
    const currentQuery = queryFromUrl();
    const queryReady = isTextQueryReady(currentQuery);
    const lifecycleIntent = entityLifecycleIntent(currentQuery);
    const currentCategory = categoryFromUrl();
    const recognizedIntent = queryReady && !lifecycleIntent.explicitDefunctRequest ? smartSearchIntentForQuery(currentQuery) : null;
    const currentIntent = recognizedIntent && (currentCategory === "all" || currentCategory === recognizedIntent.category)
      ? recognizedIntent
      : null;
    const cached = !queryReady || currentIntent || lifecycleIntent.explicitDefunctRequest || currentCategory !== "all"
      ? null
      : cachedPacket(currentQuery);
    let active = true;
    const controller = new AbortController();
    const resetTimer = window.setTimeout(() => {
      if (!active) return;
      setQuery(currentQuery);
      setCategory(currentCategory);
      setSearchIssue("");
      setIntentPackets([]);
      setPacket(cached);
      setEntityPackets([]);
      setTransactionPacket(null);
      setPeoplePacket(null);
      setOpportunityPackets([]);
      setNewsPacket(null);
      setLoading(queryReady && !cached);
    }, 0);
    if (!queryReady) {
      return () => {
        active = false;
        window.clearTimeout(resetTimer);
        controller.abort();
      };
    }
    const shouldSearchPublic = !currentIntent
      && !lifecycleIntent.explicitDefunctRequest
      && (currentCategory === "all" || currentCategory === "entities" || currentCategory === "transactions");
    const publicSearch: Promise<Packet | null> = shouldSearchPublic
      ? fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(currentQuery)}&limit=100`, 20_000, {
        signal: controller.signal,
        attempts: 2,
      }).then((nextPacket) => {
        if (!active) return nextPacket;
        if (isFact(nextPacket)) {
          setPacket((currentPacket) => (
            packetRows(nextPacket).length > 0 || !currentPacket || packetRows(currentPacket).length === 0
              ? nextPacket
              : currentPacket
          ));
          const hasVisibleCategory = currentCategory === "all"
            || currentCategory === "entities"
            || packetRows(nextPacket).some((row) => inferSearchCategory(row) === currentCategory);
          if (hasVisibleCategory) setLoading(false);
        }
        return nextPacket;
      })
      : Promise.resolve(null);
    const sourceVariants = lifecycleIntent.sourceQuery ? businessSearchQueryVariants(lifecycleIntent.sourceQuery) : [""];
    const lifecycleQuery = lifecycleIntent.explicitDefunctRequest ? "&entity_status=defunct" : "";
    const shouldSearchEntities = !currentIntent
      && (lifecycleIntent.explicitDefunctRequest || currentCategory === "all" || currentCategory === "entities" || currentCategory === "transactions");
    const entitySearch = shouldSearchEntities
      ? Promise.all(sourceVariants.map((variant) => (
        fetchPacket(`/api/source-data/search/v1?collection=entities${variant ? `&q=${encodeURIComponent(variant)}` : ""}${lifecycleQuery}&limit=100`, 25_000, {
          signal: controller.signal,
          attempts: 2,
        })
      ))).then((nextPackets) => {
      const factPackets = nextPackets.filter(isFact);
      if (active) {
        setEntityPackets(factPackets);
        if (lifecycleIntent.explicitDefunctRequest && factPackets.length) setLoading(false);
      }
      return factPackets;
    }).catch(() => {
      if (active) setEntityPackets([]);
      return [] as Packet[];
    })
      : Promise.resolve([] as Packet[]);

    const peopleSearch = !currentIntent && !lifecycleIntent.explicitDefunctRequest && (currentCategory === "all" || currentCategory === "people")
      ? fetchPacket(`/api/people/search/v1?q=${encodeURIComponent(currentQuery)}&limit=100`, 25_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((nextPacket) => {
          if (active && isFact(nextPacket)) {
            setPeoplePacket(nextPacket);
            setLoading(false);
          }
          return nextPacket;
        }).catch(() => null)
      : Promise.resolve(null);

    const opportunitySearch = !currentIntent && !lifecycleIntent.explicitDefunctRequest && (currentCategory === "all" || currentCategory === "opportunities")
      ? Promise.all([
          fetchPacket("/api/live-opportunities/v1?limit=100&page=1", 25_000, {
            signal: controller.signal,
            attempts: 2,
          }),
          fetchPacket("/api/live-mandates/v1?limit=100&page=1", 25_000, {
            signal: controller.signal,
            attempts: 2,
          }),
        ]).then((nextPackets) => {
          const factPackets = nextPackets.filter(isFact);
          if (active) {
            setOpportunityPackets(factPackets);
            if (factPackets.length) setLoading(false);
          }
          return factPackets;
        }).catch(() => {
          if (active) setOpportunityPackets([]);
          return [] as Packet[];
        })
      : Promise.resolve([] as Packet[]);

    const newsSearch = !currentIntent && !lifecycleIntent.explicitDefunctRequest && (currentCategory === "all" || currentCategory === "news")
      ? fetchPacket("/api/source-intelligence/news/v1?limit=100", 25_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((nextPacket) => {
          if (active && isFact(nextPacket)) {
            setNewsPacket(nextPacket);
            setLoading(false);
          }
          return nextPacket;
        }).catch(() => null)
      : Promise.resolve(null);

    const transactionSearch = !currentIntent && !lifecycleIntent.explicitDefunctRequest && (currentCategory === "all" || currentCategory === "transactions")
      ? Promise.all([publicSearch, entitySearch]).then(async ([publicPacket, nextEntityPackets]) => {
          if (!active) return null;
          const entityName = resolvedEntityName(currentQuery, publicPacket, nextEntityPackets);
          if (!entityName) return null;
          const nextPacket = await fetchPacket(`/api/entity-transactions/v1?name=${encodeURIComponent(entityName)}&limit=100`, 25_000, {
            signal: controller.signal,
            attempts: 2,
          }).catch(() => null);
          if (active && nextPacket && isFact(nextPacket)) {
            setTransactionPacket(nextPacket);
            setLoading(false);
          }
          return nextPacket;
        })
      : Promise.resolve(null);

    // The real allocator-activity source currently completes in roughly 25-45s.
    // Aborting it at 25s and retrying four times guarantees churn without ever
    // allowing a valid response to reach the UI.
    const intentTimeoutMs = currentIntent?.id === "active-investors" ? 70_000 : 25_000;
    const intentAttempts = currentIntent?.id === "active-investors" ? 2 : 4;
    const intentSearch = currentIntent
      ? Promise.all(currentIntent.requests.map((request) => (
          fetchPacket(request.endpoint, intentTimeoutMs, { signal: controller.signal, attempts: intentAttempts })
        ))).then((nextPackets) => {
          const factPackets = nextPackets.filter(isFact);
          if (active) {
            setIntentPackets(factPackets);
            if (factPackets.length) setLoading(false);
            const transportFailures = nextPackets
              .map(packetReason)
              .filter((reason) => /^(?:backend_fetch_|backend_http_5|frontend_fetch_)/.test(reason));
            if (transportFailures.length && !factPackets.length) {
              setSearchIssue("The search connection was interrupted before results arrived.");
            } else if (transportFailures.length) {
              setSearchIssue("Some search sources were interrupted; the visible results may be partial.");
            }
          }
          return factPackets;
        }).catch(() => {
          if (active) {
            setIntentPackets([]);
            setSearchIssue("The search connection was interrupted before results arrived.");
          }
          return [] as Packet[];
        })
      : Promise.resolve([] as Packet[]);

    void Promise.allSettled([publicSearch, entitySearch, peopleSearch, opportunitySearch, newsSearch, transactionSearch, intentSearch]).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      window.clearTimeout(resetTimer);
      controller.abort();
    };
  }, [retryKey]);

  const allResultRows = useMemo(() => {
    if (!isTextQueryReady(query)) return [];
    const lifecycleIntent = entityLifecycleIntent(query);
    const relevanceQuery = lifecycleIntent.sourceQuery || query;
    const recognizedIntent = lifecycleIntent.explicitDefunctRequest ? null : smartSearchIntentForQuery(query);
    const interpretedIntent = recognizedIntent && (category === "all" || category === recognizedIntent.category)
      ? recognizedIntent
      : null;
    const intentRows = interpretedIntent
      ? filterSmartSearchIntentRows(interpretedIntent, intentPackets.flatMap((intentPacket) => packetRows(intentPacket)))
        .map((row) => categorizedSearchRow(row, interpretedIntent.category))
      : [];
    const intentEntities = intentRows.filter((row) => row.__searchCategory === "entities");
    const intentTransactions = intentRows.filter((row) => row.__searchCategory === "transactions");
    const intentOpportunities = intentRows.filter((row) => row.__searchCategory === "opportunities");
    const publicRows = packetRows(packet).map((row) => categorizedSearchRow(row));
    const publicEntities = publicRows.filter((row) => row.__searchCategory === "entities");
    const entityRows = entityPackets
      .flatMap((entityPacket) => packetRows(entityPacket))
      .map((row) => categorizedSearchRow(row, "entities"));
    const entities = dedupeSearchRecords([
      ...intentEntities,
      ...mergeSearchRecordsPreferPrimary(publicEntities, entityRows, relevanceQuery, "entity"),
    ]);
    const matchedEntityName = transactionPacketEntityName(transactionPacket);
    const joinedTransactions = packetRows(transactionPacket).map((row) => ({
      ...categorizedSearchRow(row, "transactions"),
      __searchEntityName: matchedEntityName,
    }));
    const publicTransactions = rankSearchRecords(
      publicRows.filter((row) => row.__searchCategory === "transactions"),
      query,
      "transaction",
    );
    // The entity-transactions endpoint is already an exact entity-reference join and
    // returns newest-first rows. Do not text-filter those records by the acronym again:
    // many rows carry the entity only as a backend reference plus `role=Buyer`.
    const transactions = dedupeSearchRecords([...intentTransactions, ...joinedTransactions, ...publicTransactions]);
    const people = rankSearchRecords(dedupeSearchRecords([
      ...packetRows(peoplePacket).map((row) => categorizedSearchRow(row, "people")),
      ...publicRows.filter((row) => row.__searchCategory === "people"),
    ]), query, "person");
    const keywordOpportunities = rankSearchRecords(dedupeSearchRecords([
      ...opportunityPackets.flatMap((opportunityPacket) => packetRows(opportunityPacket)).map((row) => categorizedSearchRow(row, "opportunities")),
      ...publicRows.filter((row) => row.__searchCategory === "opportunities"),
    ]), query, "rfp");
    const opportunities = dedupeSearchRecords([...intentOpportunities, ...keywordOpportunities]);
    const news = rankSearchRecords(dedupeSearchRecords([
      ...packetRows(newsPacket).map((row) => categorizedSearchRow(row, "news")),
      ...publicRows.filter((row) => row.__searchCategory === "news"),
    ]), query, "news");

    return dedupeSearchRecords([...entities, ...transactions, ...opportunities, ...news, ...people]);
  }, [category, entityPackets, intentPackets, newsPacket, opportunityPackets, packet, peoplePacket, query, transactionPacket]);
  const resultRows = useMemo(() => (
    category === "all"
      ? allResultRows
      : allResultRows.filter((row) => (row as CategorizedSearchRow).__searchCategory === category)
  ), [allResultRows, category]);
  const filterDefinitions = useMemo(() => searchFilterDefinitions(category), [category]);
  const filterOptions = useMemo(() => Object.fromEntries(
    filterDefinitions.map((definition) => [definition.key, searchFilterOptions(resultRows, definition.key)]),
  ) as Partial<Record<SearchFilterKey, string[]>>, [filterDefinitions, resultRows]);
  const availableFilterDefinitions = useMemo(() => filterDefinitions.filter(
    (definition) => (filterOptions[definition.key] || []).length > 0,
  ), [filterDefinitions, filterOptions]);
  const filteredResultRows = useMemo(() => resultRows.filter((row) => (
    filterDefinitions.every((definition) => {
      const selected = searchFilters[definition.key];
      if (!selected) return true;
      return searchRowFilterValues(row as CategorizedSearchRow, definition.key)
        .some((value) => value.localeCompare(selected, undefined, { sensitivity: "base" }) === 0);
    })
  )), [filterDefinitions, resultRows, searchFilters]);
  const activeFilterCount = filterDefinitions.filter((definition) => searchFilters[definition.key]).length;
  const interpretedIntent = useMemo(() => {
    if (!isTextQueryReady(query)) return null;
    const lifecycle = entityLifecycleIntent(query);
    const intent = lifecycle.explicitDefunctRequest ? null : smartSearchIntentForQuery(query);
    return intent && (category === "all" || category === intent.category) ? intent : null;
  }, [category, query]);
  const sortedRows = useMemo(() => sortSearchRows(filteredResultRows, sortKey, sortDir), [filteredResultRows, sortDir, sortKey]);
  const visibleRows = category === "all"
    ? balanceSearchResultRows(sortedRows as CategorizedSearchRow[], allCategoryLimit)
    : sortedRows.slice(0, rowLimit);
  const categoryCounts = useMemo(() => searchResultCategoryCounts(allResultRows as CategorizedSearchRow[]), [allResultRows]);
  const count = filteredResultRows.length;
  const unfilteredCount = resultRows.length;
  const lifecycleIntent = entityLifecycleIntent(query);
  const queryShort = isShortTextQuery(query);
  const showingText = isTextQueryReady(query)
    ? `Showing ${visibleRows.length.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}${activeFilterCount ? ` (${unfilteredCount.toLocaleString("en-US")} before filters)` : ""}`
    : queryShort ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters` : "Awaiting search";
  function changeSort(nextKey: typeof sortKey) {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  }

  function changeCategory(nextCategory: SearchCategory) {
    setCategory(nextCategory);
    setSortKey("relevance");
    setSortDir("asc");
    setSearchIssue("");
    setPacket(null);
    setEntityPackets([]);
    setTransactionPacket(null);
    setPeoplePacket(null);
    setOpportunityPackets([]);
    setNewsPacket(null);
    setIntentPackets([]);
    setSearchFilters({ ...EMPTY_SEARCH_FILTERS });
    setLoading(isTextQueryReady(query));
    const params = new URLSearchParams(window.location.search);
    if (nextCategory === "all") params.delete("category");
    else params.set("category", nextCategory);
    const nextQuery = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
    setRetryKey((current) => current + 1);
  }

  return (
    <div className="min-h-screen bg-[#F2F4F6] font-sans text-[#1B2733]">
      <SwfiBrandHeader searchId="global-swfi-search" searchDefaultValue={query} />
      <main
        className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]"
        data-search-results-query={query.trim().toLowerCase()}
        data-search-results-ready={isTextQueryReady(query) && !loading ? "true" : "false"}
      >
        <section className="rounded border border-[#DCE3EA] bg-white p-4" data-search-category={category}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Smart Search</h1>
              <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">{searchCategoryLabel(category)} results for {query ? `“${query}”` : "your search"}. {lifecycleIntent.explicitDefunctRequest ? "Explicit defunct-only entity scope." : "Entity results are active-only by default."} Select any row to continue.</p>
              {interpretedIntent ? (
                <p className="m-0 mt-2 text-[12px] text-[#234968]" data-testid="smart-search-results-interpretation">
                  <span className="font-semibold">Interpreted as:</span> {interpretedIntent.explanation}
                </p>
              ) : null}
            </div>
            <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]" data-testid="search-result-status">
              <span className="font-semibold">{searchCategoryLabel(category)}</span> · {loading ? "Loading" : showingText}
            </div>
          </div>
        </section>

        <nav className="flex flex-wrap gap-2 rounded border border-[#DCE3EA] bg-white p-3" aria-label="Search result categories" data-testid="search-result-category-refinements">
          {SEARCH_CATEGORIES.map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => changeCategory(value)}
              aria-pressed={category === value}
              className={`rounded-full border px-3 py-1.5 text-[12px] font-semibold ${category === value ? "border-[#11314F] bg-[#11314F] text-white" : "border-[#DCE3EA] bg-white text-[#41566B]"}`}
            >
              {searchCategoryLabel(value)} ({categoryCounts[value].toLocaleString("en-US")})
            </button>
          ))}
        </nav>

        {availableFilterDefinitions.length ? (
          <section
            className="grid grid-cols-1 gap-3 rounded border border-[#DCE3EA] bg-white p-3 sm:grid-cols-2 lg:grid-cols-3"
            aria-label={`${searchCategoryLabel(category)} filters`}
            data-testid="search-result-supported-filters"
            data-option-source="current-swfi-results"
          >
            {availableFilterDefinitions.map((definition) => (
              <label key={definition.key} className="grid gap-1 text-[12px] text-[#41566B]">
                <span className="font-semibold">{definition.label}</span>
                <select
                  value={searchFilters[definition.key]}
                  onChange={(event) => setSearchFilters((current) => ({ ...current, [definition.key]: event.target.value }))}
                  className="min-h-9 rounded border border-[#C7D2DD] bg-white px-2"
                  data-testid={`search-filter-${definition.key}`}
                >
                  <option value="">{definition.allLabel}</option>
                  {(filterOptions[definition.key] || []).map((option) => (
                    <option key={option} value={option}>{option}</option>
                  ))}
                </select>
              </label>
            ))}
            {activeFilterCount ? (
              <button
                type="button"
                onClick={() => setSearchFilters({ ...EMPTY_SEARCH_FILTERS })}
                className="min-h-9 self-end justify-self-start rounded border border-[#16538C] bg-white px-3 text-[12px] font-semibold text-[#16538C]"
                data-testid="search-filter-clear"
              >
                Clear filters
              </button>
            ) : null}
          </section>
        ) : null}

        <section className="overflow-hidden rounded border border-[#DCE3EA] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE3EA] bg-[#FBFCFD] px-3 py-2 text-[12px] text-[#41566B]">
            <div>{showingText}</div>
            {category === "all" ? (
              <label className="flex items-center gap-2">
                <span className="font-semibold">Rows per category</span>
                <select
                  value={allCategoryLimit}
                  onChange={(event) => setAllCategoryLimit(Number(event.target.value))}
                  className="rounded border border-[#DCE3EA] bg-white px-2 py-1"
                >
                  {[5, 10].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="flex items-center gap-2">
                <span className="font-semibold">Rows</span>
                <select
                  value={rowLimit}
                  onChange={(event) => setRowLimit(Number(event.target.value))}
                  className="rounded border border-[#DCE3EA] bg-white px-2 py-1"
                >
                  {[5, 10, 25, 50, 100].map((value) => (
                    <option key={value} value={value}>{value}</option>
                  ))}
                </select>
              </label>
            )}
          </div>
          <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead className="bg-[#F7F9FB] text-[11px] uppercase tracking-[0.04em] text-[#5B6A78]">
              <tr>
                <SortableHeader label="Type" active={sortKey === "type"} direction={sortDir} onClick={() => changeSort("type")} />
                <SortableHeader label="Result" active={sortKey === "result"} direction={sortDir} onClick={() => changeSort("result")} />
                <SortableHeader label="Source" active={sortKey === "source"} direction={sortDir} onClick={() => changeSort("source")} />
                <SortableHeader label="Detail" active={sortKey === "detail"} direction={sortDir} onClick={() => changeSort("detail")} />
                <th className="border-b border-[#DCE3EA] px-3 py-2">Record</th>
              </tr>
            </thead>
            <tbody>
              {visibleRows.length ? visibleRows.map((row, index) => {
                const source = sourceHref(row);
                const categorizedRow = row as CategorizedSearchRow;
                const rowCategory = categorizedRow.__searchCategory;
                const href = productHref(source, searchCategoryFallback(rowCategory));
                return (
                  <tr key={`${searchResultName(row)}-${index}`} className="align-top" data-testid="search-result-row">
                    <td className="border-b border-[#EDF1F5] px-3 py-2">
                      <span className="block font-semibold text-[#11314F]" data-testid="search-result-record-type">{searchResultRecordType(categorizedRow)}</span>
                      <span className="mt-0.5 block text-[10px] uppercase tracking-[0.05em] text-[#7A8A9B]">{searchCategoryLabel(rowCategory)}</span>
                    </td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">
                      <a href={href} className="font-semibold text-[#16538C] underline">{searchResultName(row)}</a>
                    </td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">SWFI</td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">{searchResultDetail(categorizedRow)}</td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">
                      {source ? <a href={href} className="text-[#16538C] underline">View details</a> : "Not disclosed"}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#6B7A89]" data-testid="search-result-body-status">
                    {loading ? "Loading…" : searchIssue ? (
                      <span className="inline-flex flex-col items-center gap-2">
                        <span>{searchIssue}</span>
                        <button
                          type="button"
                          onClick={() => setRetryKey((value) => value + 1)}
                          className="rounded border border-[#16538C] bg-white px-3 py-1 font-semibold text-[#16538C]"
                        >
                          Retry search
                        </button>
                      </span>
                    ) : queryShort ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters to search.` : "No matching SWFI records."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>
        <SavedSearchManager />
      </main>
    </div>
  );
}

function packetRows(packet: Packet | null | undefined): Record<string, unknown>[] {
  if (!packet || !isFact(packet)) return [];
  const results = rows(packet, "results");
  if (results.length) return results;
  const dataRows = rows(packet, "rows");
  return dataRows.length ? dataRows : rows(packet);
}

function resolvedEntityName(query: string, publicPacket: Packet | null, entityPackets: Packet[]): string {
  const publicEntities = packetRows(publicPacket).filter((row) => inferSearchCategory(row) === "entities");
  const sourceEntities = entityPackets.flatMap((entityPacket) => packetRows(entityPacket));
  const ranked = mergeSearchRecordsPreferPrimary(publicEntities, sourceEntities, query, "entity");
  return text(ranked[0]?.name || ranked[0]?.title || ranked[0]?.institution, "").trim();
}

function transactionPacketEntityName(packet: Packet | null | undefined): string {
  if (!packet || !isFact(packet) || !packet.data || typeof packet.data !== "object" || Array.isArray(packet.data)) return "";
  const entity = (packet.data as Record<string, unknown>).entity;
  return entity && typeof entity === "object" && !Array.isArray(entity)
    ? meaningfulText((entity as Record<string, unknown>).name)
    : "";
}

function categorizedSearchRow(
  row: Record<string, unknown>,
  forcedCategory?: Exclude<SearchCategory, "all">,
): CategorizedSearchRow {
  return { ...row, __searchCategory: forcedCategory || inferSearchCategory(row) };
}

function inferSearchCategory(row: Record<string, unknown>): Exclude<SearchCategory, "all"> {
  const source = sourceHref(row).toLowerCase();
  if (/\/v1\/people\//.test(source)) return "people";
  if (/\/v1\/transactions\//.test(source)) return "transactions";
  if (/\/v1\/compass\//.test(source)) return "opportunities";
  if (/\/v1\/news\//.test(source) || /[?&]p=\d+/.test(source)) return "news";
  return "entities";
}

function searchCategoryLabel(category: SearchCategory): string {
  if (category === "entities") return "Entities";
  if (category === "opportunities") return "RFPs & Opportunities";
  if (category === "transactions") return "Transactions";
  if (category === "news") return "News & Articles";
  if (category === "people") return "People";
  return "All categories";
}

function searchCategoryFallback(category: Exclude<SearchCategory, "all">): string {
  if (category === "entities") return "/profiles/";
  if (category === "opportunities") return "/mandates/";
  if (category === "transactions") return "/transactions/";
  if (category === "news") return "/intelligence/";
  return "/people/";
}

function searchFilterDefinitions(category: SearchCategory): SearchFilterDefinition[] {
  if (category === "entities") return [
    { key: "geography", label: "Geography", allLabel: "All geographies" },
    { key: "recordType", label: "Entity type", allLabel: "All entity types" },
  ];
  if (category === "transactions") return [
    { key: "transactionType", label: "Transaction type", allLabel: "All transaction types" },
    { key: "buyer", label: "Buyer entity", allLabel: "All buyers" },
    { key: "seller", label: "Seller entity", allLabel: "All sellers" },
    { key: "sector", label: "Sector or industry", allLabel: "All sectors and industries" },
    { key: "geography", label: "Geography", allLabel: "All geographies" },
  ];
  if (category === "opportunities") return [
    { key: "recordType", label: "RFP or Opportunity", allLabel: "All record types" },
    { key: "strategy", label: "Strategy or investment type", allLabel: "All strategies" },
    { key: "geography", label: "Geography", allLabel: "All geographies" },
  ];
  if (category === "news") return [
    { key: "source", label: "Source", allLabel: "All sources" },
  ];
  if (category === "people") return [
    { key: "institution", label: "Institution", allLabel: "All institutions" },
    { key: "role", label: "Role", allLabel: "All roles" },
    { key: "geography", label: "Geography", allLabel: "All geographies" },
  ];
  return [
    { key: "recordType", label: "Record type", allLabel: "All record types" },
    { key: "geography", label: "Geography", allLabel: "All geographies" },
  ];
}

function searchFilterOptions(rowsToFilter: Record<string, unknown>[], key: SearchFilterKey): string[] {
  const values = rowsToFilter.flatMap((row) => searchRowFilterValues(row as CategorizedSearchRow, key));
  return [...new Set(values)].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }));
}

function searchRowFilterValues(row: CategorizedSearchRow, key: SearchFilterKey): string[] {
  if (key === "recordType") return cleanFilterValues([searchResultRecordType(row)]);
  if (key === "geography") return cleanFilterValues([
    row.country,
    row.region,
    row.buyer_country,
    row.buyer_region,
    row.seller_country,
    row.seller_region,
    row.location,
  ]);
  if (key === "transactionType") return cleanFilterValues([
    row.acquisition_type,
    row.investment_type,
    row.transaction_type,
    row.type,
  ]);
  if (key === "buyer") return cleanFilterValues([
    row.buyer_entity,
    row.buyer,
    row.institution,
    /buyer/i.test(meaningfulText(row.role)) ? row.__searchEntityName : "",
    ...nestedEntityNames(row.buyer_entities),
  ]);
  if (key === "seller") return cleanFilterValues([
    row.seller_entity,
    row.seller,
    /seller/i.test(meaningfulText(row.role)) ? row.__searchEntityName : "",
    ...nestedEntityNames(row.seller_entities),
  ]);
  if (key === "sector") return cleanFilterValues([row.sector, row.industry]);
  if (key === "strategy") return cleanFilterValues([
    row.strategy,
    row.asset_class_or_strategy,
    row.investment_type,
  ]);
  if (key === "source") return cleanFilterValues([row.source, row.source_name, row.publisher]);
  if (key === "institution") return cleanFilterValues([row.institution, row.organization, row.entity_name]);
  return cleanFilterValues([row.title, row.role, row.position]);
}

function nestedEntityNames(value: unknown): unknown[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => (
    item && typeof item === "object" && !Array.isArray(item)
      ? (item as Record<string, unknown>).name || (item as Record<string, unknown>).title
      : item
  ));
}

function cleanFilterValues(values: unknown[]): string[] {
  return [...new Set(values
    .map((value) => meaningfulText(value))
    .filter(Boolean))];
}

function searchResultName(row: Record<string, unknown>): string {
  return meaningfulText(row.name || row.title || row.institution) || "SWFI record";
}

function searchResultDetail(row: CategorizedSearchRow): string {
  const category = row.__searchCategory;
  const values = category === "transactions"
    ? [
        transactionBuyer(row),
        meaningfulMoney(
          row.amount_display || row.capital_display || row.native_amount_display || row.amount || row.capital,
          row.currency || row.amount_currency,
        ),
        meaningfulText(row.closed_at || row.activity_date || row.relevant_date || row.announced_at),
        meaningfulText(row.industry || row.sector || row.investment_type),
      ]
    : category === "people"
      ? [meaningfulText(row.title), meaningfulText(row.institution), meaningfulText(row.country || row.region)]
      : category === "opportunities"
        ? [
            meaningfulText(row.institution),
            meaningfulText(row.strategy || row.asset_class_or_strategy || row.type),
            meaningfulText(row.deadline || row.close_date || row.published_at),
          ]
        : category === "news"
          ? [meaningfulText(row.source), meaningfulText(row.published_at || row.updated_at)]
          : [
              meaningfulText(row.type || row.entity_type),
              meaningfulText(row.country || row.region),
              Number(row.activity_count || row.deal_count || 0) > 0
                ? `${Number(row.activity_count || row.deal_count).toLocaleString("en-US")} activities in 90 days`
                : "",
              meaningfulMoney(row.aum || row.assets || row.managed_assets, row.aum_currency || row.currency),
            ];
  return values.filter(Boolean).join(" / ") || "Details available on SWFI";
}

function transactionBuyer(row: Record<string, unknown>): string {
  const matchedBuyers = Array.isArray(row.__smartSearchMatchedBuyers)
    ? row.__smartSearchMatchedBuyers.map((value) => meaningfulText(value)).filter(Boolean).slice(0, 3).join(", ")
    : "";
  if (matchedBuyers) return `Matched buyer: ${matchedBuyers}`;
  const direct = meaningfulText(row.buyer_entity || row.institution);
  if (direct) return direct;
  const buyers = Array.isArray(row.buyer_entities) ? row.buyer_entities : [];
  const buyerNames = buyers
    .map((buyer) => buyer && typeof buyer === "object" ? meaningfulText((buyer as Record<string, unknown>).name) : "")
    .filter(Boolean)
    .slice(0, 3)
    .join(", ");
  if (buyerNames) return buyerNames;
  return /buyer/i.test(meaningfulText(row.role)) ? meaningfulText(row.__searchEntityName) : "";
}

function meaningfulText(value: unknown): string {
  const clean = text(value, "").trim();
  return /^(not disclosed|unavailable|loading)$/i.test(clean) ? "" : clean;
}

function meaningfulMoney(value: unknown, currencyValue?: unknown): string {
  const currency = meaningfulText(currencyValue).toUpperCase();
  const numeric = typeof value === "number" ? value : typeof value === "string" && /^-?[0-9,.]+$/.test(value.trim())
    ? Number(value.replace(/,/g, ""))
    : Number.NaN;
  if (Number.isFinite(numeric)) {
    if (!currency) return "";
    const clean = currency === "USD" || currency === "$"
      ? money(numeric)
      : `${currency} ${numeric.toLocaleString("en-US")}`;
    return /^(not disclosed|unavailable)$/i.test(clean) ? "" : clean;
  }
  const clean = money(value);
  return /^(not disclosed|unavailable)$/i.test(clean) ? "" : clean;
}

function sourceHref(row: Record<string, unknown>): string {
  const direct = text(row.source_url || row.swfi_url || row.url || row.href, "");
  if (direct) return direct;
  const legacyPost = text(row.legacy_post, "").trim();
  return /^\d+$/.test(legacyPost) ? `https://www.swfi.com/?p=${legacyPost}` : "";
}

function SortableHeader({
  label,
  active,
  direction,
  onClick,
}: {
  label: string;
  active: boolean;
  direction: "asc" | "desc";
  onClick: () => void;
}) {
  return (
    <th className="border-b border-[#DCE3EA] px-3 py-2">
      <button type="button" onClick={onClick} className="w-full bg-transparent text-left font-semibold">
        {label}{active ? ` ${direction}` : ""}
      </button>
    </th>
  );
}

function sortSearchRows(rowsToSort: Record<string, unknown>[], sortKey: "relevance" | "type" | "result" | "source" | "detail", sortDir: "asc" | "desc") {
  if (sortKey === "relevance") return rowsToSort;
  const direction = sortDir === "asc" ? 1 : -1;
  return [...rowsToSort].sort((a, b) => compareSearchRows(a, b, sortKey) * direction);
}

function compareSearchRows(a: Record<string, unknown>, b: Record<string, unknown>, sortKey: "type" | "result" | "source" | "detail") {
  return searchSortValue(a, sortKey).localeCompare(searchSortValue(b, sortKey), undefined, { numeric: true, sensitivity: "base" });
}

function searchSortValue(row: Record<string, unknown>, sortKey: "type" | "result" | "source" | "detail") {
  const categorized = row as CategorizedSearchRow;
  if (sortKey === "type") return `${searchCategoryLabel(categorized.__searchCategory)} ${searchResultRecordType(categorized)}`;
  if (sortKey === "result") return searchResultName(row);
  if (sortKey === "source") return "SWFI";
  return searchResultDetail(categorized);
}

function productHref(href: string | undefined, fallback = "/"): string {
  if (!href) return appHref(fallback);
  if (isSwfiPlatformRecordHref(href)) return swfiAuthHandoffHref(href);
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return selfContainedHref(href, fallback);
}
