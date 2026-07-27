"use client";

// Minutes F (2026-07-03): every element must have working function. Alerts
// has no feed of its own yet — but RFP deadlines are the platform's one
// genuinely time-sensitive dataset, already served by the mandates
// endpoint. This page renders a live deadline-proximity strip (visual law
// 2026-07-06: "every page should have a visual graph or relevant") and
// says honestly that a real alerts feed does not exist yet.

import { useEffect, useState } from "react";
import AlertsRuleManager from "@/components/AlertsRuleManager";
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
  // Key Enhancements PDF section 5, Phase A: the global activity feed
  // (new deals + open mandates) from /v1/swfi/activity-feed. Until the
  // backend serving that endpoint is deployed, the packet resolves to a
  // gap and this page keeps saying so instead of pretending.
  const [feedPacket, setFeedPacket] = useState<Packet | undefined>(undefined);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    const controller = new AbortController();
    void fetchPacket("/api/live-opportunities/v1", 120_000, { signal: controller.signal, attempts: 2 }).then((next) => {
      if (!controller.signal.aborted) setPacket(next ?? null);
    });
    void fetchPacket("/v1/swfi/activity-feed?limit=10&days=30", 120_000, { signal: controller.signal, attempts: 2 }).then((next) => {
      if (!controller.signal.aborted) setFeedPacket(next ?? null);
    });
    return () => controller.abort();
  }, []);
  const feedLive = feedPacket !== undefined && isFact(feedPacket);
  const feedDeals = feedLive ? rows(feedPacket, "deals") : [];
  const feedMandates = feedLive ? rows(feedPacket, "mandates") : [];

  const rfpRows = packet && isFact(packet) ? rows(packet, "rows") : [];
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
            {feedLive
              ? "Live Compass RFP deadlines, counted below from the same records the RFPs & Mandates page shows — and beneath them, the global activity feed of new deals and open mandates. Click a bar for the full list."
              : "A dedicated alerts feed is not being served by this deployment yet. What IS time-sensitive today: live Compass RFP deadlines, counted below from the same records the RFPs & Mandates page shows. Click a bar for the full list."}
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
        <section className="grid gap-3 border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Activity feed</div>
          <h2 className="m-0 text-[18px] font-bold text-[#11314F]">New deals &amp; open mandates</h2>
          {feedPacket === undefined ? (
            <div className="rounded bg-[#F6F8FA] px-3 py-3 text-[12px] font-semibold text-[#657282]">Loading…</div>
          ) : !feedLive ? (
            <div className="rounded bg-[#F6F8FA] px-3 py-3 text-[12px] font-semibold text-[#657282]">
              The activity-feed source is not available from this deployment yet. Nothing is estimated — deals and mandates stay fully browsable on their own pages below.
            </div>
          ) : feedDeals.length === 0 && feedMandates.length === 0 ? (
            <div className="rounded bg-[#F6F8FA] px-3 py-3 text-[12px] font-semibold text-[#657282]">
              No new deals in the last 30 days and no open mandates in the loaded records.
            </div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2">
              {[
                { heading: "Latest deals (30 days)", items: feedDeals },
                { heading: "Open mandates", items: feedMandates },
              ].map((group) => (
                <div key={group.heading} className="grid content-start gap-2">
                  <div className="text-[12px] font-bold uppercase tracking-[0.05em] text-[#41566B]">{group.heading}</div>
                  {group.items.length === 0 ? (
                    <div className="rounded bg-[#F6F8FA] px-3 py-2 text-[12px] font-semibold text-[#657282]">None in the loaded records.</div>
                  ) : (
                    group.items.map((item, index) => {
                      const title = text(item.title, "Not disclosed");
                      const sourceUrl = text(item.source_url, "");
                      const meta = [text(item.institution, ""), text(item.type, ""), text(item.detail, ""), text(item.deadline ? `Due ${text(item.deadline, "")}` : item.date, "")]
                        .filter(Boolean)
                        .join(" · ");
                      return (
                        <div key={`${group.heading}-${text(item.id, String(index))}`} className="grid gap-0.5 border-b border-[#EEF1F4] pb-2">
                          {sourceUrl ? (
                            <a href={sourceUrl} className="text-[13px] font-bold text-[#16538C] underline">{title}</a>
                          ) : (
                            <span className="text-[13px] font-bold text-[#11314F]">{title}</span>
                          )}
                          {meta ? <span className="text-[12px] text-[#657282]">{meta}</span> : null}
                        </div>
                      );
                    })
                  )}
                </div>
              ))}
            </div>
          )}
        </section>
        <AlertsRuleManager />
      </main>
    </>
  );
}
