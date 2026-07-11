import { beforeAll, describe, expect, test } from "bun:test";
import { MeSchema } from "@ondestudio/shared";
import { systemClock } from "../../kernel/clock";
import { ok } from "../../kernel/result";
import { createAuthMiddleware } from "../../platform/auth";
import { createDb } from "../../platform/db";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import { DrizzlePeopleRepo } from "./repo";
import { createPeopleRoutes } from "./routes";
import { PeopleService } from "./service";

/**
 * Auth proven at the HTTP boundary, wired exactly like app.ts: middleware
 * gate + signed cookie + real repo on an in-memory DB (real migrations).
 */
const SECRET = "test-secret-test-secret-test-secret!";

function buildApp() {
  const repo = new DrizzlePeopleRepo(createDb(":memory:", silentLogger));
  const service = new PeopleService({
    repo,
    directory: { fetchAccounts: () => Promise.resolve(ok([])) },
    clock: systemClock,
    logger: silentLogger,
  });
  const app = createApiApp(silentLogger);
  app.use(
    "*",
    createAuthMiddleware({
      cookieSecret: SECRET,
      publicPaths: [/^\/health$/, /^\/auth\/(login|setup)$/],
      verify: async (sessionId) => {
        const user = await service.verifySession(sessionId);
        if (!user) return null;
        return { id: user.id, displayName: user.displayName, email: user.email, role: user.role };
      },
    }),
  );
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/", createPeopleRoutes(service, SECRET));
  return { app, service, repo };
}

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("auth over HTTP", () => {
  const { app, service, repo } = buildApp();
  let cookie = "";

  beforeAll(async () => {
    await repo.createLocalUser({
      email: "demo@ondestudio.local",
      displayName: "Demo",
      role: "team",
      passwordHash: await Bun.password.hash("demo-password-1"),
    });
  });

  test("public paths are open; gated paths 401 without a session", async () => {
    expect((await app.request("/health")).status).toBe(200);
    expect((await app.request("/auth/me")).status).toBe(401);
    expect((await app.request("/users")).status).toBe(401);
  });

  test("login sets a signed httpOnly cookie and /auth/me answers with it", async () => {
    const bad = await app.request(
      "/auth/login",
      json({ email: "demo@ondestudio.local", password: "nope" }),
    );
    expect(bad.status).toBe(422);

    const response = await app.request(
      "/auth/login",
      json({ email: "demo@ondestudio.local", password: "demo-password-1" }),
    );
    expect(response.status).toBe(200);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("os_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    // Plain-http dev keeps Secure off; behind TLS it is header-driven (below).
    expect(setCookie).not.toContain("Secure");
    cookie = setCookie.split(";")[0] ?? "";

    const me = await app.request("/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    const parsed = MeSchema.parse(await me.json());
    expect(parsed.email).toBe("demo@ondestudio.local");

    const users = await app.request("/users", { headers: { cookie } });
    expect(users.status).toBe(200);
  });

  test("the session cookie is Secure when the client reached the edge over HTTPS (RFC 0002)", async () => {
    const overHttps = await app.request("/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
      body: JSON.stringify({ email: "demo@ondestudio.local", password: "demo-password-1" }),
    });
    expect(overHttps.status).toBe(200);
    expect(overHttps.headers.get("set-cookie") ?? "").toContain("Secure");
  });

  test("a tampered cookie is rejected", async () => {
    const forged = `${cookie.slice(0, -4)}beef`;
    expect((await app.request("/auth/me", { headers: { cookie: forged } })).status).toBe(401);
  });

  test("logout ends the session", async () => {
    const out = await app.request("/auth/logout", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(204);
    expect((await app.request("/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  test("the setup link sets a password and logs straight in", async () => {
    await repo.upsertSeededUser({ ref: "42", email: "new@wavezero.world", displayName: "New" });
    const token = await service.issueSetupToken("new@wavezero.world");
    expect(token.ok).toBe(true);
    if (!token.ok) return;

    const response = await app.request(
      "/auth/setup",
      json({ token: token.value, password: "fresh-password-1" }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("os_session=");

    const login = await app.request(
      "/auth/login",
      json({ email: "new@wavezero.world", password: "fresh-password-1" }),
    );
    expect(login.status).toBe(200);
  });
});
