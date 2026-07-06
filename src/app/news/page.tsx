"use client";

import { useEffect } from "react";
import { appHref } from "@/lib/selfContainedLinks";

// Consolidation 2026-07-06: /news rendered the identical news list as
// /intelligence (same component, same data) — one surface, one name. The
// canonical route is /intelligence; this unlinked alias forwards there.
export default function NewsPage() {
  const target = appHref("/intelligence/");
  useEffect(() => {
    window.location.replace(target);
  }, [target]);
  return (
    <main className="grid min-h-[60vh] place-items-center px-6 text-center">
      <div className="grid gap-2">
        <div className="text-[14px] font-semibold text-[#11314F]">News is now Research &amp; Analytics.</div>
        <a href={target} className="text-[13px] font-semibold text-[#16538C] underline">
          Continue to Research &amp; Analytics
        </a>
      </div>
    </main>
  );
}
