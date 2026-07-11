import { OpenAPIHono } from "@hono/zod-openapi";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { DomainError, type DomainErrorKind } from "../kernel/domain-error";
import type { Logger } from "../kernel/logger";

/**
 * The single place expected domain failures become HTTP statuses (docs/2 §6.1).
 * 4xx = the client's problem; 503 = a degraded upstream (AzuraCast) — which
 * must never take air down: the API degrades, the stream does not (invariant 1).
 */
const STATUS_BY_KIND: Record<DomainErrorKind, ContentfulStatusCode> = {
  "not-found": 404,
  validation: 422,
  conflict: 409,
  "illegal-transition": 409,
  "upstream-unavailable": 503,
};

export function respondDomainError(c: Context, error: DomainError): Response {
  return c.json({ error: error.message, kind: error.kind }, STATUS_BY_KIND[error.kind]);
}

/**
 * Whether the ORIGINAL client request reached the edge over HTTPS — the input
 * to the session cookies' `Secure` flag (RFC 0002). Behind the reverse proxy
 * the app sees plaintext `http` on the private hop, so `X-Forwarded-Proto`
 * (set by nginx and `tailscale serve`) is authoritative when present; only the
 * first value matters if a chain of proxies appended more. With no header (a
 * direct hit) fall back to the request's own scheme, so a genuine local `https`
 * still marks the cookie and plain dev `http` does not.
 */
export function isRequestSecure(c: Context): boolean {
  const forwarded = c.req.header("x-forwarded-proto");
  if (forwarded) return forwarded.split(",")[0]?.trim().toLowerCase() === "https";
  return new URL(c.req.url).protocol === "https:";
}

/**
 * Zod validation failures → the uniform 422 envelope, shared by every
 * OpenAPIHono sub-app (each router instance needs its own hook).
 */
// biome-ignore lint/suspicious/noExplicitAny: hook signature imposed by @hono/zod-openapi
export const validationHook = (result: any, c: Context): Response | undefined => {
  if (result.success) return undefined;
  const issues = (result.error?.issues ?? []).map(
    (issue: { path: (string | number)[]; message: string }) => ({
      path: issue.path.join("."),
      message: issue.message,
    }),
  );
  return c.json({ error: "validation failed", issues }, 422);
};

/** A router with the uniform validation envelope wired in. */
export function createRouter(): OpenAPIHono {
  return new OpenAPIHono({ defaultHook: validationHook });
}

/**
 * The versioned API shell: request logs, uniform 404, and the safety net for
 * unexpected exceptions (expected failures travel as Result values instead).
 */
export function createApiApp(logger: Logger): OpenAPIHono {
  const app = createRouter();

  app.use(async (c, next) => {
    const startedAt = performance.now();
    await next();
    logger.info("http", {
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Math.round(performance.now() - startedAt),
    });
  });

  app.onError((error, c) => {
    if (error instanceof DomainError) return respondDomainError(c, error);
    logger.error("unhandled error", { path: c.req.path, error: String(error) });
    return c.json({ error: "internal error" }, 500);
  });

  app.notFound((c) => c.json({ error: "not found" }, 404));

  return app;
}
