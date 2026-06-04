"use client";

import type { RegionalItem } from "@/lib/types";

export default function RegionalAllocation({ regions }: { regions: RegionalItem[] }) {
  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Region</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Regional Allocation Trends</h3>
      </div>
      <div className="grid gap-2.5">
        {regions.slice(0, 5).map((r) => (
          <a key={r.region} href={r.href || "/source-data?collection=transactions"} className="grid grid-cols-[1fr_auto_auto] items-center gap-3 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors">
            <strong className="text-gray-900 text-sm">{r.region}</strong>
            <span className="text-gray-700 text-sm font-semibold">{r.capital}</span>
            <span className="text-gray-700 text-sm font-semibold">{r.allocation}</span>
          </a>
        ))}
      </div>
    </article>
  );
}
