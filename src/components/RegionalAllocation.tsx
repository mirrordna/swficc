"use client";

import type { RegionalItem } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function RegionalAllocation({ regions }: { regions: RegionalItem[] }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Regional Allocation Trends</h3>
      </div>
      {!regions.length && <SourceGap message="Regional allocation requires approved SWFI regional capital-allocation rows. No illustrative capital or allocation percentages are shown." />}
      {regions.length > 0 && (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              {["Region", "Capital", "% Allocation"].map((h) => (
                <th key={h} className="border border-gray-300 px-2 py-1.5 text-left font-semibold">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {regions.slice(0, 5).map((r) => {
              const provenance = sourceProvenanceHref(r.href);
              return (
              <tr key={r.region}>
                <td className="border border-gray-300 px-2 py-1.5">
                  <a
                    href={selfContainedHref(r.href, "/transactions/")}
                    data-source-state={provenance ? "on-file" : undefined}
                    title={provenance ? "View details" : undefined}
                    className="text-black no-underline hover:underline"
                  >
                    {r.region}
                  </a>
                </td>
                <td className="border border-gray-300 px-2 py-1.5">{r.capital}</td>
                <td className="border border-gray-300 px-2 py-1.5">{r.allocation}</td>
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </article>
  );
}
