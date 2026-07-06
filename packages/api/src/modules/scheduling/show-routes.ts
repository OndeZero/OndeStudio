import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  ShowDetailSchema,
  ShowsResponseSchema,
  StationSlugSchema,
  UpdateShowInputSchema,
} from "@ondestudio/shared";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { showDetailToContract, showSummaryToContract } from "./contract";
import type { ShowService } from "./show-service";

const stationParam = z.object({ station: StationSlugSchema });
const showParams = stationParam.extend({ id: z.coerce.number().int().positive() });
const errorContent = { "application/json": { schema: ApiErrorSchema } };

const listShowsRoute = createRoute({
  method: "get",
  path: "/stations/{station}/shows",
  tags: ["scheduling"],
  summary: "The show library index: every show with slot count and next airing",
  request: { params: stationParam },
  responses: {
    200: { description: "Shows", content: { "application/json": { schema: ShowsResponseSchema } } },
    422: { description: "Invalid station", content: errorContent },
  },
});

const showDetailRoute = createRoute({
  method: "get",
  path: "/stations/{station}/shows/{id}",
  tags: ["scheduling"],
  summary: "The show hub (PD §5.4): settings, slot bindings, coming and past occurrences",
  request: { params: showParams },
  responses: {
    200: {
      description: "The show",
      content: { "application/json": { schema: ShowDetailSchema } },
    },
    404: { description: "Unknown show", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

const updateShowRoute = createRoute({
  method: "put",
  path: "/stations/{station}/shows/{id}",
  tags: ["scheduling"],
  summary: "Update show identity and per-show settings",
  request: {
    params: showParams,
    body: { content: { "application/json": { schema: UpdateShowInputSchema } } },
  },
  responses: {
    200: {
      description: "The updated show",
      content: { "application/json": { schema: ShowDetailSchema } },
    },
    404: { description: "Unknown show", content: errorContent },
    409: { description: "A show slugged like that name already exists", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

/** Thin HTTP surface: validate (shared Zod) → call the service → map out (docs/2 §3.2). */
export function createShowRoutes(service: ShowService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(listShowsRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const summaries = await service.showsSummary(station.value);
    return c.json(
      { station: station.value.value, shows: summaries.map(showSummaryToContract) },
      200,
    );
  });

  routes.openapi(showDetailRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.showDetail(station.value, id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(showDetailToContract(result.value, station.value.value, new Date()), 200);
  });

  routes.openapi(updateShowRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.updateShow(station.value, id, c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(showDetailToContract(result.value, station.value.value, new Date()), 200);
  });

  return routes;
}
