"use client";

import { useState } from "react";

type TimelineEntry = {
  year: string;
  text: string;
};

export default function SwfiTimeline({ entries }: { entries: readonly TimelineEntry[] }) {
  const [selected, setSelected] = useState(0);
  const active = entries[selected] || entries[0];

  return (
    <div className="grid gap-5 py-8" data-swfi-timeline>
      <div className="min-h-[124px] sm:min-h-[104px]">
        <div className="max-w-[260px] rounded-lg bg-white p-4 text-[16px] leading-6 text-[#22272F] shadow-[0_8px_28px_rgba(0,0,0,0.22)]">
          {active.text}
        </div>
      </div>
      <div className="relative overflow-x-auto pb-1">
        <div className="absolute left-4 right-4 top-[10px] h-px bg-[#BD1A21]" />
        <div className="relative grid min-w-[960px] gap-0" style={{ gridTemplateColumns: `repeat(${entries.length}, minmax(0, 1fr))` }}>
          {entries.map((entry, index) => {
            const isActive = index === selected;
            return (
              <button
                key={entry.year}
                type="button"
                onClick={() => setSelected(index)}
                aria-pressed={isActive}
                className="grid justify-items-center gap-2 border-0 bg-transparent p-0 text-[#22272F]"
              >
                <span className={`relative z-10 h-5 w-5 rounded-full border ${isActive ? "border-[#BD1A21] bg-[#BD1A21] ring-2 ring-[#BD1A21] ring-offset-2" : "border-[#BD1A21] bg-white"}`} />
                <span className={`text-[16px] ${isActive ? "font-bold text-[#606060]" : "font-normal text-[#22272F]"}`}>{entry.year}</span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
