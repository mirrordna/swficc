"use client";

import type { InvestorFitTargeting } from "@/lib/types";

export default function InvestorFit({ data }: { data: InvestorFitTargeting }) {
  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Investor Fit</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Ticket-Size Targeting</h3>
      </div>

      {/* Question + benefit */}
      <a href={data.href || "/ask-swfi"} className="grid gap-1 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors mb-3">
        <strong className="text-gray-900">{data.question}</strong>
        <p className="m-0 text-gray-600 text-sm">{data.benefit}</p>
      </a>

      {/* Criteria chips */}
      <div className="flex flex-wrap gap-2 mb-3">
        {data.criteria.map((c) => (
          <span key={c} className="px-3 py-1 bg-gray-100 rounded-full text-xs text-gray-700">{c}</span>
        ))}
      </div>

      {/* Ticket size distribution */}
      <div className="flex gap-2 mb-3.5">
        {data.ticket_size_distribution.map((b) => (
          <a key={b.label} href={b.href || "/ask-swfi"} className="px-4 py-2 bg-gray-100 border border-gray-200 rounded-md text-gray-800 text-[0.82rem] font-semibold no-underline hover:border-[#1a5276] hover:bg-white transition-colors">
            {b.label}
          </a>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <div className="grid bg-gray-50 rounded-t-md" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 0.6fr" }}>
          {["Institution", "Sector Focus", "Avg Ticket", "Fit"].map((h) => (
            <span key={h} className="px-3 py-2.5 text-[0.72rem] font-bold text-gray-600 uppercase tracking-wider border-b border-gray-100">{h}</span>
          ))}
        </div>
        {data.rows.slice(0, 5).map((row, i) => (
          <a key={i} href={row.href || "/ask-swfi"} className="grid no-underline text-inherit hover:bg-gray-50" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 0.6fr" }}>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.institution}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.sector_focus}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.average_ticket_size}</span>
            <span className="px-3 py-2.5 text-sm text-gray-700 border-b border-gray-100">{row.fit}</span>
          </a>
        ))}
      </div>
    </article>
  );
}
