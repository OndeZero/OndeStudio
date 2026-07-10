import { beforeAll, describe, expect, test } from "bun:test";
import { SelfProfileSchema, SelfSlotsResponseSchema } from "@ondestudio/shared";
import { systemClock } from "../../kernel/clock";
import { createAuthMiddleware } from "../../platform/auth";
import { createDb } from "../../platform/db";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import { BroadcasterAuthService } from "./broadcaster-auth-service";
import { DrizzleBroadcasterRepo } from "./broadcaster-repo";
import { createBroadcasterSelfRoutes, type SelfSlotsProvider } from "./broadcaster-self-routes";

/**
 * Self-service (PD §5.6) at the HTTP boundary, wired like app.ts: the team gate
 * steps aside for `/self/*`, the broadcaster middleware guards the rest. Proves
 * the two auth realms never blur — a self-service cookie can't open a team route.
 */
const SECRET = "test-secret-test-secret-test-secret!";

const slots: SelfSlotsProvider = {
  slotsFor: async () => ({ station: "oz", zone: "Europe/Paris", slots: [] }),
};

async function buildApp() {
  const repo = new DrizzleBroadcasterRepo(createDb(":memory:", silentLogger));
  const auth = new BroadcasterAuthService({ repo, clock: systemClock, logger: silentLogger });
  await repo.insert({
    username: "dj-nova",
    displayName: "DJ Nova",
    kind: "external",
    commentMeta: null,
    enforceSchedule: true,
    replayFlag: "not_specified",
    passwordHash: await Bun.password.hash("secret-pw"),
  });

  const app = createApiApp(silentLogger);
  app.use(
    "*",
    createAuthMiddleware({
      cookieSecret: SECRET,
      publicPaths: [/^\/health$/, /^\/self\//],
      verify: async () => null, // no team users in this test — team routes stay closed
    }),
  );
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.get("/team-only", (c) => c.json({ ok: true })); // guarded by the team gate
  app.route("/", createBroadcasterSelfRoutes(auth, SECRET, slots));
  return app;
}

const jsonPost = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("self-service over HTTP (PD §5.6)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let cookie = "";

  beforeAll(async () => {
    app = await buildApp();
  });

  test("login with Icecast credentials sets the self-service cookie and returns the profile", async () => {
    const res = await app.request(
      "/self/login",
      jsonPost({ username: "dj-nova", password: "secret-pw" }),
    );
    expect(res.status).toBe(200);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("os_bc_session=");
    expect(setCookie).toContain("HttpOnly");
    cookie = setCookie.split(";")[0] ?? "";
    const profile = SelfProfileSchema.parse(await res.json());
    expect(profile).toMatchObject({ username: "dj-nova", kind: "external" });
  });

  test("the cookie authenticates /self/me and /self/slots", async () => {
    const me = await app.request("/self/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(SelfProfileSchema.parse(await me.json()).username).toBe("dj-nova");

    const slotsRes = await app.request("/self/slots", { headers: { cookie } });
    expect(slotsRes.status).toBe(200);
    expect(SelfSlotsResponseSchema.parse(await slotsRes.json()).station).toBe("oz");
  });

  test("no cookie is 401; a self-service cookie cannot open a team route", async () => {
    expect((await app.request("/self/me")).status).toBe(401);
    // The realms are separate: the broadcaster cookie is invisible to the team gate.
    expect((await app.request("/team-only", { headers: { cookie } })).status).toBe(401);
  });

  test("wrong credentials are 422", async () => {
    const res = await app.request(
      "/self/login",
      jsonPost({ username: "dj-nova", password: "nope" }),
    );
    expect(res.status).toBe(422);
  });

  test("logout clears the session", async () => {
    const out = await app.request("/self/logout", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(204);
    expect((await app.request("/self/me", { headers: { cookie } })).status).toBe(401);
  });
});
