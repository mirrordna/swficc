"use client";

import type { CoInvestmentTracking } from "@/lib/types";

export default function CoInvestment({ data }: { data: CoInvestmentTracking }) {
  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Co-Investment</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Co-Investment Tracking</h3>
      </div>

      {/* Filter chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {data.filters.map((f) => (
          <span key={f} className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-700">{f}</span>
        ))}
      </div>

      {/* KPI strip */}
      <div className="flex gap-3 mb-3">
        {data.kpis.map((k) => (
          <a key={k.label} href={k.href || "#"} className="flex flex-col gap-1 px-3.5 py-2.5 border border-gray-200 rounded-lg no-underline text-inherit min-w-[120px]">
            <span className="text-gray-500 text-xs uppercase">{k.label}</span>
            <strong className="text-[1.1rem] text-[#0a1628]">{k.value}</strong>
          </a>
        ))}
      </div>

      {/* Network card */}
      {data.network && (
        <a href={data.network.href || "/ask-swfi"} className="block p-3.5 bg-gradient-to-br from-gray-50 to-[#e8edf4] border border-gray-200 rounded-lg no-underline text-inherit mb-3">
          <strong className="block text-gray-900 mb-1">{data.network.title}</strong>
          <p className="m-0 text-gray-600 text-sm">{data.network.nodes} &middot; {data.network.links}</p>
        </a>
      )}

      {/* Table */}
      <div className="overflow-x-auto">
        <div className="grid bg-gray-50 rounded-t-md" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 1fr 0.8fr" }}>
          {["Investor A", "Investor B", "Sector", "Deal", "Amount"].map((h) => (
            <span key={h} className="px-3 py-2.5 text-[0.72rem] font-bold text-gray-600 uppercase tracking-wider border-b border-gray-100">{h}</span>
          ))}
        </div>
        {data.rows.slice(0, 5).map((row, i) => (
          <a key={i} href={row.href || "/ask-swfi"} className="grid no-underline text-inherit hover:bg-gray-50" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 1fr 0.8fr" }}>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.investor_a}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.investor_b}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.sector}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.deal}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.amount}</span>
          </a>
        ))}
      </div>
    </article>
  );
}
