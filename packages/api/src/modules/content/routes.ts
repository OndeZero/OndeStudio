import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import { ApiErrorSchema, MediaBrowseResponseSchema, StationSlugSchema } from "@ondestudio/shared";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { browseEntryToContract } from "./contract";
import type { ContentService } from "./service";

const stationParam = z.object({ station: StationSlugSchema });
const errorContent = { "application/json": { schema: ApiErrorSchema } };

const browseMediaRoute = createRoute({
  method: "get",
  path: "/stations/{station}/media",
  tags: ["content"],
  summary: "Browse one directory of the station media tree (read-only, phase 1)",
  request: {
    params: stationParam,
    // Directory relative to the media root; "" (the default) is the root.
    query: z.object({ path: z.string().max(500).optional().default("") }),
  },
  responses: {
    200: {
      description: "Direct children of the directory, dirs first",
      content: { "application/json": { schema: MediaBrowseResponseSchema } },
    },
    404: { description: "Unknown path", content: errorContent },
    422: { description: "Invalid station or path", content: errorContent },
    503: { description: "Playout system unreachable", content: errorContent },
  },
});

/** Thin HTTP surface: validate (shared Zod) → call the service → map out (docs/2 §3.2). */
export function createContentRoutes(service: ContentService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(browseMediaRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.browse(station.value, c.req.valid("query").path);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(
      {
        station: station.value.value,
        path: result.value.path,
        entries: result.value.entries.map(browseEntryToContract),
      },
      200,
    );
  });

  return routes;
}
