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

const quickLinks = [
  ["Search Records", "/search/"],
  ["Institutions", "/profiles/"],
  ["Transactions", "/transactions/"],
  ["RFPs / Mandates", "/mandates/"],
  ["Research", "/research/"],
] as const;

export default function ProvenancePage() {
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
      <SwfiBrandHeader searchId="provenance-global-search" />

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
                  <h1 className="m-0 text-[19px] font-bold text-[#11314F]">Record Links</h1>
                  <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">
                    Record links open the corresponding SWFI profile, transaction, RFP, person, or research page when a mapped record is available.
                  </p>
                </div>
                <a href={safeReturnHref} className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">Return</a>
              </div>
            </section>

            {!hasSourceUrl ? (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Record Link</div>
                <div className="mt-1 text-[15px] font-semibold text-[#11314F]">Open a dashboard record link to view the matching SWFI page.</div>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">
                  Dashboard rows route to the matching profile, transaction, RFP, person, or research page when available.
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {quickLinks.map(([label, href]) => (
                    <a key={href} href={appHref(href)} className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#16538C] no-underline">{label}</a>
                  ))}
                </div>
              </section>
            ) : mirrorHref ? (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Open Record</div>
                <a href={mirrorHref} className="mt-1 block text-[15px] font-semibold text-[#16538C] underline">
                  Open SWFI record
                </a>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">Open the corresponding SWFI platform record through the configured sign-in handoff.</div>
              </section>
            ) : (
              <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Open Record</div>
                <div className="mt-1 text-[15px] font-semibold text-[#11314F]">No matching SWFI page is currently available for this link.</div>
                <div className="mt-1 text-[12px] text-[#7A8A9B]">Return to the dashboard and open another record.</div>
              </section>
            )}

            {hasSourceUrl ? (
              <>
                <section className="grid gap-3 rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Record Type</div>
                    <div className="text-[16px] font-bold text-[#11314F]">{source.type}</div>
                  </div>
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Record Status</div>
                    <div>{source.host ? "Record link on file" : "Record link unavailable"}</div>
                  </div>
                  <div className="grid gap-1">
                    <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">SWFI Page</div>
                    <div data-source-state={params.sourceUrl ? "on-file" : undefined} className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-[13px]">
                      Record link on file
                    </div>
                  </div>
                </section>

                <section className="rounded border border-[#DCE3EA] bg-white px-4 py-3 text-sm text-[#7A8A9B]">
                  Record links stay within the SWFI workflow.
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
    return { host: "", path: value, type: "SWFI record" };
  }
}

function classifyPath(path: string) {
  if (/\/transactions\//i.test(path)) return "Transaction";
  if (/\/compass\//i.test(path)) return "RFP / Mandate";
  if (/people|person/i.test(path)) return "Person";
  if (/news|article|research|report/i.test(path)) return "Research / News";
  if (/profile|entity|entities|fund|ranking/i.test(path)) return "Profile";
  return "SWFI record";
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
