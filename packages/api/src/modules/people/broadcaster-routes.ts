import { createRoute, type OpenAPIHono, z } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  BroadcasterImportResultSchema,
  BroadcastersResponseSchema,
  BroadcasterWithSecretSchema,
  CreateBroadcasterInputSchema,
  UpdateBroadcasterInputSchema,
} from "@ondestudio/shared";
import { createRouter, respondDomainError } from "../../platform/http";
import type { BroadcasterService } from "./broadcaster-service";

/**
 * Root-level (not station-scoped) on purpose: a broadcaster IS the main+test
 * pair (PD §5.10) — a station prefix would misstate the object. Recorded as a
 * deviation from the §6.2 sketch in the module README.
 */
const errorContent = { "application/json": { schema: ApiErrorSchema } };
const secretContent = { "application/json": { schema: BroadcasterWithSecretSchema } };
const idParam = z.object({ id: z.coerce.number().int().positive() });

const listRoute = createRoute({
  method: "get",
  path: "/broadcasters",
  tags: ["people"],
  summary: "All broadcasters with their per-station fan-out state",
  responses: {
    200: {
      description: "Broadcasters",
      content: { "application/json": { schema: BroadcastersResponseSchema } },
    },
  },
});

const createBroadcasterRoute = createRoute({
  method: "post",
  path: "/broadcasters",
  tags: ["people"],
  summary: "Create a broadcaster and fan it out (docs/2 §7.7 write stations only)",
  request: { body: { content: { "application/json": { schema: CreateBroadcasterInputSchema } } } },
  responses: {
    201: { description: "Created; generated password shown once", content: secretContent },
    409: { description: "Username already exists", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

const updateRoute = createRoute({
  method: "put",
  path: "/broadcasters/{id}",
  tags: ["people"],
  summary: "Update a broadcaster; changes fan out to allowed stations",
  request: {
    params: idParam,
    body: { content: { "application/json": { schema: UpdateBroadcasterInputSchema } } },
  },
  responses: {
    200: { description: "Updated", content: secretContent },
    404: { description: "Unknown broadcaster", content: errorContent },
    422: { description: "Invalid input", content: errorContent },
  },
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/broadcasters/{id}",
  tags: ["people"],
  summary: "Delete a broadcaster (streamers on blocked stations are left, warned)",
  request: { params: idParam },
  responses: {
    200: {
      description: "Deleted; warnings list anything left in place",
      content: { "application/json": { schema: z.object({ warnings: z.array(z.string()) }) } },
    },
    404: { description: "Unknown broadcaster", content: errorContent },
  },
});

const importRoute = createRoute({
  method: "post",
  path: "/broadcasters/import",
  tags: ["people"],
  summary: "Adopt existing AzuraCast streamers and report main/test drift (docs/2 §7.6)",
  responses: {
    200: {
      description: "Import + drift report",
      content: { "application/json": { schema: BroadcasterImportResultSchema } },
    },
    503: { description: "Playout system unreachable", content: errorContent },
  },
});

const syncTestRoute = createRoute({
  method: "post",
  path: "/broadcasters/{id}/sync-test",
  tags: ["people"],
  summary: "Create the missing test mirror (new credential, shown once)",
  request: { params: idParam },
  responses: {
    200: { description: "Mirror created", content: secretContent },
    404: { description: "Unknown broadcaster", content: errorContent },
    409: { description: "Mirror already linked", content: errorContent },
    503: { description: "Playout system unreachable", content: errorContent },
  },
});

const rotateRoute = createRoute({
  method: "post",
  path: "/broadcasters/{id}/rotate-password",
  tags: ["people"],
  summary: "Rotate the streamer credential (shown once)",
  request: { params: idParam },
  responses: {
    200: { description: "Rotated", content: secretContent },
    404: { description: "Unknown broadcaster", content: errorContent },
  },
});

export function createBroadcasterRoutes(
  service: BroadcasterService,
  writeStations: string[],
): OpenAPIHono {
  const routes = createRouter();

  routes.openapi(listRoute, async (c) =>
    c.json({ broadcasters: await service.list(), writeStations }, 200),
  );

  routes.openapi(createBroadcasterRoute, async (c) => {
    const result = await service.create(c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 201);
  });

  routes.openapi(updateRoute, async (c) => {
    const result = await service.update(c.req.valid("param").id, c.req.valid("json"));
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  routes.openapi(deleteRoute, async (c) => {
    const result = await service.remove(c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json({ warnings: result.value }, 200);
  });

  routes.openapi(importRoute, async (c) => {
    const result = await service.importExisting();
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  routes.openapi(syncTestRoute, async (c) => {
    const result = await service.syncTestMirror(c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  routes.openapi(rotateRoute, async (c) => {
    const result = await service.rotatePassword(c.req.valid("param").id);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    return c.json(result.value, 200);
  });

  return routes;
}
