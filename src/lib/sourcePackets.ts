export const SOURCE_GAP = "Not disclosed by SWFI.com";

export type Packet = Record<string, unknown>;
export type Row = Record<string, unknown>;

const rawBackend = (process.env.NEXT_PUBLIC_SWFI_BACKEND_URL || process.env.NEXT_PUBLIC_BACKEND_URL || "").replace(/\/$/, "");

function record(value: unknown): Row {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
}

function backendOrigin(): string | null {
  const browserOrigin = typeof window !== "undefined" ? window.location.origin : "";
  const browserHost = typeof window !== "undefined" ? window.location.hostname : "";
  const browserIsLocal = ["localhost", "127.0.0.1", "::1"].includes(browserHost);
  if (rawBackend === "same-origin" && typeof window !== "undefined") return window.location.origin;
  if (!rawBackend && typeof window !== "undefined") return window.location.origin;
  if (!rawBackend) return null;
  try {
    const parsed = new URL(rawBackend);
    const isLocal = ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname);
    if (isLocal && browserOrigin && !browserIsLocal) return browserOrigin;
    if (parsed.protocol === "https:" || (parsed.protocol === "http:" && isLocal)) {
      return parsed.origin;
    }
  } catch {
    return null;
  }
  return null;
}

export function packetData(packet?: Packet): Row {
  return record(packet?.data);
}

export function isFact(packet?: Packet): boolean {
  return String(packet?.status || "").toLowerCase() === "ok" && packet?.fact === true;
}

export function packetReason(packet?: Packet): string {
  return text(packet?.unavailable_reason || "", "");
}

export function rows(packet?: Packet, key = "rows"): Row[] {
  const payload = packetData(packet);
  const value = payload[key];
  if (Array.isArray(value)) return value as Row[];
  if (key !== "rows" && Array.isArray(payload.rows)) return payload.rows as Row[];
  if (Array.isArray(payload.results)) return payload.results as Row[];
  return [];
}

export function sourceRows(packet?: Packet, fallbackRows: Row[] = []): Row[] {
  return isFact(packet) ? rows(packet) : fallbackRows;
}

export function count(packet?: Packet): string {
  if (!isFact(packet)) return SOURCE_GAP;
  const value = packetData(packet).count;
  return typeof value === "number" ? value.toLocaleString("en-US") : SOURCE_GAP;
}

export function sourceCount(packet?: Packet, key = "rows"): string {
  if (!isFact(packet)) return SOURCE_GAP;
  return rows(packet, key).length.toLocaleString("en-US");
}

export function sourceRowCount(packet?: Packet, key = "rows"): string {
  if (!isFact(packet)) return SOURCE_GAP;
  return `${sourceCount(packet, key)} rows`;
}

export function text(value: unknown, fallback = SOURCE_GAP): string {
  if (value == null || value === "") return fallback;
  return String(value);
}

export function money(value: unknown): string {
  if (value == null || value === "") return SOURCE_GAP;
  if (typeof value === "string" && value.trim()) return value;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return SOURCE_GAP;
  if (Math.abs(n) >= 1_000_000_000_000) return `$${trim(n / 1_000_000_000_000)}T`;
  if (Math.abs(n) >= 1_000_000_000) return `$${trim(n / 1_000_000_000)}B`;
  if (Math.abs(n) >= 1_000_000) return `$${trim(n / 1_000_000)}M`;
  return `$${n.toLocaleString("en-US")}`;
}

export function numericSortValue(value: string): number | null {
  const textValue = value.trim();
  if (!textValue || /not disclosed|unavailable/i.test(textValue)) return null;
  const compact = textValue.replace(/\b(usd|us\$|aum|deals?|rows?|source matches?)\b/gi, "").trim();
  const unitMatch = compact.match(/(-?[0-9][0-9,]*(?:\.[0-9]+)?)\s*([KMBT])\b/i);
  if (unitMatch) {
    const multiplier = unitMatch[2].toUpperCase() === "K"
      ? 1_000
      : unitMatch[2].toUpperCase() === "M"
        ? 1_000_000
        : unitMatch[2].toUpperCase() === "B"
          ? 1_000_000_000
          : 1_000_000_000_000;
    return Number(unitMatch[1].replaceAll(",", "")) * multiplier;
  }
  const numericMatch = compact.match(/-?[0-9][0-9,]*(?:\.[0-9]+)?/);
  if (!numericMatch) return null;
  const parsed = Number(numericMatch[0].replaceAll(",", ""));
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeSwfiUrl(value: string): string {
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "cms.swfi.com") {
      parsed.hostname = "www.swfi.com";
      return parsed.toString();
    }
  } catch {
    return value;
  }
  return value;
}

type FetchPacketOptions = {
  signal?: AbortSignal;
  attempts?: number;
};

export async function fetchPacket(path: string, timeoutMs = 15_000, options: FetchPacketOptions = {}): Promise<Packet> {
  const attempts = Math.max(1, options.attempts ?? 3);
  let packet: Packet = sourceGapPacket("backend_fetch_not_started");
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (options.signal?.aborted) return sourceGapPacket("frontend_fetch_cancelled");
    packet = await fetchPacketOnce(path, timeoutMs, options.signal);
    if (!isTransientSourceGap(packet) || attempt === attempts - 1) return packet;
    await sleep(300 + attempt * 450);
  }
  return packet;
}

export async function collectFactPacketsProgressively(
  requests: Array<Promise<Packet>>,
  onPacket: (packet: Packet, index: number) => void,
): Promise<Packet[]> {
  const settled = await Promise.all(requests.map(async (request, index) => {
    let packet: Packet;
    try {
      packet = await request;
    } catch {
      return null;
    }
    if (!isFact(packet)) return null;
    onPacket(packet, index);
    return { index, packet };
  }));
  return settled
    .filter((item): item is { index: number; packet: Packet } => item !== null)
    .sort((left, right) => left.index - right.index)
    .map((item) => item.packet);
}

async function fetchPacketOnce(path: string, timeoutMs = 15_000, signal?: AbortSignal): Promise<Packet> {
  const origin = backendOrigin();
  if (!origin) return sourceGapPacket("frontend_backend_origin_missing_or_invalid");

  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal?.addEventListener("abort", cancel, { once: true });
  const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = new URL(path, origin);
    const res = await fetch(url.toString(), {
      signal: controller.signal,
      cache: "no-store",
      credentials: "omit",
      headers: { Accept: "application/json", "X-SWFIPN-Public": "1" },
    });
    if (!res.ok) return sourceGapPacket(`backend_http_${res.status}`);
    const payload: unknown = await res.json();
    return record(payload);
  } catch (error) {
    const reason = signal?.aborted
      ? "frontend_fetch_cancelled"
      : error instanceof DOMException && error.name === "AbortError"
      ? "backend_fetch_aborted"
      : "backend_fetch_failed";
    return sourceGapPacket(reason);
  } finally {
    signal?.removeEventListener("abort", cancel);
    globalThis.clearTimeout(timeout);
  }
}

function isTransientSourceGap(packet: Packet): boolean {
  const reason = packetReason(packet);
  return reason === "backend_fetch_failed"
    || reason === "backend_fetch_aborted"
    || /^backend_http_5\d\d$/.test(reason);
}

function sourceGapPacket(reason: string): Packet {
  return {
    status: "unavailable",
    fact: false,
    unavailable_reason: reason,
    data: { rows: [], count: 0 },
  };
}

function trim(value: number): string {
  return value.toFixed(value >= 10 ? 1 : 2).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => globalThis.setTimeout(resolve, ms));
}
