"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
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
  defaultComparisonPeers,
  hydrateComparisonPeer,
  MAX_COMPARISON_PEERS,
} from "@/lib/competitionAnalysis";
import { strategyEngineAnalysis, STRATEGY_ENGINE_VERSION } from "@/lib/strategyEngine";
import { profileDetailHref } from "@/lib/detailRoutes";
import {
  fetchPacket,
  isFact,
  money,
  rows,
  type Packet,
  type Row,
} from "@/lib/sourcePackets";
import { swfiAuthHandoffHref } from "@/lib/selfContainedLinks";

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

export default function CompetitionAnalysisWorkbench({ seedRecords }: { seedRecords: Row[] }) {
  const defaultPeers = useMemo(() => defaultComparisonPeers(seedRecords), [seedRecords]);
  const [selectionTouched, setSelectionTouched] = useState(false);
  const [selectedRows, setSelectedRows] = useState<Row[]>([]);
  const [anchorKey, setAnchorKey] = useState("");
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<SearchResult>({ query: "" });
  const [profilePackets, setProfilePackets] = useState<Record<string, Packet>>({});
  const [transactionPackets, setTransactionPackets] = useState<Record<string, Packet>>({});
  const [buyerActivityPackets, setBuyerActivityPackets] = useState<Record<string, Packet>>({});

  const currentSelection = useMemo(
    () => dedupeComparisonRows(selectionTouched ? selectedRows : defaultPeers).slice(0, MAX_COMPARISON_PEERS),
    [defaultPeers, selectedRows, selectionTouched],
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

  useEffect(() => {
    const clean = query.trim();
    if (clean.length < 2) return;
    const controller = new AbortController();
    const timer = globalThis.setTimeout(() => {
      void fetchPacket(
        `/api/source-data/search/v1?collection=entities&q=${encodeURIComponent(clean)}&limit=12&page=1`,
        90_000,
        { signal: controller.signal, attempts: 2 },
      ).then((packet) => setSearchResult({ query: clean, packet }));
    }, 250);
    return () => {
      globalThis.clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  useEffect(() => {
    if (!orderedSelection.length) return;
    const controllers: AbortController[] = [];
    orderedSelection.forEach((peer) => {
      const id = comparisonEntityId(peer);
      const key = comparisonPeerKey(peer);
      if (!id || !key) return;
      const profileController = new AbortController();
      const transactionController = new AbortController();
      const activityController = new AbortController();
      controllers.push(profileController, transactionController, activityController);
      void fetchPacket(`/api/profiles/${encodeURIComponent(id)}/v1`, 90_000, {
        signal: profileController.signal,
        attempts: 2,
      }).then((packet) => setProfilePackets((current) => ({ ...current, [key]: packet })));
      void fetchPacket(`/api/entity-transactions/v1?entity_id=${encodeURIComponent(id)}&limit=1`, 90_000, {
        signal: transactionController.signal,
        attempts: 2,
      }).then((packet) => setTransactionPackets((current) => ({ ...current, [key]: packet })));
      void fetchPacket(`/api/entity-transactions/v1?entity_id=${encodeURIComponent(id)}&buyers_only=1&limit=25`, 90_000, {
        signal: activityController.signal,
        attempts: 2,
      }).then((packet) => setBuyerActivityPackets((current) => ({ ...current, [key]: packet })));
    });
    return () => controllers.forEach((controller) => controller.abort());
  }, [orderedSelection, selectionKey]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const ids = new URLSearchParams(window.location.search)
      .get("ids")
      ?.split(",")
      .map((value) => value.trim())
      .filter((value) => /^[a-f0-9]{24}$/i.test(value))
      .slice(0, MAX_COMPARISON_PEERS) || [];
    if (ids.length < 2) return;
    let active = true;
    const controllers = ids.map(() => new AbortController());
    void Promise.all(ids.map((id, index) => fetchPacket(`/api/profiles/${encodeURIComponent(id)}/v1`, 90_000, {
      signal: controllers[index].signal,
      attempts: 2,
    }))).then((packets) => {
      if (!active) return;
      const restored = packets.flatMap((packet, index) => {
        const profile = isFact(packet) ? packet.data && typeof packet.data === "object" ? (packet.data as Row).profile : null : null;
        if (!profile || typeof profile !== "object" || Array.isArray(profile)) return [];
        const row = profile as Row;
        const key = comparisonPeerKey(row);
        if (key) setProfilePackets((current) => ({ ...current, [key]: packet }));
        return [{ ...row, entity_id: ids[index] }];
      });
      if (restored.length >= 2) {
        const anchorType = comparisonPeerTypeKey(restored[0]);
        const sameType = restored.filter((row) => comparisonPeerTypeKey(row) === anchorType);
        if (sameType.length >= 2) {
          setSelectedRows(sameType);
          setAnchorKey(comparisonPeerKey(sameType[0]));
          setSelectionTouched(true);
        }
      }
    });
    return () => {
      active = false;
      controllers.forEach((controller) => controller.abort());
    };
  }, []);

  useEffect(() => {
    if (!selectionTouched || typeof window === "undefined") return;
    const ids = orderedSelection.map(comparisonEntityId).filter(Boolean);
    const url = new URL(window.location.href);
    if (ids.length >= 2) url.searchParams.set("ids", ids.join(","));
    else url.searchParams.delete("ids");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, [orderedSelection, selectionKey, selectionTouched]);

  const searchClean = query.trim();
  const searchLoading = searchClean.length >= 2 && searchResult.query !== searchClean;
  const searchRows = useMemo(
    () => searchClean.length >= 2 && searchResult.query === searchClean && isFact(searchResult.packet)
      ? rows(searchResult.packet)
      : [],
    [searchClean, searchResult],
  );
  const candidates = useMemo(() => dedupeComparisonRows([
    ...orderedSelection,
    ...(searchClean.length >= 2 ? searchRows : seedRecords.slice(0, 12)),
  ]).slice(0, 24), [orderedSelection, searchClean.length, searchRows, seedRecords]);
  const hydratedPeers = orderedSelection.map((peer) => hydrateComparisonPeer(peer, profilePackets[comparisonPeerKey(peer)]));
  const evidence = competitionEvidenceQuestions(hydratedPeers, transactionPackets, buyerActivityPackets);
  const strategyEngine = strategyEngineAnalysis(hydratedPeers, transactionPackets, buyerActivityPackets);
  const hydratedProfileCount = orderedSelection.filter((peer) => isFact(profilePackets[comparisonPeerKey(peer)])).length;
  const hydratedTransactionCount = orderedSelection.filter((peer) => isFact(transactionPackets[comparisonPeerKey(peer)])).length;
  const hydratedActivityCount = orderedSelection.filter((peer) => isFact(buyerActivityPackets[comparisonPeerKey(peer)])).length;

  function replaceSelection(nextRows: Row[]) {
    setSelectedRows(dedupeComparisonRows(nextRows).slice(0, MAX_COMPARISON_PEERS));
    setSelectionTouched(true);
  }

  function togglePeer(peer: Row) {
    const key = comparisonPeerKey(peer);
    if (!key) return;
    if (selectedKeySet.has(key)) {
      const next = orderedSelection.filter((row) => comparisonPeerKey(row) !== key);
      replaceSelection(next);
      if (anchorKey === key) setAnchorKey(next[0] ? comparisonPeerKey(next[0]) : "");
      return;
    }
    if (orderedSelection.length >= MAX_COMPARISON_PEERS) return;
    if (peerTypeKey && comparisonPeerTypeKey(peer) !== peerTypeKey) return;
    replaceSelection([...orderedSelection, peer]);
  }

  function makeAnchor(peer: Row) {
    const key = comparisonPeerKey(peer);
    if (!key || !selectedKeySet.has(key)) return;
    setAnchorKey(key);
    replaceSelection([peer, ...orderedSelection.filter((row) => comparisonPeerKey(row) !== key)]);
  }

  const metrics: Metric[] = [
    { label: "Entity Type", render: (peer) => comparisonPeerType(peer) },
    { label: "AUM", render: (peer) => disclosedAum(peer) },
    { label: "Strategy", render: (peer) => comparisonStrategy(peer) },
    {
      label: "Regions",
      render: (peer) => {
        const packet = buyerActivityPackets[comparisonPeerKey(peer)];
        const activityRegions = comparisonTransactionRegions(packet).slice(0, 4);
        return (
          <span className="grid gap-1">
            <span><span className="text-[10.5px] text-[#7A8A9B]">Domicile:</span> {cleanDisplay(peer.region || peer.country)}</span>
            <span className="text-[10.5px] text-[#7A8A9B]">Recent buyer activity sample:</span>
            {!packet ? LOADING : activityRegions.length ? activityRegions.map((entry) => (
              <span key={entry.region} className="flex justify-between gap-2 text-[11px]">
                <span>{entry.region}</span><strong>{entry.count}</strong>
              </span>
            )) : NOT_DISCLOSED}
          </span>
        );
      },
    },
    {
      label: "Total Transactions",
      render: (peer) => {
        const packet = transactionPackets[comparisonPeerKey(peer)];
        if (!packet) return LOADING;
        const total = comparisonTransactionTotal(packet);
        return total == null ? NOT_DISCLOSED : (
          <span>
            <strong className="block text-[#11314F]">{total.toLocaleString("en-US")}</strong>
            <span className="text-[10.5px] text-[#7A8A9B]">Buyer and seller roles</span>
          </span>
        );
      },
    },
    {
      label: "Asset Allocation",
      render: (peer) => {
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

  return (
    <section data-gsap-reveal data-testid="competition-analysis" className="grid w-full max-w-full min-w-0 grid-cols-1 gap-4 overflow-hidden rounded border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[#0A66C2]">Peer Intelligence</div>
          <h2 className="m-0 mt-1 text-[18px] font-bold text-[#11314F]">Competition Analysis</h2>
          <p className="m-0 mt-1 max-w-[760px] text-[12px] text-[#617386]">
            Select two to four like-for-like institutions. The matrix uses SWFI profile fields, complete buyer-and-seller transaction totals, and a recent buyer-side regional sample; missing values remain undisclosed.
          </p>
        </div>
        <div className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {orderedSelection.length} of {MAX_COMPARISON_PEERS} selected
        </div>
      </div>

      <div className="grid min-w-0 grid-cols-1 gap-3 rounded border border-[#E1E7ED] bg-[#F7F9FA] p-3 lg:grid-cols-[minmax(240px,0.8fr)_minmax(0,1.2fr)]">
        <div className="grid content-start gap-2">
          <label htmlFor="competition-peer-search" className="text-sm font-semibold text-[#11314F]">Add Institution [+]</label>
          <input
            id="competition-peer-search"
            data-testid="competition-peer-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search ADIA, GIC, CPP, Ontario Teachers…"
            className="min-h-11 min-w-0 rounded border border-[#C7D2DD] bg-white px-3 text-base outline-none focus:border-[#0A66C2]"
          />
          <div className="text-[11px] text-[#7A8A9B]" aria-live="polite">
            {searchLoading
              ? "Searching SWFI institutions…"
              : searchClean.length >= 2
                ? `${searchRows.length.toLocaleString("en-US")} matching source records`
                : `${candidates.length.toLocaleString("en-US")} loaded candidates`}
          </div>
          {peerTypeKey ? (
            <div className="rounded border border-[#D7E3EE] bg-white px-3 py-2 text-[11px] text-[#41566B]">
              Peer group locked to <strong>{peerType}</strong> from the anchor institution.
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
                onClick={() => togglePeer(candidate)}
                disabled={disabled}
                className={`grid min-h-20 min-w-0 gap-1 rounded border px-3 py-2 text-left ${selected ? "border-[#0A66C2] bg-[#EAF3FB]" : "border-[#DCE3EA] bg-white"} disabled:cursor-not-allowed disabled:opacity-50`}
                title={!typeMatch ? `Select another ${peerType}` : atLimit && !selected ? `Maximum ${MAX_COMPARISON_PEERS} institutions` : undefined}
              >
                <span className="flex min-w-0 items-start justify-between gap-2">
                  <strong className="min-w-0 truncate text-[13px] text-[#11314F]">{comparisonName(candidate)}</strong>
                  <span className="shrink-0 text-[10px] font-bold uppercase text-[#0A66C2]">{selected ? "Selected" : typeMatch ? "Add" : "Different type"}</span>
                </span>
                <span className="truncate text-[11px] text-[#617386]">{comparisonPeerType(candidate)} · {cleanDisplay(candidate.country || candidate.region)}</span>
                <span className="text-[11px] font-semibold text-[#41566B]">{disclosedAum(candidate)}</span>
              </button>
            );
          })}
          {!candidates.length && !searchLoading ? (
            <div className="rounded border border-[#DCE3EA] bg-white px-3 py-3 text-sm text-[#617386]">No matching SWFI institutions.</div>
          ) : null}
        </div>
      </div>

      {orderedSelection.length ? (
        <div className="grid min-w-0 grid-cols-1 gap-2" aria-label="Selected comparison institutions">
          <div className="flex flex-wrap gap-2">
            {orderedSelection.map((peer, index) => (
              <div key={comparisonPeerKey(peer)} className={`flex min-h-11 items-center gap-2 rounded border px-2.5 py-1.5 ${index === 0 ? "border-[#0A66C2] bg-[#EAF3FB]" : "border-[#DCE3EA] bg-white"}`}>
                <span className="max-w-[240px] truncate text-[12px] font-semibold text-[#11314F]">{index === 0 ? "Anchor: " : ""}{comparisonName(peer)}</span>
                {index !== 0 ? (
                  <button type="button" onClick={() => makeAnchor(peer)} className="text-[10.5px] font-semibold text-[#0A66C2] underline">Make anchor</button>
                ) : null}
                <button
                  type="button"
                  data-testid="competition-remove-peer"
                  data-competition-name={comparisonName(peer)}
                  onClick={() => togglePeer(peer)}
                  className="text-[10.5px] font-semibold text-[#6B7785] underline"
                  aria-label={`Remove ${comparisonName(peer)}`}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
          <div className="text-[11px] text-[#7A8A9B]">
            Profiles ready: {hydratedProfileCount} of {orderedSelection.length}. Transaction totals: {hydratedTransactionCount} of {orderedSelection.length}. Buyer-activity samples: {hydratedActivityCount} of {orderedSelection.length}.
          </div>
        </div>
      ) : null}

      {hydratedPeers.length >= 2 ? (
        <div className="min-w-0 overflow-x-auto rounded border border-[#DCE3EA]">
          <table data-testid="competition-comparison-table" className="w-full min-w-[900px] border-collapse text-left text-sm">
            <thead>
              <tr className="bg-[#F7F9FA]">
                <th className="w-[170px] border-b border-[#DCE3EA] px-3 py-2 text-[#41566B]">Metric</th>
                {hydratedPeers.map((peer, index) => (
                  <th key={comparisonPeerKey(peer)} className="min-w-[220px] border-b border-[#DCE3EA] px-3 py-2 align-top text-[#11314F]">
                    <a
                      data-testid="competition-profile-link"
                      data-competition-name={comparisonName(peer)}
                      href={profileHref(peer)}
                      data-source-state={comparisonSourceUrl(peer) ? "on-file" : undefined}
                      className="text-[#16538C] underline"
                    >
                      {comparisonName(peer)}
                    </a>
                    <span className="mt-1 block text-[10px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{index === 0 ? "Anchor" : `Peer ${index}`}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {metrics.map((metric) => (
                <tr key={metric.label} className="border-b border-[#EDF1F5] last:border-b-0">
                  <td className="px-3 py-2.5 align-top font-semibold text-[#11314F]">{metric.label}</td>
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
        <div className="text-[10.5px] leading-relaxed text-[#7A8A9B]">
          Asset allocation values are reported on each SWFI institution profile. Their reporting period is not independently normalized, and disclosed ranges are shown as ranges rather than converted to midpoint estimates.
        </div>
      ) : null}

      {hydratedPeers.length >= 2 ? (
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
                <div className="text-[10px] font-bold uppercase tracking-[0.08em] text-[#7A8A9B]">{label}</div>
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
                      <div className="mt-0.5 text-[10.5px] leading-relaxed text-[#7A8A9B]">{dimension.detail}</div>
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
      ) : null}

      {hydratedPeers.length >= 2 ? (
        <div className="grid gap-2 rounded border border-[#DCE3EA] bg-[#F7F9FA] p-3" data-testid="competition-evidence-questions">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="m-0 text-[14px] font-bold text-[#11314F]">Evidence-backed gaps &amp; review questions</h3>
              <p className="m-0 mt-1 text-[11px] text-[#7A8A9B]">Comparisons use disclosed fields only. No generated recommendation and no inference from a missing field.</p>
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
  if (typeof value === "string" && /[$€£¥]|\b(?:USD|CAD|EUR|GBP|JPY|CNY|AED|SAR)\b/i.test(value)) return value;
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return NOT_DISCLOSED;
  const currency = cleanDisplay(row.aum_currency || row.assets_currency || row.currency);
  const compact = money(numeric).replace(/^\$/, "");
  if (currency === NOT_DISCLOSED) return `${compact} · currency not disclosed`;
  return currency.toUpperCase() === "USD" ? `$${compact}` : `${currency.toUpperCase()} ${compact}`;
}
