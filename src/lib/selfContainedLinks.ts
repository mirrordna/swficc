const APP_BASE = "/swficc";
const SWFI_RECORD_SECTIONS = new Set(["entities", "people", "transactions", "compass"]);
const SWFI_HOSTS = new Set(["swfi.com", "www.swfi.com", "cms.swfi.com"]);

const ROUTE_BY_SECTION: Record<string, string> = {
  profiles: "/profiles/",
  profile: "/profiles/",
  people: "/people/",
  person: "/people/",
  transactions: "/transactions/",
  transaction: "/transactions/",
  deals: "/deals/",
  deal: "/deals/",
  allocators: "/allocators/",
  allocator: "/allocators/",
  comparisons: "/comparisons/",
  comparison: "/comparisons/",
  compare: "/comparisons/",
  peer: "/comparisons/",
  mandates: "/mandates/",
  mandate: "/mandates/",
  rfps: "/mandates/",
  rfp: "/mandates/",
  reports: "/reports/",
  report: "/reports/",
  research: "/research/",
  intelligence: "/intelligence/",
  news: "/research/",
  article: "/research/",
  saved: "/saved/",
  alerts: "/alerts/",
  search: "/search/",
  source: "/source/",
  provenance: "/provenance/",
  "ask-swfi": "/search/",
  "source-data": "/search/",
  "fund-rankings": "/profiles/",
};

export function appHref(route = "/"): string {
  if (route.startsWith("#")) return route;
  const clean = route.startsWith(APP_BASE) ? route.slice(APP_BASE.length) || "/" : route;
  const path = clean.startsWith("/") ? clean : `/${clean}`;
  return path === "/" ? `${APP_BASE}/` : `${APP_BASE}${path.endsWith("/") || path.includes("?") || path.includes("#") ? path : `${path}/`}`;
}

export function assetHref(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${APP_BASE}${clean}`;
}

export function appRouteForHref(href: string | undefined, fallback = "/"): string {
  if (!href) return fallback;
  if (href.startsWith("#")) return href;
  try {
    const isHttp = href.startsWith("http://") || href.startsWith("https://");
    const parsed = isHttp
      ? new URL(href)
      : new URL(href, "https://swfipn.activemirror.ai");
    if (!isHttp) {
      const cleanPath = parsed.pathname.startsWith(APP_BASE)
        ? parsed.pathname.slice(APP_BASE.length) || "/"
        : parsed.pathname;
      return `${cleanPath || "/"}${parsed.search}${parsed.hash}`;
    }
    const mirrored = swfiMirrorRoute(parsed);
    if (mirrored) return mirrored;
    const parts = parsed.pathname.split("/").filter(Boolean);
    const first = parts[0] === "swficc" ? parts[1] : parts[0];
    const route = ROUTE_BY_SECTION[first || ""] || routeFromHost(parsed.hostname, parts) || fallback;
    if (route === "/search/" && parsed.searchParams.get("q")) {
      return `/search/?q=${encodeURIComponent(parsed.searchParams.get("q") || "")}`;
    }
    if (route === "/source/") return `/source/${parsed.search || ""}`;
    return route;
  } catch {
    return fallback;
  }
}

export function swfiMirrorHref(sourceUrl: string | undefined): string {
  if (!sourceUrl) return appHref("/");
  try {
    const mirrored = swfiMirrorRoute(new URL(sourceUrl));
    return appHref(mirrored || `/source/?${new URLSearchParams({ url: sourceUrl }).toString()}`);
  } catch {
    return appHref("/");
  }
}

export function resolvedSwfiMirrorHref(sourceUrl: string | undefined): string {
  if (!sourceUrl) return "";
  try {
    const mirrored = swfiMirrorRoute(new URL(sourceUrl));
    return mirrored ? appHref(mirrored) : "";
  } catch {
    return "";
  }
}

export function selfContainedHref(href: string | undefined, fallback = "/"): string {
  return appHref(appRouteForHref(href, fallback));
}

export function isExternalHttpHref(href: string | undefined): boolean {
  if (!href) return false;
  try {
    const parsed = new URL(href);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

export function sourceProvenanceHref(href: string | undefined): string | undefined {
  return isExternalHttpHref(href) ? href : undefined;
}

export function isSwfiPlatformRecordHref(href: string | undefined): boolean {
  return Boolean(swfiRecordPathFromHref(href)) || Boolean(legacyPostIdFromHref(href));
}

export function swfiRecordPathFromHref(href: string | undefined): string {
  if (!href) return "";
  try {
    const parsed = new URL(href, "https://www.swfi.com");
    if (!isAllowedSwfiHost(parsed.hostname)) return "";
    if (parsed.pathname.replace(/\/?$/, "/") === "/v1/signin/") {
      if (parsed.hostname !== "www.swfi.com" || parsed.searchParams.get("msg") !== "auth") return "";
      return swfiRecordPathFromHref(parsed.searchParams.get("redirect") || "");
    }
    const parts = parsed.pathname.split("/").filter(Boolean);
    const v1Index = parts.indexOf("v1");
    const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
    const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
    if (!SWFI_RECORD_SECTIONS.has(section || "")) return "";
    if (!/^[a-f0-9]{24}$/i.test(id || "")) return "";
    return `/v1/${section}/${id}`;
  } catch {
    const match = String(href || "").match(/^\/v1\/(entities|people|transactions|compass)\/([a-f0-9]{24})$/i);
    return match ? `/v1/${match[1]}/${match[2]}` : "";
  }
}

export function swfiAuthHandoffHref(href: string | undefined): string {
  const recordPath = swfiRecordPathFromHref(href);
  if (!recordPath) return href || "";
  const params = new URLSearchParams({ msg: "auth", redirect: recordPath });
  return `https://www.swfi.com/v1/signin/?${params.toString()}`;
}

function legacyPostIdFromHref(href: string | undefined): string {
  if (!href) return "";
  try {
    const parsed = new URL(href);
    if (!isAllowedSwfiHost(parsed.hostname)) return "";
    return parsed.searchParams.get("p") || "";
  } catch {
    const match = String(href || "").match(/[?&]p=(\d+)/);
    return match?.[1] || "";
  }
}

export function normalizeSwfiPlatformHref(href: string): string {
  try {
    const parsed = new URL(href);
    if (parsed.hostname === "cms.swfi.com") parsed.hostname = "www.swfi.com";
    return parsed.toString();
  } catch {
    return href;
  }
}

export function sourceDetailHref(sourceUrl: string | undefined, returnRoute = "/"): string {
  if (!sourceUrl) return appHref(returnRoute);
  try {
    const mirrored = swfiMirrorRoute(new URL(sourceUrl));
    if (mirrored) return appHref(mirrored);
  } catch {
    return appHref(returnRoute);
  }
  const params = new URLSearchParams({
    url: sourceUrl,
    return: appHref(returnRoute),
  });
  return appHref(`/source/?${params.toString()}`);
}

function routeFromHost(hostname: string, parts: string[]): string | undefined {
  if (isAllowedSwfiHost(hostname)) {
    const joined = parts.join("/");
    if (/profile|fund|ranking|entity|institution/i.test(joined)) return "/profiles/";
    if (/person|people|executive|contact/i.test(joined)) return "/people/";
    if (/transaction|deal/i.test(joined)) return "/transactions/";
    if (/rfp|mandate|compass/i.test(joined)) return "/mandates/";
    if (/news|article|research|report/i.test(joined)) return "/research/";
    return undefined;
  }
  if (hostname === "institutionalinvestorhub.com") {
    return ROUTE_BY_SECTION[parts[0] || ""] || "/";
  }
  return "/";
}

function swfiMirrorRoute(parsed: URL): string | undefined {
  if (!isAllowedSwfiHost(parsed.hostname)) return undefined;
  const publicPageRoutes: Record<string, string> = {
    "/about": "/about/",
    "/about-us": "/about/",
    "/about-us/overview": "/about-us/overview/",
    "/about-us/our-team": "/about-us/our-team/",
    "/solutions": "/solutions/",
    "/demo": "/demo/",
    "/contact": "/contact/",
    "/contact-us": "/contact/",
    "/newsletter-subscription": "/newsletter-subscription/",
    "/privacy-policy": "/privacy-policy/",
    "/terms-of-use": "/terms-of-use/",
    "/cookie-policy": "/cookie-policy/",
    "/accessibility": "/accessibility/",
  };
  const publicPageRoute = publicPageRoutes[parsed.pathname.replace(/\/$/, "")];
  if (publicPageRoute) return publicPageRoute;
  const legacyPostId = parsed.searchParams.get("p");
  if (legacyPostId) {
    return `/research/detail/?${new URLSearchParams({ legacy: legacyPostId }).toString()}`;
  }
  const parts = parsed.pathname.split("/").filter(Boolean);
  const v1Index = parts.indexOf("v1");
  const section = v1Index >= 0 ? parts[v1Index + 1] : parts[0];
  const id = v1Index >= 0 ? parts[v1Index + 2] : parts[1];
  if (section === "entities" && id === "aggregates") {
    return "/profiles/aggregates/";
  }
  if (section === "entities" && id) {
    return `/profiles/detail/?${new URLSearchParams({ id }).toString()}`;
  }
  if (section === "transactions" && id) {
    return `/transactions/detail/?${new URLSearchParams({ id }).toString()}`;
  }
  if (section === "compass" && id) {
    return `/mandates/detail/?${new URLSearchParams({ id }).toString()}`;
  }
  if ((section === "people" || section === "person") && id) {
    return `/people/detail/?${new URLSearchParams({ id }).toString()}`;
  }
  if (section === "news" && id) {
    return `/research/detail/?${new URLSearchParams({ legacy: id, source: parsed.toString() }).toString()}`;
  }
  if (/news|article|research|reports?/i.test(parsed.pathname)) {
    return "/research/";
  }
  return undefined;
}

export function isAllowedSwfiHost(hostname: string | undefined): boolean {
  const host = String(hostname || "").toLowerCase();
  return SWFI_HOSTS.has(host);
}
