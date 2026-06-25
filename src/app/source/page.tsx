"use client";

import { useMemo, useSyncExternalStore } from "react";
import { appHref, resolvedSwfiMirrorHref } from "@/lib/selfContainedLinks";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";

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

export default function SourceDetailPage() {
  const queryString = useSyncExternalStore(subscribeToLocation, browserSearch, serverSearch);
  const params = useMemo(() => {
    const search = new URLSearchParams(queryString);
    const nextReturn = search.get("return") || "/swficc/";
    return {
      sourceUrl: search.get("url") || "",
      returnHref: nextReturn.startsWith("/swficc/") ? nextReturn : "/swficc/",
    };
  }, [queryString]);

  const source = useMemo(() => parseSource(params.sourceUrl), [params.sourceUrl]);
  const mirrorHref = useMemo(() => params.sourceUrl ? resolvedSwfiMirrorHref(params.sourceUrl) : "", [params.sourceUrl]);
  const safeReturnHref = useMemo(() => isSourceRoute(params.returnHref) ? "/swficc/" : params.returnHref, [params.returnHref]);
  const hasSourceUrl = Boolean(params.sourceUrl);

  return (
    <div className="flex min-h-screen flex-col bg-[#F2F4F6] font-sans text-[#1B2733] lg:h-screen lg:overflow-hidden">
      <SwfiBrandHeader searchId="source-global-search" />

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="flex w-full shrink-0 flex-wrap overflow-visible bg-[#11314F] lg:block lg:w-[196px] lg:overflow-y-auto">
          {pageLinks.map(([label, href]) => (
            <a
              key={label}
              href={appHref(href)}
              className="flex min-h-9 flex-1 basis-[132px] items-center border-l-[3px] border-transparent px-3.5 text-[13.5px] text-[#A7BCD0] no-underline lg:flex-none"
            >
              {label}
            </a>
          ))}
        </aside>

        <main className="min-w-0 flex-1 overflow-visible lg:overflow-y-auto">
          <div className="mx-auto grid w-full max-w-[1188px] gap-4 p-4 sm:p-[20px_22px_30px]">
            <section className="rounded border border-[#DCE3EA] bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Source Reference</h1>
                  <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">
                    {hasSourceUrl
                      ? "This reference connects the visible SWFI record to its source."
                      : "Open this page from a record source link to inspect the source reference."}
                  </p>
                </div>
                <a href={safeReturnHref} className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">Return</a>
              </div>
            </section>

            {!hasSourceUrl ? (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">No Source Selected</div>
                <div className="mt-1 text-[15px] font-semibold text-[#11314F]">No source URL was supplied by this route.</div>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">Use a record, table row, or source-detail link to resolve the source URL to a SWFI record.</div>
                <div className="mt-3 flex flex-wrap gap-2">
                  <a href="/swficc/search/" className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">Search records</a>
                  <a href="/swficc/provenance/" className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">Source references</a>
                </div>
              </section>
            ) : mirrorHref ? (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Open Record</div>
                <a href={mirrorHref} className="mt-1 block text-[15px] font-semibold text-[#16538C] underline">
                  Open SWFI record
                </a>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">Open the corresponding SWFI record page.</div>
              </section>
            ) : params.sourceUrl ? (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Open Record</div>
                <div className="mt-1 text-[15px] font-semibold text-[#11314F]">No SWFI record is currently available for this source reference.</div>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">The source reference is on file.</div>
              </section>
            ) : null}

            {hasSourceUrl ? (
              <>
                <section className="grid gap-3 rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Type</div>
                    <div className="text-[16px] font-bold text-[#11314F]">{source.type}</div>
                  </div>
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Reference</div>
                    <div>{source.host ? "Source reference on file" : "Not disclosed by source"}</div>
                  </div>
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Record</div>
                    <div data-source-state={params.sourceUrl ? "on-file" : undefined} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-[13px]">
                      Source reference on file
                    </div>
                  </div>
                </section>

                <section className="rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#7A8A9B]">
                  Source links stay within the SWFI workflow.
                </section>
              </>
            ) : null}
          </div>
        </main>
      </div>
    </div>
  );
}

function parseSource(value: string) {
  if (!value) return { host: "", path: "", type: "Not disclosed" };
  try {
    const parsed = new URL(value);
    const path = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    return {
      host: parsed.hostname,
      path,
      type: classifyPath(path),
    };
  } catch {
    return { host: "", path: value, type: "SWFI.com source" };
  }
}

function classifyPath(path: string) {
  if (/\/transactions\//i.test(path)) return "SWFI transaction source";
  if (/\/compass\//i.test(path)) return "SWFI mandate/RFP source";
  if (/news|article|research|report/i.test(path)) return "SWFI research/news source";
  if (/profile|entity|entities|fund|ranking/i.test(path)) return "SWFI profile source";
  return "SWFI.com source";
}

function isSourceRoute(href: string) {
  try {
    return new URL(href, "https://swfipn.activemirror.ai").pathname === "/swficc/source/";
  } catch {
    return false;
  }
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
