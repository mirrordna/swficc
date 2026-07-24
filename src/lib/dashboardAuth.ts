import { useEffect, useState } from "react";

const APP_BASE = "/swficc";
const SESSION_STATUS_PATH = "/api/session/status/v1";

const READABLE_SESSION_COOKIE_NAMES = new Set([
  "__swfipn_session",
  "__Host-swfipn_session",
  "__swfi_terminal_session",
  "__Host-swfi_terminal_session",
  "swfi_terminal_session",
]);

type SessionStatus = {
  authenticated?: unknown;
  dashboard_access?: unknown;
  display_name?: unknown;
};

export function dashboardNavigationTarget(anchor: HTMLAnchorElement | null): string | null {
  if (!anchor) return null;
  if (anchor.target && anchor.target !== "_self") return null;
  if (anchor.hasAttribute("download")) return null;

  const rawHref = anchor.getAttribute("data-dashboard-target") || anchor.getAttribute("href") || "";
  if (!rawHref || rawHref.startsWith("#")) return null;

  const target = safeAppTarget(anchor.href);
  if (!target) return null;
  if (isPublicDashboardTarget(target)) return null;
  return target;
}

export async function navigateFromDashboard(target: string): Promise<void> {
  const href = safeAppTarget(target);
  if (!href) return;
  window.location.assign(await hasSubscriberSession() ? href : loginHrefForTarget(href));
}

export function loginHrefForTarget(target: string): string {
  const safeTarget = safeAppTarget(target) || `${APP_BASE}/`;
  const params = new URLSearchParams({ next: safeTarget });
  return `${APP_BASE}/login/?${params.toString()}`;
}

export type ProtectedRouteState = "checking" | "allowed";

export function useProtectedSwficcRoute(): ProtectedRouteState {
  const [state, setState] = useState<ProtectedRouteState>("checking");

  useEffect(() => {
    let active = true;
    async function check() {
      const currentTarget = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      const ok = await hasSubscriberSession();
      if (!active) return;
      if (ok) {
        setState("allowed");
        return;
      }
      window.location.replace(loginHrefForTarget(currentTarget));
    }
    void check();
    return () => {
      active = false;
    };
  }, []);

  return state;
}

export async function hasSubscriberSession(): Promise<boolean> {
  if (hasReadableSessionCookie()) return true;
  try {
    const response = await fetch(SESSION_STATUS_PATH, {
      cache: "no-store",
      credentials: "include",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return false;
    const status = await response.json() as SessionStatus;
    return status.authenticated === true && status.dashboard_access !== false;
  } catch {
    return false;
  }
}

export function useDashboardSessionDisplayName(): string {
  const [displayName, setDisplayName] = useState("");

  useEffect(() => {
    let active = true;
    async function check() {
      try {
        const response = await fetch(SESSION_STATUS_PATH, {
          cache: "no-store",
          credentials: "include",
          headers: { Accept: "application/json" },
        });
        if (!response.ok) {
          if (active) setDisplayName("");
          return;
        }
        const status = await response.json() as SessionStatus;
        const rawName = typeof status.display_name === "string" ? status.display_name.trim() : "";
        if (active) setDisplayName(status.authenticated === true ? safeDisplayName(rawName) : "");
      } catch {
        if (active) setDisplayName("");
      }
    }
    void check();
    return () => {
      active = false;
    };
  }, []);

  return displayName;
}

function safeDisplayName(value: string): string {
  return value
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, 60);
}

function hasReadableSessionCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie
    .split(";")
    .map((item) => item.trim().split("=")[0])
    .some((name) => READABLE_SESSION_COOKIE_NAMES.has(name));
}

function safeAppTarget(value: string): string {
  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return "";
    if (parsed.pathname === APP_BASE) return `${APP_BASE}/${parsed.search}${parsed.hash}`;
    if (!parsed.pathname.startsWith(`${APP_BASE}/`)) return "";
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function isPublicDashboardTarget(target: string): boolean {
  try {
    const parsed = new URL(target, window.location.origin);
    // Direct brand pages remain renderable; dashboard-origin clicks are gated.
    return parsed.pathname === `${APP_BASE}/`
      || parsed.pathname === `${APP_BASE}/login/`
      || parsed.pathname === `${APP_BASE}/logout/`;
  } catch {
    return false;
  }
}
