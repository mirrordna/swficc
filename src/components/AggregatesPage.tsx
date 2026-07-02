"use client";

import { useEffect, useMemo, useState } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { fetchPacket, isFact, money, packetData, rows, text } from "@/lib/sourcePackets";
import { appHref } from "@/lib/selfContainedLinks";

type AggregatePoint = Record<string, unknown>;

const ENTITY_CLASSES = [
  ["pensions", "Pensions"],
  ["central_banks", "Central Banks"],
  ["swfs", "SWFs"],
  ["superannuation", "Superannuation"],
  ["endowments", "Endowments"],
  ["foundations", "Foundations"],
] as const;

const REGIONS = [
  ["all", "All"],
  ["united_states", "United States"],
  ["canada", "Canada"],
  ["europe", "Europe"],
  ["asia", "Asia"],
  ["middle_east", "Middle East"],
  ["other", "Other"],
] as const;

const SMOOTHING = [
  ["linear", "Linear Interpolation"],
  ["forward_fill", "Forward Fill"],
  ["rolling_3y", "Rolling Average (3Y)"],
  ["none", "None (raw)"],
] as const;

export default function AggregatesPage() {
  const [entityClass, setEntityClass] = useState("pensions");
  const [region, setRegion] = useState("all");
  const [smoothing, setSmoothing] = useState("linear");
  const [view, setView] = useState<"graph" | "data">("graph");
  const [packet, setPacket] = useState<Record<string, unknown>>();

  useEffect(() => {
    let active = true;
    const endpoint = `/api/entities/aggregates/v1?entity_class=${encodeURIComponent(entityClass)}&region=${encodeURIComponent(region)}&smoothing=${encodeURIComponent(smoothing)}&start_year=1971`;
    const resetTimer = window.setTimeout(() => {
      if (active) setPacket(undefined);
    }, 0);
    void fetchPacket(endpoint, 60_000, { attempts: 1 }).then((next) => {
      if (active) setPacket(next);
    });
    return () => {
      active = false;
      window.clearTimeout(resetTimer);
    };
  }, [entityClass, region, smoothing]);

  const data = packetData(packet);
  const points = useMemo(() => rows(packet, "points") as AggregatePoint[], [packet]);
  const rawPoints = useMemo(() => rows(packet, "raw_points") as AggregatePoint[], [packet]);
  const selectedLabel = labelFor(ENTITY_CLASSES, entityClass);
  const selectedRegion = labelFor(REGIONS, region);
  const ready = isFact(packet) && points.length > 0;

  return (
    <div className="min-h-screen bg-[#F4F6F8] text-[#102A43]">
      <SwfiBrandHeader searchId="aggregates-global-search" />
      <main className="mx-auto grid max-w-[1240px] gap-5 px-4 py-6">
        <nav className="flex flex-wrap gap-2 text-sm">
          <a href={appHref("/")} className="text-[#16538C] underline">Dashboard</a>
          <span className="text-[#6B7A8A]">/</span>
          <a href={appHref("/profiles/")} className="text-[#16538C] underline">Institutions</a>
          <span className="text-[#6B7A8A]">/</span>
          <span>Aggregates</span>
        </nav>

        <section className="border border-[#D7DFE8] bg-white">
          <div className="border-b border-[#D7DFE8] px-5 py-4">
            <p className="m-0 text-xs font-bold uppercase tracking-[0.12em] text-[#718096]">Entities Aggregates</p>
            <h1 className="m-0 mt-1 text-2xl font-semibold text-[#102A43]">Historical AUM Charts</h1>
          </div>

          <div className="grid gap-4 px-5 py-4">
            <div className="flex flex-wrap gap-2" aria-label="Entity class tabs">
              {ENTITY_CLASSES.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setEntityClass(value)}
                  className={`border px-3 py-2 text-sm font-semibold ${entityClass === value ? "border-[#A61C20] bg-[#A61C20] text-white" : "border-[#C7D2DD] bg-white text-[#16538C]"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2" aria-label="Region tabs">
              {REGIONS.map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setRegion(value)}
                  className={`border px-3 py-1.5 text-sm font-semibold ${region === value ? "border-[#1F4E79] bg-[#1F4E79] text-white" : "border-[#C7D2DD] bg-white text-[#16538C]"}`}
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-3">
              <label className="text-sm font-bold text-[#334E68]" htmlFor="aggregate-smoothing">Smoothing</label>
              <select
                id="aggregate-smoothing"
                value={smoothing}
                onChange={(event) => setSmoothing(event.target.value)}
                className="border border-[#C7D2DD] bg-white px-3 py-2 text-sm"
              >
                {SMOOTHING.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
              <div className="ml-auto flex border border-[#C7D2DD]">
                <button type="button" onClick={() => setView("graph")} className={`px-3 py-2 text-sm font-bold ${view === "graph" ? "bg-[#102A43] text-white" : "bg-white text-[#16538C]"}`}>Graph</button>
                <button type="button" onClick={() => setView("data")} className={`px-3 py-2 text-sm font-bold ${view === "data" ? "bg-[#102A43] text-white" : "bg-white text-[#16538C]"}`}>Data</button>
              </div>
              <button type="button" onClick={() => downloadCsv(points, rawPoints)} disabled={!ready} className="border border-[#C7D2DD] bg-white px-3 py-2 text-sm font-bold text-[#16538C] disabled:opacity-50">Export CSV</button>
              <button type="button" onClick={() => downloadPng(points, `${selectedLabel} - ${selectedRegion}`)} disabled={!ready} className="border border-[#C7D2DD] bg-white px-3 py-2 text-sm font-bold text-[#16538C] disabled:opacity-50">Export PNG</button>
            </div>
          </div>
        </section>

        <section data-brd-aggregates="true" className="border border-[#D7DFE8] bg-white p-5">
          {!packet ? <div className="py-14 text-center text-[#526171]">Loading</div> : null}
          {packet && !ready ? (
            <div className="py-14 text-center text-[#526171]">No aggregate rows are available for this selection.</div>
          ) : null}
          {ready && view === "graph" ? <AggregateChart points={points} title={`${selectedLabel} / ${selectedRegion}`} /> : null}
          {ready && view === "data" ? <AggregateTable points={points} rawPoints={rawPoints} /> : null}
        </section>

        {ready ? (
          <section className="grid gap-3 border border-[#D7DFE8] bg-white p-5 text-sm text-[#334E68] md:grid-cols-4">
            <Metric label="Entity Class" value={selectedLabel} />
            <Metric label="Region" value={selectedRegion} />
            <Metric label="Raw Source Years" value={text(data.raw_points_count, "0")} />
            <Metric label="Entities In Scope" value={Number(data.entity_count || 0).toLocaleString("en-US")} />
          </section>
        ) : null}
      </main>
    </div>
  );
}

function AggregateChart({ points, title }: { points: AggregatePoint[]; title: string }) {
  const numeric = points.filter((point) => typeof point.amount === "number");
  const max = Math.max(...numeric.map((point) => Number(point.amount || 0)), 1);
  const minYear = Math.min(...points.map((point) => Number(point.year || 0)));
  const maxYear = Math.max(...points.map((point) => Number(point.year || 0)), minYear + 1);
  const width = 980;
  const height = 420;
  const pad = 54;
  const coords = points.map((point) => {
    const year = Number(point.year || minYear);
    const amount = typeof point.amount === "number" ? Number(point.amount) : null;
    const x = pad + ((year - minYear) / Math.max(1, maxYear - minYear)) * (width - pad * 2);
    const y = amount == null ? null : height - pad - (amount / max) * (height - pad * 2);
    return { point, x, y };
  });
  const linePath = coords
    .map((coord) => coord.y == null ? "" : `${coord === coords.find((item) => item.y != null) ? "M" : "L"} ${coord.x.toFixed(1)} ${coord.y.toFixed(1)}`)
    .filter(Boolean)
    .join(" ");
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="m-0 text-xl font-semibold text-[#102A43]">{title}</h2>
          <p className="m-0 mt-1 text-sm text-[#526171]">Hollow markers are smoothed values. Solid markers are raw SWFI AUM source years.</p>
        </div>
        <div className="text-right text-sm font-semibold text-[#526171]">Latest point: {money(numeric.at(-1)?.amount)}</div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full border border-[#E2E8F0] bg-[#FBFCFE]" role="img" aria-label="Historical AUM aggregate chart">
        <line x1={pad} y1={height - pad} x2={width - pad} y2={height - pad} stroke="#AAB7C4" />
        <line x1={pad} y1={pad} x2={pad} y2={height - pad} stroke="#AAB7C4" />
        <path d={linePath} fill="none" stroke="#1F4E79" strokeWidth="3" />
        {coords.map(({ point, x, y }) => y == null ? null : (
          <circle
            key={String(point.year)}
            cx={x}
            cy={y}
            r="5"
            fill={point.estimated ? "#FFFFFF" : "#A61C20"}
            stroke={point.estimated ? "#1F4E79" : "#A61C20"}
            strokeWidth="2"
          >
            <title>{`${point.year}: ${text(point.amount_display)}${point.estimated ? " estimated" : " raw"}`}</title>
          </circle>
        ))}
        {coords.filter((_, index) => index % Math.max(1, Math.ceil(coords.length / 8)) === 0).map(({ point, x }) => (
          <text key={`x-${String(point.year)}`} x={x} y={height - 18} textAnchor="middle" fontSize="12" fill="#526171">{String(point.year)}</text>
        ))}
        <text x={pad} y={24} fontSize="12" fill="#526171">{money(max)}</text>
      </svg>
    </div>
  );
}

function AggregateTable({ points, rawPoints }: { points: AggregatePoint[]; rawPoints: AggregatePoint[] }) {
  const rawByYear = new Map(rawPoints.map((point) => [String(point.year), point]));
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="bg-[#F1F5F9] text-[#334E68]">
            {["Year", "Smoothed AUM", "Raw AUM", "Point Type"].map((header) => <th key={header} className="border border-[#D7DFE8] px-3 py-2">{header}</th>)}
          </tr>
        </thead>
        <tbody>
          {points.map((point) => {
            const raw = rawByYear.get(String(point.year));
            return (
              <tr key={String(point.year)}>
                <td className="border border-[#D7DFE8] px-3 py-2 font-semibold">{String(point.year)}</td>
                <td className="border border-[#D7DFE8] px-3 py-2">{text(point.amount_display, "No data")}</td>
                <td className="border border-[#D7DFE8] px-3 py-2">{raw ? text(raw.amount_display) : "No data"}</td>
                <td className="border border-[#D7DFE8] px-3 py-2">{point.estimated ? "Smoothed" : point.gap ? "Gap" : "Raw"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs font-bold uppercase tracking-[0.08em] text-[#718096]">{label}</div>
      <div className="mt-1 text-lg font-semibold text-[#102A43]">{value}</div>
    </div>
  );
}

function labelFor(values: readonly (readonly [string, string])[], selected: string): string {
  return values.find(([value]) => value === selected)?.[1] || selected;
}

function downloadCsv(points: AggregatePoint[], rawPoints: AggregatePoint[]) {
  const rawByYear = new Map(rawPoints.map((point) => [String(point.year), point]));
  const csv = [
    ["Year", "Smoothed AUM", "Raw AUM", "Point Type"],
    ...points.map((point) => {
      const raw = rawByYear.get(String(point.year));
      return [
        String(point.year || ""),
        String(point.amount || ""),
        String(raw?.amount || ""),
        point.estimated ? "Smoothed" : point.gap ? "Gap" : "Raw",
      ];
    }),
  ].map((row) => row.map((cell) => `"${cell.replaceAll("\"", "\"\"")}"`).join(",")).join("\n");
  downloadBlob(new Blob([csv], { type: "text/csv;charset=utf-8" }), "swfi-entity-aggregates.csv");
}

function downloadPng(points: AggregatePoint[], title: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 960;
  canvas.height = 540;
  const context = canvas.getContext("2d");
  if (!context) return;
  context.fillStyle = "#FFFFFF";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = "#102A43";
  context.font = "bold 24px Arial";
  context.fillText(title, 40, 48);
  const numeric = points.filter((point) => typeof point.amount === "number");
  const max = Math.max(...numeric.map((point) => Number(point.amount || 0)), 1);
  const minYear = Math.min(...points.map((point) => Number(point.year || 0)));
  const maxYear = Math.max(...points.map((point) => Number(point.year || 0)), minYear + 1);
  const left = 60;
  const top = 84;
  const width = 840;
  const height = 360;
  context.strokeStyle = "#AAB7C4";
  context.beginPath();
  context.moveTo(left, top);
  context.lineTo(left, top + height);
  context.lineTo(left + width, top + height);
  context.stroke();
  context.strokeStyle = "#1F4E79";
  context.lineWidth = 3;
  context.beginPath();
  let started = false;
  for (const point of points) {
    if (typeof point.amount !== "number") continue;
    const x = left + ((Number(point.year) - minYear) / Math.max(1, maxYear - minYear)) * width;
    const y = top + height - (Number(point.amount) / max) * height;
    if (!started) {
      context.moveTo(x, y);
      started = true;
    } else {
      context.lineTo(x, y);
    }
  }
  context.stroke();
  context.fillStyle = "#526171";
  context.font = "14px Arial";
  context.fillText(`Latest: ${money(numeric.at(-1)?.amount)}`, 40, 500);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, "swfi-entity-aggregates.png");
  }, "image/png");
}

function downloadBlob(blob: Blob, filename: string) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = filename;
  link.click();
  URL.revokeObjectURL(link.href);
}
