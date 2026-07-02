"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { Packet, Row } from "@/lib/sourcePackets";
import { fetchPacket, isFact, money, packetData, packetReason, rows, SOURCE_GAP, text } from "@/lib/sourcePackets";
import { personDetailHref, profileDetailHref, sourceRecordId, transactionDetailHref } from "@/lib/detailRoutes";
import { verifiedPeopleLinks, type VerifiedPeopleLink } from "@/lib/peopleEnrichment";
import { appHref, sourceDetailHref } from "@/lib/selfContainedLinks";
import { HOME_PACKET_SNAPSHOT } from "@/lib/homeSourceSnapshot";
import SwfiBrandHeader from "@/components/SwfiBrandHeader";

type Kind = "profile" | "transaction" | "mandate" | "person" | "report";

const NOT_DISCLOSED = "Not disclosed";
const LOADING = "Loading";
const VERIFIED = "Verified in SWFI records";
const NOT_AVAILABLE = "Not available from SWFI records";

const CONFIG: Record<Kind, { title: string; back: string; sourceLabel: string }> = {
  profile: { title: "Entity Profile", back: "/profiles/", sourceLabel: "Source record" },
  transaction: { title: "Transaction Details", back: "/transactions/", sourceLabel: "Source record" },
  mandate: { title: "Compass / RFP Detail", back: "/mandates/", sourceLabel: "Source record" },
  person: { title: "Person Detail", back: "/people/", sourceLabel: "Source record" },
  report: { title: "Report Detail", back: "/reports/", sourceLabel: "Source record" },
};

const DETAIL_NAV = [
  ["Dashboard", "/"],
  ["Institutions", "/profiles/"],
  ["People", "/people/"],
  ["Deals", "/deals/"],
  ["Comparisons", "/comparisons/"],
  ["RFPs", "/mandates/"],
  ["Reports", "/reports/"],
  ["Intelligence", "/intelligence/"],
  ["Search", "/search/"],
] as const;

export default function RecordDetailPage({ kind }: { kind: Kind }) {
  const [packet, setPacket] = useState<Packet | undefined>();
  const [record, setRecord] = useState<Row | undefined>();
  const [reason, setReason] = useState("");
  const queryString = useSyncExternalStore(subscribeToLocation, browserSearch, serverSearch);
  const params = useMemo(() => new URLSearchParams(queryString), [queryString]);
  const config = CONFIG[kind];

  useEffect(() => {
    let active = true;
    async function load() {
      const result = await loadRecord(kind, params);
      if (!active) return;
      setPacket(result.packet);
      setRecord(result.record);
      setReason(result.reason);
    }
    void load();
    return () => {
      active = false;
    };
  }, [kind, params]);

  const sourceUrl = useMemo(() => {
    const explicit = params.get("source") || "";
    return explicit || sourceHref(record);
  }, [params, record]);
  const displayName = text(record?.name || record?.title || params.get("name") || params.get("title"), config.title);
  const isLoading = !packet;
  const sourceOk = isFact(packet) && record;
  const selectionRequired = reason.endsWith("_required");
  const statusText = sourceOk ? VERIFIED : isLoading ? LOADING : selectionRequired ? "Selection required" : NOT_AVAILABLE;

  return (
    <div className="min-h-screen bg-[#F2F4F6] font-sans text-[#1B2733]">
      <SwfiBrandHeader searchId={`detail-${kind}-search`} />
      <div className="border-b border-[#DCE3EA] bg-white px-4 py-2">
        <nav className="mx-auto flex max-w-[1120px] flex-wrap gap-2 text-[13px]">
          {DETAIL_NAV.map(([label, href]) => (
            <a key={href} href={appHref(href)} className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[#16538C] no-underline">{label}</a>
          ))}
          <a href={appHref(config.back)} className="rounded border border-[#C7D2DD] bg-white px-3 py-2 text-[#16538C] no-underline">Back to list</a>
        </nav>
      </div>

      <main className="mx-auto grid w-full max-w-[1120px] gap-4 p-4 sm:p-5">
        <section className="rounded border border-[#DCE3EA] bg-white p-4">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">{config.title}</div>
          <h1 className="m-0 mt-1 text-[22px] font-bold text-[#11314F]">{displayName}</h1>
          <div className="mt-2 text-sm text-[#41566B]">{statusText}</div>
          {sourceUrl ? (
            <div className="mt-3">
              <a href="#source-record" data-source-state="on-file" className="text-sm text-[#16538C] underline">
                Source record on file
              </a>
            </div>
          ) : null}
        </section>

        {record ? <RecordFields kind={kind} record={record} sourceUrl={sourceUrl} /> : isLoading ? <LoadingPanel kind={kind} sourceUrl={sourceUrl} /> : <SourceGapPanel kind={kind} sourceUrl={sourceUrl} selectionRequired={selectionRequired} />}
      </main>
    </div>
  );
}

async function loadRecord(kind: Kind, params: URLSearchParams): Promise<{ packet?: Packet; record?: Row; endpoint: string; reason: string }> {
  if (kind === "profile") return loadProfile(params);
  if (kind === "transaction") return loadTransaction(params);
  if (kind === "mandate") return loadMandate(params);
  if (kind === "report") return loadReport(params);
  return loadPerson(params);
}

async function loadProfile(params: URLSearchParams) {
  const slug = params.get("slug") || "";
  const source = params.get("source") || "";
  const id = params.get("id") || sourceRecordId(source);
  const name = params.get("name") || "";
  if (/^[a-fA-F0-9]{24}$/.test(id)) {
    const endpoint = `/api/profiles/${encodeURIComponent(id)}/v1`;
    const packet = await fetchPacket(endpoint, 90_000);
    const profile = packetData(packet).profile as Row | undefined;
    return { packet, record: isFact(packet) ? profile : undefined, endpoint, reason: packetReason(packet) };
  }
  const snapshotMatch = findSnapshotRecord(["allocators30", "top20"], name || slug, source);
  const snapshotId = text(snapshotMatch?.id || snapshotMatch?.entity_id || snapshotMatch?.source_record_id, "") || sourceRecordId(sourceHref(snapshotMatch));
  if (/^[a-fA-F0-9]{24}$/.test(snapshotId)) {
    const endpoint = `/api/profiles/${encodeURIComponent(snapshotId)}/v1`;
    const packet = await fetchPacket(endpoint, 90_000);
    const profile = packetData(packet).profile as Row | undefined;
    if (isFact(packet) && profile) return { packet, record: profile, endpoint, reason: "" };
  }
  if (slug) {
    const endpoint = `/api/profiles/${encodeURIComponent(slug)}/v1`;
    const packet = await fetchPacket(endpoint, 90_000);
    const profile = packetData(packet).profile as Row | undefined;
    return { packet, record: isFact(packet) ? profile : undefined, endpoint, reason: packetReason(packet) };
  }
  if (name) {
    const searchEndpoint = `/api/v1/public/search?q=${encodeURIComponent(name)}&limit=10`;
    const searchPacket = await fetchPacket(searchEndpoint, 90_000);
    const match = rows(searchPacket, "results").find((row) => text(row.name, "").toLowerCase() === name.toLowerCase());
    const foundSlug = text(match?.slug || String(match?.profile_url || "").split("/").filter(Boolean).pop(), "");
    if (foundSlug) {
      const endpoint = `/api/profiles/${encodeURIComponent(foundSlug)}/v1`;
      const packet = await fetchPacket(endpoint, 90_000);
      const profile = packetData(packet).profile as Row | undefined;
      return { packet, record: isFact(packet) ? profile : undefined, endpoint, reason: packetReason(packet) };
    }
    return { packet: searchPacket, record: match, endpoint: searchEndpoint, reason: match ? "" : "profile_search_no_match" };
  }
  return { packet: localSourceGapPacket("profile_slug_or_name_required"), endpoint: "/api/profiles/{slug}/v1", reason: "profile_slug_or_name_required" };
}

async function loadTransaction(params: URLSearchParams) {
  const source = params.get("source") || "";
  const id = params.get("id") || sourceRecordId(source);
  const title = params.get("title") || "";
  if (!title && !id && !source) {
    return {
      packet: localSourceGapPacket("transaction_title_id_or_source_required"),
      endpoint: "/api/transactions/{transaction_id}/v1",
      reason: "transaction_title_id_or_source_required",
    };
  }
  if (id) {
    const endpoint = `/api/transactions/${encodeURIComponent(id)}/v1`;
    const packet = await fetchPacket(endpoint, 120_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    if (isFact(packet) && record) return { packet, record, endpoint, reason: "" };
    if (!packetReason(packet).startsWith("backend_http_404")) {
      return { packet, record: undefined, endpoint, reason: text(packetReason(packet), "transaction_detail_not_returned_by_source") };
    }
  }
  const snapshotMatch = findSnapshotRecord(["transactions30"], title, source);
  const snapshotId = text(snapshotMatch?.id || snapshotMatch?.source_record_id, "") || sourceRecordId(sourceHref(snapshotMatch));
  if (snapshotId) {
    const endpoint = `/api/transactions/${encodeURIComponent(snapshotId)}/v1`;
    const packet = await fetchPacket(endpoint, 120_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    if (isFact(packet) && record) return { packet, record, endpoint, reason: "" };
  }
  if (id || source) {
    const endpoint = "/api/recent-transactions/v1?days=90&limit=100";
    const packet = await fetchPacket(endpoint, 120_000);
    const match = findRecord(rows(packet), id, title, source);
    if (match) return { packet, record: match, endpoint, reason: "" };
  }
  const endpoint = title
    ? `/api/deal-intelligence/v1?q=${encodeURIComponent(title)}&days=365&limit=25`
    : "/api/recent-transactions/v1?days=90&limit=100";
  const packet = await fetchPacket(endpoint, 120_000);
  const match = findRecord(rows(packet), id, title, source);
  return { packet, record: match, endpoint, reason: match ? "" : "transaction_not_returned_by_current_source_endpoint" };
}

async function loadMandate(params: URLSearchParams) {
  const source = params.get("source") || "";
  const id = params.get("id") || sourceRecordId(source);
  const title = params.get("title") || "";
  if (!id && !title && !source) {
    return {
      packet: localSourceGapPacket("compass_id_title_or_source_required"),
      endpoint: "/api/compass/{compass_id}/v1",
      reason: "compass_id_title_or_source_required",
    };
  }
  if (id) {
    const endpoint = `/api/compass/${encodeURIComponent(id)}/v1`;
    const packet = await fetchPacket(endpoint, 120_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    if (isFact(packet) && record) return { packet, record, endpoint, reason: "" };
    if (!packetReason(packet).startsWith("backend_http_404")) {
      return { packet, record: undefined, endpoint, reason: text(packetReason(packet), "compass_detail_not_returned_by_source") };
    }
  }
  const snapshotMatch = findSnapshotRecord(["rfps"], title, source);
  const snapshotId = text(snapshotMatch?.id || snapshotMatch?.compass_id || snapshotMatch?.source_record_id, "") || sourceRecordId(sourceHref(snapshotMatch));
  if (snapshotId) {
    const endpoint = `/api/compass/${encodeURIComponent(snapshotId)}/v1`;
    const packet = await fetchPacket(endpoint, 120_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    if (isFact(packet) && record) return { packet, record, endpoint, reason: "" };
  }
  const endpoint = "/api/live-opportunities/v1?limit=100";
  const packet = await fetchPacket(endpoint, 90_000);
  const match = findRecord(rows(packet), id, title, source);
  return { packet, record: match, endpoint, reason: match ? "" : "compass_record_not_returned_by_current_source_endpoint" };
}

async function loadPerson(params: URLSearchParams) {
  const source = params.get("source") || "";
  const id = params.get("id") || sourceRecordId(source);
  const name = params.get("name") || "";
  let attemptedEndpoint = "";
  if (!id && !name && !source) {
    return {
      packet: localSourceGapPacket("person_id_name_or_source_required"),
      endpoint: "/api/people/{person_id}/v1",
      reason: "person_id_name_or_source_required",
    };
  }
  if (id) {
    const endpoint = `/api/people/${encodeURIComponent(id)}/v1`;
    attemptedEndpoint = endpoint;
    const packet = await fetchPacket(endpoint, 120_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    if (isFact(packet) && record) return { packet, record, endpoint, reason: "" };
    if (!name && !packetReason(packet).startsWith("backend_http_404")) {
      return { packet, record: undefined, endpoint, reason: text(packetReason(packet), "people_detail_not_returned_by_source") };
    }
  }
  const lookup = name || id || source;
  const endpoint = `/api/source-data/search/v1?collection=people&q=${encodeURIComponent(lookup)}&limit=25&page=1`;
  const packet = await fetchPacket(endpoint, 120_000);
  const sourceRows = rows(packet);
  const match = findRecord(sourceRows, id, name, source) || (isFact(packet) && sourceRows.length === 1 ? sourceRows[0] : undefined);
  return { packet, record: match, endpoint: attemptedEndpoint ? `${attemptedEndpoint} -> ${endpoint}` : endpoint, reason: match ? "" : "person_record_not_returned_by_current_source_endpoint" };
}

async function loadReport(params: URLSearchParams) {
  const id = params.get("key") || params.get("id") || "";
  const title = params.get("title") || "";
  if (id) {
    const endpoint = `/api/reports/${encodeURIComponent(id)}/v1`;
    const packet = await fetchPacket(endpoint, 90_000);
    const record = (packetData(packet).record || rows(packet)[0]) as Row | undefined;
    return { packet, record: isFact(packet) ? record : undefined, endpoint, reason: packetReason(packet) };
  }
  if (title) {
    const endpoint = `/api/reports/v1?q=${encodeURIComponent(title)}&limit=25&page=1`;
    const packet = await fetchPacket(endpoint, 90_000);
    const match = findRecord(rows(packet), "", title, "");
    return { packet, record: match, endpoint, reason: match ? "" : "report_record_not_returned_by_current_source_endpoint" };
  }
  return { packet: localSourceGapPacket("report_id_or_title_required"), endpoint: "/api/reports/{report_id}/v1", reason: "report_id_or_title_required" };
}

function localSourceGapPacket(reason: string): Packet {
  return {
    status: "unavailable",
    fact: false,
    unavailable_reason: reason,
    data: { rows: [], count: 0 },
  };
}

function findSnapshotRecord(packetKeys: string[], title: string, sourceUrl: string): Row | undefined {
  for (const key of packetKeys) {
    const packet = (HOME_PACKET_SNAPSHOT as Record<string, Packet | undefined>)[key];
    const match = findRecord(rows(packet), "", title, sourceUrl);
    if (match) return match;
  }
  return undefined;
}

function findRecord(sourceRows: Row[], id: string, title: string, sourceUrl: string): Row | undefined {
  const cleanTitle = normalizeMatchText(title);
  return sourceRows.find((row) => {
    const rowSource = sourceHref(row) || "";
    const rowTitle = normalizeMatchText(text(row.title || row.name, ""));
    return (!!id && text(row.id || row.entity_id || row.compass_id || row.source_record_id || row.person_id, "") === id)
      || (!!sourceUrl && rowSource === sourceUrl)
      || (!!cleanTitle && (rowTitle === cleanTitle || rowTitle.includes(cleanTitle) || cleanTitle.includes(rowTitle)));
  });
}

function normalizeMatchText(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function RecordFields({ kind, record, sourceUrl }: { kind: Kind; record: Row; sourceUrl: string }) {
  if (kind === "profile") return <ProfileRecord record={record} sourceUrl={sourceUrl} />;
  if (kind === "transaction") return <TransactionRecord record={record} sourceUrl={sourceUrl} />;
  if (kind === "mandate") return <MandateRecord record={record} sourceUrl={sourceUrl} />;
  if (kind === "person") return <PersonRecord record={record} sourceUrl={sourceUrl} />;
  if (kind === "report") return <ReportRecord record={record} sourceUrl={sourceUrl} />;

  return null;
}

function ProfileRecord({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const fields = [
    ["Legal Name", text(record.legal_name || record.name)],
    ["Type", text(record.type)],
    ["Country", text(record.country)],
    ["Region", text(record.region)],
    ["AUM / Assets", disclosedMoney(firstPresent(record.aum, record.assets))],
    ["AUM Currency", text(record.aum_currency)],
    ["AUM Date", text(record.aum_date)],
    ["Managed Assets", disclosedMoney(record.managed_assets)],
    ["Established At", text(record.established_at || record.establishedAt)],
    ["Address", text(record.address)],
    ["City", text(record.city)],
    ["Phone", text(record.phone)],
    ["Fax", text(record.fax)],
    ["Website", text(record.website)],
  ];
  const sourceFields = [
    ["Source Record", sourceUrl || text(record.source_url || record.swfi_url) ? "SWFI record" : ""],
  ];
  return (
    <section className="grid gap-4 rounded border border-[#DCE3EA] bg-white p-4">
      <div className="grid gap-2">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Entity Details</div>
        {fields.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} />
        ))}
      </div>
      {text(record.summary, "") ? (
        <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Summary</div>
          <div className="text-sm leading-6 text-[#41566B]">
            <LinkedText value={decodeHtml(text(record.summary))} returnRoute="/profiles/detail/" />
          </div>
        </section>
      ) : null}
      <ProfileModules record={record} sourceUrl={sourceUrl} />
      <ProfileRelatedRecords entityName={text(record.name || record.legal_name, "")} />
      {sourceUrl ? (
        <div className="grid gap-2">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Profile Sections</div>
          <div className="flex flex-wrap gap-2">
            {profileSections(record).map((section) => (
              <a
                key={section.id}
                href={`#${section.id}`}
                data-source-state="on-file"
                className="rounded border border-[#C7D2DD] bg-white px-2 py-1 text-sm text-[#16538C] underline"
              >
                {section.label}
              </a>
            ))}
          </div>
        </div>
      ) : null}
      <SourceRecordSection fields={sourceFields} sourceUrl={sourceUrl} returnRoute="/profiles/detail/" />
    </section>
  );
}

function TransactionRecord({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const buyerEntities = entityRows(record, "buyer");
  const sellerEntities = entityRows(record, "seller");
  const fields = [
    ["Transaction Name", text(record.title || record.name)],
    ["Investment Type", text(record.investment_type || record.investmentType)],
    ["Industry / Category", text(record.industry || record.category || record.sector)],
    ["Sector", text(record.sector)],
    ["Region", text(record.region || record.buyer_region)],
    ["Country", text(record.country)],
    ["Buyer Region", text(record.buyer_region)],
    ["Seller Region", text(record.seller_region)],
    ["Amount", disclosedMoney(firstPresent(record.amount_display, record.capital_display, record.amount, record.value, record.capital))],
    ["Currency", text(record.currency)],
    ["Announced At", text(record.announced_at || record.announcedAt)],
    ["Closed At", text(record.closed_at || record.closedAt || record.date)],
    ["Buyer Count", text(record.buyer_count)],
  ];
  const sourceFields = [
    ["Source Record", sourceUrl || text(record.source_url || record.swfi_url) ? "SWFI record" : ""],
  ];

  return (
    <section className="grid gap-4 rounded border border-[#DCE3EA] bg-white p-4">
      <div className="grid gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Transaction Details</div>
        <div className="grid gap-2">
          {fields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      <EntitySection title="Buyer Entities" entities={buyerEntities} emptyLabel={text(record.buyer_entity || record.institution, NOT_DISCLOSED)} />
      <EntitySection title="Seller Entities" entities={sellerEntities} emptyLabel={text(record.seller_entity, NOT_DISCLOSED)} />

      <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Record</div>
        <div className="grid gap-2">
          {sourceFields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} sourceUrl={label === "Source Record" ? sourceUrl : ""} />
          ))}
        </div>
      </section>

    </section>
  );
}

function MandateRecord({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const institutionSource = text(record.entity_id, "") ? `https://www.swfi.com/v1/entities/${encodeURIComponent(text(record.entity_id, ""))}` : "";
  const institutionHref = profileDetailHref({ name: record.institution, entity_id: record.entity_id }, institutionSource || undefined);
  const children = Array.isArray(record.investment_type_children) ? record.investment_type_children.map((item) => text(item, "")).filter(Boolean).join(", ") : text(record.investment_type_children, "");
  const fields = [
    ["Title", text(record.title || record.name)],
    ["Institution", text(record.institution)],
    ["Type", text(record.type || record.opportunity_type)],
    ["Strategy", text(record.strategy || record.asset_class_or_strategy)],
    ["Investment Type", text(record.investment_type || record.investmentType)],
    ["Investment Type Children", children],
    ["Amount", disclosedMoney(firstPresent(record.amount_display, record.amount, record.value))],
    ["Currency", text(record.currency)],
    ["Country", text(record.country)],
    ["Region", text(record.region)],
    ["City", text(record.city)],
    ["Posted At", text(record.posted_at || record.postedAt)],
    ["Deadline", text(record.deadline || record.due_at || record.dueAt)],
    ["Relevant Date", text(record.relevant_date || record.relevantDate)],
  ];
  const sourceFields = [
    ["Source Record", sourceUrl || text(record.source_url || record.swfi_url) ? "SWFI record" : ""],
  ];

  return (
    <section className="grid gap-4 rounded border border-[#DCE3EA] bg-white p-4">
      <div className="grid gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">RFP / Mandate Details</div>
        <div className="grid gap-2">
          {fields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>

      <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Institution</div>
        <div className="text-sm text-[#41566B]">
          {text(record.institution, "") ? (
            <a href={recordOrAppHref(institutionHref)} className="text-[#16538C] underline">{text(record.institution)}</a>
          ) : NOT_DISCLOSED}
        </div>
      </section>

      {text(record.summary, "") ? (
        <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Summary</div>
          <div className="text-sm leading-6 text-[#41566B]">
            <LinkedText value={decodeHtml(text(record.summary))} returnRoute="/mandates/detail/" />
          </div>
        </section>
      ) : null}

      {text(record.attachment_url, "") ? (
        <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Attachment</div>
          <a
            href={sourceMirrorHref(text(record.attachment_url, ""), "/mandates/detail/")}
            data-source-state="on-file"
            className="break-all text-sm text-[#16538C] underline"
          >
            Open attachment
          </a>
        </section>
      ) : null}

      <SourceRecordSection fields={sourceFields} sourceUrl={sourceUrl} returnRoute="/mandates/detail/" />
    </section>
  );
}

function PersonRecord({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const email = personEmail(record);
  const linkedIn = personLinkedInHref(record);
  const verifiedLinks = verifiedPeopleLinks(record, sourceUrl);
  const selfHref = personDetailHref(record, sourceUrl || sourceHref(record));
  const personSections: Array<[string, string]> = [
    ["Overview", "#overview"],
    ["Contact", "#contact"],
    ...(verifiedLinks.length ? [["Verified Links", "#verified-links"] as [string, string]] : []),
    ["Source", "#source-record"],
  ];
  const fields = [
    ["Name", text(record.name || record.title)],
    ["Title", personTitle(record)],
    ["Institution", text(record.institution || record.entity || record.organization)],
    ["Country", text(record.country)],
    ["Region", text(record.region)],
    ["Email", email],
    ["LinkedIn", linkedIn],
  ];
  const sourceFields = [
    ["Source Record", sourceUrl || text(record.source_url || record.swfi_url) ? "SWFI record" : ""],
  ];

  return (
    <section className="grid gap-4 rounded border border-[#DCE3EA] bg-white p-4">
      <nav className="flex flex-wrap gap-2 text-sm" aria-label="Person profile sections">
        {personSections.map(([label, href]) => (
          <a key={label} href={href} className="rounded border border-[#C7D2DD] bg-white px-2 py-1 text-[#16538C] underline">{label}</a>
        ))}
      </nav>
      <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Profile Actions</div>
        <div className="flex flex-wrap gap-2 text-sm">
          {email ? (
            <button type="button" onClick={() => copyPersonEmail(email)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Copy Email</button>
          ) : (
            <span className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-1.5 text-[#7A8A9B]">Email not disclosed</span>
          )}
          {linkedIn ? (
            <a href={sourceMirrorHref(linkedIn, "/people/detail/")} data-source-state="on-file" className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C] underline">LinkedIn</a>
          ) : (
            <span className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-1.5 text-[#7A8A9B]">LinkedIn not disclosed</span>
          )}
          <span className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-1.5 text-[#7A8A9B]">Follow requires SWFI account access</span>
          <a href={personVcardHref(record, sourceUrl)} download={`${safeFilename(text(record.name || record.title, "person"))}.vcf`} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C] underline">Export Contact</a>
          <a href={recordOrAppHref(selfHref)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C] underline">Profile Link</a>
        </div>
      </section>
      <div className="grid gap-3">
        <div id="overview" className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Person Details</div>
        <div className="grid gap-2">
          {fields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} />
          ))}
        </div>
      </div>
      <section id="contact" className="grid gap-2 rounded border border-[#DCE3EA] p-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Contact</div>
        <DetailRow label="Email" value={email} />
        <DetailRow label="LinkedIn" value={linkedIn} returnRoute="/people/detail/" />
      </section>
      {verifiedLinks.length ? <VerifiedPeopleLinks links={verifiedLinks} /> : null}
      <SourceRecordSection fields={sourceFields} sourceUrl={sourceUrl} returnRoute="/people/detail/" />
    </section>
  );
}

function VerifiedPeopleLinks({ links }: { links: VerifiedPeopleLink[] }) {
  return (
    <section id="verified-links" className="grid gap-2 rounded border border-[#DCE3EA] p-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Verified Public Links</div>
      <div className="grid gap-2">
        {links.map((link) => (
          <div key={`${link.label}-${link.href}`} className="grid gap-1 border-b border-[#F2F5F8] pb-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
            <div className="font-semibold text-[#11314F]">{link.label}</div>
            <div className="break-words text-[#41566B]">
              <a href={sourceMirrorHref(link.href, "/people/detail/")} data-source-state="on-file" className="text-[#16538C] underline">
                {link.label === "SWFI source record" ? "SWFI record" : link.label}
              </a>
              <div className="mt-1 text-[12px] text-[#7A8A9B]">Verified by {link.source}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ReportRecord({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const assetUrl = text(record.report_url || record.source_url, "");
  const fields = [
    ["Report", text(record.title || record.name)],
    ["Type", text(record.type)],
    ["Published At", text(record.published_at || record.publishedAt)],
    ["Updated At", text(record.updated_at || record.updatedAt)],
    ["Report Asset", assetUrl ? "Report asset on file" : ""],
  ];
  const sourceFields = [
    ["Source Record", sourceUrl || assetUrl ? "SWFI report record" : ""],
  ];

  return (
    <section className="grid gap-4 rounded border border-[#DCE3EA] bg-white p-4">
      <div className="grid gap-3">
        <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Report Details</div>
        <div className="grid gap-2">
          {fields.map(([label, value]) => (
            <DetailRow key={label} label={label} value={value} sourceUrl={label === "Report Asset" ? assetUrl : ""} returnRoute="/reports/detail/" />
          ))}
        </div>
      </div>
      <SourceRecordSection fields={sourceFields} sourceUrl={sourceUrl || assetUrl} returnRoute="/reports/detail/" />
    </section>
  );
}

function SourceRecordSection({ fields, sourceUrl, returnRoute }: { fields: string[][]; sourceUrl: string; returnRoute: string }) {
  return (
    <section id="source-record" className="grid gap-2 rounded border border-[#DCE3EA] p-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Source Record</div>
      <div className="grid gap-2">
        {fields.map(([label, value]) => (
          <DetailRow key={label} label={label} value={value} sourceUrl={label.includes("Source") || label.includes("URL") ? sourceUrl : ""} returnRoute={returnRoute} />
        ))}
      </div>
    </section>
  );
}

function DetailRow({ label, value, sourceUrl = "", returnRoute = "/transactions/detail/" }: { label: string; value: string; sourceUrl?: string; returnRoute?: string }) {
  const display = value && value !== SOURCE_GAP && value !== "Not disclosed" ? value : NOT_DISCLOSED;
  const linkLabel = sourceDisplayLabel(label, display);
  return (
    <div className="grid gap-1 border-b border-[#F2F5F8] pb-2 text-sm sm:grid-cols-[180px_minmax(0,1fr)]">
      <div className="font-semibold text-[#11314F]">{label}</div>
      <div className="break-words text-[#41566B]">
        {sourceUrl ? (
          <a
            href="#source-record"
            data-source-state="on-file"
            data-return-route={returnRoute}
            className="text-[#16538C] underline"
          >
            {linkLabel}
          </a>
        ) : isHttpValue(display) ? (
          <a
            href={sourceMirrorHref(display, returnRoute)}
            data-source-state="on-file"
            data-return-route={returnRoute}
            className="text-[#16538C] underline"
          >
            {sourceDisplayLabel(label, display)}
          </a>
        ) : display}
      </div>
    </div>
  );
}

function LinkedText({ value, returnRoute }: { value: string; returnRoute: string }) {
  const parts = value.split(/(https?:\/\/[^\s]+)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (!isHttpValue(part)) return <span key={`${part}-${index}`}>{part}</span>;
        const clean = part.replace(/[),.;:]+$/, "");
        const tail = part.slice(clean.length);
        return (
          <span key={`${part}-${index}`}>
            <a href={sourceMirrorHref(clean, returnRoute)} data-source-state="on-file" className="text-[#16538C] underline">
              {sourceDisplayLabel("Source", clean)}
            </a>
            {tail}
          </span>
        );
      })}
    </>
  );
}

function isHttpValue(value: string): boolean {
  return value.startsWith("http://") || value.startsWith("https://");
}

function recordOrAppHref(href: string): string {
  return isHttpValue(href) ? href : appHref(href);
}

function sourceDisplayLabel(label: string, value: string): string {
  if (!isHttpValue(value) && value !== "SWFI source" && value !== "SWFI record") return value;
  if (/swfi\.com/i.test(value) || /source|url/i.test(label)) return "SWFI record";
  return "Source link";
}

function personEmail(record: Row): string {
  const value = text(record.email || record.email_address || record.work_email || record.contact_email, "");
  return /@/.test(value) ? value : "";
}

function personLinkedInHref(record: Row): string {
  const value = text(record.linkedin_url || record.linkedin || record.linkedin_profile || record.linked_in, "");
  if (value.startsWith("https://www.linkedin.com/") || value.startsWith("https://linkedin.com/")) return value;
  return "";
}

function copyPersonEmail(email: string) {
  if (!email || typeof navigator === "undefined" || !navigator.clipboard) return;
  void navigator.clipboard.writeText(email);
}

function personVcardHref(record: Row, sourceUrl: string): string {
  const fullName = text(record.name || record.title, "Not disclosed");
  const title = personTitle(record);
  const organization = text(record.institution || record.entity || record.organization, "");
  const email = personEmail(record);
  const linkedIn = personLinkedInHref(record);
  const lines = [
    "BEGIN:VCARD",
    "VERSION:3.0",
    `FN:${vcardEscape(fullName)}`,
    title && title !== NOT_DISCLOSED ? `TITLE:${vcardEscape(title)}` : "",
    organization ? `ORG:${vcardEscape(organization)}` : "",
    email ? `EMAIL:${vcardEscape(email)}` : "",
    linkedIn ? `URL:${vcardEscape(linkedIn)}` : sourceUrl ? `URL:${vcardEscape(sourceUrl)}` : "",
    "END:VCARD",
  ].filter(Boolean).join("\n");
  return `data:text/vcard;charset=utf-8,${encodeURIComponent(lines)}`;
}

function vcardEscape(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("\n", "\\n").replaceAll(",", "\\,").replaceAll(";", "\\;");
}

function safeFilename(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "swfi-person";
}

function personTitle(record: Row): string {
  const name = text(record.name, "");
  const title = text(record.title, "");
  if (!title || title === name) return NOT_DISCLOSED;
  return title;
}

function EntitySection({ title, entities, emptyLabel }: { title: string; entities: Row[]; emptyLabel: string }) {
  return (
    <section className="grid gap-2 rounded border border-[#DCE3EA] p-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">{title}</div>
      {entities.length ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-left text-sm">
            <thead className="border-b border-[#DCE3EA] text-[11px] uppercase tracking-[0.05em] text-[#7A8A9B]">
              <tr>
                <th className="py-2 pr-3">Entity Name</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">Country</th>
                <th className="py-2 pr-3">Region</th>
                <th className="py-2 pr-3">Source</th>
              </tr>
            </thead>
            <tbody>
              {entities.map((entity, index) => (
                <EntityRow key={`${text(entity.id || entity.name, title)}-${index}`} entity={entity} />
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="text-sm text-[#41566B]">{emptyLabel && emptyLabel !== SOURCE_GAP ? emptyLabel : NOT_DISCLOSED}</div>
      )}
    </section>
  );
}

function EntityRow({ entity }: { entity: Row }) {
  const name = text(entity.name || entity.entityName, NOT_DISCLOSED);
  const source = text(entity.source_url || entity.swfi_url, "");
  const href = profileDetailHref({ name, entity_id: text(entity.id || entity.entity_id || entity.entityID, ""), slug: entity.slug }, source || undefined);
  return (
    <tr className="border-b border-[#F2F5F8] align-top text-[#41566B]">
      <td className="py-2 pr-3 font-semibold text-[#11314F]">
        <a href={recordOrAppHref(href)} className="text-[#16538C] underline">{name}</a>
      </td>
      <td className="py-2 pr-3">{text(entity.type, NOT_DISCLOSED)}</td>
      <td className="py-2 pr-3">{text(entity.country, NOT_DISCLOSED)}</td>
      <td className="py-2 pr-3">{text(entity.region, NOT_DISCLOSED)}</td>
      <td className="py-2 pr-3">
        {source ? (
          <a href={sourceMirrorHref(source, href)} data-source-state="on-file" className="text-[#16538C] underline">SWFI record</a>
        ) : NOT_DISCLOSED}
      </td>
    </tr>
  );
}

function entityRows(record: Row, role: "buyer" | "seller"): Row[] {
  const arrayKey = role === "buyer" ? "buyer_entities" : "seller_entities";
  const entities = Array.isArray(record[arrayKey]) ? record[arrayKey] as Row[] : [];
  if (entities.length) return entities;
  const name = text(role === "buyer" ? record.buyer_entity || record.institution : record.seller_entity, "");
  if (!name || name === "Not disclosed") return [];
  const id = text(role === "buyer" ? record.buyer_entity_id || record.institution_id : record.seller_entity_id, "");
  const source = text(role === "buyer" ? record.buyer_entity_url || record.institution_url : record.seller_entity_url, "");
  return [{
    id,
    name,
    source_url: source,
    swfi_url: source,
    region: role === "buyer" ? record.buyer_region || record.region : record.seller_region,
  }];
}

function ProfileModules({ record, sourceUrl }: { record: Row; sourceUrl: string }) {
  const modules = record.modules && typeof record.modules === "object" && !Array.isArray(record.modules)
    ? record.modules as Record<string, Row>
    : {};
  const order = ["overview", "assets", "people", "strategy", "transactions", "compass", "documents", "holdings", "benchmarks", "returns", "governance", "contact", "timeline"];
  if (!Object.keys(modules).length) {
    return (
      <section className="grid gap-2 rounded border border-[#DCE3EA] p-3 text-sm text-[#41566B]">
        <div className="font-semibold text-[#11314F]">Profile Modules</div>
        <div>Profile sections are not available from SWFI records.</div>
      </section>
    );
  }
  return (
    <section className="grid gap-3">
      <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Profile Modules</div>
      <div className="grid gap-3 md:grid-cols-2">
        {order.filter((key) => modules[key]).map((key) => (
          <ProfileModule key={key} id={sourceSectionId(key)} module={modules[key]} sourceUrl={sourceUrl} />
        ))}
      </div>
    </section>
  );
}

function ProfileModule({ id, module, sourceUrl }: { id: string; module: Row; sourceUrl: string }) {
  const fields = module.fields && typeof module.fields === "object" && !Array.isArray(module.fields)
    ? module.fields as Row
    : {};
  const ok = text(module.status, "") === "ok";
  const label = text(module.label, id);
  const shell = isShellModule(fields);
  const entries = Object.entries(fields).filter(([key, value]) => {
    const normalized = humanLabel(key).toLowerCase();
    return !["source", "entity id"].includes(normalized) && value != null && value !== "";
  });
  return (
    <section id={id} className="grid content-start gap-2 rounded border border-[#DCE3EA] p-3 text-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-[#11314F]">{label}</div>
          <div className="text-[11px] text-[#7A8A9B]">
            {ok && !shell ? VERIFIED : ok && shell ? NOT_AVAILABLE : NOT_AVAILABLE}
          </div>
        </div>
        {sourceUrl ? (
          <a
            href={`#${sourceSectionId(id)}`}
            data-source-state="on-file"
            className="text-[11px] text-[#16538C] underline"
          >
            SWFI record
          </a>
        ) : null}
      </div>
      <div className="grid gap-1 text-[#41566B]">
        {entries.length ? entries.map(([key, value]) => (
          <div key={key} className="grid gap-1 border-t border-[#F2F5F8] pt-1">
            <div className="text-[11px] font-semibold uppercase tracking-[0.04em] text-[#7A8A9B]">{humanLabel(key)}</div>
            <div className="break-words">
              <LinkedText value={formatModuleValue(value)} returnRoute="/profiles/detail/" />
            </div>
          </div>
        )) : <div>{NOT_DISCLOSED}</div>}
      </div>
    </section>
  );
}

function ProfileRelatedRecords({ entityName }: { entityName: string }) {
  const [packet, setPacket] = useState<Packet | undefined>();

  useEffect(() => {
    if (!entityName) return;
    const controller = new AbortController();
    void fetchPacket(`/api/transactions/v1?limit=5&page=1&q=${encodeURIComponent(entityName)}`, 120_000, { signal: controller.signal, attempts: 3 }).then(setPacket);
    return () => controller.abort();
  }, [entityName]);

  if (!entityName) return null;
  const transactionRows = rows(packet).slice(0, 5);
  if (packet && (!isFact(packet) || transactionRows.length === 0)) return null;
  const total = countFromPacket(packet, transactionRows.length);
  const allHref = appHref(`/transactions/?filter=${encodeURIComponent(entityName)}`);

  return (
    <section id="related-transactions" className="grid gap-3 rounded border border-[#DCE3EA] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-[11px] font-bold uppercase tracking-[0.07em] text-[#7A8A9B]">Related Transactions</div>
          <div className="mt-1 text-sm text-[#41566B]">
            {packet ? `Showing ${transactionRows.length.toLocaleString("en-US")} of ${total.toLocaleString("en-US")} related rows` : LOADING}
          </div>
        </div>
        <a href={allHref} className="text-sm text-[#16538C] underline">Open all</a>
      </div>
      {packet ? (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] border-collapse text-left text-sm">
            <thead className="border-b border-[#DCE3EA] text-[11px] uppercase tracking-[0.05em] text-[#7A8A9B]">
              <tr>
                <th className="py-2 pr-3">Transaction</th>
                <th className="py-2 pr-3">Buyer Entity</th>
                <th className="py-2 pr-3">Industry / Category</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Closed At</th>
              </tr>
            </thead>
            <tbody>
              {transactionRows.map((row, index) => (
                <tr key={`${text(row.source_url || row.title, "transaction")}-${index}`} className="border-b border-[#F2F5F8] align-top text-[#41566B]">
                  <td className="py-2 pr-3 font-semibold text-[#11314F]">
                    <a href={recordOrAppHref(transactionDetailHref(row, sourceHref(row)))} className="text-[#16538C] underline">
                      {text(row.title || row.name, NOT_DISCLOSED)}
                    </a>
                  </td>
                  <td className="py-2 pr-3">{entityLinks(entityRows(row, "buyer"), text(row.buyer_entity || row.institution, NOT_DISCLOSED))}</td>
                  <td className="py-2 pr-3">{text(row.industry || row.category || row.sector, NOT_DISCLOSED)}</td>
                  <td className="py-2 pr-3">{disclosedMoney(firstPresent(row.amount_display, row.capital_display, row.amount, row.capital, row.value))}</td>
                  <td className="py-2 pr-3">{text(row.closed_at || row.announced_at || row.date, NOT_DISCLOSED)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

function entityLinks(entities: Row[], fallback: string) {
  if (!entities.length) return fallback;
  return (
    <div className="grid gap-1">
      {entities.slice(0, 5).map((entity, index) => {
        const name = text(entity.name || entity.entityName, NOT_DISCLOSED);
        const href = profileDetailHref({ name, entity_id: text(entity.id || entity.entity_id || entity.entityID, ""), slug: entity.slug }, sourceHref(entity) || undefined);
        return (
          <a key={`${name}-${index}`} href={recordOrAppHref(href)} className="text-[#16538C] underline">
            {name}
          </a>
        );
      })}
    </div>
  );
}

function countFromPacket(packet: Packet | undefined, fallback: number): number {
  const value = packetData(packet).count;
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function profileSections(record: Row): Array<{ id: string; label: string }> {
  const modules = record.modules && typeof record.modules === "object" && !Array.isArray(record.modules)
    ? Object.keys(record.modules as Row)
    : [];
  const fallback = ["overview", "assets", "managers", "documents"];
  return (modules.length ? modules : fallback).map((key) => {
    const id = sourceSectionId(key);
    return { id, label: profileSectionLabel(id) };
  });
}

function sourceSectionId(id: string): string {
  if (id === "people") return "managers";
  if (id === "compass") return "mandates";
  return id;
}

function profileSectionLabel(id: string): string {
  const labels: Record<string, string> = {
    overview: "Overview",
    assets: "Assets",
    managers: "People",
    strategy: "Strategy",
    transactions: "Transactions",
    mandates: "RFPs / Mandates",
    documents: "Documents",
    holdings: "Holdings",
    benchmarks: "Benchmarks",
    returns: "Returns",
    governance: "Governance",
    contact: "Contact",
    timeline: "Timeline",
  };
  return labels[id] || humanLabel(id);
}

function isShellModule(fields: Row): boolean {
  const keys = Object.keys(fields);
  if (!keys.length) return true;
  const meaningful = keys.filter((key) => {
    const normalized = humanLabel(key).toLowerCase();
    const value = text(fields[key], "");
    return !["source", "entity id"].includes(normalized)
      && value
      && value !== "Not disclosed"
      && value !== SOURCE_GAP;
  });
  return meaningful.length === 0;
}

function humanLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/([a-z])([A-Z])/g, "$1 $2");
}

function formatModuleValue(value: unknown): string {
  if (value == null || value === "" || value === SOURCE_GAP) return NOT_DISCLOSED;
  if (typeof value === "number") return Number.isFinite(value) ? value.toLocaleString("en-US") : NOT_DISCLOSED;
  if (Array.isArray(value)) {
    return value.length
      ? value.map((item) => typeof item === "object" && item !== null ? formatObjectValue(item as Row) : text(item, "")).filter(Boolean).join("; ")
      : NOT_DISCLOSED;
  }
  if (typeof value === "object") {
    return formatObjectValue(value as Row);
  }
  return text(value, NOT_DISCLOSED);
}

function firstPresent(...values: unknown[]): unknown {
  return values.find((value) => value != null && value !== "");
}

function disclosedMoney(value: unknown): string {
  if (value == null || value === "" || value === 0 || value === "0" || value === "$0" || value === "Not disclosed") return NOT_DISCLOSED;
  return money(value);
}

function formatObjectValue(value: Row): string {
  const entries = Object.entries(value)
    .filter(([, item]) => item != null && item !== "")
    .map(([key, item]) => `${humanLabel(key)}: ${typeof item === "number" ? item.toLocaleString("en-US") : Array.isArray(item) ? formatModuleValue(item) : text(item, "")}`);
  return entries.length ? entries.join("; ") : NOT_DISCLOSED;
}

function decodeHtml(value: string): string {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#39;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

function SourceGapPanel({ kind, sourceUrl, selectionRequired }: { kind: Kind; sourceUrl: string; selectionRequired?: boolean }) {
  return (
    <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
      <div className="font-semibold text-[#11314F]">{selectionRequired ? "Selection required" : NOT_AVAILABLE}</div>
      <div className="mt-1">{selectionRequired ? `Open a ${kind} from a SWFI list to view its detail page.` : `The selected ${kind} is not available in the current SWFI records.`}</div>
      {sourceUrl ? <a href={sourceMirrorHref(sourceUrl, detailReturnRoute(kind))} data-source-state="on-file" className="mt-2 inline-block text-[#16538C] underline">Open SWFI record</a> : null}
    </section>
  );
}

function LoadingPanel({ kind, sourceUrl }: { kind: Kind; sourceUrl: string }) {
  return (
    <section className="rounded border border-[#DCE3EA] bg-white p-4 text-sm text-[#41566B]">
      <div className="font-semibold text-[#11314F]">{LOADING}</div>
      <div className="mt-1">Loading the SWFI {kind} record.</div>
      {sourceUrl ? <a href={sourceMirrorHref(sourceUrl, detailReturnRoute(kind))} data-source-state="on-file" className="mt-2 inline-block text-[#16538C] underline">Open SWFI record</a> : null}
    </section>
  );
}

function sourceHref(row?: Row): string {
  if (!row) return "";
  for (const key of ["source_url", "swfi_url", "url"]) {
    const value = text(row[key], "");
    if (value.startsWith("http://") || value.startsWith("https://")) return value;
  }
  return "";
}

function detailReturnRoute(kind: Kind): string {
  if (kind === "profile") return "/profiles/detail/";
  if (kind === "mandate") return "/mandates/detail/";
  if (kind === "person") return "/people/detail/";
  if (kind === "report") return "/reports/detail/";
  return "/transactions/detail/";
}

function sourceMirrorHref(sourceUrl: string, returnRoute: string): string {
  return sourceDetailHref(sourceUrl, returnRoute);
}

function subscribeToLocation(callback: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("popstate", callback);
  return () => window.removeEventListener("popstate", callback);
}

function browserSearch() {
  return typeof window === "undefined" ? "" : window.location.search;
}

function serverSearch() {
  return "";
}
