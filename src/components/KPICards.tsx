"use client";

import type { SnapshotKPI } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";

export default function KPICards({ kpis }: { kpis: SnapshotKPI[] }) {
  return (
    <section className="border border-gray-300" aria-label="KPI cards">
      <h2 className="m-0 border-b border-gray-300 px-3 py-2 text-base font-semibold">KPI CARDS</h2>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
      {kpis.slice(0, 4).map((kpi) => {
        const provenance = sourceProvenanceHref(kpi.href);
        return (
        <a
          key={kpi.label}
          href={selfContainedHref(kpi.href, "/")}
          data-source-url={provenance}
          title={provenance ? `Source: ${provenance}` : undefined}
          className="flex flex-col gap-1 border-r border-gray-300 px-3 py-2 text-inherit no-underline last:border-r-0 hover:bg-gray-50"
        >
          <span className="text-sm text-black">
            {kpi.label}
          </span>
          <strong className="text-xl leading-none text-black">
            {kpi.value}
          </strong>
          <p className="m-0 text-xs leading-snug text-gray-600">
            {kpi.note}
          </p>
        </a>
      );})}
      </div>
    </section>
  );
}
