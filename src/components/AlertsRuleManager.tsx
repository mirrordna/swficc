"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type AlertItem = {
  id?: string;
  name?: string;
  alert_type?: string;
  enabled?: boolean;
  frequency?: string;
  delivery_channels?: string[];
  delivery_worker_status?: string;
  delivery_claim?: string;
  plain_english_preview?: string;
  last_fired_at?: string;
};

type DeliveryReceipt = {
  channel?: string;
  status?: string;
  detail?: string;
  delivered_at?: string;
};

type AlertEnvelope = {
  status?: string;
  detail?: string;
  data?: {
    item?: AlertItem;
    items?: AlertItem[];
    count?: number;
    total?: number;
    retention_days?: number;
    delivery_worker_status?: string;
    delivery_claim?: string;
    delivery_receipts?: DeliveryReceipt[];
    delivered_count?: number;
    blocked_count?: number;
    failed_count?: number;
    deleted?: boolean;
  };
};

const alertTypes = [
  ["transaction", "Transactions"],
  ["compass_rfp", "RFPs / Mandates"],
  ["news", "News"],
  ["entity_aum", "Entity AUM"],
  ["people", "People"],
] as const;

const frequencies = ["Immediate", "Daily Digest", "Weekly Digest"] as const;

export default function AlertsRuleManager() {
  const [userId, setUserId] = useState("swfi-validation@swfi.test");
  const [status, setStatus] = useState("Use your SWFI session to load saved alert rules.");
  const [items, setItems] = useState<AlertItem[]>([]);
  const [historyText, setHistoryText] = useState("");
  const [alertName, setAlertName] = useState("Infrastructure transaction alert");
  const [alertType, setAlertType] = useState("transaction");
  const [frequency, setFrequency] = useState("Immediate");
  const [inApp, setInApp] = useState(true);
  const [email, setEmail] = useState(true);
  const [webhook, setWebhook] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState("https://swfipn.activemirror.ai/api/v1/alerts/webhook-test-sink");
  const [sector, setSector] = useState("Infrastructure");
  const [minimumAmount, setMinimumAmount] = useState("100000000");
  const [entityIds, setEntityIds] = useState("");

  const activeCount = useMemo(() => items.filter((item) => item.enabled !== false).length, [items]);

  async function loadAlerts() {
    const response = await apiRequest("/api/v1/alerts?limit=25&offset=0");
    if (!response) return;
    if (response.status !== "ok") {
      setStatus(response.detail || "Unable to load alert rules.");
      return;
    }
    setItems(response.data?.items || []);
    setStatus(`Showing ${(response.data?.items || []).length.toLocaleString("en-US")} saved alert rules.`);
  }

  async function createAlert(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const channels = [inApp ? "in_app" : "", email ? "email" : "", webhook ? "webhook" : ""].filter(Boolean);
    const criteria: Record<string, unknown> = {};
    if (alertType === "entity_aum") {
      criteria.entity_ids = entityIds.split(",").map((item) => item.trim()).filter(Boolean);
    } else {
      if (sector.trim()) criteria.sectors = [sector.trim()];
      const amount = Number(minimumAmount);
      if (Number.isFinite(amount) && amount > 0) criteria.min_amount_usd = amount;
    }
    const body: Record<string, unknown> = {
      alert_name: alertName.trim(),
      alert_type: alertType,
      delivery_channels: channels.length ? channels : ["in_app"],
      frequency,
      criteria,
    };
    if (webhook) body.webhook_url = webhookUrl.trim();
    const response = await apiRequest("/api/v1/alerts", {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.data?.item) {
      setStatus(response.detail || "Alert rule was not created.");
      return;
    }
    setItems((current) => [response.data!.item!, ...current]);
    setStatus("Alert rule created from the protected Alerts API.");
  }

  async function updateAlert(item: AlertItem, enabled: boolean) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/alerts/${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.data?.item) {
      setStatus(response.detail || "Alert rule was not updated.");
      return;
    }
    setItems((current) => current.map((row) => (row.id === item.id ? response.data!.item! : row)));
    setStatus(enabled ? "Alert rule enabled." : "Alert rule disabled.");
  }

  async function deleteAlert(item: AlertItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/alerts/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response) return;
    if (response.status !== "ok" || response.data?.deleted !== true) {
      setStatus(response.detail || "Alert rule was not deleted.");
      return;
    }
    setItems((current) => current.filter((row) => row.id !== item.id));
    setStatus("Alert rule deleted.");
  }

  async function testDelivery(item: AlertItem) {
    if (!item.id) return;
    const response = await apiRequest(`/api/v1/alerts/${encodeURIComponent(item.id)}/deliveries/test`, {
      method: "POST",
      body: JSON.stringify({ event_type: "ui_delivery_test", event_title: "UI delivery test" }),
    });
    if (!response) return;
    if (response.status !== "ok") {
      setStatus(response.detail || "Delivery test failed.");
      return;
    }
    const delivered = response.data?.delivered_count ?? 0;
    const blocked = response.data?.blocked_count ?? 0;
    const failed = response.data?.failed_count ?? 0;
    if (response.data?.item) {
      setItems((current) => current.map((row) => (row.id === item.id ? response.data!.item! : row)));
    }
    setStatus(`Delivery test complete: ${delivered} delivered, ${blocked} blocked, ${failed} failed.`);
  }

  async function loadHistory() {
    const response = await apiRequest("/api/v1/alerts/history?limit=25&offset=0");
    if (!response) return;
    if (response.status !== "ok") {
      setHistoryText(response.detail || "Alert history unavailable.");
      return;
    }
    const retention = response.data?.retention_days || 90;
    const delivery = response.data?.delivery_claim || "Outbound delivery requires receipts before it is claimed.";
    setHistoryText(`Alert history uses ${retention}-day retention. ${delivery}`);
  }

  async function apiRequest(path: string, init: RequestInit = {}): Promise<AlertEnvelope | null> {
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
      setStatus("Alerts API request failed.");
      return null;
    }
  }

  return (
    <section data-brd-alerts-ui data-gsap-reveal className="grid gap-4 rounded border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="m-0 text-[16px] font-bold text-[#11314F]">Alert Rule Management</h2>
          <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">Create, review, disable, and delete saved alert rules through the protected Alerts API.</p>
        </div>
        <div data-testid="alerts-ui-status" className="rounded border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {status}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Subscriber identity</span>
          <input
            data-testid="alerts-user-id"
            type="email"
            value={userId}
            onChange={(event) => setUserId(event.target.value)}
            className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none"
          />
        </label>
        <button
          data-testid="alerts-load"
          type="button"
          onClick={loadAlerts}
          className="min-h-10 rounded border border-[#C7D2DD] bg-white px-4 font-semibold text-[#16538C]"
        >
          Load Rules
        </button>
      </div>

      <form onSubmit={createAlert} className="grid gap-3 rounded border border-[#E8EDF2] bg-[#F7F9FA] p-3 lg:grid-cols-4">
        <label className="grid gap-1 text-sm lg:col-span-2">
          <span className="font-semibold text-[#41566B]">Alert name</span>
          <input
            data-testid="alerts-name"
            value={alertName}
            onChange={(event) => setAlertName(event.target.value)}
            className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none"
          />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Alert type</span>
          <select data-testid="alerts-type" value={alertType} onChange={(event) => setAlertType(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3">
            {alertTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Frequency</span>
          <select data-testid="alerts-frequency" value={frequency} onChange={(event) => setFrequency(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] bg-white px-3">
            {frequencies.map((value) => <option key={value} value={value}>{value}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Industry / category</span>
          <input data-testid="alerts-sector" value={sector} onChange={(event) => setSector(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Minimum amount USD</span>
          <input data-testid="alerts-minimum-amount" inputMode="numeric" value={minimumAmount} onChange={(event) => setMinimumAmount(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
        </label>
        <label className="grid gap-1 text-sm lg:col-span-2">
          <span className="font-semibold text-[#41566B]">Entity IDs for AUM alerts</span>
          <input data-testid="alerts-entity-ids" value={entityIds} onChange={(event) => setEntityIds(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" placeholder="Only required for Entity AUM" />
        </label>
        <div className="flex flex-wrap items-center gap-4 text-sm lg:col-span-3">
          <label className="inline-flex items-center gap-2">
            <input data-testid="alerts-channel-in-app" type="checkbox" checked={inApp} onChange={(event) => setInApp(event.target.checked)} />
            <span>In-app</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input data-testid="alerts-channel-email" type="checkbox" checked={email} onChange={(event) => setEmail(event.target.checked)} />
            <span>Email</span>
          </label>
          <label className="inline-flex items-center gap-2">
            <input data-testid="alerts-channel-webhook" type="checkbox" checked={webhook} onChange={(event) => setWebhook(event.target.checked)} />
            <span>Webhook</span>
          </label>
          <span className="text-[12px] text-[#7A8A9B]">In-app and webhook delivery write receipts. Email remains pending SendGrid onboarding.</span>
        </div>
        {webhook ? (
          <label className="grid gap-1 text-sm lg:col-span-4">
            <span className="font-semibold text-[#41566B]">Webhook URL</span>
            <input data-testid="alerts-webhook-url" value={webhookUrl} onChange={(event) => setWebhookUrl(event.target.value)} className="min-h-10 rounded border border-[#C7D2DD] px-3 outline-none" />
          </label>
        ) : null}
        <button data-testid="alerts-create" type="submit" className="min-h-10 rounded bg-[#A61C20] px-4 font-semibold text-white">Create Alert</button>
      </form>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-[#41566B]">
        <strong className="text-[#11314F]">Active rules: {activeCount.toLocaleString("en-US")}</strong>
        <button data-testid="alerts-history" type="button" onClick={loadHistory} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Load History</button>
      </div>
      {historyText ? <div data-testid="alerts-history-summary" className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-sm text-[#41566B]">{historyText}</div> : null}

      <div data-testid="alerts-rules" className="grid gap-2">
        {items.length ? items.map((item, index) => (
          <article key={item.id || `${item.name}-${index}`} className="grid gap-2 rounded border border-[#DCE3EA] px-3 py-3 text-sm lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] lg:items-start">
            <div>
              <div className="font-bold text-[#11314F]">{item.name || "Untitled alert"}</div>
              <div className="mt-1 text-[#41566B]">{typeLabel(item.alert_type)} · {item.frequency || "Immediate"} · {item.enabled === false ? "Disabled" : "Enabled"}</div>
              {item.plain_english_preview ? <div className="mt-1 text-[12px] text-[#7A8A9B]">{item.plain_english_preview}</div> : null}
            </div>
            <div className="text-[#41566B]">
              <div>{channelsLabel(item.delivery_channels)}</div>
              <div className="mt-1 text-[12px] text-[#7A8A9B]">{deliveryLabel(item)}</div>
            </div>
            <div className="flex flex-wrap gap-2">
              <button data-testid="alerts-toggle" type="button" onClick={() => updateAlert(item, item.enabled === false)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">
                {item.enabled === false ? "Enable" : "Disable"}
              </button>
              <button data-testid="alerts-test-delivery" type="button" onClick={() => testDelivery(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#16538C]">Test Delivery</button>
              <button data-testid="alerts-delete" type="button" onClick={() => deleteAlert(item)} className="rounded border border-[#C7D2DD] bg-white px-3 py-1.5 font-semibold text-[#A61C20]">Delete</button>
            </div>
          </article>
        )) : (
          <div className="rounded border border-[#DCE3EA] bg-[#F7F9FA] px-3 py-2 text-sm text-[#41566B]">No saved alert rules loaded.</div>
        )}
      </div>
    </section>
  );
}

function typeLabel(value?: string) {
  return alertTypes.find(([key]) => key === value)?.[1] || "Alert";
}

function channelsLabel(value?: string[]) {
  const channels = Array.isArray(value) && value.length ? value : ["in_app"];
  return channels.map((item) => item.replaceAll("_", "-")).join(" / ");
}

function deliveryLabel(item: AlertItem) {
  if (String(item.delivery_worker_status || "").includes("pending")) return "Delivery proof pending";
  if (item.last_fired_at) return `${item.delivery_claim || "Delivery receipts available."} Last tested ${item.last_fired_at}.`;
  return item.delivery_claim || "Delivery status available after receipts exist.";
}
