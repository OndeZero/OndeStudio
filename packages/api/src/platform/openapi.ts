import type { OpenAPIHono } from "@hono/zod-openapi";

/**
 * The documented contract, generated from the shared Zod schemas the routes
 * declare (docs/2 §2.2) — served at /api/v1/openapi.json. A browsable UI can
 * come later; the JSON document is the contract satellites integrate against.
 */
export function registerOpenApi(app: OpenAPIHono): void {
  app.doc31("/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "OndeStudio API",
      version: "0.1.0",
      description:
        "OndeStudio's own model only — the playout system behind it is an integration detail " +
        "(docs/1 §7.2). Resources are station-scoped: /stations/{station}/…",
    },
  });
}
