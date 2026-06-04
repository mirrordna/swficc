"use client";

import type { TrendItem } from "@/lib/types";

export default function TrendAnalytics({ trends }: { trends: TrendItem[] }) {
  const max = Math.max(...trends.map((t) => Number(t.active_investors || 0)), 1);

  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Trends</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Investment Trend Analytics</h3>
      </div>
      <div className="grid gap-2.5">
        {trends.slice(0, 6).map((t) => {
          const val = Number(t.active_investors || 0);
          const w = Math.max(8, Math.round((val / max) * 100));
          return (
            <a key={t.sector} href={t.href || "/source-data?collection=transactions"} className="grid gap-1 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors">
              <div className="flex justify-between items-center gap-2">
                <strong className="text-gray-900 text-sm">{t.sector}</strong>
                <span className="text-gray-500 text-xs">{t.capital_deployed}</span>
              </div>
              <div className="my-1.5">
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-gradient-to-r from-[#1a5276] to-[#a61c20]" style={{ width: `${w}%` }} />
                </div>
              </div>
              <p className="m-0 text-gray-600 text-xs">{t.growth} &middot; {val} active investor{val === 1 ? "" : "s"}</p>
            </a>
          );
        })}
      </div>
    </article>
  );
}
