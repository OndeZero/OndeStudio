import { z } from "zod";

/**
 * Realtime channels a client subscribes to per station (docs/2 §6.3):
 * `GET /stations/{station}/sse?channels=onair,grid`.
 * Live state arrives in seconds; structural state within ≤30s (PD §6 freshness).
 */
export const SSE_CHANNELS = ["grid", "board", "onair"] as const;

export const SseChannelSchema = z.enum(SSE_CHANNELS);

export type SseChannel = z.infer<typeof SseChannelSchema>;
