"use client";

import { useMemo, useState } from "react";
import { PEOPLE_ENRICHMENT_CANDIDATES, enrichmentStats, type PeopleEnrichmentCandidate, type PeopleEnrichmentStatus } from "@/lib/peopleEnrichment";
import { appHref } from "@/lib/selfContainedLinks";

type Decision = {
  id: string;
  personName: string;
  decision: "approved" | "rejected";
  at: string;
};

const statusLabels: Record<PeopleEnrichmentStatus, string> = {
  pending: "Pending",
  candidate_found: "Candidate Found",
  high_confidence: "High Confidence",
  needs_review: "Needs Review",
  verified: "Verified",
  rejected: "Rejected",
};

export default function PeopleEnrichmentConsole() {
  const [items, setItems] = useState<PeopleEnrichmentCandidate[]>(PEOPLE_ENRICHMENT_CANDIDATES);
  const [decision, setDecision] = useState<Decision | null>(null);
  const stats = useMemo(() => enrichmentStats(items), [items]);

  function decide(item: PeopleEnrichmentCandidate, next: "approved" | "rejected") {
    const at = new Date().toISOString();
    setItems((current) => current.map((row) => row.id === item.id
      ? {
          ...row,
          status: next === "approved" ? "verified" : "rejected",
          evidence: next === "approved"
            ? "Demo-approved in browser state only. Production verification requires an exact profile URL and backend write-back receipt."
            : "Rejected in browser state for this demo session. No production record was changed.",
          reviewedBy: "demo-reviewer",
          reviewedAt: at,
        }
      : row));
    setDecision({ id: item.id, personName: item.personName, decision: next, at });
  }

  return (
    <section data-people-enrichment-demo data-testid="people-enrichment-console" className="grid gap-4 border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Governed Enrichment</div>
          <h1 className="m-0 mt-1 text-[24px] font-bold text-[#11314F]">People Enrichment Review Queue</h1>
          <p className="m-0 mt-1 max-w-[760px] text-sm leading-6 text-[#41566B]">
            Candidate links are review-only until approved. The demo does not write to MongoDB and does not publish candidate links to public People pages.
          </p>
        </div>
        <a href={appHref("/people/")} className="border border-[#C7D2DD] bg-white px-3 py-2 text-sm font-semibold text-[#16538C] underline">
          Open People
        </a>
      </div>

      <div className="grid gap-3 md:grid-cols-5">
        <Metric label="Pending" value={stats.pending} />
        <Metric label="Candidate Found" value={stats.candidateFound} />
        <Metric label="Needs Review" value={stats.needsReview} />
        <Metric label="Verified" value={stats.verified} />
        <Metric label="Rejected" value={stats.rejected} />
      </div>

      <div className="overflow-x-auto border border-[#E2E8EF]">
        <table className="w-full min-w-[1040px] border-collapse text-left text-sm">
          <thead className="border-b border-[#DCE3EA] bg-[#F7F9FA] text-[11px] uppercase tracking-[0.05em] text-[#7A8A9B]">
            <tr>
              <th className="px-3 py-2">Person</th>
              <th className="px-3 py-2">Institution</th>
              <th className="px-3 py-2">Candidate</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Confidence</th>
              <th className="px-3 py-2">Status</th>
              <th className="px-3 py-2">Evidence</th>
              <th className="px-3 py-2">Decision</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => (
              <tr key={item.id} className="border-b border-[#F2F5F8] align-top text-[#41566B]">
                <td className="px-3 py-3">
                  <a href={appHref(`/people/detail/?source=${encodeURIComponent(item.swfiSourceUrl)}`)} className="font-semibold text-[#16538C] underline">
                    {item.personName}
                  </a>
                  <div className="mt-1 text-[12px] text-[#7A8A9B]">{item.country}</div>
                </td>
                <td className="px-3 py-3">{item.institution}</td>
                <td className="px-3 py-3">
                  <a href={item.candidateUrl} target="_blank" rel="noreferrer" className="text-[#16538C] underline">
                    {item.candidateLabel}
                  </a>
                </td>
                <td className="px-3 py-3">{item.candidateSource}</td>
                <td className="px-3 py-3">{item.confidence}%</td>
                <td className="px-3 py-3">
                  <span className={statusClass(item.status)}>{statusLabels[item.status]}</span>
                </td>
                <td className="px-3 py-3">{item.evidence}</td>
                <td className="px-3 py-3">
                  <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => decide(item, "approved")} className="border border-[#198754] bg-white px-3 py-1.5 font-semibold text-[#198754]">
                      Approve
                    </button>
                    <button type="button" onClick={() => decide(item, "rejected")} className="border border-[#A61C20] bg-white px-3 py-1.5 font-semibold text-[#A61C20]">
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section data-testid="people-enrichment-receipt" className="grid gap-2 border border-[#DCE3EA] bg-[#F7F9FA] p-3 text-sm text-[#41566B]">
        <div className="font-semibold text-[#11314F]">Decision Receipt</div>
        {decision ? (
          <div>
            {decision.personName} marked {decision.decision} at {decision.at}. This demo records the decision in browser state only; production write-back requires the Phase 2 backend approval endpoint.
          </div>
        ) : (
          <div>No review decision made in this browser session.</div>
        )}
      </section>
    </section>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">{label}</div>
      <div className="mt-1 text-2xl font-bold text-[#11314F]">{value.toLocaleString("en-US")}</div>
    </div>
  );
}

function statusClass(status: PeopleEnrichmentStatus): string {
  const base = "inline-flex border px-2 py-1 text-[12px] font-semibold";
  if (status === "verified") return `${base} border-[#198754] bg-[#F0FAF4] text-[#198754]`;
  if (status === "rejected") return `${base} border-[#A61C20] bg-[#FFF4F4] text-[#A61C20]`;
  if (status === "high_confidence") return `${base} border-[#0D6EFD] bg-[#F0F6FF] text-[#0D6EFD]`;
  return `${base} border-[#C7D2DD] bg-white text-[#41566B]`;
}
