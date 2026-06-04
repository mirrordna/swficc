"use client";

import type { BusinessModelItem } from "@/lib/types";

export default function BusinessModels({ models }: { models: BusinessModelItem[] }) {
  const max = Math.max(...models.map((m) => Number(m.active_investors || 0)), 1);

  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Capital Deployment</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Top-Funded Business Models</h3>
      </div>
      <div className="grid gap-2.5">
        {models.slice(0, 6).map((m) => {
          const val = Number(m.active_investors || 0);
          const w = Math.max(8, Math.round((val / max) * 100));
          return (
            <a key={m.sector} href={m.href || "/source-data?collection=transactions"} className="grid gap-2 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors">
              <div>
                <strong className="text-gray-900 text-sm">{m.sector}</strong>
                <p className="m-0 text-gray-500 text-xs">{m.note || "Open current source records for deployment context."}</p>
              </div>
              <div className="flex gap-4 text-gray-600 text-xs">
                <span>{m.capital_deployed}</span>
                <span>{m.growth}</span>
                <span>{m.active_investors_display || `${val} investors`}</span>
              </div>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1a5276] to-[#a61c20]" style={{ width: `${w}%` }} />
              </div>
            </a>
          );
        })}
      </div>
    </article>
  );
}
