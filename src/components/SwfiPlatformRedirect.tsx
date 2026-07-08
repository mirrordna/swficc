"use client";

// Minutes 2026-07-03, decision J (Paul-directed 2026-07-05): detailed record
// views do NOT live inside the dashboard — the existing SWFI platform is the
// source of truth, so every detail route forwards there (through the login
// handoff for gated content). The dashboard stays a curated preview layer
// (decision D). When a request carries no resolvable record pointer, we send
// the visitor back to the dashboard preview rather than invent a destination.

import { Suspense, useEffect, useMemo } from "react";
import { useSearchParams } from "next/navigation";
import { isSwfiPlatformRecordHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";

const KIND_COLLECTION: Record<string, string> = {
  profile: "entities",
  person: "people",
  transaction: "transactions",
  mandate: "compass",
  report: "reports",
  research: "news",
};

function recordUrl(kind: string, id: string): string {
  const collection = KIND_COLLECTION[kind] || "entities";
  return `https://www.swfi.com/v1/${collection}/${encodeURIComponent(id)}`;
}

function RedirectInner({ kind }: { kind: string }) {
  const params = useSearchParams();
  const target = useMemo(() => {
    const source = params.get("source") || "";
    if (/^https?:\/\//i.test(source)) return isSwfiPlatformRecordHref(source) ? swfiAuthHandoffHref(source) : source;
    const legacy = (params.get("legacy") || "").trim();
    if (kind === "research" && /^\d+$/.test(legacy)) return `https://www.swfi.com/?p=${encodeURIComponent(legacy)}`;
    const id = (params.get("id") || "").trim();
    if (id) return swfiAuthHandoffHref(recordUrl(kind, id));
    // Slug/name-only rows carry no record id. swfi.com's public search is a
    // real, verified destination (HTTP 200 unauthenticated) — forward there
    // rather than bounce back to the preview (minutes G: chains end at SWFI).
    const slugTerms = (params.get("name") || params.get("slug") || "").trim().replace(/-/g, " ");
    if (slugTerms) return `https://www.swfi.com/?s=${encodeURIComponent(slugTerms)}`;
    return "";
  }, [kind, params]);

  useEffect(() => {
    if (target) {
      window.location.replace(target);
    } else {
      window.location.replace("./../"); // no record pointer -> back to the preview layer
    }
  }, [target]);

  return (
    <main className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div>
        <div className="text-[13px] font-bold text-[#11314F]">Taking you to the SWFI platform…</div>
        <div className="mt-2 text-[12px] text-[#7A8A9B]">
          Detailed records live on SWFI, the source of truth.{" "}
          {target ? <a className="text-[#16538C] underline" href={target}>Continue</a> : <a className="text-[#16538C] underline" href="../">Back to the dashboard</a>}
        </div>
      </div>
    </main>
  );
}

export default function SwfiPlatformRedirect({ kind }: { kind: string }) {
  return (
    <Suspense fallback={<main className="grid min-h-[60vh] place-items-center text-[13px] text-[#7A8A9B]">Loading…</main>}>
      <RedirectInner kind={kind} />
    </Suspense>
  );
}
