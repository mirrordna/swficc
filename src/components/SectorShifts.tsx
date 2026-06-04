"use client";

import type { SectorShiftItem } from "@/lib/types";

export default function SectorShifts({ shifts }: { shifts: SectorShiftItem[] }) {
  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="mb-3.5">
        <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Sector Shifts</p>
        <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Sector Shift Heatmap</h3>
      </div>
      <div className="grid gap-2.5">
        {shifts.slice(0, 5).map((s) => (
          <a key={s.sector} href={s.href || "/source-data?collection=transactions"} className="grid gap-1.5 p-3 border border-gray-200 rounded-lg no-underline text-inherit hover:border-[#1a5276] transition-colors">
            <strong className="text-gray-900 text-sm">{s.sector}</strong>
            <div className="flex gap-3">
              {s.cells.map((c, i) => (
                <span key={i} className="flex flex-col gap-0.5 text-gray-800 text-sm font-semibold">
                  <small className="text-gray-500 text-[0.66rem] uppercase">{c.label}</small>
                  {c.value}
                </span>
              ))}
            </div>
            <p className="m-0 text-gray-500 text-xs italic">{s.insight}</p>
          </a>
        ))}
      </div>
    </article>
  );
}
