import { beforeAll, describe, expect, test } from "bun:test";
import { SelfProfileSchema, SelfSlotsResponseSchema, SlotSchema } from "@ondestudio/shared";
import { systemClock } from "../../kernel/clock";
import { ok } from "../../kernel/result";
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

let lastPropose: { broadcasterId: number; kind: string } | null = null;
let lastMeta: { broadcasterId: number; slotId: number; meta: string | null } | null = null;
const slots: SelfSlotsProvider = {
  slotsFor: async () => ({ station: "oz", zone: "Europe/Paris", slots: [] }),
  propose: async (broadcasterId, kind, input) => {
    lastPropose = { broadcasterId, kind };
    return ok({
      id: 1,
      station: "oz",
      kind: "live",
      title: input.title ?? null,
      showId: null,
      showName: null,
      recurrence: input.recurrence,
      durationMin: input.durationMin,
      // Mirror the real rule under test: team self-validates, external waits.
      negotiationDefault: kind === "team" ? "validated" : "prebooked",
      broadcasterId,
      meta: null,
    });
  },
  updateMeta: async (broadcasterId, slotId, meta) => {
    lastMeta = { broadcasterId, slotId, meta };
    return ok({
      id: slotId,
      station: "oz",
      kind: "live",
      title: "Live",
      showId: null,
      showName: null,
      recurrence: { type: "weekly", weekdays: [5], time: "20:00" },
      durationMin: 120,
      negotiationDefault: "validated",
      broadcasterId,
      meta,
    });
  },
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

  test("propose creates a live slot bound to the broadcaster; external → prebooked", async () => {
    const res = await app.request("/self/slots/propose", {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({
        title: "My live",
        recurrence: { type: "weekly", weekdays: [5], time: "20:00" },
        durationMin: 120,
      }),
    });
    expect(res.status).toBe(201);
    const slot = SlotSchema.parse(await res.json());
    expect(slot.kind).toBe("live");
    expect(slot.negotiationDefault).toBe("prebooked"); // dj-nova is external
    expect(lastPropose).toMatchObject({ kind: "external" });

    // An anonymous proposal is rejected by the self-service guard.
    const anon = await app.request("/self/slots/propose", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recurrence: { type: "weekly", weekdays: [1], time: "10:00" },
        durationMin: 60,
      }),
    });
    expect(anon.status).toBe(401);
  });

  test("meta update passes the id + body through the guarded route", async () => {
    const res = await app.request("/self/slots/42/meta", {
      method: "PUT",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ meta: "Tonight: deep cuts" }),
    });
    expect(res.status).toBe(200);
    expect(SlotSchema.parse(await res.json()).meta).toBe("Tonight: deep cuts");
    expect(lastMeta).toEqual({
      broadcasterId: expect.any(Number),
      slotId: 42,
      meta: "Tonight: deep cuts",
    });

    // Guarded — no cookie, no meta write.
    const anon = await app.request("/self/slots/42/meta", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ meta: "nope" }),
    });
    expect(anon.status).toBe(401);
  });

  test("logout clears the session", async () => {
    const out = await app.request("/self/logout", { method: "POST", headers: { cookie } });
    expect(out.status).toBe(204);
    expect((await app.request("/self/me", { headers: { cookie } })).status).toBe(401);
  });
});
