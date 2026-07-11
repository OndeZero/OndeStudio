import { beforeAll, describe, expect, test } from "bun:test";
import { PublicScheduleSchema } from "@ondestudio/shared";
import type { Clock } from "../../kernel/clock";
import { EventBus } from "../../kernel/event-bus";
import { ok } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createAuthMiddleware } from "../../platform/auth";
import { createDb } from "../../platform/db";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import type { MirrorSchedulePort } from "./ports";
import { createPublicScheduleRoutes, type StreamerDirectory } from "./public-schedule-routes";
import { DrizzleSchedulingRepo } from "./repo";
import { SchedulingService } from "./service";

/**
 * The public Upcoming seam (RFC 0003) at the HTTP boundary: real service →
 * domain → SQLite. Proves it is unauthenticated, announceable-only (prebooked
 * holds never leak), episode-enriched, and live-aware (streamerName resolved).
 * 2026-07-13 is a Monday; the fixed clock sits at 08:00Z that day.
 */
const ZONE = "Europe/Paris";
const NOW = new Date("2026-07-13T08:00:00Z");
const clock: Clock = { now: () => NOW };
const mirror: MirrorSchedulePort = { fetchBlocks: () => Promise.resolve(ok([])) };

const streamers: StreamerDirectory = {
  namesByIds: async (ids) =>
    new Map(ids.filter((id) => id === 7).map((id) => [id, "DJ Nova"] as const)),
};

async function buildApp() {
  const repo = new DrizzleSchedulingRepo(createDb(":memory:", silentLogger));
  const service = new SchedulingService({
    repo,
    mirror,
    bus: new EventBus(() => {}),
    clock,
    logger: silentLogger,
    zone: ZONE,
  });
  const oz = StationId.parse("oz");
  if (!oz.ok) throw new Error("station");

  // Monday 12:00 Paris (10:00Z) — validated show, upcoming relative to NOW.
  await service.createSlot(oz.value, {
    kind: "show",
    showName: "Morning Show",
    recurrence: { type: "weekly", weekdays: [1], time: "12:00" },
    durationMin: 60,
    bornValidated: true,
  });
  // Monday 14:00 Paris — a prebooked hold: must NOT appear on the public seam.
  await service.createSlot(oz.value, {
    kind: "show",
    showName: "Secret Pitch",
    recurrence: { type: "weekly", weekdays: [1], time: "14:00" },
    durationMin: 60,
    bornValidated: false,
  });
  // Monday 20:00 Paris — validated live slot bound to broadcaster 7.
  await service.createSlot(oz.value, {
    kind: "live",
    title: "Night Live",
    recurrence: { type: "weekly", weekdays: [1], time: "20:00" },
    durationMin: 120,
    bornValidated: true,
    broadcasterId: 7,
  });

  const app = createApiApp(silentLogger);
  app.use(
    "*",
    createAuthMiddleware({
      cookieSecret: "test-secret-test-secret-test-secret!",
      publicPaths: [/^\/stations\/[^/]+\/schedule$/],
      verify: async () => null, // no team users — a non-public path would 401
    }),
  );
  app.route("/", createPublicScheduleRoutes(service, streamers, clock));
  return app;
}

describe("public schedule seam (RFC 0003)", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  beforeAll(async () => {
    app = await buildApp();
  });

  const WINDOW = "from=2026-07-13T00:00:00Z&to=2026-07-14T00:00:00Z";

  test("is public — no session needed", async () => {
    const res = await app.request(`/stations/oz/schedule?${WINDOW}`);
    expect(res.status).toBe(200);
  });

  test("returns only announceable occurrences, enriched and live-aware", async () => {
    const res = await app.request(`/stations/oz/schedule?${WINDOW}`);
    const body = PublicScheduleSchema.parse(await res.json());
    expect(body.station).toBe("oz");

    const titles = body.items.map((i) => i.title);
    expect(titles).toContain("Morning Show");
    expect(titles).toContain("Night Live");
    // The prebooked hold never leaks onto the public seam.
    expect(titles).not.toContain("Secret Pitch");
    expect(body.items).toHaveLength(2);

    const show = body.items.find((i) => i.title === "Morning Show");
    expect(show?.kind).toBe("show");
    expect(show?.live).toBeNull();

    const live = body.items.find((i) => i.kind === "live");
    expect(live?.live).toEqual({ streamerName: "DJ Nova" });
    expect(live?.durationMin).toBe(120);
  });

  test("defaults the window to now → +3d when omitted", async () => {
    const res = await app.request("/stations/oz/schedule");
    const body = PublicScheduleSchema.parse(await res.json());
    // Monday's validated occurrences are all after NOW (08:00Z) and within 3 days.
    expect(body.items.map((i) => i.title).sort()).toEqual(["Morning Show", "Night Live"]);
  });

  test("an invalid station shortcode is 422", async () => {
    expect((await app.request("/stations/OZ!/schedule")).status).toBe(422);
  });
});
