import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  CreateSlotInputSchema,
  MirrorResponseSchema,
  NegotiationStateSchema,
  OccurrenceIdSchema,
  OccurrenceSchema,
  OccurrencesResponseSchema,
  PatchOccurrenceInputSchema,
  SlotKindSchema,
  SlotSchema,
  SlotsResponseSchema,
  StationSlugSchema,
  UpdateSlotInputSchema,
} from "@ondestudio/shared";
import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import { mirrorBlockToContract, occurrenceToContract, slotToContract } from "./contract";
import type { GridFilters, SchedulingService } from "./service";

const stationParam = z.object({ station: StationSlugSchema });
const windowQuery = z.object({
  from: z.iso.datetime(),
  to: z.iso.datetime(),
  negotiation: z.string().optional(),
  kind: z.string().optional(),
});
const errorContent = { "application/json": { schema: ApiErrorSchema } };

const listOccurrencesRoute = createRoute({
  method: "get",
  path: "/stations/{station}/occurrences",
  tags: ["scheduling"],
  summary: "The grid over a window: computed occurrences merged with exceptions",
  request: { params: stationParam, query: windowQuery },
  responses: {
    200: {
      description: "Occurrences intersecting [from, to)",
      content: { "application/json": { schema: OccurrencesResponseSchema } },
    },
    422: { description: "Invalid window or filters", content: errorContent },
  },
});

const mirrorRoute = createRoute({
  method: "get",
  path: "/stations/{station}/mirror",
  tags: ["scheduling"],
  summary: "Read-only playout-system schedule over a window (Increment 1 mirror)",
  request: {
    params: stationParam,
    query: z.object({ from: z.iso.datetime(), to: z.iso.datetime() }),
  },
  responses: {
    200: {
      description: "Blocks the playout system will air",
      content: { "application/json": { schema: MirrorResponseSchema } },
    },
    422: { description: "Invalid window", content: errorContent },
    503: { description: "Playout system unreachable", content: errorContent },
  },
});

const listSlotsRoute = createRoute({
  method: "get",
  path: "/stations/{station}/slots",
  tags: ["scheduling"],
  summary: "Slot definitions (recurrence rules)",
  request: { params: stationParam },
  responses: {
    200: { description: "Slots", content: { "application/json": { schema: SlotsResponseSchema } } },
    422: { description: "Invalid station", content: errorContent },
  },
});

const createSlotRoute = createRoute({
  method: "post",
  path: "/stations/{station}/slots",
  tags: ["scheduling"],
  summary: "Create a slot definition",
  request: {
    params: stationParam,
    body: { content: { "application/json": { schema: CreateSlotInputSchema } } },
  },
  responses: {
    201: { description: "Created", content: { "application/json": { schema: SlotSchema } } },
    422: { description: "Invalid input", content: errorContent },
  },
});

const updateSlotRoute = createRoute({
  method: "put",
  path: "/stations/{station}/slots/{id}",
  tags: ["scheduling"],
  summary: "Update a slot definition (series-wide)",
  request: {
    params: stationParam.extend({ id: z.coerce.number().int().positive() }),
    body: { content: { "application/json": { schema: UpdateSlotInputSchema } } },
  },
  responses: {
    200: { description: "Updated", content: { "application/json": { schema: SlotSchema } } },
    404: { description: "Unknown slot", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

const deleteSlotRoute = createRoute({
  method: "delete",
  path: "/stations/{station}/slots/{id}",
  tags: ["scheduling"],
  summary: "Delete a slot definition and its exceptions",
  request: { params: stationParam.extend({ id: z.coerce.number().int().positive() }) },
  responses: {
    204: { description: "Deleted" },
    404: { description: "Unknown slot", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

const patchOccurrenceRoute = createRoute({
  method: "patch",
  path: "/stations/{station}/occurrences/{id}",
  tags: ["scheduling"],
  summary: "Edit one occurrence: move, resize, state transition, flags",
  description:
    "Records a per-instance exception without breaking the series (docs/2 §5.3). Moves never fail on overlap — soft boundaries (PD §4.3).",
  request: {
    params: stationParam.extend({ id: OccurrenceIdSchema }),
    body: { content: { "application/json": { schema: PatchOccurrenceInputSchema } } },
  },
  responses: {
    200: {
      description: "The updated occurrence",
      content: { "application/json": { schema: OccurrenceSchema } },
    },
    404: { description: "Unknown occurrence", content: errorContent },
    409: { description: "Illegal state transition", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

/** Thin HTTP surface: validate (shared Zod) → call the service → map out (docs/2 §3.2). */
export function createSchedulingRoutes(service: SchedulingService): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(listOccurrencesRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const query = c.req.valid("query");
    const filters = parseFilters(query.negotiation, query.kind);
    if (!filters.ok) return respondDomainError(c, filters.error) as never;

    const result = await service.listOccurrences(
      station.value,
      new Date(query.from),
      new Date(query.to),
      filters.value,
    );
    if (!result.ok) return respondDomainError(c, result.error) as never;

    const now = new Date();
    return c.json(
      {
        station: station.value.value,
        zone: service.zone,
        occurrences: result.value.map((o) => occurrenceToContract(o, station.value.value, now)),
      },
      200,
    );
  });

  routes.openapi(mirrorRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const query = c.req.valid("query");
    const result = await service.getMirror(station.value, new Date(query.from), new Date(query.to));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(
      {
        station: station.value.value,
        zone: service.zone,
        blocks: result.value.map(mirrorBlockToContract),
      },
      200,
    );
  });

  routes.openapi(listSlotsRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const records = await service.listSlots(station.value);
    return c.json(
      {
        station: station.value.value,
        zone: service.zone,
        slots: records.map((r) => slotToContract(r, station.value.value)),
      },
      200,
    );
  });

  routes.openapi(createSlotRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const result = await service.createSlot(station.value, c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(slotToContract(result.value, station.value.value), 201);
  });

  routes.openapi(updateSlotRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.updateSlot(station.value, id, c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(slotToContract(result.value, station.value.value), 200);
  });

  routes.openapi(deleteSlotRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.deleteSlot(station.value, id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.body(null, 204);
  });

  routes.openapi(patchOccurrenceRoute, async (c) => {
    const station = StationId.parse(c.req.valid("param").station);
    if (!station.ok) return respondDomainError(c, station.error) as never;
    const { id } = c.req.valid("param");
    const result = await service.patchOccurrence(station.value, id, c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(occurrenceToContract(result.value, station.value.value, new Date()), 200);
  });

  return routes;
}

function parseFilters(
  negotiationRaw: string | undefined,
  kindRaw: string | undefined,
): Result<GridFilters, DomainError> {
  const filters: GridFilters = {};
  if (negotiationRaw) {
    const parsed = z.array(NegotiationStateSchema).safeParse(negotiationRaw.split(","));
    if (!parsed.success)
      return err(DomainError.validation(`invalid negotiation filter: ${negotiationRaw}`));
    filters.negotiation = parsed.data;
  }
  if (kindRaw) {
    const parsed = z.array(SlotKindSchema).safeParse(kindRaw.split(","));
    if (!parsed.success) return err(DomainError.validation(`invalid kind filter: ${kindRaw}`));
    filters.kind = parsed.data;
  }
  return ok(filters);
}
