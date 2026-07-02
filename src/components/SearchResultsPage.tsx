"use client";

import { useEffect, useMemo, useState } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, money, rows, text } from "@/lib/sourcePackets";
import { appHref, isSwfiPlatformRecordHref, selfContainedHref } from "@/lib/selfContainedLinks";

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
  const [loading, setLoading] = useState(false);

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
    void fetchPacket(`/api/v1/public/search?q=${encodeURIComponent(currentQuery)}&limit=25`, 20_000, {
      signal: controller.signal,
      attempts: 2,
    }).then((nextPacket) => {
      if (!active) return;
      if (isFact(nextPacket)) setPacket(nextPacket);
      setLoading(false);
    });
    return () => {
      active = false;
      window.clearTimeout(resetTimer);
      controller.abort();
    };
  }, []);

  const resultRows = useMemo(() => {
    const packetRows = packet && isFact(packet) ? rows(packet, "results") : [];
    return rankSearchRows(packetRows, query);
  }, [packet, query]);
  const count = resultRows.length;
  const showingText = query
    ? `Showing ${count.toLocaleString("en-US")} of ${count.toLocaleString("en-US")}`
    : "Awaiting search";

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
          <table className="w-full border-collapse text-left text-[13px]">
            <thead className="bg-[#F7F9FB] text-[11px] uppercase tracking-[0.04em] text-[#5B6A78]">
              <tr>
                <th className="border-b border-[#DCE3EA] px-3 py-2">Type</th>
                <th className="border-b border-[#DCE3EA] px-3 py-2">Result</th>
                <th className="border-b border-[#DCE3EA] px-3 py-2">Source</th>
                <th className="border-b border-[#DCE3EA] px-3 py-2">Detail</th>
                <th className="border-b border-[#DCE3EA] px-3 py-2">Record</th>
              </tr>
            </thead>
            <tbody>
              {resultRows.length ? resultRows.map((row, index) => {
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

function rankSearchRows(sourceRows: Record<string, unknown>[], query: string) {
  const clean = query.trim();
  if (!clean) return sourceRows;
  return [...sourceRows].sort((a, b) => searchScore(b, clean) - searchScore(a, clean));
}

function searchScore(row: Record<string, unknown>, query: string) {
  const clean = query.trim().toLowerCase();
  const name = text(row.name || row.title || row.institution, "").toLowerCase();
  const type = text(row.type || row.entity_type, "").toLowerCase();
  const country = text(row.country || row.region, "").toLowerCase();
  const all = Object.values(row).filter((value) => typeof value === "string").join(" ").toLowerCase();
  const terms = clean.split(/\s+/).filter(Boolean);
  let score = 0;
  if (name === clean) score += 1000;
  if (name.startsWith(clean)) score += 700;
  if (name.includes(clean)) score += 520;
  if (terms.length && terms.every((term) => name.includes(term))) score += 320;
  if (terms.length && terms.every((term) => all.includes(term))) score += 180;
  if (country.includes(clean)) score += 60;
  if (/sovereign wealth fund|central bank|public pension|pension|investment authority|asset owner/i.test(type)) score += 180;
  if (/\b(adia|abu dhabi investment authority)\b/i.test(name) && /abu|dhabi|adia/.test(clean)) score += 500;
  if (/\b(mubadala|adia|adq|abu dhabi)\b/i.test(name) && /abu|dhabi|uae|united arab emirates/.test(clean)) score += 180;
  return score;
}

function productHref(href: string | undefined, fallback = "/"): string {
  if (!href) return appHref(fallback);
  if (isSwfiPlatformRecordHref(href)) return selfContainedHref(href, fallback);
  if (href.startsWith("http://") || href.startsWith("https://")) return href;
  return selfContainedHref(href, fallback);
}
