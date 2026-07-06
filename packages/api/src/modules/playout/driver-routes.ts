import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  DriverStatusResponseSchema,
  ReconciliationResponseSchema,
  ResolveReconciliationInputSchema,
} from "@ondestudio/shared";
import type { StationId } from "../../kernel/station-id";
import { createRouter, respondDomainError } from "../../platform/http";
import type { PlayoutDriver } from "./driver";
import { projectionToContract, reconciliationToContract } from "./driver-contract";

const errorContent = { "application/json": { schema: ApiErrorSchema } };

const statusRoute = createRoute({
  method: "get",
  path: "/driver",
  tags: ["playout"],
  summary: "What OndeStudio is projecting to AzuraCast, and where a manual edit needs a decision",
  responses: {
    200: {
      description: "Driver status",
      content: { "application/json": { schema: DriverStatusResponseSchema } },
    },
  },
});

const reconciliationsRoute = createRoute({
  method: "get",
  path: "/reconciliations",
  tags: ["playout"],
  summary: "Open drift items — manual AzuraCast edits to projected objects",
  responses: {
    200: {
      description: "Open reconciliation items",
      content: { "application/json": { schema: ReconciliationResponseSchema } },
    },
  },
});

const resolveRoute = createRoute({
  method: "post",
  path: "/reconciliations/{id}/resolve",
  tags: ["playout"],
  summary: "Pick a side: re-push OndeStudio or keep AzuraCast's edit (PD §6)",
  request: {
    params: z.object({ id: z.coerce.number().int().positive() }),
    body: { content: { "application/json": { schema: ResolveReconciliationInputSchema } } },
  },
  responses: {
    204: { description: "Resolved" },
    404: { description: "Unknown or already-resolved item", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

/** Root-level (not station-scoped): the driver spans the write stations (docs/2 §7.7). */
export function createDriverRoutes(driver: PlayoutDriver, writeStations: StationId[]): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(statusRoute, async (c) => {
    const projections = (
      await Promise.all(writeStations.map((station) => driver.listProjections(station)))
    ).flat();
    const open = await driver.listReconciliations();
    return c.json(
      {
        writeStations: writeStations.map((s) => s.value),
        driving: driver.isDriving,
        projections: projections.map(projectionToContract),
        openReconciliations: open.length,
        lastRunAt: driver.lastRun ? driver.lastRun.toISOString() : null,
        adapterHealthy: driver.adapterHealthy(),
      },
      200,
    );
  });

  routes.openapi(reconciliationsRoute, async (c) => {
    const open = await driver.listReconciliations();
    return c.json({ items: open.map(reconciliationToContract) }, 200);
  });

  routes.openapi(resolveRoute, async (c) => {
    const result = await driver.resolve(c.req.valid("param").id, c.req.valid("json").resolution);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.body(null, 204);
  });

  return routes;
}
