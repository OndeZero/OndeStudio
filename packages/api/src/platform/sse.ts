import type { OpenAPIHono } from "@hono/zod-openapi";
import { SSE_CHANNELS, type SseChannel } from "@ondestudio/shared";
import { streamSSE } from "hono/streaming";
import type { Logger } from "../kernel/logger";
import { StationId } from "../kernel/station-id";
import { createRouter } from "./http";

type Send = (event: string, data: unknown) => void;

/**
 * In-process SSE fan-out (docs/2 §6.3): modules publish through the event bus
 * (wired in app.ts), subscribers hold one HTTP connection per surface.
 * Channels are station-scoped: `grid` · `board` · `onair`.
 */
export interface SseHub {
  publish(station: string, channel: SseChannel, event: string, data: unknown): void;
  register(station: string, channel: SseChannel, send: Send): () => void;
  subscriberCount(station: string, channel: SseChannel): number;
}

export function createSseHub(logger: Logger): SseHub {
  const subscribers = new Map<string, Set<Send>>();
  const key = (station: string, channel: SseChannel): string => `${station}/${channel}`;

  return {
    publish(station, channel, event, data) {
      const set = subscribers.get(key(station, channel));
      if (!set || set.size === 0) return;
      for (const send of set) {
        try {
          send(event, data);
        } catch (error) {
          logger.warn("sse send failed", { station, channel, error: String(error) });
        }
      }
    },
    register(station, channel, send) {
      const k = key(station, channel);
      let set = subscribers.get(k);
      if (!set) {
        set = new Set();
        subscribers.set(k, set);
      }
      set.add(send);
      return () => {
        set.delete(send);
        // Prune empty keys: the key space is caller-influenced, so leftovers
        // from arbitrary station strings must not accumulate.
        if (set.size === 0) subscribers.delete(k);
      };
    },
    subscriberCount(station, channel) {
      return subscribers.get(key(station, channel))?.size ?? 0;
    },
  };
}

const HEARTBEAT_MS = 15_000;

/** Serves the current state to a fresh subscriber, so reconnects never show stale data. */
export type SseSnapshotProvider = (station: string) => Promise<unknown | null>;
export type SseSnapshotProviders = Partial<Record<SseChannel, SseSnapshotProvider>>;

/** `GET /stations/{station}/sse?channels=onair,grid` — one connection, N channels. */
export function createSseRoutes(
  hub: SseHub,
  logger: Logger,
  snapshots: SseSnapshotProviders = {},
): OpenAPIHono {
  const routes = createRouter();

  routes.get("/stations/:station/sse", (c) => {
    // Validate + canonicalize: publishers key the hub on the parsed StationId
    // value, so an unvalidated raw param would subscribe to a key nothing
    // ever publishes to — a silently dead stream (docs/2 §6.1).
    const stationParsed = StationId.parse(c.req.param("station"));
    if (!stationParsed.ok) {
      return c.json({ error: stationParsed.error.message }, 422);
    }
    const station = stationParsed.value.value;
    const requested = (c.req.query("channels") ?? "")
      .split(",")
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk.length > 0);

    const invalid = requested.filter((r) => !(SSE_CHANNELS as readonly string[]).includes(r));
    if (requested.length === 0 || invalid.length > 0) {
      return c.json({ error: `channels must be a comma list of: ${SSE_CHANNELS.join(", ")}` }, 422);
    }
    const channels = requested as SseChannel[];

    return streamSSE(c, async (stream) => {
      const send: Send = (event, data) => {
        void stream.writeSSE({ event, data: JSON.stringify(data) });
      };
      const unregister = channels.map((channel) => hub.register(station, channel, send));
      logger.debug("sse subscribed", { station, channels });

      let open = true;
      stream.onAbort(() => {
        open = false;
        for (const fn of unregister) fn();
        logger.debug("sse closed", { station, channels });
      });

      // Late subscribers (and EventSource auto-reconnects) get the current
      // state immediately — without this, a reconnect that missed a
      // transition would show stale data until the NEXT transition.
      for (const channel of channels) {
        const provider = snapshots[channel];
        if (!provider || !open) continue;
        const snapshot = await provider(station).catch(() => null);
        if (snapshot !== null && open) send(channel, snapshot);
      }

      // Heartbeat keeps intermediaries (and Bun's idle timeout) from cutting quiet streams.
      while (open) {
        await stream.writeSSE({ event: "ping", data: "" });
        await stream.sleep(HEARTBEAT_MS);
      }
    });
  });

  return routes;
}
