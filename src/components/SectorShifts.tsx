"use client";

import type { SectorShiftItem } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function SectorShifts({ shifts }: { shifts: SectorShiftItem[] }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Sector Shift Heatmap</h3>
      </div>
      <div className="grid gap-2">
        {!shifts.length && <SourceGap message="Sector-shift heatmap requires approved SWFI year-over-year transaction series. No illustrative percentages are shown." />}
        {shifts.slice(0, 5).map((s) => {
          const provenance = sourceProvenanceHref(s.href);
          return (
          <a
            key={s.sector}
            href={selfContainedHref(s.href, "/transactions/")}
            data-source-state={provenance ? "on-file" : undefined}
            title={provenance ? "View details" : undefined}
            className="grid gap-1.5 border border-gray-300 p-2 no-underline text-inherit hover:bg-gray-50"
          >
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
          );
        })}
      </div>
    </article>
  );
}
