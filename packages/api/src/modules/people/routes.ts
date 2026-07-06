import { createRoute, type OpenAPIHono } from "@hono/zod-openapi";
import {
  ApiErrorSchema,
  LoginInputSchema,
  type Me,
  MeSchema,
  SetupInputSchema,
  UsersResponseSchema,
} from "@ondestudio/shared";
import type { Context } from "hono";
import { deleteCookie, getSignedCookie, setSignedCookie } from "hono/cookie";
import { SESSION_COOKIE } from "../../platform/auth";
import { createRouter, respondDomainError } from "../../platform/http";
import type { UserAccount } from "./domain/user-account";
import type { PeopleService } from "./service";

const errorContent = { "application/json": { schema: ApiErrorSchema } };
const meContent = { "application/json": { schema: MeSchema } };

const loginRoute = createRoute({
  method: "post",
  path: "/auth/login",
  tags: ["people"],
  summary: "Start a session",
  request: { body: { content: { "application/json": { schema: LoginInputSchema } } } },
  responses: {
    200: { description: "Logged in; the session cookie is set", content: meContent },
    422: {
      description: "Unknown email, wrong password, or no password set yet",
      content: errorContent,
    },
  },
});

const setupRoute = createRoute({
  method: "post",
  path: "/auth/setup",
  tags: ["people"],
  summary: "Complete an admin-issued one-time setup link and log straight in",
  request: { body: { content: { "application/json": { schema: SetupInputSchema } } } },
  responses: {
    200: { description: "Password set; session cookie set", content: meContent },
    404: { description: "Unknown setup token", content: errorContent },
    422: { description: "Expired token or weak password", content: errorContent },
  },
});

const logoutRoute = createRoute({
  method: "post",
  path: "/auth/logout",
  tags: ["people"],
  summary: "End the session",
  responses: { 204: { description: "Session ended" } },
});

const meRoute = createRoute({
  method: "get",
  path: "/auth/me",
  tags: ["people"],
  summary: "Who am I",
  responses: { 200: { description: "The authenticated user", content: meContent } },
});

const usersRoute = createRoute({
  method: "get",
  path: "/users",
  tags: ["people"],
  summary: "Team directory (assignment pickers)",
  responses: {
    200: {
      description: "All users",
      content: { "application/json": { schema: UsersResponseSchema } },
    },
  },
});

/** Thin HTTP surface (docs/2 §3.2). The cookie secret comes from the composition root. */
export function createPeopleRoutes(service: PeopleService, cookieSecret: string): OpenAPIHono {
  const routes = createRouter();

  const setSessionCookie = async (c: Context, sessionId: string): Promise<void> => {
    await setSignedCookie(c, SESSION_COOKIE, sessionId, cookieSecret, {
      httpOnly: true,
      sameSite: "Lax",
      path: "/",
      maxAge: 30 * 24 * 3600,
      // `secure` stays off: phase 1 serves localhost/LAN over http; the
      // reverse-proxy TLS deployment flips this via a header-aware revisit (M5).
    });
  };

  routes.openapi(loginRoute, async (c) => {
    const input = c.req.valid("json");
    const result = await service.login(input.email, input.password);
    if (!result.ok) return respondDomainError(c, result.error) as never;
    await setSessionCookie(c, result.value.sessionId);
    return c.json(toMe(result.value.user), 200);
  });

  routes.openapi(setupRoute, async (c) => {
    const input = c.req.valid("json");
    const completed = await service.completeSetup(input.token, input.password);
    if (!completed.ok) return respondDomainError(c, completed.error) as never;
    const session = await service.startSession(completed.value.id);
    if (!session.ok) return respondDomainError(c, session.error) as never;
    await setSessionCookie(c, session.value.sessionId);
    return c.json(toMe(session.value.user), 200);
  });

  routes.openapi(logoutRoute, async (c) => {
    const sessionId = await getSignedCookie(c, cookieSecret, SESSION_COOKIE);
    if (sessionId) await service.logout(sessionId);
    deleteCookie(c, SESSION_COOKIE, { path: "/" });
    return c.body(null, 204);
  });

  routes.openapi(meRoute, (c) => {
    // The auth middleware already resolved the user (this path is gated).
    const user = c.get("user");
    return c.json(
      { id: user.id, displayName: user.displayName, email: user.email, role: user.role },
      200,
    );
  });

  routes.openapi(usersRoute, async (c) => {
    const users = await service.listUsers();
    return c.json({ users: users.map(toMe) }, 200);
  });

  return routes;
}

function toMe(user: UserAccount): Me {
  return { id: user.id, displayName: user.displayName, email: user.email, role: user.role };
}
