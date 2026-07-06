import { beforeAll, describe, expect, test } from "bun:test";
import { ShowDetailSchema, ShowsResponseSchema } from "@ondestudio/shared";
import { systemClock } from "../../kernel/clock";
import { EventBus } from "../../kernel/event-bus";
import { ok } from "../../kernel/result";
import { createDb } from "../../platform/db";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import type { MirrorSchedulePort } from "./ports";
import { DrizzleSchedulingRepo } from "./repo";
import { createSchedulingRoutes } from "./routes";
import { SchedulingService } from "./service";
import { createShowRoutes } from "./show-routes";
import { ShowService } from "./show-service";

/**
 * Integration proof for the show hub at the HTTP boundary (PD §5.4): real
 * routes → services → repo → SQLite (in-memory, real migrations). Windows are
 * relative to the real clock — weekly slots always have computed occurrences
 * on both sides of now, so no fixed dates are needed.
 */
const ZONE = "Europe/Paris";
const DAY_MS = 24 * 3_600_000;

const mirror: MirrorSchedulePort = { fetchBlocks: () => Promise.resolve(ok([])) };

function buildApp() {
  const repo = new DrizzleSchedulingRepo(createDb(":memory:", silentLogger));
  const reasons: string[] = [];
  const bus = new EventBus(() => {});
  bus.on("scheduling.grid-changed", (event) => reasons.push(event.reason));
  const grid = new SchedulingService({
    repo,
    mirror,
    bus,
    clock: systemClock,
    logger: silentLogger,
    zone: ZONE,
  });
  const showService = new ShowService({ repo, grid, bus, clock: systemClock, zone: ZONE });
  const app = createApiApp(silentLogger);
  app.route("/", createSchedulingRoutes(grid));
  app.route("/", createShowRoutes(showService));
  return { app, reasons };
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

describe("show hub over HTTP", () => {
  const { app, reasons } = buildApp();
  let showId = 0;
  let orphanId = 0;

  beforeAll(async () => {
    // Two weekly slots bound to the same show (born validated, so occurrences
    // whose end has passed read as `aired` — time-driven, PD §4.4).
    for (const recurrence of [
      { type: "weekly", weekdays: [2], time: "22:00" },
      { type: "weekly", weekdays: [5], time: "10:00" },
    ]) {
      const created = await app.request(
        "/stations/oz/slots",
        jsonInit("POST", {
          kind: "show",
          showName: "Minuit Décousu",
          recurrence,
          durationMin: 60,
          bornValidated: true,
        }),
      );
      expect(created.status).toBe(201);
    }
    // A show whose only slot is deleted stays in the library, unscheduled.
    const orphanSlot = await app.request(
      "/stations/oz/slots",
      jsonInit("POST", {
        kind: "show",
        showName: "Émission Orpheline",
        recurrence: { type: "weekly", weekdays: [3], time: "12:00" },
        durationMin: 60,
      }),
    );
    const { id } = (await orphanSlot.json()) as { id: number };
    await app.request(`/stations/oz/slots/${id}`, { method: "DELETE" });
  });

  test("summary: slot counts and a raw-series next airing", async () => {
    const response = await app.request("/stations/oz/shows");
    expect(response.status).toBe(200);
    const body = ShowsResponseSchema.parse(await response.json());
    expect(body.shows).toHaveLength(2);

    const minuit = body.shows.find((s) => s.name === "Minuit Décousu");
    const orphan = body.shows.find((s) => s.name === "Émission Orpheline");
    if (!minuit || !orphan) throw new Error("missing show");
    showId = minuit.id;
    orphanId = orphan.id;

    expect(minuit.slug).toBe("minuit-decousu");
    expect(minuit.slotCount).toBe(2);
    expect(minuit.dropFolderPath).toBeNull();
    // Tue+Fri weekly → the next airing is at most ~4.5 days out; it may have
    // just started (a running occurrence counts as next).
    if (!minuit.nextOccurrenceAt) throw new Error("expected a next airing");
    const delta = new Date(minuit.nextOccurrenceAt).getTime() - Date.now();
    expect(delta).toBeGreaterThan(-DAY_MS);
    expect(delta).toBeLessThan(5 * DAY_MS);

    expect(orphan.slotCount).toBe(0);
    expect(orphan.nextOccurrenceAt).toBeNull();
  });

  test("summary is station-scoped for slots, not for shows", async () => {
    const body = ShowsResponseSchema.parse(
      await (await app.request("/stations/wz-test/shows")).json(),
    );
    const minuit = body.shows.find((s) => s.name === "Minuit Décousu");
    expect(minuit?.slotCount).toBe(0);
    expect(minuit?.nextOccurrenceAt).toBeNull();
  });

  test("detail: slots + next/past split strictly around now, capped at 5 each", async () => {
    const before = Date.now();
    const response = await app.request(`/stations/oz/shows/${showId}`);
    expect(response.status).toBe(200);
    const detail = ShowDetailSchema.parse(await response.json());
    const after = Date.now();

    expect(detail.slots).toHaveLength(2);
    expect(detail.slots.every((slot) => slot.showName === "Minuit Décousu")).toBe(true);
    // Two weekly slots over ±45 days: far more than 5 a side → capped at 5.
    expect(detail.next).toHaveLength(5);
    expect(detail.past).toHaveLength(5);
    for (const occurrence of detail.next) {
      expect(new Date(occurrence.startsAt).getTime()).toBeGreaterThanOrEqual(before);
      expect(occurrence.negotiationState).toBe("validated");
    }
    for (const occurrence of detail.past) {
      expect(new Date(occurrence.startsAt).getTime()).toBeLessThan(after);
    }
    // Ended occurrences read as aired — computed on read, never stored (PD §4.4).
    const ended = detail.past.filter((o) => new Date(o.endsAt).getTime() <= before);
    expect(ended.every((o) => o.negotiationState === "aired")).toBe(true);
    // Chronological on both sides, and `past` holds the LAST five before now.
    const nextStarts = detail.next.map((o) => o.startsAt);
    expect([...nextStarts].sort()).toEqual(nextStarts);
    const pastStarts = detail.past.map((o) => o.startsAt);
    expect([...pastStarts].sort()).toEqual(pastStarts);
    const newestPast = new Date(pastStarts[4] ?? 0).getTime();
    expect(after - newestPast).toBeLessThan(8 * DAY_MS);
  });

  test("update: settings roundtrip normalizes the drop folder, no grid event", async () => {
    const response = await app.request(
      `/stations/oz/shows/${showId}`,
      jsonInit("PUT", {
        fallbackPolicy: "replay_previous",
        trustAutoAir: true,
        replayFlag: "yes",
        contributorTz: "Europe/Athens",
        dropFolderPath: "/[SHOWS]/Minuit Décousu//",
      }),
    );
    expect(response.status).toBe(200);
    const detail = ShowDetailSchema.parse(await response.json());
    expect(detail.fallbackPolicy).toBe("replay_previous");
    expect(detail.trustAutoAir).toBe(true);
    expect(detail.replayFlag).toBe("yes");
    expect(detail.contributorTz).toBe("Europe/Athens");
    expect(detail.dropFolderPath).toBe("[SHOWS]/Minuit Décousu");
    expect(reasons).not.toContain("show-updated");

    // Persisted: a fresh GET agrees.
    const fetched = ShowDetailSchema.parse(
      await (await app.request(`/stations/oz/shows/${showId}`)).json(),
    );
    expect(fetched.dropFolderPath).toBe("[SHOWS]/Minuit Décousu");
  });

  test("update: a rename refreshes the slug and repaints the grid", async () => {
    const response = await app.request(
      `/stations/oz/shows/${showId}`,
      jsonInit("PUT", { name: "Minuit Recousu" }),
    );
    expect(response.status).toBe(200);
    const detail = ShowDetailSchema.parse(await response.json());
    expect(detail.name).toBe("Minuit Recousu");
    expect(detail.slug).toBe("minuit-recousu");
    expect(reasons).toContain("show-updated");
  });

  test("update: bad timezone / traversal / empty body are 422, name twins 409", async () => {
    const badTz = await app.request(
      `/stations/oz/shows/${showId}`,
      jsonInit("PUT", { contributorTz: "Mars/Olympus" }),
    );
    expect(badTz.status).toBe(422);

    const badPath = await app.request(
      `/stations/oz/shows/${showId}`,
      jsonInit("PUT", { dropFolderPath: "../secrets" }),
    );
    expect(badPath.status).toBe(422);

    const empty = await app.request(`/stations/oz/shows/${showId}`, jsonInit("PUT", {}));
    expect(empty.status).toBe(422);

    const twin = await app.request(
      `/stations/oz/shows/${orphanId}`,
      jsonInit("PUT", { name: "Minuit Recousu" }),
    );
    expect(twin.status).toBe(409);
    const body = (await twin.json()) as { kind: string };
    expect(body.kind).toBe("conflict");
  });

  test("unknown shows are 404, on GET and PUT alike", async () => {
    expect((await app.request("/stations/oz/shows/9999")).status).toBe(404);
    const put = await app.request(
      "/stations/oz/shows/9999",
      jsonInit("PUT", { trustAutoAir: false }),
    );
    expect(put.status).toBe(404);
  });
});
