"use client";

import { useEffect } from "react";
import { appHref } from "@/lib/selfContainedLinks";

// Consolidation 2026-07-05: /research and /intelligence served the identical
// news list (same endpoint, same columns) — two names for one thing reads as
// two products. /intelligence is the canonical news surface; this route
// forwards there. /research/detail/ stays live (legacy record handoff).
export default function ResearchPage() {
  const target = appHref("/intelligence/");
  useEffect(() => {
    window.location.replace(target);
  }, [target]);
  return (
    <main className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="grid gap-2">
        <div className="text-[14px] font-semibold text-[#11314F]">Research is now Intelligence.</div>
        <a href={target} className="text-[13px] font-semibold text-[#16538C] underline">
          Continue to Research &amp; Analytics
        </a>
      </div>
    </main>
  );
}
