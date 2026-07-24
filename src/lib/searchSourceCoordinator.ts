import type { Packet } from "@/lib/sourcePackets";
import { fetchPacket, isFact, packetData, rows } from "@/lib/sourcePackets";
import {
  combineSearchSourceSettlements,
  searchSourceSettlementFromPacket,
  type SearchSourceSettlement,
} from "@/lib/searchRequestLifecycle";

export type SearchPacketCollectionResult = {
  packets: Packet[];
  factPackets: Packet[];
  settlement: SearchSourceSettlement;
};

export function searchPacketRows(packet: Packet | null | undefined): Record<string, unknown>[] {
  if (!packet || !isFact(packet)) return [];
  const resultRows = rows(packet, "results");
  return resultRows.length ? resultRows : rows(packet);
}

export async function fetchAllOpportunitySearchPackets(
  signal: AbortSignal,
  { maxPages = 25 }: { maxPages?: number } = {},
): Promise<SearchPacketCollectionResult> {
  const packets: Packet[] = [];
  let page = 1;
  for (let requestCount = 0; requestCount < maxPages; requestCount += 1) {
    const packet = await fetchPacket(`/api/live-opportunities/v1?limit=100&page=${page}`, 25_000, {
      signal,
      attempts: 2,
    });
    packets.push(packet);
    const settlement = searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length);
    if (settlement.state !== "success") return collectionResult(packets);

    const data = packetData(packet);
    if (data.has_more !== true) return collectionResult(packets);
    const nextPage = Number(data.next_page);
    if (!Number.isInteger(nextPage) || nextPage <= page) {
      return collectionResult(packets, {
        state: "error",
        itemCount: packetRowCount(packets),
        reason: "invalid_opportunity_pagination",
      });
    }
    page = nextPage;
  }
  return collectionResult(packets, {
    state: "error",
    itemCount: packetRowCount(packets),
    reason: "opportunity_page_limit_reached",
  });
}

function collectionResult(
  packets: Packet[],
  settlement: SearchSourceSettlement = combineSearchSourceSettlements(packets.map((packet) => (
    searchSourceSettlementFromPacket(packet, searchPacketRows(packet).length)
  ))),
): SearchPacketCollectionResult {
  return {
    packets,
    factPackets: packets.filter(isFact),
    settlement,
  };
}

function packetRowCount(packets: Packet[]): number {
  return packets.reduce((total, packet) => total + searchPacketRows(packet).length, 0);
}
