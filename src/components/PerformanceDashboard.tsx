"use client";

import { useState, useMemo } from "react";
import type { HistoricalPerformance, PerformanceEntity } from "@/lib/types";
import { selfContainedHref, sourceProvenanceHref } from "@/lib/selfContainedLinks";
import SourceGap from "./SourceGap";

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
  const hasPoints = Boolean(selectedEntity?.points?.length);
  const profileProvenance = sourceProvenanceHref(selectedEntity?.profile_url);

  return (
    <article className="border border-gray-300 bg-white p-3">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h3 className="m-0 text-base font-semibold text-black">Historical Performance Dashboard</h3>
        </div>
        <div className="flex gap-2 flex-shrink-0">
          {selectedEntity && (
            <a
              href={selfContainedHref(selectedEntity.profile_url, "/profiles/")}
              data-source-state={profileProvenance ? "on-file" : undefined}
              title={profileProvenance ? "View details" : undefined}
              className="border border-gray-300 px-3 py-1.5 text-sm text-black no-underline hover:bg-gray-50"
            >
              View Profile
            </a>
          )}
          <button disabled={!hasPoints} className="border border-gray-300 px-3 py-1.5 text-sm text-black disabled:text-gray-400">
            Export
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 mb-4 md:grid-cols-[0.8fr_1.4fr_0.9fr]">
        <label className="grid gap-1.5">
          <span className="text-sm text-black">Entity Type</span>
          <select value={entityType} onChange={(e) => { setEntityType(e.target.value); setEntityName(""); }}
            className="h-[38px] border border-gray-300 bg-white px-2.5 text-sm text-black">
            <optgroup label="Top 5">
              {data.entity_types.slice(0, 5).map((t) => <option key={t} value={t}>{t}</option>)}
            </optgroup>
            {data.entity_types.length > 5 ? (
              <optgroup label="All types">
                {data.entity_types.slice(5).map((t) => <option key={t} value={t}>{t}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-black">Entity Name</span>
          <input type="search" value={entityName} onChange={(e) => setEntityName(e.target.value)} list="perf-entities"
            className="h-[38px] border border-gray-300 bg-white px-2.5 text-sm text-black" />
          <datalist id="perf-entities">
            {filteredEntities.map((e) => <option key={e.slug} value={e.name} />)}
          </datalist>
        </label>
        <label className="grid gap-1.5">
          <span className="text-sm text-black">Chart Type</span>
          <select value={chartType} onChange={(e) => setChartType(e.target.value)}
            className="h-[38px] border border-gray-300 bg-white px-2.5 text-sm text-black">
            <optgroup label="Top 5">
              {data.chart_types.slice(0, 5).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </optgroup>
            {data.chart_types.length > 5 ? (
              <optgroup label="All chart types">
                {data.chart_types.slice(5).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </optgroup>
            ) : null}
          </select>
        </label>
      </div>

      {selectedEntity ? (
        <div className="border border-gray-300 p-3">
          {chartType === "aum_over_time" && <AumChart entity={selectedEntity} />}
          {chartType === "growth_decline" && <GrowthChart entity={selectedEntity} />}
          {chartType === "benchmark_percentile" && <BenchmarkChart entity={selectedEntity} />}
        </div>
      ) : (
        <div className="py-6 text-center text-gray-500">
          <strong className="block mb-1.5 text-gray-700">No performance series available.</strong>
          <p className="m-0 text-sm">Historical performance requires approved SWFI AUM-series rows.</p>
        </div>
      )}

      {selectedEntity && (
        <div className="mt-3 border border-gray-300 p-3">
          <strong>{(data.chart_types.find((c) => c.key === chartType) || { label: "AUM over time" }).label}</strong>
          <p className="m-0 text-sm text-gray-600">{selectedEntity.benchmark || ""}</p>
          <p className="m-0 text-sm text-gray-600">{selectedEntity.growth_display || "Not disclosed"} &middot; CAGR {selectedEntity.cagr_display || "Not disclosed"}</p>
        </div>
      )}
    </article>
  );
}

function AumChart({ entity }: { entity: PerformanceEntity }) {
  const points = entity.points || [];
  if (!points.length) {
    return <SourceGap message="AUM over time requires approved historical AUM rows for the selected entity." />;
  }
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
              <div className="h-2 border border-gray-300 bg-white">
                <div className="h-full bg-gray-600" style={{ width: `${w}%` }} />
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
  if (!points.length) {
    return <SourceGap message="Growth / decline requires approved historical AUM rows for the selected entity." />;
  }
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
        <span className="text-gray-600 text-sm">{entity.first_label || "Not disclosed"} to {entity.latest_label || "Not disclosed"} &middot; {entity.growth_display || "Not disclosed"}</span>
      </div>
      <div className="grid gap-2">
        {rows.map(({ point: p, change }) => {
          const hasChange = change !== null && Number.isFinite(change);
          const w = hasChange ? Math.max(6, Math.round((Math.abs(change!) / maxAbs) * 100)) : 0;
          const color = !hasChange ? "bg-gray-300" : change! >= 0 ? "bg-gray-600" : "bg-gray-800";
          return (
            <div key={p.label} className="grid grid-cols-[84px_minmax(80px,1fr)_72px] gap-2.5 items-center text-xs text-gray-600">
              <span>{p.label}</span>
              <div className="h-2 border border-gray-300 bg-white">
                <div className={`h-full ${color}`} style={{ width: `${w}%` }} />
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
    { label: "Peer group", value: entity.peer_group || entity.type || "Not disclosed", note: entity.benchmark || "Not disclosed." },
    { label: "Peer percentile", value: entity.peer_percentile ? `${entity.peer_percentile}th` : "Not ranked", note: "AUM position among comparable institutions." },
    { label: "Series growth", value: entity.growth_display || "Not disclosed", note: `${entity.first_label || "Not disclosed"} to ${entity.latest_label || "Not disclosed"}.` },
    { label: "CAGR", value: entity.cagr_display || "Not disclosed", note: "Requires approved SWFI AUM history." },
  ];
  return (
    <>
      <div className="flex justify-between items-center gap-3 mb-3">
        <strong className="text-gray-900">{entity.name}</strong>
        <span className="text-gray-600 text-sm">{entity.latest_assets_display || "Not disclosed"} &middot; {entity.chart_label || "AUM series"}</span>
      </div>
      <div className="grid grid-cols-2 gap-2.5">
        {cards.map((c) => (
          <div key={c.label} className="border border-gray-300 bg-white p-3">
            <span className="block mb-1 text-xs text-gray-600">{c.label}</span>
            <strong className="block text-gray-900">{c.value}</strong>
            <p className="m-0 mt-1.5 text-gray-600 text-xs leading-snug">{c.note}</p>
          </div>
        ))}
      </div>
    </>
  );
}
