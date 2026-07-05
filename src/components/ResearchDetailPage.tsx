"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, packetData, rows, text } from "@/lib/sourcePackets";
import { appHref, sourceDetailHref, swfiMirrorHref } from "@/lib/selfContainedLinks";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";

type Row = Record<string, unknown>;
type SourceLink = { label: string; href: string };

const NOT_DISCLOSED = "Not disclosed";
const VERIFIED = "Verified in SWFI records";
const NOT_AVAILABLE = "Not available from SWFI records";
const DATE_NOT_PROVIDED = "Date not provided in SWFI record";
const pageLinks = [
  ["Dashboard", "/"],
  ["Institutions", "/profiles"],
  ["People", "/people"],
  ["Deals", "/deals"],
  ["Comparisons", "/comparisons"],
  ["RFPs", "/mandates"],
  ["Reports", "/reports"],
  ["Intelligence", "/intelligence"],
  ["Search", "/search"],
] as const;

export default function ResearchDetailPage() {
  const queryString = useSyncExternalStore(subscribeToLocation, browserSearch, serverSearch);
  const params = useMemo(() => {
    const search = new URLSearchParams(queryString);
    return {
      id: search.get("id") || "",
      legacy: search.get("legacy") || "",
      title: search.get("title") || "",
      source: search.get("source") || "",
    };
  }, [queryString]);
  const hasIdentifier = Boolean(params.id || params.legacy || params.source || params.title);
  const endpoint = useMemo(() => {
    if (!hasIdentifier) return "";
    if (!params.id && !params.legacy && !params.source && params.title) {
      return `/api/source-intelligence/news/v1?limit=100&q=${encodeURIComponent(params.title)}`;
    }
    const search = new URLSearchParams();
    if (params.id) search.set("id", params.id);
    if (params.legacy) search.set("legacy_id", params.legacy);
    if (params.source) search.set("source_url", params.source);
    return `/api/source-intelligence/news/detail/v1?${search.toString()}`;
  }, [hasIdentifier, params]);
  const [packet, setPacket] = useState<Packet | null>(null);

  useEffect(() => {
    if (!endpoint) return;
    let active = true;
    void fetchPacket(endpoint, 90_000, { attempts: 3 }).then((result) => {
      if (active) setPacket(result);
    });
    return () => {
      active = false;
    };
  }, [endpoint]);

  const effectivePacket = hasIdentifier ? packet : null;
  const record = useMemo(() => {
    const data = packetData(effectivePacket || undefined);
    if (data.record && typeof data.record === "object") return data.record as Row;
    const cleanTitle = params.title.trim().replace(/\s+/g, " ").toLowerCase();
    if (!cleanTitle) return {};
    return rows(effectivePacket || undefined).find((row) => text(row.title || row.name, "").trim().replace(/\s+/g, " ").toLowerCase() === cleanTitle) || {};
  }, [effectivePacket, params.title]);
  const sourceUrl = text(record.source_url || params.source, "");
  const title = text(record.title || record.name || params.title, "Research / News Detail");
  const status = !hasIdentifier ? "No record selected" : effectivePacket == null ? "Loading" : isFact(effectivePacket) ? VERIFIED : NOT_AVAILABLE;
  const textDownload = useMemo(() => makeDataUrl(renderTextExport(record), "text/plain"), [record]);
  const sourceLinks = useMemo(() => normalizeSourceLinks(record.source_links), [record]);

  return (
    <div className="min-h-screen bg-[#F2F4F6] font-sans text-[#1B2733]">
      <SwfiBrandHeader searchId="research-detail-search" />
      <div className="border-b border-[#DCE3EA] bg-white px-4 py-2">
        <nav className="mx-auto flex max-w-[1120px] flex-wrap gap-2 text-[13px]">
          {pageLinks.map(([label, href]) => (
            <a key={label} href={appHref(href)} className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[#16538C] no-underline">{label}</a>
          ))}
          <a href="/swficc/research/" className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[#16538C] no-underline">Back to list</a>
        </nav>
      </div>

      <main className="mx-auto grid w-full max-w-[1120px] gap-4 p-4 sm:p-5">
        <section className="rounded border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Research / News Detail</div>
          <h1 className="m-0 mt-1 text-[22px] font-bold text-[#11314F]">{title}</h1>
          <div className="mt-2 text-sm text-[#41566B]">{status}</div>
          {sourceUrl ? (
            <div className="mt-3">
              <a href="#source-record" data-source-state="on-file" className="text-sm text-[#16538C] underline">
                Source record on file
              </a>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <a download={`${downloadSlug(title)}.txt`} href={textDownload} className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[12px] text-[#16538C] no-underline">Download Source Data</a>
          </div>
        </section>

        {!hasIdentifier ? (
          <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">No Research Record Selected</div>
            <div className="mt-1 text-[15px] font-semibold text-[#11314F]">Open an intelligence row or legacy SWFI source link to load this page.</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <a href="/swficc/intelligence/" className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[12px] text-[#16538C] no-underline">Open Intelligence</a>
              <a href="/swficc/search/" className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[12px] text-[#16538C] no-underline">Search Records</a>
            </div>
          </section>
        ) : null}

        <section id="source-record" className="rounded border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Article Details</div>
          <dl className="mt-2 grid gap-0 text-sm">
            <DetailRow label="Title" value={title} />
            <DetailRow label="Published At" value={text(record.published_at, DATE_NOT_PROVIDED)} />
            <DetailRow label="Updated At" value={text(record.updated_at, DATE_NOT_PROVIDED)} />
            <DetailRow label="SWFI Page" value={sourceUrl ? "SWFI record" : NOT_DISCLOSED} />
          </dl>
        </section>

        <section className="rounded border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Article / Report Body</div>
          <div className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[#41566B]">
            <LinkedText value={text(record.content || record.excerpt, !hasIdentifier ? "No research record selected." : effectivePacket == null ? "Loading" : "Not disclosed")} />
          </div>
        </section>

        {sourceLinks.length ? (
          <section className="rounded border border-[#DCE3EA] bg-white p-4">
            <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Links From This Record</div>
            <div className="mt-2 grid gap-2">
              {sourceLinks.map((link) => (
                <a
                  key={link.href}
                  href={hrefForSourceLink(link.href)}
                  data-source-state="on-file"
                  className="block rounded border border-[#EDF1F5] bg-[#F7F9FA] px-3 py-2 text-sm text-[#16538C] no-underline"
                >
                  <span className="block font-semibold">{safeSourceLabel(link.label, link.href)}</span>
                  <span className="block text-[12px] text-[#7A8A9B]">Source reference on file</span>
                </a>
              ))}
            </div>
          </section>
        ) : null}
      </main>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-2 border-b border-[#EDF1F5] py-2 last:border-b-0 sm:grid-cols-[190px_minmax(0,1fr)]">
      <dt className="font-bold text-[#11314F]">{label}</dt>
      <dd className="m-0 break-words text-[#41566B]">{value}</dd>
    </div>
  );
}

function subscribeToLocation(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function browserSearch() {
  return typeof window === "undefined" ? "" : window.location.search;
}

function serverSearch() {
  return "";
}

function makeDataUrl(textValue: string, mimeType: string) {
  return `data:${mimeType};charset=utf-8,${encodeURIComponent(textValue)}`;
}

function renderTextExport(record: Row) {
  const sourceLinks = normalizeSourceLinks(record.source_links);
  return [
    `Title: ${text(record.title || record.name, NOT_DISCLOSED)}`,
    `SWFI Page: ${text(record.source_url, "") ? "SWFI record" : NOT_DISCLOSED}`,
    sourceLinks.length ? `Source Links: ${sourceLinks.length} references on file` : "",
    "",
    text(record.content || record.excerpt, NOT_DISCLOSED),
  ].join("\n");
}

function downloadSlug(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 80) || "swfi-research-record";
}

function normalizeSourceLinks(value: unknown): SourceLink[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const links: SourceLink[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const row = item as Row;
    const href = text(row.href, "");
    if (!href || seen.has(href)) continue;
    seen.add(href);
    links.push({ href, label: text(row.label, href) });
  }
  return links;
}

function hrefForSourceLink(href: string): string {
  return isSwfiUrl(href) ? swfiMirrorHref(href) : sourceDetailHref(href, "/research/detail/");
}

function isSwfiUrl(href: string): boolean {
  try {
    return new URL(href).hostname.endsWith("swfi.com");
  } catch {
    return false;
  }
}

function safeSourceLabel(label: string, href: string): string {
  const clean = text(label, "");
  if (clean && !/^https?:\/\//i.test(clean)) return clean;
  return isSwfiUrl(href) ? "SWFI source" : "Source link";
}

function LinkedText({ value }: { value: string }) {
  const parts = value.split(/(https?:\/\/[^\s<>"')]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return <span key={`${index}:${part.slice(0, 12)}`}>{part}</span>;
        const href = part.replace(/[.,;:]+$/, "");
        const suffix = part.slice(href.length);
        return (
          <span key={`${index}:${href}`}>
            <a
              href={hrefForSourceLink(href)}
              data-source-state="on-file"
              className="text-[#16538C] underline"
            >
              {isSwfiUrl(href) ? "SWFI source" : "Source link"}
            </a>
            {suffix}
          </span>
        );
      })}
    </>
  );
}
