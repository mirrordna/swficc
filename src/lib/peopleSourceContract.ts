export function peopleSourceEndpoint(
  query: string,
  rowLimit: number,
  pageIndex: number,
): string {
  const params = new URLSearchParams({
    collection: "people",
    limit: String(Math.min(50, Math.max(1, rowLimit))),
    page: String(Math.max(0, pageIndex) + 1),
  });
  const cleanQuery = query.trim();
  if (cleanQuery) params.set("q", cleanQuery);
  return `/api/source-data/search/v1?${params.toString()}`;
}

export function peopleFilterSummary(query: string): string {
  const cleanQuery = query.trim();
  return cleanQuery ? `name containing “${cleanQuery}”` : "all people in the source preview";
}

// A LinkedIn link is public only when both halves of its provenance are valid:
// an HTTPS profile URL and a canonical SWFI People record carrying it. This is
// deliberately narrower than a generic social-media URL and never creates
// follow, connect, message, email, or contact actions.
export function verifiedPeopleLinkedInProfileUrl(linkedinValue: unknown, sourceValue: unknown): string {
  const linkedin = String(linkedinValue || "").trim();
  const source = String(sourceValue || "").trim();
  if (!linkedin || !isCanonicalSwfiPeopleSource(source)) return "";
  try {
    const parsed = new URL(linkedin);
    const host = parsed.hostname.toLowerCase();
    if (parsed.protocol !== "https:") return "";
    if (host !== "linkedin.com" && host !== "www.linkedin.com") return "";
    if (!/^\/(?:in|pub)\/[^/?#]+\/?$/i.test(parsed.pathname)) return "";
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return "";
  }
}

export function isCanonicalSwfiPeopleSource(value: unknown): boolean {
  const clean = String(value || "").trim();
  try {
    const parsed = new URL(clean);
    return parsed.protocol === "https:"
      && (parsed.hostname === "www.swfi.com" || parsed.hostname === "swfi.com")
      && /^\/v1\/people\/[a-f0-9]{24}\/?$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}
