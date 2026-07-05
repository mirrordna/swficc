"use client";

import { useEffect, useMemo, useState } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, money, rows, text } from "@/lib/sourcePackets";
import { appHref, isSwfiPlatformRecordHref, selfContainedHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { businessSearchQueryVariants, dedupeSearchRecords, rankSearchRecords, searchRelevanceScore as businessSearchRelevanceScore } from "@/lib/searchRelevance";

const SEARCH_PREFETCH_CACHE_PREFIX = "swfipn.search.prefetch.v1:";

function searchPrefetchCacheKey(query: string): string {
  return `${SEARCH_PREFETCH_CACHE_PREFIX}${query.trim().toLowerCase()}`;
}

function queryFromUrl(): string {
  if (typeof window === "undefined") return "";
  return new URLSearchParams(window.location.search).get("q")?.trim() || "";
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
  const [packet, setPacket] = useState<Packet | null>(null);
  const [entityPackets, setEntityPackets] = useState<Packet[]>([]);
  const [loading, setLoading] = useState(false);
  const [rowLimit, setRowLimit] = useState(25);
  const [sortKey, setSortKey] = useState<"relevance" | "type" | "result" | "source" | "detail">("relevance");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  useEffect(() => {
    const currentQuery = queryFromUrl();
    const cached = cachedPacket(currentQuery);
    let active = true;
    const controller = new AbortController();
    const resetTimer = window.setTimeout(() => {
      if (!active) return;
      setQuery(currentQuery);
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
    const publicSearch = fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(currentQuery)}&limit=25`, 20_000, {
      signal: controller.signal,
      attempts: 2,
    }).then((nextPacket) => {
      if (!active) return;
      if (isFact(nextPacket)) setPacket(nextPacket);
    });
    const entitySearch = Promise.all(businessSearchQueryVariants(currentQuery).map((variant) => (
      fetchPacket(`/api/source-data/search/v1?collection=entities&q=${encodeURIComponent(variant)}&limit=25`, 25_000, {
        signal: controller.signal,
        attempts: 2,
      })
    ))).then((nextPackets) => {
      if (!active) return;
      setEntityPackets(nextPackets.filter(isFact));
    }).catch(() => {
      if (!active) return;
      setEntityPackets([]);
    });
    void Promise.allSettled([publicSearch, entitySearch]).then(() => {
      if (active) setLoading(false);
    });
    return () => {
      active = false;
      window.clearTimeout(resetTimer);
      controller.abort();
    };
  }, []);

  const resultRows = useMemo(() => {
    const packetRows = packet && isFact(packet) ? rows(packet, "results") : [];
    const entityRows = entityPackets.flatMap((entityPacket) => rows(entityPacket, "results"));
    return rankSearchRows(dedupeSearchRecords([...entityRows, ...packetRows]), query);
  }, [entityPackets, packet, query]);
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
        <section className="rounded border border-[#DCE3EA] bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Smart Search</h1>
              <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Results are ranked for institutional relevance. Select any row to continue.</p>
            </div>
            <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
              {loading && !packet ? "Loading" : showingText}
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
          <table className="w-full border-collapse text-left text-[13px]">
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
                return (
                  <tr key={`${text(row.name, "Result")}-${index}`} className="align-top">
                    <td className="border-b border-[#EDF1F5] px-3 py-2 font-semibold text-[#11314F]">Institution</td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">
                      <a href={productHref(source, "/profiles/")} className="font-semibold text-[#16538C] underline">{text(row.name, "Not disclosed")}</a>
                    </td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">SWFI</td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">{[text(row.type, ""), text(row.country || row.region, ""), money(row.aum || row.assets)].filter(Boolean).join(" / ")}</td>
                    <td className="border-b border-[#EDF1F5] px-3 py-2">
                      {source ? <a href={productHref(source, "/profiles/")} className="text-[#16538C] underline">View details</a> : "Not disclosed"}
                    </td>
                  </tr>
                );
              }) : (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-[#6B7A89]">{loading ? "Loading" : "Not disclosed"}</td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </main>
    </div>
  );
}

function sourceHref(row: Record<string, unknown>): string {
  return text(row.source_url || row.swfi_url || row.url || row.href, "");
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
  if (sortKey === "type") return "Institution";
  if (sortKey === "result") return text(row.name, "");
  if (sortKey === "source") return "SWFI";
  return [text(row.type, ""), text(row.country || row.region, ""), money(row.aum || row.assets)].filter(Boolean).join(" / ");
}

function rankSearchRows(sourceRows: Record<string, unknown>[], query: string) {
  return rankSearchRecords(sourceRows, query, "entity");
}

function searchScore(row: Record<string, unknown>, query: string) {
  return businessSearchRelevanceScore(row, query, "entity");
}

function productHref(href: string | undefined, fallback = "/"): string {
  if (!href) return appHref(fallback);
  if (isSwfiPlatformRecordHref(href)) return swfiAuthHandoffHref(href);
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return selfContainedHref(href, fallback);
}
