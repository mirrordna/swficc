"use client";

// Minutes F (2026-07-03): every element must have working function. Alerts
// has no feed of its own yet — but RFP deadlines are the platform's one
// genuinely time-sensitive dataset, already served by the mandates
// endpoint. This page renders a live deadline-proximity strip (visual law
// 2026-07-06: "every page should have a visual graph or relevant") and
// says honestly that a real alerts feed does not exist yet.

import { useEffect, useState } from "react";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";
import { appHref } from "@/lib/selfContainedLinks";
import { fetchPacket, isFact, rows, text, type Packet } from "@/lib/sourcePackets";

const BUCKETS = [
  { label: "Due in 7 days", days: 7 },
  { label: "Due in 30 days", days: 30 },
  { label: "Due in 60 days", days: 60 },
  { label: "Due in 90 days", days: 90 },
] as const;

function deadlineTime(value: unknown): number | null {
  const raw = text(value as string, "").trim();
  if (!raw || raw === "Not disclosed") return null;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function AlertsPage() {
  const [packet, setPacket] = useState<Packet | undefined>(undefined);
  useEffect(() => {
    const controller = new AbortController();
    void fetchPacket("/api/live-opportunities/v1", 120_000, { signal: controller.signal, attempts: 2 }).then((next) => {
      if (!controller.signal.aborted) setPacket(next ?? null);
    });
    return () => controller.abort();
  }, []);

  const rfpRows = packet && isFact(packet) ? rows(packet, "rows") : [];
  const now = Date.now();
  const dated = rfpRows
    .map((row) => ({ row, at: deadlineTime(row.deadline || row.due_at) }))
    .filter((entry): entry is { row: Record<string, unknown>; at: number } => entry.at !== null && entry.at >= now);
  const counts = BUCKETS.map((bucket) => ({
    ...bucket,
    count: dated.filter((entry) => entry.at <= now + bucket.days * 86_400_000).length,
  }));
  const maxCount = Math.max(1, ...counts.map((bucket) => bucket.count));
  const undatedCount = rfpRows.length - dated.length;

  return (
    <>
      <SwfiBrandHeader showSearch={false} />
      <main className="mx-auto grid w-full max-w-[960px] gap-4 px-4 py-6 lg:px-[72px]">
        <section className="grid gap-3 border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Alerts</div>
          <h1 className="m-0 text-[24px] font-bold text-[#11314F]">RFP deadlines approaching</h1>
          <p className="m-0 text-sm leading-6 text-[#41566B]">
            A dedicated alerts feed does not exist yet in this preview. What IS time-sensitive today: live Compass RFP deadlines, counted below from the same records the RFPs &amp; Mandates page shows. Click a bar for the full list.
          </p>
          {packet === undefined ? (
            <div className="rounded bg-[#F6F8FA] px-3 py-3 text-[12px] font-semibold text-[#657282]">Loading…</div>
          ) : dated.length ? (
            <div className="grid gap-2" role="img" aria-label="Open RFPs by deadline proximity">
              {counts.map((bucket) => (
                <a key={bucket.label} href={appHref("/mandates/")} className="grid grid-cols-[110px_minmax(0,1fr)_46px] items-center gap-2 text-inherit no-underline">
                  <span className="text-[12px] font-bold text-[#41566B]">{bucket.label}</span>
                  <span className="block h-[10px] overflow-hidden rounded bg-[#EAF1F7]">
                    <span className="block h-full rounded bg-[#0A66C2]" style={{ width: `${Math.max(bucket.count ? 6 : 0, Math.round((bucket.count / maxCount) * 100))}%` }} />
                  </span>
                  <span className="text-right text-[13px] font-extrabold text-[#0A3A7A]">{bucket.count}</span>
                </a>
              ))}
              <div className="text-[10.5px] font-semibold text-[#7B8996]">
                Cumulative counts from {dated.length} open RFPs with disclosed future deadlines{undatedCount > 0 ? ` (${undatedCount} more without a usable deadline are on the RFPs page)` : ""}. Nothing is estimated.
              </div>
            </div>
          ) : (
            <div className="rounded bg-[#F6F8FA] px-3 py-3 text-[12px] font-semibold text-[#657282]">
              No open RFPs with disclosed future deadlines in the loaded records.
            </div>
          )}
          <div className="flex flex-wrap gap-2 text-sm">
            <a href={appHref("/mandates/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              RFPs &amp; Mandates
            </a>
            <a href={appHref("/intelligence/")} className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              Research &amp; Analytics
            </a>
            <a href="https://www.swfi.com/v1/signin/" className="border border-[#C7D2DD] bg-white px-3 py-2 font-semibold text-[#16538C] underline">
              swfi.com account
            </a>
          </div>
        </section>
      </main>
    </>
  );
}
