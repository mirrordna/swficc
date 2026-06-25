/* ═══════════════════════════════════════════════
   API Client — fetches from backend via proxy
   ═══════════════════════════════════════════════ */

import type { DashboardPayload } from "./types";

const BACKEND = (process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

/** Server-side fetch — direct to backend, forwards cookies */
export async function fetchDashboard(cookie?: string): Promise<DashboardPayload> {
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  if (cookie) headers.Cookie = cookie;

  const res = await fetch(`${BACKEND}/api/dashboard/v1`, {
    headers,
    next: { revalidate: 120 },
  });

  if (!res.ok) {
    throw new Error(`Dashboard API returned ${res.status}`);
  }

  return res.json();
}

/** Client-side fetch — goes through Next.js proxy */
export async function fetchDashboardClient(): Promise<DashboardPayload> {
  const res = await fetch("/api/proxy/dashboard/v1", {
    credentials: "include",
  });

  if (!res.ok) {
    throw new Error(`Dashboard proxy returned ${res.status}`);
  }

  return res.json();
}

/** Client-side search via Ask SWFI */
export async function fetchSearch(query: string): Promise<Record<string, unknown>> {
  const res = await fetch(`/api/proxy/swfi/chat/v1`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });

  if (!res.ok) {
    throw new Error(`Search API returned ${res.status}`);
  }

  return res.json();
}
