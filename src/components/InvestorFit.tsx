"use client";

import type { InvestorFitTargeting } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function InvestorFit({ data }: { data: InvestorFitTargeting }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Investor Fit Targeting</h3>
      </div>

      <a
        href={selfContainedHref(data.href, "/search/")}
        data-source-state={sourceProvenanceHref(data.href) ? "on-file" : undefined}
        title={sourceProvenanceHref(data.href) ? "Source on file" : undefined}
        className="grid gap-1 border border-gray-300 p-3 no-underline text-inherit hover:bg-gray-50 mb-3"
      >
        <strong className="text-gray-900">{data.question}</strong>
        <p className="m-0 text-gray-600 text-sm">{data.benefit}</p>
      </a>

      <div className="flex flex-wrap gap-2 mb-3">
        {data.criteria.map((c) => (
          <span key={c} className="border border-gray-300 px-3 py-1 text-xs text-gray-700">{c}</span>
        ))}
      </div>

      <div className="flex gap-2 mb-3.5">
        {!data.ticket_size_distribution.length && <SourceGap message="Ticket-size distribution requires approved SWFI deal-size rows. No illustrative ticket bands are shown." />}
        {data.ticket_size_distribution.map((b) => {
          const provenance = sourceProvenanceHref(b.href);
          return (
          <a
            key={b.label}
            href={selfContainedHref(b.href, "/search/")}
            data-source-state={provenance ? "on-file" : undefined}
            title={provenance ? "Source on file" : undefined}
            className="border border-gray-300 px-3 py-1.5 text-sm text-black no-underline hover:bg-gray-50"
          >
            {b.label}
          </a>
          );
        })}
      </div>

      <div className="overflow-x-auto">
        {!data.rows.length && <SourceGap message="Investor-fit rows require approved SWFI investor, sector, and ticket-size records." />}
        {data.rows.length > 0 && (
          <>
            <div className="grid bg-gray-50" style={{ gridTemplateColumns: "1fr 1fr 0.8fr 0.6fr" }}>
              {["Institution", "Sector Focus", "Avg Ticket", "Fit"].map((h) => (
                <span key={h} className="border border-gray-300 px-3 py-2 text-xs font-semibold text-gray-700">{h}</span>
              ))}
            </div>
            {data.rows.slice(0, 5).map((row, i) => {
              const provenance = sourceProvenanceHref(row.href);
              return (
              <a
                key={i}
                href={selfContainedHref(row.href, "/profiles/")}
                data-source-state={provenance ? "on-file" : undefined}
                title={provenance ? "Source on file" : undefined}
                className="grid no-underline text-inherit hover:bg-gray-50"
                style={{ gridTemplateColumns: "1fr 1fr 0.8fr 0.6fr" }}
              >
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.institution}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.sector_focus}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.average_ticket_size}</span>
                <span className="border border-gray-300 px-3 py-2 text-sm text-gray-700">{row.fit}</span>
              </a>
              );
            })}
          </>
        )}
      </div>
    </article>
  );
}
