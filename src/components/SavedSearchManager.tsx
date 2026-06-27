"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type SavedSearchItem = {
  id?: string;
  name?: string;
  section?: string;
  query_string?: string;
  filters?: Record<string, unknown>;
  filters_summary?: string;
  result_url?: string;
  alert_enabled?: boolean;
  alert_frequency?: string | null;
  linked_alert_enabled?: boolean;
  linked_alert_channel?: string | null;
  linked_alert_last_fired_at?: string | null;
  last_used_at?: string | null;
};

type DeliveryReceipt = {
  channel?: string;
  status?: string;
  detail?: string;
  fired_at?: string;
};

type SavedSearchEnvelope = {
  status?: string;
  detail?: string;
  data?: {
    item?: SavedSearchItem;
    items?: SavedSearchItem[];
    count?: number;
    total?: number;
    deleted?: boolean;
    linked_alert_deleted?: boolean;
    alert_update_confirmed?: boolean;
    linked_alert?: {
      linked_alert_enabled?: boolean;
      linked_alert_created?: boolean;
      linked_alert_deleted?: boolean;
      linked_alert_channel?: string | null;
    };
    linked_alert_delivery?: {
      delivery_receipts?: DeliveryReceipt[];
      delivered_count?: number;
      blocked_count?: number;
      failed_count?: number;
      email_delivery_claimed?: boolean;
      sendgrid_onboarding_claimed?: boolean;
      current_results_summary?: {
        status?: string;
        collection?: string;
        count?: number;
        total?: number;
      };
    };
    current_results?: {
      status?: string;
      collection?: string;
      data?: {
        count?: number;
        total?: number;
      };
    };
    refresh_rule?: string;
  };
};

const sections = [
  ["transaction", "Transactions / Deals"],
  ["compass", "RFPs / Mandates"],
  ["entity", "Institutions"],
  ["people", "People"],
  ["global", "Global"],
] as const;

const frequencies = ["Daily Digest", "Weekly Digest", "Immediate"] as const;

export default function SavedSearchManager() {
  const [token, setToken] = useState("");
  const [userId, setUserId] = useState("swfi-validation@swfi.test");
  const [status, setStatus] = useState("Enter access details to load saved searches.");
  const [items, setItems] = useState<SavedSearchItem[]>([]);
  const [resultText, setResultText] = useState("");
  const [name, setName] = useState("Asia infrastructure deals");
  const [section, setSection] = useState("transaction");
  const [queryString, setQueryString] = useState("Norway");
  const [region, setRegion] = useState("Asia");
  const [industry, setIndustry] = useState("Infrastructure");
  const [minimumAmount, setMinimumAmount] = useState("100000000");
  const [alertEnabled, setAlertEnabled] = useState(true);
  const [alertFrequency, setAlertFrequency] = useState("Daily Digest");

  const activeAlertCount = useMemo(() => items.filter((item) => item.alert_enabled).length, [items]);

  async function loadSavedSearches() {
    const response = await apiRequest("/api/v1/saved-searches?limit=25&offset=0");
    if (!response) return;
    if (response.status !== "ok") {
      setStatus(response.detail || "Unable to load saved searches.");
      return;
    }
    setItems(response.data?.items || []);
    setStatus(`Showing ${(response.data?.items || []).length.toLocaleString("en-US")} saved searches.`);
  }

  async function createSavedSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await apiRequest("/api/v1/saved-searches", {
      method: "POST",
      body: JSON.stringify({
        name: name.trim(),
        section,
        query_string: queryString.trim(),
        filters: buildFilters(),
        result_url: resultUrlFor(section, queryString.trim()),
        alert_enabled: alertEnabled,
        alert_frequency: alertFrequency,
      }),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.data?.item) {
      setStatus(response.detail || "Saved search was not created.");
      return;
    }
    setItems((current) => [response.data!.item!, ...current]);
    setStatus("Saved search created through the protected Saved Searches API.");
  }

  async function refreshResults(item: SavedSearchItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/saved-searches/${encodeURIComponent(item.id)}/results?limit=2&offset=0`);
    if (!response) return;
    if (response.status !== "ok") {
      setStatus(response.detail || "Saved search results unavailable.");
      return;
    }
    const current = response.data?.current_results;
    const count = current?.data?.count ?? 0;
    const total = current?.data?.total ?? count;
    setItems((currentItems) => currentItems.map((row) => (row.id === item.id && response.data?.item ? response.data.item : row)));
    setResultText(`Current ${current?.collection || "SWFI"} results: ${Number(count).toLocaleString("en-US")} of ${Number(total).toLocaleString("en-US")}.`);
    setStatus("Saved search rerun against the current SWFI data source.");
  }

  async function updateSavedSearch(item: SavedSearchItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/saved-searches/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: `${item.name || "Saved search"} updated`,
        filters: {
          ...(typeof item.filters === "object" && item.filters ? item.filters : {}),
          region: ["Europe"],
        },
        confirm_alert_update: true,
      }),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.data?.item) {
      setStatus(response.detail || "Saved search was not updated.");
      return;
    }
    setItems((current) => current.map((row) => (row.id === item.id ? response.data!.item! : row)));
    setStatus(response.data.alert_update_confirmed ? "Saved search updated with alert confirmation." : "Saved search updated.");
  }

  async function testAlertDelivery(item: SavedSearchItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/saved-searches/${encodeURIComponent(item.id)}/alert-deliveries/test`, {
      method: "POST",
      body: JSON.stringify({ event_type: "saved_search_ui_test", event_title: `Saved search alert test: ${item.name || "Saved search"}` }),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.data?.item) {
      setStatus(response.detail || "Linked alert delivery test failed.");
      return;
    }
    setItems((current) => current.map((row) => (row.id === item.id ? response.data!.item! : row)));
    const delivery = response.data.linked_alert_delivery;
    const delivered = Number(delivery?.delivered_count || 0).toLocaleString("en-US");
    const blocked = Number(delivery?.blocked_count || 0).toLocaleString("en-US");
    const failed = Number(delivery?.failed_count || 0).toLocaleString("en-US");
    const collection = delivery?.current_results_summary?.collection || "SWFI";
    setStatus(`Linked alert delivery test complete: ${delivered} delivered, ${blocked} blocked, ${failed} failed. Checked current ${collection} results first.`);
  }

  async function deleteSavedSearch(item: SavedSearchItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/saved-searches/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response) return;
    if (response.status !== "ok" || response.data?.deleted !== true) {
      setStatus(response.detail || "Saved search was not deleted.");
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
    const alertText = response.data.linked_alert_deleted ? " Linked alert was disabled." : "";
    setStatus(`Saved search deleted.${alertText}`);
  }

  async function apiRequest(path: string, init: RequestInit = {}): Promise<SavedSearchEnvelope | null> {
    if (!token.trim()) {
      setStatus("Access token required.");
      return null;
    }
    if (!userId.trim()) {
      setStatus("Subscriber identity required.");
      return null;
    }
    try {
      const response = await fetch(path, {
        ...init,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          Authorization: `Bearer ${token.trim()}`,
          "X-SWFI-User-Id": userId.trim(),
          "X-SWFIPN-Internal": "1",
          ...(init.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
      if (!response.ok) {
        setStatus(body.detail || `HTTP ${response.status}`);
        return body;
      }
      return body;
    } catch {
      setStatus("Saved Searches API request failed.");
      return null;
    }
  }

  function buildFilters() {
    const filters: Record<string, unknown> = {};
    if (region.trim()) filters.region = [region.trim()];
    if (industry.trim()) filters.sector = [industry.trim()];
    const amount = Number(minimumAmount);
    if (Number.isFinite(amount) && amount > 0) filters.min_amount = amount;
    return filters;
  }

  return (
    <section data-brd-saved-searches-ui data-gsap-reveal className="grid gap-4 rounded border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Saved Search Workspace</h2>
          <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Save filters, rerun current results, test in-app alert receipts, and delete saved searches through the protected API.</p>
        </div>
        <div data-testid="saved-searches-ui-status" className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {status}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">API access token</span>
          <input
            data-testid="saved-searches-access-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none"
            autoComplete="off"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Subscriber identity</span>
          <input
            data-testid="saved-searches-user-id"
            type="email"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none"
          />
        </label>
        <button
          data-testid="saved-searches-load"
          type="button"
          onClick={loadSavedSearches}
          className="min-h-10 rounded border border-[#C7D2DD] bg-white px-4 font-semibold text-[#16538C]"
        >
          Load Saved
        </button>
      </div>

      <form onSubmit={createSavedSearch} className="grid gap-3 rounded border border-[#E8EDF2] bg-[#F7F9FA] p-3 lg:grid-cols-4">
        <label className="grid gap-1 text-sm lg:col-span-2">
          <span className="font-semibold text-[#41566B]">Search name</span>
          <input data-testid="saved-searches-name" value={name} onChange={(event) => setName(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Section</span>
          <select data-testid="saved-searches-section" value={section} onChange={(event) => setSection(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3">
            {sections.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Query</span>
          <input data-testid="saved-searches-query" value={queryString} onChange={(event) => setQueryString(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Region</span>
          <input data-testid="saved-searches-region" value={region} onChange={(event) => setRegion(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Industry / category</span>
          <input data-testid="saved-searches-sector" value={industry} onChange={(event) => setIndustry(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Minimum amount USD</span>
          <input data-testid="saved-searches-minimum-amount" inputMode="numeric" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Alert frequency</span>
          <select data-testid="saved-searches-alert-frequency" value={alertFrequency} onChange={(event) => setAlertFrequency(event.target.value)} disabled={!alertEnabled} className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3 disabled:bg-[#EEF2F5]">
            {frequencies.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2 text-sm lg:col-span-3">
          <input data-testid="saved-searches-alert-enabled" type="checkbox" checked={alertEnabled} onChange={(event) => setAlertEnabled(event.target.checked)} />
          <span>Attach alert to this saved search</span>
        </label>
        <button data-testid="saved-searches-create" type="submit" className="min-h-10 rounded bg-[#A61C20] px-4 font-semibold text-white">Save Search</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#41566B]">
        <strong className="text-[#11314F]">Saved searches: {items.length.toLocaleString("en-US")} · Alerts: {activeAlertCount.toLocaleString("en-US")}</strong>
        {resultText ? <span data-testid="saved-searches-results-summary">{resultText}</span> : null}
      </div>

      <div data-testid="saved-searches-list" className="grid gap-2">
        {items.length ? items.map((item, index) => (
          <article key={item.id || `${item.name}-${index}`} className="grid gap-2 rounded border border-[#DCE3EA] px-3 py-3 text-sm lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto] lg:items-start">
            <div>
              <div className="font-bold text-[#11314F]">{item.name || "Untitled saved search"}</div>
              <div className="mt-1 text-[#41566B]">{sectionLabel(item.section)} · {item.query_string || "No query"}</div>
              <div className="mt-1 text-[12px] text-[#7A8A9B]">{item.filters_summary || "No filters"}</div>
            </div>
            <div className="text-[#41566B]">
              <div>{item.alert_enabled ? `Alert: ${item.alert_frequency || "Enabled"}` : "Alert: off"}</div>
              <div className="mt-1 text-[12px] text-[#7A8A9B]">{savedSearchAlertLabel(item)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button data-testid="saved-searches-rerun" type="button" onClick={() => refreshResults(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Rerun</button>
              {item.alert_enabled ? <button data-testid="saved-searches-test-alert-delivery" type="button" onClick={() => testAlertDelivery(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Test Alert</button> : null}
              <button data-testid="saved-searches-update" type="button" onClick={() => updateSavedSearch(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Update</button>
              <button data-testid="saved-searches-delete" type="button" onClick={() => deleteSavedSearch(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#A61C20]">Delete</button>
            </div>
          </article>
        )) : (
          <div className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-sm text-[#41566B]">No saved searches loaded.</div>
        )}
      </div>
    </section>
  );
}

function resultUrlFor(section: string, query: string) {
  const encoded = encodeURIComponent(query);
  if (section === "transaction") return `/v1/transactions/search${encoded ? `?q=${encoded}` : ""}`;
  if (section === "compass") return `/v1/compass/search${encoded ? `?q=${encoded}` : ""}`;
  if (section === "people") return `/v1/people/search${encoded ? `?q=${encoded}` : ""}`;
  if (section === "global") return encoded ? `/v1?q=${encoded}` : "/v1";
  return `/v1/entities/search${encoded ? `?q=${encoded}` : ""}`;
}

function sectionLabel(value?: string) {
  return sections.find(([key]) => key === value)?.[1] || "Saved search";
}

function savedSearchAlertLabel(item: SavedSearchItem) {
  if (!item.alert_enabled) return "Results are read fresh when rerun.";
  const channel = item.linked_alert_channel === "in_app" ? "in-app" : "saved-search";
  if (item.linked_alert_last_fired_at) return `Linked ${channel} alert receipt last tested ${item.linked_alert_last_fired_at}.`;
  if (item.linked_alert_enabled) return `Linked ${channel} alert writes delivery receipts when tested.`;
  return "Linked alert receipt pending.";
}
