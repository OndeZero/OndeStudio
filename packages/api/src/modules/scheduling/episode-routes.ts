import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  EpisodeQueueResponseSchema,
  ReorderEpisodesInputSchema,
  RescanResultSchema,
  StationSlugSchema,
} from "@ondestudio/shared";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import type { EpisodeQueueService } from "./episode-queue-service";

const errorContent = { "application/json": { schema: ApiErrorSchema } };
const params = z.object({
  station: StationSlugSchema,
  id: z.coerce.number().int().positive(),
});
const queueContent = { "application/json": { schema: EpisodeQueueResponseSchema } };

const listRoute = createRoute({
  method: "get",
  path: "/stations/{station}/shows/{id}/episodes",
  tags: ["scheduling"],
  summary: "A show's episode queue (PD §4.5) with the occurrence each episode fills",
  request: { params },
  responses: {
    200: { description: "Queue", content: queueContent },
    404: { description: "Unknown show", content: errorContent },
  },
});

const rescanRoute = createRoute({
  method: "post",
  path: "/stations/{station}/shows/{id}/rescan",
  tags: ["scheduling"],
  summary: "Rescan the drop folder and auto-fill the show's empty occurrences",
  request: { params },
  responses: {
    200: {
      description: "Scan + fill result",
      content: { "application/json": { schema: RescanResultSchema } },
    },
    404: { description: "Unknown show", content: errorContent },
    503: { description: "Media store unreachable", content: errorContent },
  },
});

const reorderRoute = createRoute({
  method: "post",
  path: "/stations/{station}/shows/{id}/episodes/reorder",
  tags: ["scheduling"],
  summary: "Reorder the queue (order decides which episode fills which occurrence)",
  request: {
    params,
    body: { content: { "application/json": { schema: ReorderEpisodesInputSchema } } },
  },
  responses: {
    200: { description: "Reordered queue", content: queueContent },
    404: { description: "Unknown show", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

export function createEpisodeRoutes(service: EpisodeQueueService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(listRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.queue(station.value, c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  routes.openapi(rescanRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.scanAndFill(station.value, c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  routes.openapi(reorderRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.reorder(
      station.value,
      c.req.valid("param").id,
      c.req.valid("json").orderedIds,
    );
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  return routes;
}
