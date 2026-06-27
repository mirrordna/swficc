"use client";

import type { RankingGroup } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

export default function DynamicRankings({ rankings }: { rankings: RankingGroup[] }) {
  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="mb-3">
        <h3 className="m-0 text-base font-semibold text-black">Dynamic Rankings Engine</h3>
      </div>
      <div className="grid gap-3">
        {rankings.slice(0, 3).map((group) => {
          const groupProvenance = sourceProvenanceHref(group.href);
          return (
          <div key={group.title} className="border border-gray-300 p-3">
            <div className="flex justify-between items-center mb-2">
              <strong className="text-gray-900 text-sm">{group.title}</strong>
              {group.href && (
                <a
                  href={selfContainedHref(group.href, "/profiles/")}
                  data-source-state={groupProvenance ? "on-file" : undefined}
                  title={groupProvenance ? "Source on file" : undefined}
                  className="text-black text-xs no-underline hover:underline"
                >
                  Open
                </a>
              )}
            </div>
            <div className="grid gap-1.5">
              {!group.items.length && <SourceGap message={`${group.title} requires approved SWFI database ranking rows.`} />}
              {group.items.slice(0, 5).map((item, i) => (
                <div key={i} className="flex justify-between items-center gap-2 py-1.5 border-b border-gray-100 last:border-b-0">
                  <span>
                    {item.profile_url ? (() => {
                      const provenance = sourceProvenanceHref(item.profile_url);
                      return (
                      <a
                        href={selfContainedHref(item.profile_url, "/profiles/")}
                        data-source-state={provenance ? "on-file" : undefined}
                        title={provenance ? "Source on file" : undefined}
                        className="text-black font-semibold text-sm no-underline hover:underline"
                      >
                        {item.name || item.title || "Institution"}
                      </a>
                      );
                    })() : (
                      <strong className="text-sm">{item.name || item.title || "Institution"}</strong>
                    )}
                    <small className="block text-gray-500 text-xs">{item.basis || item.type || ""}</small>
                  </span>
                  <strong className="text-gray-700 text-sm whitespace-nowrap">{item.metric || item.aum || ""}</strong>
                </div>
              ))}
            </div>
          </div>
          );
        })}
      </div>
    </article>
  );
}
