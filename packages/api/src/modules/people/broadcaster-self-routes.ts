import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  SelfLoginInputSchema,
  SelfProfileSchema,
  SelfSlotsResponseSchema,
} from "@ondestudio/shared";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { BROADCASTER_SESSION_COOKIE, createBroadcasterAuthMiddleware } from "../../platform/auth";
import { createRouter, respondDomainError } from "../../platform/http";
import type { BroadcasterAuthService } from "./broadcaster-auth-service";

const errorContent = { "application/json": { schema: ApiErrorSchema } };
const profileContent = { "application/json": { schema: SelfProfileSchema } };

/** What the self-service page needs to render a broadcaster's own slots. */
export interface SelfSlotsProvider {
  slotsFor(broadcasterId: number): Promise<{
    station: string;
    zone: string;
    slots: unknown[];
  }>;
}

const loginRoute = createRoute({
  method: "post",
  path: "/self/login",
  tags: ["self-service"],
  summary: "Sign in with Icecast credentials (PD §5.6)",
  request: { body: { content: { "application/json": { schema: SelfLoginInputSchema } } } },
  responses: {
    200: { description: "Signed in; the self-service cookie is set", content: profileContent },
    422: { description: "Unknown broadcaster, wrong password, or none set", content: errorContent },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/self/logout",
  tags: ["self-service"],
  summary: "End the self-service session",
  responses: { 204: { description: "Session ended" } },
});

const meRoute = createRoute({
  method: "get",
  path: "/self/me",
  tags: ["self-service"],
  summary: "The signed-in broadcaster",
  responses: {
    200: { description: "Profile", content: profileContent },
    401: { description: "Not signed in", content: errorContent },
  },
});

const slotsRoute = createRoute({
  method: "get",
  path: "/self/slots",
  tags: ["self-service"],
  summary: "This broadcaster's live slots",
  responses: {
    200: {
      description: "Slots",
      content: { "application/json": { schema: SelfSlotsResponseSchema } },
    },
    401: { description: "Not signed in", content: errorContent },
  },
});

export function createBroadcasterSelfRoutes(
  auth: BroadcasterAuthService,
  cookieSecret: string,
  slots: SelfSlotsProvider,
): OpenAPIHono {
  const routes = createRouter();

  // Guard the authenticated routes with the self-service middleware; /self/login
  // stays open, /self/logout only reads-and-clears the cookie.
  const guard = createBroadcasterAuthMiddleware({
    cookieSecret,
    verify: (sessionId) => auth.verifySession(sessionId),
  });
  routes.use("/self/me", guard);
  routes.use("/self/slots", guard);

  const setCookie = async (c: Context, sessionId: string, maxAgeSec: number): Promise<void> => {
    await setSignedCookie(c, BROADCASTER_SESSION_COOKIE, sessionId, cookieSecret, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: maxAgeSec,
    });
  };

  routes.openapi(loginRoute, async (c) => {
    const input = c.req.valid("json");
    const result = await auth.login(input.username, input.password);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    await setCookie(c, result.value.sessionId, Math.floor(result.value.ttlMs / 1000));
    return c.json(result.value.identity, 200);
  });

  routes.openapi(logoutRoute, async (c) => {
    const sessionId = await getSignedCookie(c, cookieSecret, BROADCASTER_SESSION_COOKIE);
    if (sessionId) await auth.logout(sessionId);
    deleteCookie(c, BROADCASTER_SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  routes.openapi(meRoute, (c) => c.json(c.get("broadcaster"), 200));

  routes.openapi(slotsRoute, async (c) => {
    const broadcaster = c.get("broadcaster");
    const result = await slots.slotsFor(broadcaster.id);
    return c.json(result as never, 200);
  });

  return routes;
}
