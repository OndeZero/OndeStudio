import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import { ApiErrorSchema, OnAirSchema, StationSlugSchema } from "@ondestudio/shared";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { onAirToContract } from "./contract";
import type { PlayoutService } from "./service";

const nowRoute = createRoute({
  method: "get",
  path: "/stations/{station}/now",
  tags: ["playout"],
  summary: "What is on air right now",
  description:
    "Live-first, cache-degraded: when the playout link is down the last-known state is served with `stale: true`.",
  request: { params: z.object({ station: StationSlugSchema }) },
  responses: {
    200: {
      description: "Current on-air state",
      content: { "application/json": { schema: OnAirSchema } },
    },
    404: {
      description: "Station unknown to the playout system",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
    422: {
      description: "Invalid station shortcode",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
    503: {
      description: "Playout system unreachable and no cached state available",
      content: { "application/json": { schema: ApiErrorSchema } },
    },
  },
});

/** Thin HTTP surface: validate (shared Zod) → call the service → map out (docs/2 §3.2). */
export function createPlayoutRoutes(service: PlayoutService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(nowRoute, async (c) => {
    // `as never`: the uniform error envelope (platform/http.ts) satisfies every
    // declared error status; re-proving that to the per-route response types
    // would add noise, not safety.
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;

    const result = await service.getNow(station.value);
    if (!result.ok) return respondDomainError(c, result.error) as never;

    return c.json(onAirToContract(result.value), 200);
  });

  return routes;
}
