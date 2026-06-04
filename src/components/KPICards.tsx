"use client";

import type { SnapshotKPI } from "@/lib/types";

export default function KPICards({ kpis }: { kpis: SnapshotKPI[] }) {
  return (
    <section className="grid grid-cols-4 gap-3.5 max-lg:grid-cols-2" aria-label="Key performance indicators">
      {kpis.slice(0, 4).map((kpi) => (
        <a
          key={kpi.label}
          href={kpi.href || "#"}
          className="flex flex-col gap-2 p-[18px] bg-white border border-gray-200 rounded-[10px] shadow-sm no-underline text-inherit hover:border-[#1a5276] hover:shadow-md transition-all"
        >
          <span className="text-gray-500 text-[0.68rem] font-bold font-mono uppercase tracking-wider">
            {kpi.label}
          </span>
          <strong className="text-[1.8rem] leading-none text-[#0a1628] font-extrabold">
            {kpi.value}
          </strong>
          <p className="m-0 text-gray-500 text-[0.78rem] leading-snug">
            {kpi.note}
          </p>
        </a>
      ))}
    </section>
  );
}
