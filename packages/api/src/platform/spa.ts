import type { Hono } from "hono";
import { serveStatic } from "hono/bun";

/**
 * Serve the built web SPA (RFC 0002, "one process, two surfaces"): in
 * production a single Bun process serves both the static bundle AND `/api/v1`,
 * so the client's already-relative fetch/SSE/cookie all work same-origin with
 * zero client changes (`client.ts:5`, `sse.ts:20`). Dev fakes this with the
 * Vite proxy; prod needs the API to serve `packages/web/dist`.
 *
 * Call this on the OUTER app AFTER `app.route("/api/v1", api)` so the API is
 * registered first and always wins. Two layers:
 *   1. static files under `webDist` — the hashed `/assets/*`, favicon, … (and
 *      `index.html` as the default document for `/`);
 *   2. an SPA history fallback → `index.html` for any other GET, so a client
 *      route like `/grid` still resolves on a hard refresh / deep link.
 *
 * The fallback is guarded to non-`/api` paths, so a mistyped `/api/...` falls
 * through to the API's own 404 instead of being shadowed by the index shell.
 * The fallback uses `path` RELATIVE to `root` (not an absolute `path`): Hono's
 * `serveStatic` joins an absolute `path` onto the default root and 404s, so the
 * relative form is the one that actually serves the shell.
 *
 * When `webDist` has no build (dev api-only, tests) every path simply 404s
 * through to the caller — nothing here throws or requires the bundle to exist.
 */
export function mountSpa(app: Hono, webDist: string): void {
  app.use("/*", serveStatic({ root: webDist }));
  app.get("/*", (c, next) =>
    c.req.path.startsWith("/api/")
      ? next()
      : serveStatic({ path: "index.html", root: webDist })(c, next),
  );
}
