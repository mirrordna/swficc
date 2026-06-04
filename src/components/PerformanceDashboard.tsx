"use client";

import { useState, useMemo } from "react";
import type { HistoricalPerformance, PerformanceEntity } from "@/lib/types";

export default function PerformanceDashboard({ data }: { data: HistoricalPerformance }) {
  const [entityType, setEntityType] = useState(data.entity_types[0] || "");
  const [entityName, setEntityName] = useState("");
  const [chartType, setChartType] = useState("aum_over_time");

  const filteredEntities = useMemo(() =>
    data.entities.filter((e) => !entityType || e.type === entityType),
    [data.entities, entityType]
  );

  const selectedEntity = useMemo(() => {
    const byName = filteredEntities.find((e) => e.name.toLowerCase() === entityName.toLowerCase());
    const bySlug = filteredEntities.find((e) => e.slug === data.default_entity_slug);
    return byName || bySlug || filteredEntities[0] || null;
  }, [filteredEntities, entityName, data.default_entity_slug]);

  return (
    <article className="bg-white border border-gray-200 rounded-[10px] shadow-sm p-[18px]">
      <div className="flex justify-between items-start gap-3 mb-3.5">
        <div>
          <p className="m-0 mb-1 text-[#1a5276] text-[0.66rem] font-bold font-mono uppercase tracking-wider">Performance</p>
          <h3 className="m-0 text-[1.08rem] font-bold text-gray-900">Historical Performance Dashboard</h3>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selectedEntity && (
            <a href={selectedEntity.profile_url || "/profiles"} className="px-3.5 py-1.5 bg-gray-100 border border-gray-300 rounded-md text-gray-800 text-[0.78rem] font-semibold no-underline hover:bg-gray-200 transition-colors">
              View Profile
            </a>
          )}
          <button className="px-3.5 py-1.5 bg-gray-100 border border-gray-300 rounded-md text-gray-800 text-[0.78rem] font-semibold cursor-pointer hover:bg-gray-200 transition-colors">
            Export
          </button>
        </div>
      </div>

      {/* Controls */}
      <div className="grid grid-cols-[0.8fr_1.4fr_0.9fr] gap-3 mb-4 max-md:grid-cols-1">
        <label className="grid gap-1.5">
          <span className="text-gray-500 text-[0.66rem] font-bold font-mono uppercase tracking-wider">Entity Type</span>
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setEntityName(""); }}
            className="h-[38px] border border-gray-200 rounded-lg bg-white text-gray-900 text-sm font-medium px-2.5 focus:outline-2 focus:outline-[#1a5276]">
            {data.entity_types.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-gray-500 text-[0.66rem] font-bold font-mono uppercase tracking-wider">Entity Name</span>
          <input type="search" value={entityName} onChange={(e) => setEntityName(e.target.value)} list="perf-entities"
            className="h-[38px] border border-gray-200 rounded-lg bg-white text-gray-900 text-sm font-medium px-2.5 focus:outline-2 focus:outline-[#1a5276]" />
          <datalist id="perf-entities">
            {filteredEntities.map((e) => <option key={e.slug} value={e.name} />)}
          </datalist>
        </label>
        <label className="grid gap-1.5">
          <span className="text-gray-500 text-[0.66rem] font-bold font-mono uppercase tracking-wider">Chart Type</span>
          <select value={chartType} onChange={(e) => setChartType(e.target.value)}
            className="h-[38px] border border-gray-200 rounded-lg bg-white text-gray-900 text-sm font-medium px-2.5 focus:outline-2 focus:outline-[#1a5276]">
            {data.chart_types.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
      </div>

      {/* Chart */}
      {selectedEntity ? (
        <div className="border border-gray-200 rounded-lg bg-gradient-to-b from-white to-[#f8fbff] p-3.5">
          {chartType === "aum_over_time" && <AumChart entity={selectedEntity} />}
          {chartType === "growth_decline" && <GrowthChart entity={selectedEntity} />}
          {chartType === "benchmark_percentile" && <BenchmarkChart entity={selectedEntity} />}
        </div>
      ) : (
        <div className="py-6 text-center text-gray-500">
          <strong className="block mb-1.5 text-gray-700">No performance series available.</strong>
          <p className="m-0 text-sm">Open profiles for current AUM snapshots.</p>
        </div>
      )}

      {/* Benchmark summary */}
      {selectedEntity && (
        <div className="mt-3 p-3 border border-gray-200 rounded-lg">
          <strong>{(data.chart_types.find((c) => c.key === chartType) || { label: "AUM over time" }).label}</strong>
          <p className="m-0 text-sm text-gray-600">{selectedEntity.benchmark || ""}</p>
          <p className="m-0 text-sm text-gray-600">{selectedEntity.growth_display || "Historical series"} &middot; CAGR {selectedEntity.cagr_display || "N/A"}</p>
        </div>
      )}
    </article>
  );
}

function AumChart({ entity }: { entity: PerformanceEntity }) {
  const points = entity.points || [];
  const max = Math.max(...points.map((p) => Number(p.assets || 0)), 1);
  return (
    <>
      <div className="flex justify-between items-center gap-3 mb-3">
        <strong className="text-gray-900">{entity.name}</strong>
        <span className="text-gray-600 text-sm">{entity.chart_label || "Historical AUM"} &middot; {entity.latest_assets_display || "Not disclosed"}</span>
      </div>
      <div className="grid gap-2">
        {points.slice(-12).map((p) => {
          const w = Math.max(6, Math.round((Number(p.assets || 0) / max) * 100));
          return (
            <div key={p.label} className="grid grid-cols-[84px_minmax(80px,1fr)_72px] gap-2.5 items-center text-xs text-gray-600">
              <span>{p.label}</span>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className="h-full rounded-full bg-gradient-to-r from-[#1a5276] to-[#a61c20]" style={{ width: `${w}%` }} />
              </div>
              <strong className="text-right text-gray-900">{p.assets_display}</strong>
            </div>
          );
        })}
      </div>
    </>
  );
}

function GrowthChart({ entity }: { entity: PerformanceEntity }) {
  const points = entity.points || [];
  const rows = points.map((p, i) => {
    const prev = points[i - 1];
    const prevAssets = Number(prev?.assets || 0);
    const assets = Number(p.assets || 0);
    const change = prevAssets ? ((assets - prevAssets) / prevAssets) * 100 : null;
    return { point: p, change };
  }).slice(-12);
  const maxAbs = Math.max(...rows.map((r) => Math.abs(r.change || 0)), 1);

  return (
    <>
      <div className="flex justify-between items-center gap-3 mb-3">
        <strong className="text-gray-900">{entity.name}</strong>
        <span className="text-gray-600 text-sm">{entity.first_label} to {entity.latest_label} &middot; {entity.growth_display || "N/A"}</span>
      </div>
      <div className="grid gap-2">
        {rows.map(({ point: p, change }) => {
          const hasChange = change !== null && Number.isFinite(change);
          const w = hasChange ? Math.max(6, Math.round((Math.abs(change!) / maxAbs) * 100)) : 0;
          const color = !hasChange ? "bg-gray-300" : change! >= 0 ? "bg-gradient-to-r from-green-600 to-[#1a5276]" : "bg-gradient-to-r from-[#a61c20] to-amber-600";
          return (
            <div key={p.label} className="grid grid-cols-[84px_minmax(80px,1fr)_72px] gap-2.5 items-center text-xs text-gray-600">
              <span>{p.label}</span>
              <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
              </div>
              <strong className="text-right text-gray-900 tabular-nums">{hasChange ? `${change! >= 0 ? "+" : ""}${Math.abs(change!) >= 10 ? change!.toFixed(0) : change!.toFixed(1)}%` : "Base"}</strong>
            </div>
          );
        })}
      </div>
    </>
  );
}

function BenchmarkChart({ entity }: { entity: PerformanceEntity }) {
  const cards = [
    { label: "Peer group", value: entity.peer_group || entity.type || "Peer set", note: entity.benchmark || "Current peer-set benchmark." },
    { label: "Peer percentile", value: entity.peer_percentile ? `${entity.peer_percentile}th` : "Not ranked", note: "AUM position among comparable institutions." },
    { label: "Series growth", value: entity.growth_display || "N/A", note: `${entity.first_label || "First period"} to ${entity.latest_label || "latest period"}.` },
    { label: "CAGR", value: entity.cagr_display || "N/A", note: "Annualized change across the published AUM series." },
  ];
  return (
    <>
      <div className="flex justify-between items-center gap-3 mb-3">
        <strong className="text-gray-900">{entity.name}</strong>
        <span className="text-gray-600 text-sm">{entity.latest_assets_display || "Not disclosed"} &middot; {entity.chart_label || "AUM series"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {cards.map((c) => (
          <div key={c.label} className="border border-gray-200 rounded-lg bg-white p-3">
            <span className="block mb-1 text-gray-500 text-[0.68rem] font-extrabold uppercase">{c.label}</span>
            <strong className="block text-gray-900">{c.value}</strong>
            <p className="m-0 mt-1.5 text-gray-600 text-xs leading-snug">{c.note}</p>
          </div>
        ))}
      </div>
    </>
  );
}
