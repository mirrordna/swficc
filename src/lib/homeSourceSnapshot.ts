import type { Packet } from "@/lib/sourcePackets";

// Public first paint must not bundle backend receipts or legacy CMS URLs.
// Live SWFI packets hydrate the dashboard after load.
export const HOME_PACKET_SNAPSHOT = {} satisfies Record<string, Packet>;
