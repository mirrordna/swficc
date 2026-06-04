"use client";

import type { RankingGroup } from "@/lib/types";

export default function DynamicRankings({ rankings }: { rankings: RankingGroup[] }) {
  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Rankings</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Dynamic Rankings</h3>
      </div>
      <div className="grid gap-3">
        {rankings.slice(0, 3).map((group) => (
          <div key={group.title} className="p-3 border border-gray-200 rounded-lg">
            <div className="flex justify-between items-center mb-2">
              <strong className="text-gray-900 text-sm">{group.title}</strong>
              {group.href && <a href={group.href} className="text-[#1a5276] text-xs no-underline hover:underline">Open</a>}
            </div>
            <div className="grid gap-1.5">
              {group.items.slice(0, 5).map((item, i) => (
                <div key={i} className="flex justify-between items-center gap-2 py-1.5 border-b border-gray-100 last:border-b-0">
                  <span>
                    {item.profile_url ? (
                      <a href={item.profile_url} className="text-[#1a5276] font-semibold text-sm no-underline hover:underline">{item.name || item.title || "Institution"}</a>
                    ) : (
                      <strong className="text-sm">{item.name || item.title || "Institution"}</strong>
                    )}
                    <small className="block text-gray-500 text-xs">{item.basis || item.type || ""}</small>
                  </span>
                  <strong className="text-gray-700 text-sm whitespace-nowrap">{item.metric || item.aum || ""}</strong>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </article>
  );
}
