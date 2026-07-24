"use client";

import { useEffect } from "react";
import { appHref } from "@/lib/selfContainedLinks";

// Consolidation 2026-07-06: /compass rendered the identical RFP list as
// /mandates (same component, same data) — one surface, one name. The
// canonical route is /mandates; this unlinked alias forwards there.
export default function CompassPage() {
  const target = appHref("/mandates/");
  useEffect(() => {
    window.location.replace(target);
  }, [target]);
  return (
    <main className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="grid gap-2">
        <div className="text-[14px] font-semibold text-[#11314F]">Compass is now RFPs &amp; Mandates.</div>
        <a href={target} className="text-[13px] font-semibold text-[#16538C] underline">
          Continue to RFPs &amp; Mandates
        </a>
      </div>
    </main>
  );
}
