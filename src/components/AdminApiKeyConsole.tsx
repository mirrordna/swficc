"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type ApiKeyItem = {
  id?: string;
  name?: string;
  status?: string;
  source?: string;
  created_at?: string | null;
  revoked_at?: string | null;
};

type ApiKeyEnvelope = {
  status?: string;
  detail?: string;
  store_configured?: boolean;
  total?: number;
  items?: ApiKeyItem[];
  item?: ApiKeyItem;
  api_key?: string;
  one_time_secret?: boolean;
  secret_policy?: string;
};

export default function AdminApiKeyConsole() {
  const [token, setToken] = useState("");
  const [status, setStatus] = useState("Enter the service access token to manage product API keys.");
  const [items, setItems] = useState<ApiKeyItem[]>([]);
  const [name, setName] = useState(`SWFI API validation key ${new Date().toISOString().slice(0, 10)}`);
  const [createdSecret, setCreatedSecret] = useState("");

  const activeManagedCount = useMemo(
    () => items.filter((item) => item.source === "managed_store" && item.status !== "revoked").length,
    [items]
  );

  async function loadKeys() {
    setCreatedSecret("");
    const response = await apiRequest("/v1/admin/api-keys");
    if (!response) return;
    if (response.status !== "ok") {
      setStatus(response.detail || "Unable to load product API keys.");
      return;
    }
    setItems(response.items || []);
    setStatus(`Showing ${(response.items || []).length.toLocaleString("en-US")} product API keys.`);
  }

  async function createKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setCreatedSecret("");
    const response = await apiRequest("/v1/admin/api-keys", {
      method: "POST",
      body: JSON.stringify({ name: name.trim() || "SWFI API key" }),
    });
    if (!response) return;
    if (response.status !== "ok" || !response.item || !response.api_key || response.one_time_secret !== true) {
      setStatus(response.detail || "Product API key was not created.");
      return;
    }
    setItems((current) => [response.item!, ...current]);
    setCreatedSecret(response.api_key);
    setStatus("Product API key created. Store the one-time secret now.");
  }

  async function revokeKey(item: ApiKeyItem) {
    if (!item.id) return;
    setCreatedSecret("");
    const response = await apiRequest(`/v1/admin/api-keys/${encodeURIComponent(item.id)}`, { method: "DELETE" });
    if (!response) return;
    if (response.status !== "ok" || !response.item) {
      setStatus(response.detail || "Product API key was not revoked.");
      return;
    }
    setItems((current) => current.map((row) => (row.id === item.id ? response.item! : row)));
    setStatus("Product API key revoked.");
  }

  async function apiRequest(path: string, init: RequestInit = {}): Promise<ApiKeyEnvelope | null> {
    if (!token.trim()) {
      setStatus("Service access token required.");
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
      setStatus("Product API key request failed.");
      return null;
    }
  }

  return (
    <section data-brd-admin-api-ui data-gsap-reveal className="grid gap-4 border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[20px] font-bold text-[#11314F]">Admin API Product Console</h1>
          <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">
            Protected operator surface for listing, creating, and revoking SWFI product API keys.
          </p>
        </div>
        <div data-testid="admin-api-status" className="border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {status}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Service access token</span>
          <input
            data-testid="admin-api-token"
            type="password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            className="min-h-10 border border-[#C7D2DD] px-3 outline-none"
            autoComplete="off"
          />
        </label>
        <button
          data-testid="admin-api-load"
          type="button"
          onClick={loadKeys}
          className="min-h-10 border border-[#C7D2DD] bg-white px-4 font-semibold text-[#16538C]"
        >
          Load Keys
        </button>
      </div>

      <form onSubmit={createKey} className="grid gap-3 border border-[#E8EDF2] bg-[#F7F9FA] p-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Key name</span>
          <input
            data-testid="admin-api-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="min-h-10 border border-[#C7D2DD] px-3 outline-none"
          />
        </label>
        <button data-testid="admin-api-create" type="submit" className="min-h-10 bg-[#A61C20] px-4 font-semibold text-white">
          Create Key
        </button>
      </form>

      {createdSecret ? (
        <div className="grid gap-2 border border-[#BFD7EA] bg-[#F4FAFF] p-3 text-sm">
          <div className="font-bold text-[#11314F]">One-time product API key</div>
          <code data-testid="admin-api-created-secret" className="break-all border border-[#DCE3EA] bg-white px-3 py-2 text-[#11314F]">
            {createdSecret}
          </code>
          <p className="m-0 text-[12px] text-[#41566B]">This value is only returned by the create request. It is cleared when keys are reloaded or revoked.</p>
        </div>
      ) : null}

      <div className="grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-[#41566B]">
          <strong className="text-[#11314F]">Product API keys</strong>
          <span data-testid="admin-api-count">Active managed keys: {activeManagedCount.toLocaleString("en-US")}</span>
        </div>
        <div data-testid="admin-api-keys" className="overflow-x-auto border border-[#E2E8EF]">
          <table className="min-w-full border-collapse text-left text-sm">
            <thead className="bg-[#F7F9FA] text-[12px] uppercase tracking-[0.04em] text-[#41566B]">
              <tr>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Name</th>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Status</th>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Source</th>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Created</th>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Revoked</th>
                <th className="border-b border-[#E2E8EF] px-3 py-2">Action</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? items.map((item) => (
                <tr key={`${item.source || "key"}-${item.id || item.name}`} data-key-name={item.name || ""} className="border-b border-[#EEF2F6] last:border-b-0">
                  <td className="px-3 py-2 font-semibold text-[#11314F]">{item.name || "Untitled API key"}</td>
                  <td className="px-3 py-2 text-[#41566B]">{item.status === "revoked" ? "Revoked" : "Active"}</td>
                  <td className="px-3 py-2 text-[#41566B]">{item.source === "managed_store" ? "Managed store" : "Static configuration"}</td>
                  <td className="px-3 py-2 text-[#41566B]">{formatDate(item.created_at)}</td>
                  <td className="px-3 py-2 text-[#41566B]">{formatDate(item.revoked_at)}</td>
                  <td className="px-3 py-2">
                    {item.source === "managed_store" && item.status !== "revoked" ? (
                      <button data-testid="admin-api-revoke" type="button" onClick={() => revokeKey(item)} className="border border-[#A61C20] px-3 py-2 text-[#A61C20]">
                        Revoke
                      </button>
                    ) : (
                      <span className="text-[#7A8A9B]">No action</span>
                    )}
                  </td>
                </tr>
              )) : (
                <tr>
                  <td colSpan={6} className="px-3 py-6 text-center text-[#7A8A9B]">No product API keys loaded.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

function formatDate(value?: string | null): string {
  if (!value) return "Not disclosed";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not disclosed";
  return date.toISOString().slice(0, 10);
}
