import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorSchema, PublicScheduleSchema, StationSlugSchema } from "@ondestudio/shared";
import type { Clock } from "../../kernel/clock";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { occurrenceToPublicScheduleItem } from "./contract";
import type { SchedulingService } from "./service";

/**
 * Resolves live broadcasters' public display names by id — a tiny
 * composition-root port (app.ts wires it over the broadcaster repo) so the
 * scheduling module never imports people (docs/2 §3.6).
 */
export interface StreamerDirectory {
  namesByIds(ids: number[]): Promise<Map<number, string>>;
}

/** Default window when the caller omits it: now → +3d, matching OndePlayer's own Upcoming range. */
const DEFAULT_HORIZON_MS = 3 * 24 * 60 * 60 * 1000;

const scheduleRoute = createRoute({
  method: "get",
  path: "/stations/{station}/schedule",
  tags: ["scheduling"],
  summary: "Announceable schedule — the public Upcoming seam (RFC 0003, M5)",
  description:
    "Publicly-announceable occurrences only: `validated` (episode-enriched) and past-`aired` (reverted to generic, PD §5.5). Negotiation and team internals never appear.",
  request: {
    params: z.object({ station: StationSlugSchema }),
    query: z.object({ from: z.iso.datetime().optional(), to: z.iso.datetime().optional() }),
  },
  responses: {
    200: {
      description: "Announceable occurrences over the window",
      content: { "application/json": { schema: PublicScheduleSchema } },
    },
    422: {
      description: "Invalid station shortcode or window",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
  },
});

/**
 * The public read seam OndePlayer's Upcoming reads (RFC 0003). Same-origin,
 * unauthenticated read — the composition root lists it in `PUBLIC_PATHS`, and
 * the tyrell edge keeps it tailnet/on-box for M5 (it joins the public galaxy
 * seam later). Reads over the existing occurrence engine, filtered and mapped
 * to the announcement-safe contract.
 */
export function createPublicScheduleRoutes(
  service: SchedulingService,
  streamers: StreamerDirectory,
  clock: Clock,
): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(scheduleRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;

    const { from, to } = c.req.valid("query");
    const now = clock.now();
    const fromUtc = from ? new Date(from) : now;
    const toUtc = to ? new Date(to) : new Date(fromUtc.getTime() + DEFAULT_HORIZON_MS);

    const result = await service.listOccurrences(station.value, fromUtc, toUtc, {
      // Announceable only (docs/2 §6.4): validated upcoming + past-aired. Every
      // other negotiation state (prebooked holds, dealing, declined…) is dropped.
      negotiation: ["validated", "aired"],
    });
    if (!result.ok) return respondDomainError(c, result.error) as never;

    // One lookup for every live broadcaster in the window → its public name.
    const liveIds = [
      ...new Set(
        result.value
          .filter((e) => e.slot.kind === "live" && e.slot.broadcasterId !== null)
          .map((e) => e.slot.broadcasterId as number),
      ),
    ];
    const names = liveIds.length ? await streamers.namesByIds(liveIds) : new Map<number, string>();

    const items = result.value.map((enriched) =>
      occurrenceToPublicScheduleItem(
        enriched,
        now,
        enriched.slot.broadcasterId !== null
          ? (names.get(enriched.slot.broadcasterId) ?? null)
          : null,
      ),
    );
    return c.json({ station: station.value.value, generatedAt: now.toISOString(), items }, 200);
  });

  return routes;
}
