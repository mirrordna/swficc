"use client";

import type { PeerComparison as PeerComparisonType } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";

const NOT_DISCLOSED = "Not disclosed";

function peerValue(peer: Record<string, unknown>, key: string): string {
  if (key === "peer_percentile") return peer.peer_percentile ? `${peer.peer_percentile}th` : NOT_DISCLOSED;
  if (key === "fit_score") return peer.fit_score ? String(peer.fit_score) : NOT_DISCLOSED;
  return String(peer[key] || NOT_DISCLOSED);
}

export default function PeerComparison({ data }: { data: PeerComparisonType }) {
  const institutions = data.institutions.slice(0, 4);

  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-black">Competitor Intelligence Module</h3>
        </div>
        <button className="border border-gray-300 bg-white px-3 py-1.5 text-sm text-black">
          Add Institution [+]
        </button>
      </div>

      {institutions.length > 0 ? (
        <div className="overflow-x-auto">
          <div className="grid border-b border-gray-300 bg-gray-50" style={{ gridTemplateColumns: `120px repeat(${institutions.length}, minmax(120px, 1fr))` }}>
            <div className="px-3 py-2.5 text-sm font-bold text-gray-900">Metric</div>
            {institutions.map((inst) => {
              const provenance = sourceProvenanceHref(inst.profile_url);
              return (
              <div key={inst.slug} className="px-3 py-2.5">
                <a
                  href={selfContainedHref(inst.profile_url, "/profiles/")}
                  data-source-state={provenance ? "on-file" : undefined}
                  title={provenance ? "Source on file" : undefined}
                  className="text-black font-semibold text-sm no-underline hover:underline"
                >
                  {inst.name}
                </a>
                <span className="block text-gray-500 text-xs">{inst.type}</span>
              </div>
              );
            })}
          </div>
          {data.metrics.map((metric) => (
            <div key={metric.key} className="grid border-b border-gray-200" style={{ gridTemplateColumns: `120px repeat(${institutions.length}, minmax(120px, 1fr))` }}>
              <div className="px-3 py-2.5 text-sm font-bold text-gray-800">{metric.label || metric.key}</div>
              {institutions.map((inst) => (
                <div key={inst.slug} className="px-3 py-2.5 text-sm text-gray-700">
                  {peerValue(inst as unknown as Record<string, unknown>, metric.key)}
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <div className="py-6 text-center text-gray-500">
          <strong className="block mb-1.5 text-gray-700">No peers available.</strong>
          <p className="m-0 text-sm">Peer comparison requires approved SWFI AUM/profile rows.</p>
        </div>
      )}
    </article>
  );
}
