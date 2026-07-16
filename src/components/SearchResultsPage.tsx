"use client";

import { useEffect, useMemo, useState } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, money, packetReason, rows, text } from "@/lib/sourcePackets";
import { appHref, isSwfiPlatformRecordHref, selfContainedHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { businessSearchQueryVariants, dedupeSearchRecords, mergeSearchRecordsPreferPrimary, rankSearchRecords } from "@/lib/searchRelevance";
import { filterSmartSearchIntentRows, smartSearchIntentForQuery } from "@/lib/smartSearchIntent";

const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";
const SEARCH_CATEGORIES = ["all", "entities", "opportunities", "transactions", "news", "people"] as const;
type SearchCategory = (typeof SEARCH_CATEGORIES)[number];
type CategorizedSearchRow = Record<string, unknown> & { __searchCategory: Exclude<SearchCategory, "all"> };

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
    return parsed.packet && isFact(parsed.packet) ? parsed.packet : null;
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
  const [rowLimit, setRowLimit] = useState(25);
  const [sortKey, setSortKey] = useState<"relevance" | "type" | "result" | "source" | "detail">("relevance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const currentQuery = queryFromUrl();
    const currentCategory = categoryFromUrl();
    const currentIntent = smartSearchIntentForQuery(currentQuery);
    const cached = currentIntent ? null : cachedPacket(currentQuery);
    let active = true;
    const controller = new AbortController();
    const resetTimer = window.setTimeout(() => {
      if (!active) return;
      setQuery(currentQuery);
      setCategory(currentCategory);
      setSearchIssue("");
      setIntentPackets([]);
      if (cached) setPacket(cached);
      setLoading(Boolean(currentQuery) && !cached);
    }, 0);
    if (!currentQuery) {
      return () => {
        active = false;
        window.clearTimeout(resetTimer);
        controller.abort();
      };
    }
    const publicSearch: Promise<Packet | null> = currentIntent
      ? Promise.resolve(null)
      : fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(currentQuery)}&limit=100`, 20_000, {
        signal: controller.signal,
        attempts: 2,
      }).then((nextPacket) => {
        if (!active) return nextPacket;
        if (isFact(nextPacket)) setPacket(nextPacket);
        return nextPacket;
      });
    const entitySearch = currentIntent
      ? Promise.resolve([] as Packet[])
      : Promise.all(businessSearchQueryVariants(currentQuery).map((variant) => (
        fetchPacket(`/api/source-data/search/v1?collection=entities&q=${encodeURIComponent(variant)}&limit=100`, 25_000, {
          signal: controller.signal,
          attempts: 2,
        })
      ))).then((nextPackets) => {
      const factPackets = nextPackets.filter(isFact);
      if (active) setEntityPackets(factPackets);
      return factPackets;
    }).catch(() => {
      if (active) setEntityPackets([]);
      return [] as Packet[];
    });

    const peopleSearch = !currentIntent && (currentCategory === "all" || currentCategory === "people")
      ? fetchPacket(`/api/people/search/v1?q=${encodeURIComponent(currentQuery)}&limit=100`, 25_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((nextPacket) => {
          if (active && isFact(nextPacket)) setPeoplePacket(nextPacket);
          return nextPacket;
        }).catch(() => null)
      : Promise.resolve(null);

    const opportunitySearch = !currentIntent && (currentCategory === "all" || currentCategory === "opportunities")
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
          if (active) setOpportunityPackets(factPackets);
          return factPackets;
        }).catch(() => {
          if (active) setOpportunityPackets([]);
          return [] as Packet[];
        })
      : Promise.resolve([] as Packet[]);

    const newsSearch = !currentIntent && (currentCategory === "all" || currentCategory === "news")
      ? fetchPacket("/api/source-intelligence/news/v1?limit=100", 25_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((nextPacket) => {
          if (active && isFact(nextPacket)) setNewsPacket(nextPacket);
          return nextPacket;
        }).catch(() => null)
      : Promise.resolve(null);

    const transactionSearch = !currentIntent && (currentCategory === "all" || currentCategory === "transactions")
      ? Promise.all([publicSearch, entitySearch]).then(async ([publicPacket, nextEntityPackets]) => {
          if (!active) return null;
          const entityName = resolvedEntityName(currentQuery, publicPacket, nextEntityPackets);
          if (!entityName) return null;
          const nextPacket = await fetchPacket(`/api/entity-transactions/v1?name=${encodeURIComponent(entityName)}&limit=100`, 25_000, {
            signal: controller.signal,
            attempts: 2,
          }).catch(() => null);
          if (active && nextPacket && isFact(nextPacket)) setTransactionPacket(nextPacket);
          return nextPacket;
        })
      : Promise.resolve(null);

    const intentSearch = currentIntent
      ? Promise.all(currentIntent.requests.map((request) => (
          fetchPacket(request.endpoint, 25_000, { signal: controller.signal, attempts: 4 })
        ))).then((nextPackets) => {
          const factPackets = nextPackets.filter(isFact);
          if (active) {
            setIntentPackets(factPackets);
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

  const resultRows = useMemo(() => {
    const interpretedIntent = smartSearchIntentForQuery(query);
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
      ...mergeSearchRecordsPreferPrimary(publicEntities, entityRows, query, "entity"),
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

    if (category === "entities") return entities;
    if (category === "transactions") return transactions;
    if (category === "people") return people;
    if (category === "opportunities") return opportunities;
    if (category === "news") return news;
    return dedupeSearchRecords([...entities, ...transactions, ...opportunities, ...news, ...people]);
  }, [category, entityPackets, intentPackets, newsPacket, opportunityPackets, packet, peoplePacket, query, transactionPacket]);
  const interpretedIntent = useMemo(() => smartSearchIntentForQuery(query), [query]);
  const sortedRows = useMemo(() => sortSearchRows(resultRows, sortKey, sortDir), [resultRows, sortDir, sortKey]);
  const visibleRows = sortedRows.slice(0, rowLimit);
  const count = resultRows.length;
  const showingText = query
    ? `Showing ${visibleRows.length.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}`
    : "Awaiting search";
  function changeSort(nextKey: typeof sortKey) {
    if (sortKey === nextKey) {
      setSortDir((current) => (current === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(nextKey);
    setSortDir("asc");
  }

  return (
    <div className="min-h-screen bg-[#F2F4F6] font-sans text-[#1B2733]">
      <SwfiBrandHeader searchId="global-swfi-search" searchDefaultValue={query} />
      <main className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]">
        <section className="rounded border border-[#DCE3EA] bg-white p-4" data-search-category={category}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Smart Search</h1>
              <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">{searchCategoryLabel(category)} results for {query ? `“${query}”` : "your search"}. Select any row to continue.</p>
              {interpretedIntent ? (
                <p className="m-0 mt-2 text-[12px] text-[#234968]" data-testid="smart-search-results-interpretation">
                  <span className="font-semibold">Interpreted as:</span> {interpretedIntent.explanation}
                </p>
              ) : null}
            </div>
            <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
              <span className="font-semibold">{searchCategoryLabel(category)}</span> · {loading && !packet ? "Loading" : showingText}
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded border border-[#DCE3EA] bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#DCE3EA] bg-[#FBFCFD] px-3 py-2 text-[12px] text-[#41566B]">
            <div>{showingText}</div>
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
                  <tr key={`${searchResultName(row)}-${index}`} className="align-top">
                    <td className="border-b border-[#EDF1F5] px-3 py-2 font-semibold text-[#11314F]">{searchCategoryLabel(rowCategory)}</td>
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
                  <td colSpan={5} className="px-3 py-8 text-center text-[#6B7A89]">
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
                    ) : "No matching SWFI records."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          </div>
        </section>
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

function searchResultName(row: Record<string, unknown>): string {
  return meaningfulText(row.name || row.title || row.institution) || "SWFI record";
}

function searchResultDetail(row: CategorizedSearchRow): string {
  const category = row.__searchCategory;
  const values = category === "transactions"
    ? [
        transactionBuyer(row),
        meaningfulMoney(row.amount_display || row.capital_display || row.native_amount_display || row.amount || row.capital),
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
              meaningfulMoney(row.aum || row.assets || row.managed_assets),
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

function meaningfulMoney(value: unknown): string {
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
  if (sortKey === "type") return searchCategoryLabel(categorized.__searchCategory);
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
