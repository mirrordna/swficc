"use client";

import type { PeerComparison as PeerComparisonType } from "@/lib/types";

function peerValue(peer: Record<string, unknown>, key: string): string {
  if (key === "peer_percentile") return peer.peer_percentile ? `${peer.peer_percentile}th` : "Not available";
  if (key === "fit_score") return peer.fit_score ? String(peer.fit_score) : "Current";
  return String(peer[key] || "Not disclosed");
}

export default function PeerComparison({ data }: { data: PeerComparisonType }) {
  const institutions = data.institutions.slice(0, 4);

  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="flex justify-between items-start gap-3 mb-3.5">
        <div>
          <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Competition</p>
          <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Peer Comparison Engine</h3>
        </div>
        <button className="px-3.5 py-1.5 bg-gray-100 border border-gray-300 rounded-md text-gray-800 text-[0.78rem] font-semibold cursor-pointer hover:bg-gray-200 transition-colors">
          Add Institution [+]
        </button>
      </div>

      {institutions.length > 0 ? (
        <div className="overflow-x-auto">
          {/* Header */}
          <div className="grid border-b border-gray-200 bg-gray-50 rounded-t-md" style={{ gridTemplateColumns: `120px repeat(${institutions.length}, minmax(120px, 1fr))` }}>
            <div className="px-3 py-2.5 text-sm font-bold text-gray-900">Metric</div>
            {institutions.map((inst) => (
              <div key={inst.slug} className="px-3 py-2.5">
                <a href={inst.profile_url || "#"} className="text-[#1a5276] font-semibold text-sm no-underline hover:underline">{inst.name}</a>
                <span className="block text-gray-500 text-xs">{inst.type}</span>
              </div>
            ))}
          </div>
          {/* Rows */}
          {data.metrics.map((metric) => (
            <div key={metric.key} className="grid border-b border-gray-100" style={{ gridTemplateColumns: `120px repeat(${institutions.length}, minmax(120px, 1fr))` }}>
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
          <p className="m-0 text-sm">Open profiles to build a comparison set.</p>
        </div>
      )}
    </article>
  );
}
