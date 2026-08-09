"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  comparisonAllocationEntries,
  comparisonEntityId,
  comparisonName,
  comparisonPeerKey,
  comparisonPeerType,
  comparisonPeerTypeKey,
  comparisonSourceUrl,
  comparisonStrategy,
  comparisonTransactionRegions,
  comparisonTransactionTotal,
  competitionEvidenceQuestions,
  dedupeComparisonRows,
  hydrateComparisonPeer,
} from "@/lib/competitionAnalysis";
import { strategyEngineAnalysis, STRATEGY_ENGINE_VERSION } from "@/lib/strategyEngine";
import { profileDetailHref } from "@/lib/detailRoutes";
import {
  fetchPacket,
  money,
  rows,
  type Packet,
  type Row,
} from "@/lib/sourcePackets";
import { appHref, swfiAuthHandoffHref } from "@/lib/selfContainedLinks";
import { isShortTextQuery, isTextQueryReady, MIN_TEXT_QUERY_CHARACTERS } from "@/lib/textQueryPolicy";
import {
  COMPARISON_SEARCH_LIMIT,
  COMPARISON_TRANSACTION_SAMPLE_LIMIT,
  comparisonBuyerActivityEndpoint,
  comparisonEntityListEndpoint,
  comparisonProfileEndpoint,
  comparisonTransactionTotalEndpoint,
  inspectComparisonEntityListPacket,
  inspectComparisonProfilePacket,
  inspectComparisonTransactionPacket,
} from "@/lib/comparisonSourceContract";
import {
  MAX_COMPARISON_PEERS,
  comparisonSelectionFromParams,
  patchComparisonSelectionUrl,
} from "@/lib/comparisonUrlContext";

const NOT_DISCLOSED = "Not disclosed";
const LOADING = "Loading";

type SearchResult = {
  query: string;
  packet?: Packet;
};

type Metric = {
  label: string;
  render: (peer: Row) => ReactNode;
};

type DirectoryLifecycle = "loading" | "ready" | "empty" | "failed";

export default function CompetitionAnalysisWorkbench({
  seedRecords,
  includeDefunct = false,
  entityTypeContext = "",
  regionContext = "",
  directoryLifecycle = "ready",
  onRetryDirectory,
}: {
  seedRecords: Row[];
  includeDefunct?: boolean;
  entityTypeContext?: string;
  regionContext?: string;
  directoryLifecycle?: DirectoryLifecycle;
  onRetryDirectory?: () => void;
}) {
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Row[]>([]);
  const [anchorKey, setAnchorKey] = useState("");
  const [selectionIssue, setSelectionIssue] = useState("");
  const [restorePending, setRestorePending] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult>({ query: "" });
  const [searchRetryKey, setSearchRetryKey] = useState(0);
  const [peerRetryKey, setPeerRetryKey] = useState(0);
  const [profilePackets, setProfilePackets] = useState<Record<string, Packet>>({});
  const [transactionPackets, setTransactionPackets] = useState<Record<string, Packet>>({});
  const [buyerActivityPackets, setBuyerActivityPackets] = useState<Record<string, Packet>>({});
  const profilePacketsRef = useRef(profilePackets);
  const transactionPacketsRef = useRef(transactionPackets);
  const buyerActivityPacketsRef = useRef(buyerActivityPackets);

  useEffect(() => { profilePacketsRef.current = profilePackets; }, [profilePackets]);
  useEffect(() => { transactionPacketsRef.current = transactionPackets; }, [transactionPackets]);
  useEffect(() => { buyerActivityPacketsRef.current = buyerActivityPackets; }, [buyerActivityPackets]);

  const currentSelection = useMemo(
    () => dedupeComparisonRows(selectedRows).slice(0, MAX_COMPARISON_PEERS),
    [selectedRows],
  );
  const orderedSelection = useMemo(() => {
    if (!currentSelection.length) return [];
    const effectiveAnchorKey = currentSelection.some((row) => comparisonPeerKey(row) === anchorKey)
      ? anchorKey
      : comparisonPeerKey(currentSelection[0]);
    return [
      ...currentSelection.filter((row) => comparisonPeerKey(row) === effectiveAnchorKey),
      ...currentSelection.filter((row) => comparisonPeerKey(row) !== effectiveAnchorKey),
    ];
  }, [anchorKey, currentSelection]);
  const selectionKey = orderedSelection.map(comparisonPeerKey).join("|");
  const selectedKeySet = useMemo(() => new Set(orderedSelection.map(comparisonPeerKey)), [orderedSelection]);
  const peerTypeKey = orderedSelection[0] ? comparisonPeerTypeKey(orderedSelection[0]) : "";
  const peerType = orderedSelection[0] ? comparisonPeerType(orderedSelection[0]) : NOT_DISCLOSED;
  const candidateEntityType = peerTypeKey ? peerType : entityTypeContext;
  const searchRequest = useMemo(() => ({
    query: query.trim(),
    entityType: candidateEntityType,
    region: regionContext,
    includeDefunct,
    limit: COMPARISON_SEARCH_LIMIT,
    page: 1,
  }), [candidateEntityType, includeDefunct, query, regionContext]);

  useEffect(() => {
    const clean = query.trim();
    if (!isTextQueryReady(clean)) return;
    const controller = new AbortController();
    let active = true;
    const timer = globalThis.setTimeout(() => {
      void fetchPacket(
        comparisonEntityListEndpoint({ ...searchRequest, query: clean }),
        90_000,
        { signal: controller.signal, attempts: 2 },
      ).then((packet) => {
        if (active) setSearchResult({ query: clean, packet });
      });
    }, 250);
    return () => {
      active = false;
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [query, searchRequest, searchRetryKey]);

  useEffect(() => {
    if (!orderedSelection.length) return;
    let active = true;
    const controllers: AbortController[] = [];
    orderedSelection.forEach((peer) => {
      const id = comparisonEntityId(peer);
      const key = comparisonPeerKey(peer);
      if (!id || !key) return;
      if (!profilePacketsRef.current[key]) {
        const controller = new AbortController();
        controllers.push(controller);
        void fetchPacket(comparisonProfileEndpoint(id), 90_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((packet) => {
          if (active) setProfilePackets((current) => ({ ...current, [key]: packet }));
        });
      }
      if (!transactionPacketsRef.current[key]) {
        const controller = new AbortController();
        controllers.push(controller);
        void fetchPacket(comparisonTransactionTotalEndpoint(id), 90_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((packet) => {
          if (active) setTransactionPackets((current) => ({ ...current, [key]: packet }));
        });
      }
      if (!buyerActivityPacketsRef.current[key]) {
        const controller = new AbortController();
        controllers.push(controller);
        void fetchPacket(comparisonBuyerActivityEndpoint(id), 90_000, {
          signal: controller.signal,
          attempts: 2,
        }).then((packet) => {
          if (active) setBuyerActivityPackets((current) => ({ ...current, [key]: packet }));
        });
      }
    });
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
    };
  }, [orderedSelection, peerRetryKey, selectionKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    let active = true;
    let controllers: AbortController[] = [];
    let restoreGeneration = 0;

    async function restoreSelection() {
      const generation = ++restoreGeneration;
      controllers.forEach((controller) => controller.abort());
      controllers = [];
      const context = comparisonSelectionFromParams(new URLSearchParams(window.location.search));
      if (context.state === "none") {
        setSelectedRows([]);
        setAnchorKey("");
        setSelectionTouched(false);
        setSelectionIssue("");
        setRestorePending(false);
        return;
      }
      if (context.state === "invalid") {
        setSelectedRows([]);
        setAnchorKey("");
        setSelectionTouched(false);
        setSelectionIssue(context.issue);
        setRestorePending(false);
        return;
      }

      setRestorePending(true);
      setSelectionIssue("");
      controllers = context.ids.map(() => new AbortController());
      const packets = await Promise.all(context.ids.map((id, index) => fetchPacket(comparisonProfileEndpoint(id), 90_000, {
        signal: controllers[index].signal,
        attempts: 2,
      })));
      if (!active || generation !== restoreGeneration) return;
      const inspections = packets.map((packet, index) => inspectComparisonProfilePacket(packet, context.ids[index]));
      if (inspections.some((inspection) => inspection.state !== "ready" || !inspection.profile)) {
        setSelectedRows([]);
        setAnchorKey("");
        setSelectionTouched(false);
        setSelectionIssue("The shared comparison could not verify every requested SWFI profile. No substitute peers were selected.");
        setRestorePending(false);
        return;
      }
      const restored: Row[] = inspections.map((inspection, index) => ({ ...(inspection.profile as Row), entity_id: context.ids[index] }));
      const restoredTypes = new Set(restored.map(comparisonPeerTypeKey));
      const outOfTypeScope = entityTypeContext && restored.some((row) => comparisonPeerTypeKey(row) !== normalizedTypeKey(entityTypeContext));
      const outOfRegionScope = regionContext && restored.some((row) => cleanDisplay(row.region).toLowerCase() !== regionContext.trim().toLowerCase());
      const defunctBlocked = !includeDefunct && restored.some(isDefunctPeer);
      if (restoredTypes.size !== 1 || restoredTypes.has("") || outOfTypeScope || outOfRegionScope || defunctBlocked) {
        setSelectedRows([]);
        setAnchorKey("");
        setSelectionTouched(false);
        setSelectionIssue(defunctBlocked
          ? "The shared comparison includes a defunct institution, but this page is in active-only mode. Enable the explicit defunct scope to review it."
          : outOfTypeScope || outOfRegionScope
            ? "The shared comparison does not match the active entity-type or region scope. No substitute peers were selected."
            : "The shared comparison mixes entity types or contains a missing type. No substitute peers were selected.");
        setRestorePending(false);
        return;
      }
      setProfilePackets((current) => ({ ...current, ...Object.fromEntries(restored.map((row, index) => [comparisonPeerKey(row), packets[index]])) }));
      setSelectedRows(restored);
      setAnchorKey(comparisonPeerKey(restored[0]));
      setSelectionTouched(true);
      setRestorePending(false);
    }

    void restoreSelection();
    const onPopState = () => { void restoreSelection(); };
    window.addEventListener("popstate", onPopState);
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
      window.removeEventListener("popstate", onPopState);
    };
  }, [entityTypeContext, includeDefunct, regionContext]);

  useEffect(() => {
    if (!selectionTouched || restorePending || typeof window === "undefined") return;
    const ids = orderedSelection.map(comparisonEntityId).filter(Boolean);
    const next = patchComparisonSelectionUrl(window.location.href, ids);
    const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
    if (next !== current) window.history.pushState(null, "", next);
  }, [orderedSelection, restorePending, selectionKey, selectionTouched]);

  const searchClean = query.trim();
  const searchReady = isTextQueryReady(searchClean);
  const searchShort = isShortTextQuery(searchClean);
  const searchLoading = searchReady && searchResult.query !== searchClean;
  const searchInspection = useMemo(() => inspectComparisonEntityListPacket(
    searchReady && searchResult.query === searchClean ? searchResult.packet : undefined,
    searchRequest,
  ), [searchClean, searchReady, searchRequest, searchResult]);
  const searchRows = useMemo(() => (
    searchReady && !searchLoading && (searchInspection.state === "ready" || searchInspection.state === "empty")
      ? searchInspection.rows
      : []
  ), [searchInspection, searchLoading, searchReady]);
  const scopedSeedRecords = useMemo(() => seedRecords.filter((row) => {
    if (!comparisonPeerKey(row) || !comparisonSourceUrl(row) || !comparisonPeerTypeKey(row)) return false;
    if (!includeDefunct && isDefunctPeer(row)) return false;
    if (entityTypeContext && comparisonPeerTypeKey(row) !== normalizedTypeKey(entityTypeContext)) return false;
    if (regionContext && cleanDisplay(row.region).toLowerCase() !== regionContext.trim().toLowerCase()) return false;
    return true;
  }), [entityTypeContext, includeDefunct, regionContext, seedRecords]);
  const candidates = useMemo(() => dedupeComparisonRows([
    ...orderedSelection,
    ...(searchReady ? searchRows : searchShort ? [] : scopedSeedRecords.slice(0, COMPARISON_SEARCH_LIMIT)),
  ]).slice(0, 24), [orderedSelection, scopedSeedRecords, searchReady, searchRows, searchShort]);
  const profileInspections = Object.fromEntries(orderedSelection.map((peer) => {
    const key = comparisonPeerKey(peer);
    return [key, inspectComparisonProfilePacket(profilePackets[key], comparisonEntityId(peer))];
  }));
  const transactionInspections = Object.fromEntries(orderedSelection.map((peer) => {
    const key = comparisonPeerKey(peer);
    return [key, inspectComparisonTransactionPacket(transactionPackets[key], { entityId: comparisonEntityId(peer), buyersOnly: false, requestedLimit: 1 })];
  }));
  const activityInspections = Object.fromEntries(orderedSelection.map((peer) => {
    const key = comparisonPeerKey(peer);
    return [key, inspectComparisonTransactionPacket(buyerActivityPackets[key], { entityId: comparisonEntityId(peer), buyersOnly: true, requestedLimit: COMPARISON_TRANSACTION_SAMPLE_LIMIT })];
  }));
  const hydratedPeers = orderedSelection.map((peer) => {
    const key = comparisonPeerKey(peer);
    return profileInspections[key]?.state === "ready" ? hydrateComparisonPeer(peer, profilePackets[key]) : peer;
  });
  const hydratedProfileCount = orderedSelection.filter((peer) => profileInspections[comparisonPeerKey(peer)]?.state === "ready").length;
  const hydratedTransactionCount = orderedSelection.filter((peer) => ["ready", "empty"].includes(transactionInspections[comparisonPeerKey(peer)]?.state)).length;
  const hydratedActivityCount = orderedSelection.filter((peer) => ["ready", "empty"].includes(activityInspections[comparisonPeerKey(peer)]?.state)).length;
  const analysisReady = orderedSelection.length >= 2
    && hydratedProfileCount === orderedSelection.length
    && hydratedTransactionCount === orderedSelection.length
    && hydratedActivityCount === orderedSelection.length;
  const evidence = analysisReady ? competitionEvidenceQuestions(hydratedPeers, transactionPackets, buyerActivityPackets) : [];
  const strategyEngine = analysisReady
    ? strategyEngineAnalysis(hydratedPeers, transactionPackets, buyerActivityPackets)
    : strategyEngineAnalysis([], {}, {});

  function replaceSelection(nextRows: Row[]) {
    setSelectedRows(dedupeComparisonRows(nextRows).slice(0, MAX_COMPARISON_PEERS));
    setSelectionTouched(true);
    setSelectionIssue("");
  }

  function togglePeer(peer: Row) {
    const key = comparisonPeerKey(peer);
    if (!key || !comparisonSourceUrl(peer) || !comparisonPeerTypeKey(peer)) {
      setSelectionIssue("That record lacks a canonical SWFI entity identity or entity type and cannot authorize a peer comparison.");
      return;
    }
    if (!includeDefunct && isDefunctPeer(peer)) {
      setSelectionIssue("Defunct institutions require the explicit Include defunct entities scope.");
      return;
    }
    if (selectedKeySet.has(key)) {
      const next = orderedSelection.filter((row) => comparisonPeerKey(row) !== key);
      replaceSelection(next);
      if (anchorKey === key) setAnchorKey(next[0] ? comparisonPeerKey(next[0]) : "");
      return;
    }
    if (orderedSelection.length >= MAX_COMPARISON_PEERS) {
      setSelectionIssue(`A comparison supports at most ${MAX_COMPARISON_PEERS} institutions.`);
      return;
    }
    if (peerTypeKey && comparisonPeerTypeKey(peer) !== peerTypeKey) {
      setSelectionIssue(`The anchor locks this set to ${peerType}; mixed entity types are not allowed.`);
      return;
    }
    replaceSelection([...orderedSelection, peer]);
  }

  function makeAnchor(peer: Row) {
    const key = comparisonPeerKey(peer);
    if (!key || !selectedKeySet.has(key)) return;
    setAnchorKey(key);
    replaceSelection([peer, ...orderedSelection.filter((row) => comparisonPeerKey(row) !== key)]);
  }

  function retryUnverifiedPeerSources() {
    const retryKeys = new Set(orderedSelection.map(comparisonPeerKey));
    setProfilePackets((current) => omitUnverifiedPackets(current, retryKeys, (key, packet) => inspectComparisonProfilePacket(packet, key).state === "ready"));
    setTransactionPackets((current) => omitUnverifiedPackets(current, retryKeys, (key, packet) => ["ready", "empty"].includes(inspectComparisonTransactionPacket(packet, { entityId: key, buyersOnly: false, requestedLimit: 1 }).state)));
    setBuyerActivityPackets((current) => omitUnverifiedPackets(current, retryKeys, (key, packet) => ["ready", "empty"].includes(inspectComparisonTransactionPacket(packet, { entityId: key, buyersOnly: true, requestedLimit: COMPARISON_TRANSACTION_SAMPLE_LIMIT }).state)));
    setPeerRetryKey((current) => current + 1);
  }

  const peerInputsHaveFailure = orderedSelection.some((peer) => {
    const key = comparisonPeerKey(peer);
    return Boolean(profilePackets[key] && profileInspections[key]?.state !== "ready")
      || Boolean(transactionPackets[key] && !["ready", "empty"].includes(transactionInspections[key]?.state))
      || Boolean(buyerActivityPackets[key] && !["ready", "empty"].includes(activityInspections[key]?.state));
  });

  const metrics: Metric[] = [
    { label: "Entity Type", render: (peer) => comparisonPeerType(peer) },
    { label: "AUM", render: (peer) => disclosedAum(peer) },
    {
      label: "Investment Strategy",
      render: (peer) => {
        const key = comparisonPeerKey(peer);
        const inspection = profileInspections[key];
        if (!profilePackets[key]) return LOADING;
        if (inspection?.state !== "ready") return sourceFailureLabel(inspection?.state);
        return comparisonStrategy(peer);
      },
    },
    {
      label: "Regions",
      render: (peer) => {
        const packet = buyerActivityPackets[comparisonPeerKey(peer)];
        const inspection = activityInspections[comparisonPeerKey(peer)];
        const activityRegions = comparisonTransactionRegions(packet).slice(0, 4);
        return (
          <span className="grid gap-1">
            <span><span className="text-[10.5px] text-[#5C6D7E]">Domicile:</span> {cleanDisplay(peer.region || peer.country)}</span>
            <span className="text-[10.5px] text-[#5C6D7E]">Recent buyer activity sample:</span>
            {!packet ? LOADING : !["ready", "empty"].includes(inspection?.state) ? sourceFailureLabel(inspection?.state) : activityRegions.length ? activityRegions.map((entry) => (
              <span key={entry.region} className="flex justify-between gap-2 text-[11px]">
                <span>{entry.region}</span><strong>{entry.count}</strong>
              </span>
            )) : "No buyer-side rows in the verified sample"}
            {transactionEvidenceHref(packet) ? <a href={swfiAuthHandoffHref(transactionEvidenceHref(packet))} className="text-[10.5px] font-semibold text-[#16538C] underline">Open sampled transaction evidence</a> : null}
          </span>
        );
      },
    },
    {
      label: "Total Transactions",
      render: (peer) => {
        const packet = transactionPackets[comparisonPeerKey(peer)];
        const inspection = transactionInspections[comparisonPeerKey(peer)];
        if (!packet) return LOADING;
        if (!["ready", "empty"].includes(inspection?.state)) return sourceFailureLabel(inspection?.state);
        const total = comparisonTransactionTotal(packet);
        return total == null ? NOT_DISCLOSED : (
          <span>
            <strong className="block text-[#11314F]">{total.toLocaleString("en-US")}</strong>
            <span className="text-[10.5px] text-[#5C6D7E]">Recorded buyer and seller roles returned by SWFI</span>
            {transactionEvidenceHref(packet) ? <a href={swfiAuthHandoffHref(transactionEvidenceHref(packet))} className="mt-1 block text-[10.5px] font-semibold text-[#16538C] underline">Open a returned transaction record</a> : null}
          </span>
        );
      },
    },
    {
      label: "Asset Allocation",
      render: (peer) => {
        const key = comparisonPeerKey(peer);
        const inspection = profileInspections[key];
        if (!profilePackets[key]) return LOADING;
        if (inspection?.state !== "ready") return sourceFailureLabel(inspection?.state);
        const entries = comparisonAllocationEntries(peer);
        if (!entries.length) return NOT_DISCLOSED;
        return (
          <span className="grid gap-1" data-testid="comparison-allocation-values">
            {entries.map((entry) => (
              <span key={entry.label} className="flex justify-between gap-3 text-[11px]">
                <span className="text-[#617386]">{entry.label}</span>
                <strong className="text-right text-[#11314F]">{entry.display}</strong>
              </span>
            ))}
          </span>
        );
      },
    },
  ];
  const searchSettled = searchReady && !searchLoading;
  const searchFailed = searchSettled && ["invalid", "unavailable"].includes(searchInspection.state);
  const candidateListHref = comparisonCandidateListHref({
    query: searchClean,
    entityType: candidateEntityType,
    region: regionContext,
    includeDefunct,
    selectedIds: orderedSelection.map(comparisonEntityId),
  });

  return (
    <section data-gsap-reveal data-testid="competition-analysis" className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 overflow-hidden rounded border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#0A66C2]">Peer Intelligence</div>
          <h2 className="m-0 mt-1 text-[18px] font-bold text-[#11314F]">Competition Analysis</h2>
          <p className="m-0 mt-1 max-w-[760px] text-[12px] text-[#617386]">
            Select an anchor and one to three institutions of the same sourced entity type. The matrix uses canonical SWFI profiles, recorded buyer-and-seller role totals returned by the entity endpoint, and the latest up-to-{COMPARISON_TRANSACTION_SAMPLE_LIMIT} buyer-side rows; source failure is never relabeled as missing data.
          </p>
        </div>
        <div className="grid gap-1 rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          <span>{orderedSelection.length} of {MAX_COMPARISON_PEERS} selected</span>
          <span className="text-[10.5px] font-semibold uppercase tracking-[0.08em] text-[#5C6D7E]">
            {includeDefunct ? "Explicit lifecycle scope: Active + Defunct" : "Lifecycle scope: Active only"}
          </span>
        </div>
      </div>

      {restorePending ? (
        <div role="status" data-testid="comparison-restore-pending" className="rounded border border-[#B8CEE2] bg-[#F3F8FC] px-3 py-2 text-sm text-[#41566B]">
          Restoring and verifying every institution in the shared comparison… unrelated defaults are withheld.
        </div>
      ) : null}
      {selectionIssue ? (
        <div role="alert" data-testid="comparison-selection-issue" className="rounded border border-[#E4C4C4] bg-[#FFF6F6] px-3 py-2 text-sm text-[#8A3030]">
          {selectionIssue}
        </div>
      ) : null}

      <div className="grid min-w-0 grid-cols-1 gap-3 rounded border border-[#E1E7ED] bg-[#F7F9FA] p-3 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-2">
          <label htmlFor="competition-peer-search" className="text-sm font-semibold text-[#11314F]">Add Institution [+]</label>
          <input
            id="competition-peer-search"
            data-testid="competition-peer-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            minLength={MIN_TEXT_QUERY_CHARACTERS}
            aria-describedby="competition-peer-search-minimum"
            placeholder="Search ADIA, GIC, CPP, Ontario Teachers…"
            className="min-h-11 min-w-0 rounded border border-[#C7D2DD] bg-white px-3 text-base outline-none focus:border-[#0A66C2]"
          />
          <div id="competition-peer-search-minimum" className="text-[11px] text-[#5C6D7E]" aria-live="polite">
            {searchLoading
              ? "Searching SWFI institutions…"
              : searchReady
                ? searchFailed
                  ? "The candidate source did not return a verified result. No empty result has been claimed."
                  : `${searchRows.length.toLocaleString("en-US")} exact-type candidates loaded${searchInspection.count == null ? "" : ` from ${searchInspection.count.toLocaleString("en-US")} broad upstream matches`}`
                : searchShort
                  ? `Enter at least ${MIN_TEXT_QUERY_CHARACTERS} characters; no query has run.`
                  : directoryLifecycle === "loading"
                    ? "Loading and verifying candidate institutions…"
                    : directoryLifecycle === "failed"
                      ? "The candidate directory is unavailable; no empty set has been claimed."
                      : `${candidates.length.toLocaleString("en-US")} loaded candidates; no institution is selected automatically.`}
          </div>
          {searchFailed ? (
            <button
              type="button"
              data-testid="competition-search-retry"
              onClick={() => {
                setSearchResult({ query: "" });
                setSearchRetryKey((current) => current + 1);
              }}
              className="min-h-9 justify-self-start rounded border border-[#16538C] bg-white px-3 text-[11px] font-semibold text-[#16538C]"
            >
              Retry candidate search
            </button>
          ) : null}
          {searchSettled && !searchFailed && searchInspection.count != null && (searchInspection.hasMore || searchInspection.count > searchRows.length) ? (
            <a href={candidateListHref} className="text-[11px] font-semibold text-[#16538C] underline">
              Open the governed candidate directory for more source matches →
            </a>
          ) : null}
          {peerTypeKey ? (
            <div className="rounded border border-[#D7E3EE] bg-white px-3 py-2 text-[11px] text-[#41566B]">
              Peer group locked to the canonical <strong>{peerType}</strong> type from the anchor institution. The source request uses exact, case-insensitive type matching, and its count and pagination use the same predicate.
            </div>
          ) : null}
        </div>

        <div className="grid max-h-[330px] min-w-0 grid-cols-1 gap-2 overflow-y-auto sm:grid-cols-2">
          {candidates.map((candidate) => {
            const key = comparisonPeerKey(candidate);
            const selected = selectedKeySet.has(key);
            const typeMatch = !peerTypeKey || comparisonPeerTypeKey(candidate) === peerTypeKey;
            const atLimit = orderedSelection.length >= MAX_COMPARISON_PEERS;
            const disabled = !selected && (!typeMatch || atLimit);
            return (
              <button
                key={key}
                type="button"
                data-testid="competition-candidate"
                data-competition-name={comparisonName(candidate)}
                data-competition-selected={selected ? "true" : "false"}
                data-peer-type-match={typeMatch ? "true" : "false"}
                aria-pressed={selected}
                onClick={() => togglePeer(candidate)}
                disabled={disabled}
                className={`grid min-h-20 min-w-0 gap-1 rounded border px-3 py-2 text-left ${selected ? "border-[#0A66C2] bg-[#EAF3FB]" : "border-[#DCE3EA] bg-white"} disabled:cursor-not-allowed disabled:opacity-50`}
                title={!typeMatch ? `Select another ${peerType}` : atLimit && !selected ? `Maximum ${MAX_COMPARISON_PEERS} institutions` : undefined}
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <strong className="min-w-0 truncate text-[13px] text-[#11314F]">{comparisonName(candidate)}</strong>
                  <span className="shrink-0 text-[10px] font-bold uppercase text-[#0A66C2]">{selected ? "Selected" : typeMatch ? "Add" : "Different type"}</span>
                </span>
                <span className="truncate text-[11px] text-[#5C6D7E]">{comparisonPeerType(candidate)} · {cleanDisplay(candidate.country || candidate.region)}</span>
                <span className="text-[11px] font-semibold text-[#41566B]">{disclosedAum(candidate)}</span>
              </button>
            );
          })}
          {!candidates.length && searchReady && searchSettled && searchInspection.state === "empty" ? (
            <div className="rounded border border-[#DCE3EA] bg-white px-3 py-3 text-sm text-[#617386]">The source verified zero matching institutions.</div>
          ) : null}
          {!candidates.length && !searchReady && directoryLifecycle === "failed" ? (
            <div className="rounded border border-[#E4C4C4] bg-white px-3 py-3 text-sm text-[#8A3030]">
              Candidate directory unavailable.
              {onRetryDirectory ? <button type="button" onClick={onRetryDirectory} className="ml-2 font-semibold underline">Retry</button> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-2" aria-label="Selected comparison institutions">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="m-0 text-[14px] font-bold text-[#11314F]">Current Peer Set</h3>
          {orderedSelection.length ? (
            <button type="button" data-testid="competition-clear-all" onClick={() => replaceSelection([])} className="text-[11px] font-semibold text-[#5C6D7E] underline">Clear all</button>
          ) : null}
        </div>
        {orderedSelection.length ? (
          <>
            <div className="flex flex-wrap gap-2">
            {orderedSelection.map((peer, index) => (
              <div key={comparisonPeerKey(peer)} className={`flex min-h-11 items-center gap-2 rounded border px-2.5 py-1.5 ${index === 0 ? "border-[#0A66C2] bg-[#EAF3FB]" : "border-[#DCE3EA] bg-white"}`}>
                <span className="max-w-[240px] truncate text-[12px] font-semibold text-[#11314F]">{index === 0 ? "Anchor: " : ""}{comparisonName(peer)}</span>
                {isDefunctPeer(peer) ? <span className="rounded bg-[#FFF0D8] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[#875C12]">Defunct</span> : null}
                {index !== 0 ? (
                  <button type="button" onClick={() => makeAnchor(peer)} className="text-[10.5px] font-semibold text-[#0A66C2] underline">Make anchor</button>
                ) : null}
                <button
                  type="button"
                  data-testid="competition-remove-peer"
                  data-competition-name={comparisonName(peer)}
                  onClick={() => togglePeer(peer)}
                  className="text-[10.5px] font-semibold text-[#5C6D7E] underline"
                  aria-label={`Remove ${comparisonName(peer)}`}
                >
                  Remove
                </button>
              </div>
            ))}
            </div>
            <div className="text-[11px] text-[#5C6D7E]" role="status" aria-live="polite">
              Profiles verified: {hydratedProfileCount} of {orderedSelection.length}. Recorded transaction totals verified: {hydratedTransactionCount} of {orderedSelection.length}. Buyer-activity samples verified: {hydratedActivityCount} of {orderedSelection.length}.
              {!analysisReady ? " Derived observations remain paused until every required packet verifies." : " Derived observations are ready from independently generated source packets."}
            </div>
            {peerInputsHaveFailure ? (
              <button type="button" data-testid="comparison-peer-sources-retry" onClick={retryUnverifiedPeerSources} className="min-h-9 justify-self-start rounded border border-[#16538C] bg-white px-3 text-[11px] font-semibold text-[#16538C]">Retry unverified peer sources</button>
            ) : null}
          </>
        ) : (
          <div className="rounded border border-dashed border-[#C7D2DD] bg-[#F7F9FA] px-4 py-4 text-sm text-[#617386]">
            No institutions selected. Choose an anchor explicitly; the page will not build a peer set from arbitrary first-page rows.
          </div>
        )}
      </div>

      {hydratedPeers.length >= 2 ? (
        <div className="min-w-0 overflow-x-auto rounded border border-[#DCE3EA]">
          <table data-testid="competition-comparison-table" className="w-full min-w-[900px] border-collapse text-left text-sm">
            <caption className="sr-only">Selected same-type SWFI institutions compared by source-backed metric</caption>
            <thead>
              <tr className="bg-[#F7F9FA]">
                <th scope="col" className="w-[170px] border-b border-[#DCE3EA] px-3 py-2 text-[#41566B]">Metric</th>
                {hydratedPeers.map((peer, index) => (
                  <th scope="col" key={comparisonPeerKey(peer)} className="min-w-[220px] border-b border-[#DCE3EA] px-3 py-2 align-top text-[#11314F]">
                    <a
                      data-testid="competition-profile-link"
                      data-competition-name={comparisonName(peer)}
                      href={profileHref(peer)}
                      data-source-state={comparisonSourceUrl(peer) ? "on-file" : undefined}
                      className="text-[#16538C] underline"
                    >
                      {comparisonName(peer)}
                    </a>
                    <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{index === 0 ? "Anchor" : `Peer ${index}`}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.label} className="border-b border-[#EDF1F5] last:border-b-0">
                  <th scope="row" className="px-3 py-2.5 align-top font-semibold text-[#11314F]">{metric.label}</th>
                  {hydratedPeers.map((peer) => (
                    <td key={`${comparisonPeerKey(peer)}-${metric.label}`} className="max-w-[320px] px-3 py-2.5 align-top text-[#41566B]">
                      {metric.render(peer)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="rounded border border-dashed border-[#C7D2DD] bg-[#F7F9FA] px-4 py-5 text-sm text-[#617386]">
          Select at least two institutions from the same peer group to build the comparison.
        </div>
      )}

      {hydratedPeers.length >= 2 ? (
        <div className="text-[10.5px] leading-relaxed text-[#5C6D7E]">
          AUM is native-currency text with its source as-of date when disclosed; mixed currencies are not ranked, summed, ratioed, or plotted on one magnitude scale. Asset allocation values come from each verified SWFI profile. Their reporting periods are not independently normalized, and disclosed ranges remain ranges rather than midpoint estimates. Packets are generated independently and are not an atomic cross-peer snapshot.
        </div>
      ) : null}

      {analysisReady ? (
        <section id="strategy-engine" data-testid="strategy-engine" className="scroll-mt-4 rounded border border-[#B8CEE2] bg-[#F3F8FC] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#0A66C2]">Evidence-bounded decision support</div>
              <h3 className="m-0 mt-1 text-[16px] font-bold text-[#11314F]">Strategy Engine</h3>
              <p className="m-0 mt-1 max-w-[760px] text-[11.5px] leading-relaxed text-[#52687D]">
                Positions {strategyEngine.anchor} against selected same-type peers, then separates usable observations, coverage gaps, and inputs that cannot yet support a conclusion.
              </p>
            </div>
            <span data-testid="strategy-engine-version" className="rounded border border-[#B8CEE2] bg-white px-2 py-1 text-[10px] font-bold text-[#41566B]">{STRATEGY_ENGINE_VERSION}</span>
          </div>

          <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["Same-type peers", strategyEngine.peerCount],
              ["Allocation categories", strategyEngine.allocationCategoriesCompared],
              ["Transaction totals", `${strategyEngine.transactionTotalsReady}/${strategyEngine.peerCount + 1}`],
              ["Activity samples", `${strategyEngine.activitySamplesReady}/${strategyEngine.peerCount + 1}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded border border-[#D7E3EE] bg-white px-3 py-2">
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#5C6D7E]">{label}</div>
                <div className="mt-1 text-[17px] font-bold text-[#11314F]">{value}</div>
              </div>
            ))}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
            <div className="grid content-start gap-2">
              <h4 className="m-0 text-[12px] font-bold text-[#11314F]">Strategic observations</h4>
              {strategyEngine.signals.length ? strategyEngine.signals.map((signal) => (
                <article key={signal.id} data-strategy-signal={signal.id} className="rounded border border-[#D7E3EE] bg-white px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <strong className="text-[12px] text-[#11314F]">{signal.title}</strong>
                    <span className={`rounded px-2 py-0.5 text-[9.5px] font-bold uppercase tracking-[0.08em] ${signal.state === "coverage-gap" ? "bg-[#FFF0D8] text-[#875C12]" : "bg-[#EAF3FB] text-[#16538C]"}`}>
                      {signal.state === "coverage-gap" ? "Coverage gap" : "Observation"}
                    </span>
                  </div>
                  <p className="m-0 mt-1 text-[11.5px] leading-relaxed text-[#41566B]">{signal.detail}</p>
                  <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
                    {signal.evidence.map((item) => (
                      <a key={`${signal.id}-${item.url}`} href={swfiAuthHandoffHref(item.url)} className="text-[10.5px] font-semibold text-[#16538C] underline">Source: {item.label}</a>
                    ))}
                  </div>
                </article>
              )) : (
                <div className="rounded border border-[#D7E3EE] bg-white px-3 py-3 text-[11.5px] text-[#617386]">No evidence-backed strategic observation is available from the selected inputs.</div>
              )}
            </div>

            <div className="grid content-start gap-3">
              <div className="rounded border border-[#D7E3EE] bg-white p-3">
                <h4 className="m-0 text-[12px] font-bold text-[#11314F]">Decision-input readiness</h4>
                <div className="mt-2 grid gap-2">
                  {strategyEngine.dimensions.map((dimension) => (
                    <div key={dimension.id} data-strategy-dimension={dimension.id} className="border-t border-[#EDF1F5] pt-2 first:border-t-0 first:pt-0">
                      <div className="flex items-center justify-between gap-2">
                        <strong className="text-[11px] text-[#41566B]">{dimension.label}</strong>
                        <span className={`text-[9px] font-bold uppercase tracking-[0.08em] ${dimension.state === "ready" ? "text-[#14703C]" : dimension.state === "partial" ? "text-[#875C12]" : "text-[#A13D3D]"}`}>{dimension.state}</span>
                      </div>
                      <div className="mt-0.5 text-[10.5px] leading-relaxed text-[#5C6D7E]">{dimension.detail}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="rounded border border-[#D7E3EE] bg-white p-3">
                <h4 className="m-0 text-[12px] font-bold text-[#11314F]">Next-best research actions</h4>
                <ol className="m-0 mt-2 grid list-decimal gap-2 pl-4">
                  {strategyEngine.researchActions.map((action) => (
                    <li key={action.id} className="pl-1 text-[10.5px] leading-relaxed text-[#617386]"><strong className="text-[#41566B]">{action.label}.</strong> {action.reason}</li>
                  ))}
                </ol>
              </div>
            </div>
          </div>

          <div data-testid="strategy-engine-limitations" className="mt-4 rounded border border-[#E4D8C6] bg-[#FFFBF2] px-3 py-2.5">
            <strong className="text-[11px] text-[#6E552C]">Cannot conclude from current inputs</strong>
            <ul className="m-0 mt-1 grid gap-1 pl-4 text-[10.5px] leading-relaxed text-[#765F3B]">
              {strategyEngine.limitations.map((limitation) => <li key={limitation}>{limitation}</li>)}
            </ul>
          </div>
        </section>
      ) : hydratedPeers.length >= 2 ? (
        <section data-testid="strategy-engine-paused" className="rounded border border-[#E4D8C6] bg-[#FFFBF2] px-4 py-3 text-sm text-[#765F3B]">
          <strong>Strategy Engine paused.</strong> Profile, recorded transaction-total, and buyer-sample packets must all verify before the page derives observations or coverage gaps. Slow responses remain pending; invalid or unavailable responses require Retry.
        </section>
      ) : null}

      {analysisReady ? (
        <div className="grid gap-2 rounded border border-[#DCE3EA] bg-[#F7F9FA] p-3" data-testid="competition-evidence-questions">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="m-0 text-[14px] font-bold text-[#11314F]">Evidence-backed gaps &amp; review questions</h3>
              <p className="m-0 mt-1 text-[11px] text-[#5C6D7E]">Comparisons use disclosed fields only. No generated recommendation and no inference from a missing field.</p>
            </div>
            <span className="rounded bg-white px-2 py-1 text-[10px] font-bold uppercase tracking-[0.08em] text-[#617386]">Profiles + totals + recent activity</span>
          </div>
          {evidence.length ? evidence.map((item) => (
            <article key={item.id} className="rounded border border-[#E1E7ED] bg-white px-3 py-2.5">
              <div className="text-[12px] font-bold text-[#11314F]">{item.label}</div>
              <div className="mt-1 text-[11.5px] leading-relaxed text-[#41566B]">{item.detail}</div>
            </article>
          )) : (
            <div className="rounded border border-[#E1E7ED] bg-white px-3 py-2.5 text-[11.5px] text-[#617386]">
              No evidence-backed gap signal is available from the selected institutions’ currently approved fields.
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}

function profileHref(row: Row): string {
  const source = comparisonSourceUrl(row);
  return source ? swfiAuthHandoffHref(source) : profileDetailHref(row);
}

function cleanDisplay(value: unknown): string {
  if (value == null || value === "") return NOT_DISCLOSED;
  const clean = String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return clean && clean !== "Not disclosed by SWFI.com" ? clean : NOT_DISCLOSED;
}

function disclosedAum(row: Row): string {
  const value = row.aum || row.assets;
  if (value == null || value === "" || value === 0 || value === "0" || value === "$0") return NOT_DISCLOSED;
  const currency = cleanDisplay(row.aum_currency || row.assets_currency || row.currency);
  const date = cleanDisplay(row.aum_date || row.assets_date);
  let amount = "";
  if (typeof value === "string" && /[$€£¥]|\b(?:USD|CAD|EUR|GBP|JPY|CNY|AED|SAR)\b/i.test(value)) amount = value;
  else {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return NOT_DISCLOSED;
    const compact = money(numeric).replace(/^\$/, "");
    amount = currency === NOT_DISCLOSED
      ? compact
      : currency.toUpperCase() === "USD" ? `$${compact}` : `${currency.toUpperCase()} ${compact}`;
  }
  const qualifiers = [
    currency === NOT_DISCLOSED ? "currency not disclosed" : "",
    date === NOT_DISCLOSED ? "as-of date not disclosed; not comparison-ready" : `as of ${date}`,
  ].filter(Boolean);
  return `${amount}${qualifiers.length ? ` · ${qualifiers.join(" · ")}` : ""}`;
}

function sourceFailureLabel(state: string | undefined): string {
  return state === "invalid" ? "Invalid source response — Retry" : "Source unavailable — Retry";
}

function isDefunctPeer(row: Row): boolean {
  return row.defunct === true || cleanDisplay(row.entity_status).toLowerCase() === "defunct";
}

function normalizedTypeKey(value: unknown): string {
  return cleanDisplay(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function omitUnverifiedPackets(
  packets: Record<string, Packet>,
  selectedKeys: Set<string>,
  verified: (key: string, packet: Packet) => boolean,
): Record<string, Packet> {
  return Object.fromEntries(Object.entries(packets).filter(([key, packet]) => !selectedKeys.has(key) || verified(key, packet)));
}

function transactionEvidenceHref(packet: Packet | undefined): string {
  const source = cleanDisplay(rows(packet)[0]?.source_url || rows(packet)[0]?.swfi_url);
  return /^https:\/\/(?:www\.)?swfi\.com\/v1\/transactions\/[a-f0-9]{24}$/i.test(source) ? source : "";
}

function comparisonCandidateListHref({
  query,
  entityType,
  region,
  includeDefunct,
  selectedIds,
}: {
  query: string;
  entityType: string;
  region: string;
  includeDefunct: boolean;
  selectedIds: string[];
}): string {
  const params = new URLSearchParams({ view: "data", rows: "25", page: "1" });
  if (query) params.set("q", query);
  if (entityType) params.set("entity_type", entityType);
  if (region) params.set("region", region);
  if (includeDefunct) params.set("include_defunct", "true");
  if (selectedIds.length >= 2 && selectedIds.length <= MAX_COMPARISON_PEERS) params.set("ids", selectedIds.join(","));
  return appHref(`/comparisons/?${params.toString()}`);
}
