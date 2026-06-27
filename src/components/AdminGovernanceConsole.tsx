"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";

type AdminEnvelope<T = unknown> = {
  status?: string;
  detail?: string;
  data?: T;
  real_swfi_auth_integration_claimed?: boolean;
  sendgrid_onboarding_claimed?: boolean;
  welcome_email_claimed?: boolean;
};

type Organization = {
  id?: string;
  org_name?: string;
  org_type?: string;
  subscription_tier?: string;
  max_users?: number;
  billing_email?: string;
  api_access?: boolean;
  status?: string;
};

type AdminUser = {
  id?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  org_id?: string;
  role?: string;
  status?: string;
  api_key_id?: string | null;
  welcome_email_status?: string;
};

type ContentItem = {
  id?: string;
  section?: string;
  title?: string;
  status?: string;
  summary?: string;
  submitted_by?: string;
};

type ListData<T> = {
  items?: T[];
  total?: number;
  item?: T;
  one_time_api_key?: string | null;
  one_time_secret?: boolean;
  welcome_email_claimed?: boolean;
};

const adminRoles = ["Super Admin", "Admin", "Editor", "Viewer"] as const;

export default function AdminGovernanceConsole() {
  const [token, setToken] = useState("");
  const [role, setRole] = useState<(typeof adminRoles)[number]>("Super Admin");
  const [status, setStatus] = useState("Enter the service access token to manage Admin governance workflows.");
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [contentItems, setContentItems] = useState<ContentItem[]>([]);
  const [createdOrgId, setCreatedOrgId] = useState("");
  const [orgName, setOrgName] = useState(() => `BRD Validation Organization ${new Date().toISOString().slice(0, 10)}`);
  const [billingEmail, setBillingEmail] = useState("billing@validation.swfi.test");
  const [userEmail, setUserEmail] = useState(() => `validator.${Date.now()}@swfi.test`);
  const [contentTitle, setContentTitle] = useState(() => `Admin workflow validation story ${new Date().toISOString().slice(0, 10)}`);

  const activeOrgCount = useMemo(() => organizations.filter((item) => item.status !== "inactive").length, [organizations]);
  const activeUserCount = useMemo(() => users.filter((item) => item.status !== "Suspended").length, [users]);

  async function loadGovernance() {
    const [orgs, userRows, contentRows] = await Promise.all([
      apiRequest<ListData<Organization>>("/v1/admin/organizations?limit=25&offset=0"),
      apiRequest<ListData<AdminUser>>("/v1/admin/users?limit=25&offset=0"),
      apiRequest<ListData<ContentItem>>("/v1/admin/content-items?limit=25&offset=0"),
    ]);
    if (!orgs || !userRows || !contentRows) return;
    setOrganizations(orgs.data?.items || []);
    setUsers(userRows.data?.items || []);
    setContentItems(contentRows.data?.items || []);
    setCreatedOrgId((orgs.data?.items || [])[0]?.id || "");
    setStatus(
      `Showing ${(orgs.data?.items || []).length.toLocaleString("en-US")} organizations, ${(userRows.data?.items || []).length.toLocaleString("en-US")} users, and ${(contentRows.data?.items || []).length.toLocaleString("en-US")} content workflow records.`
    );
  }

  async function createOrganization(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await apiRequest<ListData<Organization>>("/v1/admin/organizations", {
      method: "POST",
      body: JSON.stringify({
        org_name: orgName.trim(),
        org_type: "API Client",
        subscription_tier: "Enterprise",
        contract_start: "2026-06-01",
        contract_end: "2027-06-01",
        max_users: 5,
        billing_email: billingEmail.trim(),
        api_access: true,
      }),
    });
    if (!response?.data?.item) return;
    setOrganizations((current) => [response.data!.item!, ...current]);
    setCreatedOrgId(response.data.item.id || "");
    setStatus("Organization created with API access enabled.");
  }

  async function createUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const orgId = createdOrgId || organizations[0]?.id || "";
    if (!orgId) {
      setStatus("Create an organization before adding a user.");
      return;
    }
    const response = await apiRequest<ListData<AdminUser>>("/v1/admin/users", {
      method: "POST",
      body: JSON.stringify({
        first_name: "Prem",
        last_name: "Validator",
        email: userEmail.trim(),
        org_id: orgId,
        role: "Admin",
        status: "Pending",
        two_factor_enabled: true,
      }),
    });
    if (!response?.data?.item) return;
    setUsers((current) => [response.data!.item!, ...current]);
    setStatus(response.data.one_time_secret ? "User created. One-time API key was generated and not persisted in the UI." : "User created. Welcome email remains pending SendGrid onboarding.");
  }

  async function createContent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await apiRequest<ListData<ContentItem>>("/v1/admin/content-items", {
      method: "POST",
      body: JSON.stringify({
        section: "news",
        title: contentTitle.trim(),
        status: "Draft",
        summary: "Draft content stays in admin workflow until published.",
        featured: true,
        premium: false,
      }),
    });
    if (!response?.data?.item) return;
    setContentItems((current) => [response.data!.item!, ...current]);
    setStatus("Content workflow draft saved.");
  }

  async function apiRequest<T>(path: string, init: RequestInit = {}): Promise<AdminEnvelope<T> | null> {
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
          "X-SWFI-Admin-Role": role,
          "X-SWFI-Admin-User": "swfi-admin-validation@swfi.test",
          ...(init.headers || {}),
        },
      });
      const body = await response.json().catch(() => ({ detail: `HTTP ${response.status}` }));
      if (!response.ok || body.status !== "ok") {
        setStatus(body.detail || `HTTP ${response.status}`);
        return body;
      }
      return body;
    } catch {
      setStatus("Admin governance request failed.");
      return null;
    }
  }

  return (
    <section data-brd-admin-governance-ui data-gsap-reveal className="grid gap-4 border border-[#DCE3EA] bg-white px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="m-0 text-[20px] font-bold text-[#11314F]">Admin Governance Console</h1>
          <p className="m-0 mt-1 text-[12px] text-[#7A8A9B]">
            Protected staff workflow for organizations, users, roles, and content review records.
          </p>
        </div>
        <div data-testid="admin-governance-status" className="border border-[#DCE3EA] px-3 py-2 text-[12px] text-[#41566B]">
          {status}
        </div>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_180px_auto] lg:items-end">
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Service access token</span>
          <input data-testid="admin-governance-token" type="password" value={token} onChange={(event) => setToken(event.target.value)} className="min-h-10 border border-[#C7D2DD] px-3 outline-none" autoComplete="off" />
        </label>
        <label className="grid gap-1 text-sm">
          <span className="font-semibold text-[#41566B]">Admin role</span>
          <select data-testid="admin-governance-role" value={role} onChange={(event) => setRole(event.target.value as (typeof adminRoles)[number])} className="min-h-10 border border-[#C7D2DD] px-3 outline-none">
            {adminRoles.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <button data-testid="admin-governance-load" type="button" onClick={loadGovernance} className="min-h-10 border border-[#C7D2DD] bg-white px-4 font-semibold text-[#16538C]">
          Load Admin
        </button>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <form onSubmit={createOrganization} className="grid gap-3 border border-[#E8EDF2] bg-[#F7F9FA] p-3">
          <h2 className="m-0 text-[15px] font-bold text-[#11314F]">Organizations</h2>
          <input data-testid="admin-governance-org-name" value={orgName} onChange={(event) => setOrgName(event.target.value)} className="min-h-10 border border-[#C7D2DD] px-3 outline-none" />
          <input data-testid="admin-governance-org-email" value={billingEmail} onChange={(event) => setBillingEmail(event.target.value)} className="min-h-10 border border-[#C7D2DD] px-3 outline-none" />
          <button data-testid="admin-governance-create-org" type="submit" className="min-h-10 bg-[#A61C20] px-4 font-semibold text-white">Create Organization</button>
          <span data-testid="admin-governance-org-count" className="text-[12px] text-[#41566B]">Active organizations: {activeOrgCount.toLocaleString("en-US")}</span>
        </form>

        <form onSubmit={createUser} className="grid gap-3 border border-[#E8EDF2] bg-[#F7F9FA] p-3">
          <h2 className="m-0 text-[15px] font-bold text-[#11314F]">Users</h2>
          <input data-testid="admin-governance-user-email" value={userEmail} onChange={(event) => setUserEmail(event.target.value)} className="min-h-10 border border-[#C7D2DD] px-3 outline-none" />
          <button data-testid="admin-governance-create-user" type="submit" className="min-h-10 bg-[#A61C20] px-4 font-semibold text-white">Create User</button>
          <span data-testid="admin-governance-user-count" className="text-[12px] text-[#41566B]">Active users: {activeUserCount.toLocaleString("en-US")}</span>
        </form>

        <form onSubmit={createContent} className="grid gap-3 border border-[#E8EDF2] bg-[#F7F9FA] p-3">
          <h2 className="m-0 text-[15px] font-bold text-[#11314F]">Content Workflow</h2>
          <input data-testid="admin-governance-content-title" value={contentTitle} onChange={(event) => setContentTitle(event.target.value)} className="min-h-10 border border-[#C7D2DD] px-3 outline-none" />
          <button data-testid="admin-governance-create-content" type="submit" className="min-h-10 bg-[#A61C20] px-4 font-semibold text-white">Create Draft</button>
          <span data-testid="admin-governance-content-count" className="text-[12px] text-[#41566B]">Workflow records: {contentItems.length.toLocaleString("en-US")}</span>
        </form>
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <AdminMiniTable title="Organizations" rows={organizations.map((item) => [item.org_name || "Untitled", item.org_type || "", item.status || ""])} />
        <AdminMiniTable title="Users" rows={users.map((item) => [`${item.first_name || ""} ${item.last_name || ""}`.trim() || item.email || "Untitled", item.role || "", item.welcome_email_status || ""])} />
        <AdminMiniTable title="Content" rows={contentItems.map((item) => [item.title || "Untitled", item.section || "", item.status || ""])} />
      </div>
    </section>
  );
}

function AdminMiniTable({ title, rows }: { title: string; rows: string[][] }) {
  return (
    <div className="overflow-x-auto border border-[#E2E8EF]">
      <div className="border-b border-[#E2E8EF] bg-[#F7F9FA] px-3 py-2 text-[12px] font-bold uppercase text-[#41566B]">{title}</div>
      <table className="min-w-full border-collapse text-left text-sm">
        <tbody>
          {rows.length ? rows.slice(0, 5).map((row, rowIndex) => (
            <tr key={`${title}-${rowIndex}-${row.join("-")}`} className="border-b border-[#EEF2F6] last:border-b-0">
              {row.map((cell, cellIndex) => <td key={`${title}-${rowIndex}-${cellIndex}`} className="px-3 py-2 text-[#41566B]">{cell || "Not disclosed"}</td>)}
            </tr>
          )) : (
            <tr><td className="px-3 py-6 text-center text-[#7A8A9B]">No rows loaded.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
