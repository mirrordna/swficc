import {
  comparisonAllocationEntries,
  comparisonName,
  comparisonPeerKey,
  comparisonSourceUrl,
  comparisonStrategy,
  comparisonTransactionRegions,
  comparisonTransactionTotal,
} from "@/lib/competitionAnalysis";
import { isFact, type Packet, type Row } from "@/lib/sourcePackets";

export const STRATEGY_ENGINE_VERSION = "swfi.strategy-engine.v1";

export type StrategyEvidenceLink = {
  label: string;
  url: string;
};

export type StrategySignal = {
  id: string;
  title: string;
  detail: string;
  basis: "strategy" | "allocation" | "transactions" | "regional-sample" | "coverage";
  state: "observation" | "coverage-gap";
  evidence: StrategyEvidenceLink[];
};

export type StrategyDimension = {
  id: "profile-context" | "peer-position" | "allocation" | "activity" | "geography" | "strategic-trajectory" | "opportunity-fit" | "relationship-exposure" | "decision-constraints";
  label: string;
  state: "ready" | "partial" | "blocked";
  detail: string;
};

export type StrategyResearchAction = {
  id: string;
  label: string;
  reason: string;
};

export type StrategyEngineResult = {
  version: string;
  anchor: string;
  peerCount: number;
  allocationCategoriesCompared: number;
  transactionTotalsReady: number;
  activitySamplesReady: number;
  dimensions: StrategyDimension[];
  signals: StrategySignal[];
  researchActions: StrategyResearchAction[];
  limitations: string[];
};

export function strategyEngineAnalysis(
  peers: Row[],
  transactionPackets: Record<string, Packet>,
  buyerActivityPackets: Record<string, Packet>,
): StrategyEngineResult {
  const anchor = peers[0];
  const comparisonPeers = peers.slice(1);
  const result: StrategyEngineResult = {
    version: STRATEGY_ENGINE_VERSION,
    anchor: anchor ? comparisonName(anchor) : "Not disclosed",
    peerCount: comparisonPeers.length,
    allocationCategoriesCompared: 0,
    transactionTotalsReady: peers.filter((peer) => comparisonTransactionTotal(transactionPackets[comparisonPeerKey(peer)]) != null).length,
    activitySamplesReady: peers.filter((peer) => isFact(buyerActivityPackets[comparisonPeerKey(peer)])).length,
    dimensions: [],
    signals: [],
    researchActions: [],
    limitations: [
      "Selected-peer observations are not investment advice or portfolio optimization.",
      "Allocation reporting periods are not normalized, and disclosed ranges are never converted to midpoint estimates.",
      "Regional observations use only the latest loaded buyer-side sample and do not prove complete geographic exposure.",
      "Mandate objectives, liabilities, liquidity needs, risk budget, return targets, and governance constraints are not present in the approved comparison inputs.",
      "Thematic, stage, ticket-size, manager, co-investor, and full-history exposure are not inferred from partial profile or transaction records.",
    ],
  };
  if (!anchor || comparisonPeers.length < 1) {
    result.dimensions = strategyDimensions(result, false, false, false);
    return result;
  }

  const anchorStrategy = comparisonStrategy(anchor);
  const peersWithStrategy = comparisonPeers.filter((peer) => comparisonStrategy(peer) !== "Not disclosed");
  if (anchorStrategy === "Not disclosed" && peersWithStrategy.length) {
    result.signals.push({
      id: "strategy-disclosure-gap",
      title: "Strategy disclosure gap",
      detail: `${peersWithStrategy.length} selected peer${peersWithStrategy.length === 1 ? " has" : "s have"} a sourced strategy narrative; ${comparisonName(anchor)} does not. This is missing coverage, not evidence of no strategy.`,
      basis: "coverage",
      state: "coverage-gap",
      evidence: evidenceLinks(peersWithStrategy),
    });
  } else if (anchorStrategy !== "Not disclosed") {
    result.signals.push({
      id: "strategy-narrative-on-file",
      title: "Strategy narrative on file",
      detail: `${comparisonName(anchor)} has a sourced strategy narrative available for comparison. The engine does not convert narrative text into an inferred allocation or recommendation.`,
      basis: "strategy",
      state: "observation",
      evidence: evidenceLinks([anchor]),
    });
  }

  const anchorAllocations = new Map(comparisonAllocationEntries(anchor).map((entry) => [entry.label, entry]));
  const allocationCategoriesWithPeerValues = new Set<string>();
  const allocationSignals = [...new Set(comparisonPeers.flatMap((peer) => comparisonAllocationEntries(peer).map((entry) => entry.label)))]
    .flatMap((label) => {
      const anchorEntry = anchorAllocations.get(label);
      const peerEntries = comparisonPeers.flatMap((peer) => {
        const entry = comparisonAllocationEntries(peer).find((candidate) => candidate.label === label);
        return entry?.percent == null ? [] : [{ peer, percent: entry.percent }];
      });
      if (anchorEntry?.percent == null || !peerEntries.length) return [];
      allocationCategoriesWithPeerValues.add(label);
      const median = numericMedian(peerEntries.map((entry) => entry.percent));
      const delta = anchorEntry.percent - median;
      if (Math.abs(delta) < 1) return [];
      return [{
        id: `allocation-${slug(label)}`,
        title: `${label} differs from selected-peer median`,
        detail: `${comparisonName(anchor)} reports ${formatPercent(anchorEntry.percent)} versus a selected-peer median of ${formatPercent(median)} (${formatPercentagePointDelta(delta)}). This is a disclosed peer position, not an overweight or underweight recommendation.`,
        basis: "allocation" as const,
        state: "observation" as const,
        evidence: evidenceLinks([anchor, ...peerEntries.map((entry) => entry.peer)]),
        magnitude: Math.abs(delta),
      }];
    })
    .sort((left, right) => right.magnitude - left.magnitude);
  result.allocationCategoriesCompared = allocationCategoriesWithPeerValues.size;
  result.signals.push(...allocationSignals.slice(0, 2).map((signal) => ({
    id: signal.id,
    title: signal.title,
    detail: signal.detail,
    basis: signal.basis,
    state: signal.state,
    evidence: signal.evidence,
  })));

  const missingAllocation = [...new Set(comparisonPeers.flatMap((peer) => comparisonAllocationEntries(peer).map((entry) => entry.label)))]
    .map((label) => ({
      label,
      peers: comparisonPeers.filter((peer) => comparisonAllocationEntries(peer).some((entry) => entry.label === label)),
    }))
    .filter((entry) => !anchorAllocations.has(entry.label) && entry.peers.length >= 2)
    .sort((left, right) => right.peers.length - left.peers.length)[0];
  if (missingAllocation) {
    result.signals.push({
      id: `allocation-coverage-${slug(missingAllocation.label)}`,
      title: `${missingAllocation.label} coverage gap`,
      detail: `${missingAllocation.peers.length} selected peers disclose ${missingAllocation.label}; ${comparisonName(anchor)} does not. The missing value remains undisclosed and is never treated as zero.`,
      basis: "coverage",
      state: "coverage-gap",
      evidence: evidenceLinks(missingAllocation.peers),
    });
  }

  const anchorTotal = comparisonTransactionTotal(transactionPackets[comparisonPeerKey(anchor)]);
  const peerTotals = comparisonPeers.flatMap((peer) => {
    const total = comparisonTransactionTotal(transactionPackets[comparisonPeerKey(peer)]);
    return total == null ? [] : [{ peer, total }];
  });
  if (anchorTotal != null && peerTotals.length) {
    const median = numericMedian(peerTotals.map((entry) => entry.total));
    if (anchorTotal !== median) {
      result.signals.push({
        id: "transaction-activity-position",
        title: "Recorded transaction activity differs from peers",
        detail: `${comparisonName(anchor)} has ${formatCount(anchorTotal)} source-linked buyer-and-seller transactions versus a selected-peer median of ${formatCount(median)}. The difference may reflect activity or record coverage; the engine does not choose between them.`,
        basis: "transactions",
        state: "observation",
        evidence: evidenceLinks([anchor, ...peerTotals.map((entry) => entry.peer)]),
      });
    }
  }

  const anchorRegions = new Set(comparisonTransactionRegions(buyerActivityPackets[comparisonPeerKey(anchor)]).map((entry) => entry.region));
  const peerOnlyRegions = new Map<string, Set<Row>>();
  comparisonPeers.forEach((peer) => {
    comparisonTransactionRegions(buyerActivityPackets[comparisonPeerKey(peer)]).forEach((entry) => {
      if (anchorRegions.has(entry.region)) return;
      const current = peerOnlyRegions.get(entry.region) || new Set<Row>();
      current.add(peer);
      peerOnlyRegions.set(entry.region, current);
    });
  });
  const regional = [...peerOnlyRegions.entries()].sort((left, right) => right[1].size - left[1].size || left[0].localeCompare(right[0]))[0];
  if (regional) {
    result.signals.push({
      id: `regional-sample-${slug(regional[0])}`,
      title: `${regional[0]} appears in peer activity samples`,
      detail: `${regional[1].size} selected peer${regional[1].size === 1 ? " has" : "s have"} ${regional[0]} in the latest loaded buyer-side transaction sample; ${comparisonName(anchor)} does not. This is a sample difference, not proof of geographic inactivity.`,
      basis: "regional-sample",
      state: "observation",
      evidence: evidenceLinks([...regional[1]]),
    });
  }

  result.signals = result.signals.slice(0, 6);
  result.dimensions = strategyDimensions(
    result,
    anchorStrategy !== "Not disclosed",
    anchorAllocations.size > 0,
    comparisonTransactionRegions(buyerActivityPackets[comparisonPeerKey(anchor)]).length > 0,
  );
  result.researchActions = strategyResearchActions(result, anchorStrategy !== "Not disclosed", anchorAllocations.size > 0);
  return result;
}

function strategyDimensions(
  result: StrategyEngineResult,
  hasProfileContext: boolean,
  hasAnchorAllocation: boolean,
  hasAnchorActivity: boolean,
): StrategyDimension[] {
  return [
    {
      id: "profile-context",
      label: "Profile strategy context",
      state: hasProfileContext ? "ready" : "blocked",
      detail: hasProfileContext ? "A sourced anchor strategy narrative is on file." : "No sourced anchor strategy narrative is on file.",
    },
    {
      id: "peer-position",
      label: "Like-for-like peer position",
      state: result.peerCount >= 1 ? "ready" : "blocked",
      detail: result.peerCount >= 1 ? `${result.peerCount} selected same-type peer${result.peerCount === 1 ? "" : "s"}.` : "Select at least one same-type peer.",
    },
    {
      id: "allocation",
      label: "Allocation position",
      state: result.allocationCategoriesCompared > 0 ? "ready" : hasAnchorAllocation ? "partial" : "blocked",
      detail: result.allocationCategoriesCompared > 0
        ? `${result.allocationCategoriesCompared} disclosed categor${result.allocationCategoriesCompared === 1 ? "y" : "ies"} can be compared without midpointing ranges.`
        : hasAnchorAllocation ? "Anchor allocation is on file, but no selected-peer numeric category is comparable." : "No usable anchor allocation is on file.",
    },
    {
      id: "activity",
      label: "Recorded transaction activity",
      state: result.transactionTotalsReady >= result.peerCount + 1 ? "ready" : result.transactionTotalsReady > 0 ? "partial" : "blocked",
      detail: `${result.transactionTotalsReady} of ${result.peerCount + 1} selected institutions have a complete recorded transaction total available.`,
    },
    {
      id: "geography",
      label: "Recent geographic activity",
      state: hasAnchorActivity && result.activitySamplesReady >= 2 ? "partial" : "blocked",
      detail: hasAnchorActivity && result.activitySamplesReady >= 2
        ? "Recent buyer-side samples can support bounded differences, not full exposure conclusions."
        : "Comparable anchor and peer buyer-side samples are not available.",
    },
    {
      id: "strategic-trajectory",
      label: "Multi-period strategic trajectory",
      state: "blocked",
      detail: "A point-in-time peer position is not a trend; normalized multi-period allocation and transaction history are required.",
    },
    {
      id: "opportunity-fit",
      label: "Sector, stage, ticket & geography fit",
      state: "blocked",
      detail: "No opportunity-fit score is produced until controlled sector, stage, disclosed ticket band, and geography contracts are joined.",
    },
    {
      id: "relationship-exposure",
      label: "Manager & co-investor relationships",
      state: "blocked",
      detail: "Manager and co-investor fit require source-linked relationship and full-history transaction contracts.",
    },
    {
      id: "decision-constraints",
      label: "Mandate, risk & liquidity constraints",
      state: "blocked",
      detail: "No recommendation is generated without objectives, liabilities, liquidity needs, risk budget, return targets, and governance constraints.",
    },
  ];
}

function strategyResearchActions(
  result: StrategyEngineResult,
  hasProfileContext: boolean,
  hasAnchorAllocation: boolean,
): StrategyResearchAction[] {
  const actions: StrategyResearchAction[] = [];
  if (!hasProfileContext) {
    actions.push({
      id: "verify-strategy-context",
      label: "Verify the anchor strategy narrative",
      reason: "Peer positioning should not substitute for the institution's own stated objective.",
    });
  }
  if (!hasAnchorAllocation || result.allocationCategoriesCompared < 2) {
    actions.push({
      id: "normalize-allocation-evidence",
      label: "Collect comparable allocation disclosures",
      reason: "Capture reporting date, units, and exact values before interpreting allocation differences.",
    });
  }
  if (result.transactionTotalsReady < result.peerCount + 1 || result.activitySamplesReady < result.peerCount + 1) {
    actions.push({
      id: "complete-activity-coverage",
      label: "Complete transaction and activity coverage",
      reason: "Separate a real activity difference from a record-coverage difference, then add normalized multi-period history before claiming a trend.",
    });
  }
  actions.push({
    id: "capture-decision-constraints",
    label: "Capture the decision constraints",
    reason: "Mandate, liabilities, liquidity, risk budget, return target, time horizon, and governance are required before optimization or advice.",
  });
  actions.push({
    id: "join-exposure-contracts",
    label: "Join opportunity-fit and relationship evidence",
    reason: "Add approved sector, stage, ticket-size, geography, manager, co-investor, and full-history contracts before claiming strategic fit.",
  });
  return actions.slice(0, 5);
}

function evidenceLinks(peers: Row[]): StrategyEvidenceLink[] {
  const seen = new Set<string>();
  return peers.flatMap((peer) => {
    const url = comparisonSourceUrl(peer);
    if (!url || seen.has(url)) return [];
    seen.add(url);
    return [{ label: comparisonName(peer), url }];
  });
}

function numericMedian(values: number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function formatPercent(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1")}%`;
}

function formatPercentagePointDelta(value: number): string {
  const direction = value > 0 ? "above" : "below";
  return `${formatPercent(Math.abs(value)).replace("%", " percentage points")} ${direction}`;
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US", { maximumFractionDigits: value % 1 ? 1 : 0 });
}

function slug(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}
