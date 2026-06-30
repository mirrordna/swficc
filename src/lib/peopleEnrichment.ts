import type { Row } from "@/lib/sourcePackets";
import { text } from "@/lib/sourcePackets";

export type PeopleEnrichmentStatus = "pending" | "candidate_found" | "high_confidence" | "needs_review" | "verified" | "rejected";

export type PeopleEnrichmentCandidate = {
  id: string;
  personName: string;
  institution: string;
  country: string;
  swfiSourceUrl: string;
  candidateLabel: string;
  candidateUrl: string;
  candidateSource: string;
  evidence: string;
  confidence: number;
  status: PeopleEnrichmentStatus;
  reviewedBy?: string;
  reviewedAt?: string;
};

export type VerifiedPeopleLink = {
  label: string;
  href: string;
  source: string;
};

export const PEOPLE_ENRICHMENT_CANDIDATES: PeopleEnrichmentCandidate[] = [
  {
    id: "people-enrichment-5d478c85db50f72668ea53a6",
    personName: "William A Ackman",
    institution: "Not disclosed",
    country: "United States",
    swfiSourceUrl: "https://www.swfi.com/v1/people/5d478c85db50f72668ea53a6",
    candidateLabel: "LinkedIn people search",
    candidateUrl: "https://www.linkedin.com/search/results/people/?keywords=William%20A%20Ackman",
    candidateSource: "Operator candidate discovery",
    evidence: "Candidate search only. No profile URL has been approved for publication.",
    confidence: 45,
    status: "needs_review",
  },
  {
    id: "people-enrichment-61badf076c79e6d5c05ca50a",
    personName: "Brett Crosby",
    institution: "Not disclosed",
    country: "United States",
    swfiSourceUrl: "https://www.swfi.com/v1/people/61badf076c79e6d5c05ca50a",
    candidateLabel: "LinkedIn people search",
    candidateUrl: "https://www.linkedin.com/search/results/people/?keywords=Brett%20Crosby",
    candidateSource: "Operator candidate discovery",
    evidence: "Candidate search only. Multiple public people can share this name; review is required before write-back.",
    confidence: 38,
    status: "needs_review",
  },
  {
    id: "people-enrichment-64de5c641a326288aa216fef",
    personName: "Bret Mcleod",
    institution: "Not disclosed",
    country: "Sweden",
    swfiSourceUrl: "https://www.swfi.com/v1/people/64de5c641a326288aa216fef",
    candidateLabel: "LinkedIn people search",
    candidateUrl: "https://www.linkedin.com/search/results/people/?keywords=Bret%20Mcleod",
    candidateSource: "Operator candidate discovery",
    evidence: "Candidate search only. Country match is insufficient without profile-level evidence.",
    confidence: 34,
    status: "candidate_found",
  },
  {
    id: "people-enrichment-616c8e5fbff9af209fddc7a4",
    personName: "Brad Mertz",
    institution: "Not disclosed",
    country: "United States",
    swfiSourceUrl: "https://www.swfi.com/v1/people/616c8e5fbff9af209fddc7a4",
    candidateLabel: "LinkedIn people search",
    candidateUrl: "https://www.linkedin.com/search/results/people/?keywords=Brad%20Mertz",
    candidateSource: "Operator candidate discovery",
    evidence: "Candidate search only. The enrichment queue must verify employer/title before approval.",
    confidence: 32,
    status: "pending",
  },
];

export function verifiedPeopleLinks(record: Row, sourceUrl = ""): VerifiedPeopleLink[] {
  const links: VerifiedPeopleLink[] = [];
  const linkedIn = verifiedLinkedIn(text(record.linkedin_url || record.linkedin || record.linkedin_profile || record.linked_in, ""));
  if (linkedIn) {
    links.push({
      label: "LinkedIn",
      href: linkedIn,
      source: "SWFI person record",
    });
  }
  const source = sourceUrl || text(record.source_url || record.swfi_url, "");
  if (source) {
    links.push({
      label: "SWFI source record",
      href: source,
      source: "SWFI person record",
    });
  }
  return links;
}

export function enrichmentStats(items: PeopleEnrichmentCandidate[] = PEOPLE_ENRICHMENT_CANDIDATES) {
  return {
    pending: items.filter((item) => item.status === "pending").length,
    candidateFound: items.filter((item) => item.status === "candidate_found").length,
    highConfidence: items.filter((item) => item.status === "high_confidence").length,
    needsReview: items.filter((item) => item.status === "needs_review").length,
    verified: items.filter((item) => item.status === "verified").length,
    rejected: items.filter((item) => item.status === "rejected").length,
  };
}

function verifiedLinkedIn(value: string): string {
  const clean = value.trim();
  if (!clean) return "";
  try {
    const parsed = new URL(clean);
    const host = parsed.hostname.replace(/^www\./, "");
    if (host !== "linkedin.com") return "";
    if (!parsed.pathname.startsWith("/in/") && !parsed.pathname.startsWith("/pub/")) return "";
    return parsed.toString();
  } catch {
    return "";
  }
}
