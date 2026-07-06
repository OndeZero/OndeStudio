import { getSignedCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";

/** What the middleware attaches to the request context under `user`. */
export interface RequestUser {
  id: number;
  displayName: string;
  email: string;
  role: "team" | "external";
}

// Every route sees a typed `c.get("user")` — set exclusively by this middleware.
declare module "hono" {
  interface ContextVariableMap {
    user: RequestUser;
  }
}

export const SESSION_COOKIE = "os_session";

export interface AuthMiddlewareOptions {
  cookieSecret: string;
  /** Resolves a session id to a user; implemented by the people module, wired in app.ts. */
  verify: (sessionId: string) => Promise<RequestUser | null>;
  /** Path regexes (relative to the mounted API root) that stay public. */
  publicPaths: RegExp[];
}

/**
 * Session-cookie gate for the team surface (docs/2 §6.5, §12). Public reads —
 * health, docs, auth itself, `now`, SSE — stay open: `now` is the galaxy seam
 * (PD §7.2) and the SSE grid channel only ever carries refetch hints. platform
 * stays module-free: the session verifier is injected by the composition root.
 */
export function createAuthMiddleware(options: AuthMiddlewareOptions) {
  return createMiddleware<{ Variables: { user: RequestUser } }>(async (c, next) => {
    if (options.publicPaths.some((pattern) => pattern.test(c.req.path))) {
      return next();
    }
    const sessionId = await getSignedCookie(c, options.cookieSecret, SESSION_COOKIE);
    const user = sessionId ? await options.verify(sessionId) : null;
    if (!user) {
      return c.json({ error: "authentication required", kind: "unauthenticated" }, 401);
    }
    c.set("user", user);
    return next();
  });
}
