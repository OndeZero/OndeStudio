import { beforeAll, describe, expect, test } from "bun:test";
import {
  type CreateSlotInput,
  OccurrenceSchema,
  OccurrencesResponseSchema,
  SlotSchema,
} from "@ondestudio/shared";
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

/**
 * Integration proof at the HTTP boundary: real routes → service → domain →
 * repo → SQLite (in-memory, real migrations). Only the mirror port is fake.
 */
const ZONE = "Europe/Paris";

const mirror: MirrorSchedulePort = {
  fetchBlocks: () =>
    Promise.resolve(
      ok([
        {
          source: "playlist" as const,
          mode: "band" as const,
          label: "[MIXS]",
          startsAtUtc: new Date("2026-07-07T20:00:00Z"),
          endsAtUtc: new Date("2026-07-08T07:00:00Z"),
        },
      ]),
    ),
};

function buildApp() {
  const repo = new DrizzleSchedulingRepo(createDb(":memory:", silentLogger));
  const events: string[] = [];
  const bus = new EventBus(() => {});
  bus.on("scheduling.grid-changed", (e) => events.push(e.reason));
  const service = new SchedulingService({
    repo,
    mirror,
    bus,
    clock: systemClock,
    logger: silentLogger,
    zone: ZONE,
  });
  const app = createApiApp(silentLogger);
  app.route("/", createSchedulingRoutes(service));
  return { app, events };
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
  method,
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

// Week of Mon 2026-07-06 (Europe/Paris, CEST): window in UTC.
const WEEK = "from=2026-07-05T22:00:00.000Z&to=2026-07-12T22:00:00.000Z";

describe("scheduling over HTTP", () => {
  const { app, events } = buildApp();
  let occurrenceId = "";

  beforeAll(async () => {
    const create: CreateSlotInput = {
      kind: "show",
      showName: "Minuit Décousu",
      recurrence: { type: "weekly", weekdays: [2], time: "22:00" },
      durationMin: 120,
      bornValidated: false,
    };
    const response = await app.request("/stations/oz/slots", jsonInit("POST", create));
    expect(response.status).toBe(201);
    const slot = SlotSchema.parse(await response.json());
    expect(slot.showName).toBe("Minuit Décousu");
    expect(slot.title).toBeNull();
    expect(slot.negotiationDefault).toBe("prebooked");
  });

  test("computed occurrences appear with slot defaults, no rows persisted yet", async () => {
    const response = await app.request(`/stations/oz/occurrences?${WEEK}`);
    expect(response.status).toBe(200);
    const body = OccurrencesResponseSchema.parse(await response.json());
    expect(body.zone).toBe(ZONE);
    expect(body.occurrences).toHaveLength(1);
    const occ = body.occurrences[0];
    if (!occ) throw new Error("missing occurrence");
    expect(occ.title).toBe("Minuit Décousu");
    expect(occ.startsAt).toBe("2026-07-07T20:00:00.000Z"); // Tue 22:00 CEST
    expect(occ.negotiationState).toBe("prebooked");
    expect(occ.contentState).toBe("empty");
    expect(occ.moved).toBe(false);
    occurrenceId = occ.id;
  });

  test("PATCH move records an exception; the series time is suppressed, moved:true", async () => {
    const response = await app.request(
      `/stations/oz/occurrences/${occurrenceId}`,
      jsonInit("PATCH", { startsAtWall: "2026-07-08T15:30", durationMin: 90 }),
    );
    expect(response.status).toBe(200);
    const patched = OccurrenceSchema.parse(await response.json());
    expect(patched.startsAt).toBe("2026-07-08T13:30:00.000Z"); // Wed 15:30 CEST
    expect(patched.durationMin).toBe(90);
    expect(patched.moved).toBe(true);

    const list = OccurrencesResponseSchema.parse(
      await (await app.request(`/stations/oz/occurrences?${WEEK}`)).json(),
    );
    // Still exactly one occurrence this week — the moved one, not a double render.
    expect(list.occurrences).toHaveLength(1);
    expect(list.occurrences[0]?.startsAt).toBe("2026-07-08T13:30:00.000Z");
    expect(events).toContain("occurrence-patched");
  });

  test("state transitions: legal succeeds, illegal is 409", async () => {
    const toDealing = await app.request(
      `/stations/oz/occurrences/${occurrenceId}`,
      jsonInit("PATCH", { negotiationState: "dealing" }),
    );
    expect(toDealing.status).toBe(200);

    const illegal = await app.request(
      `/stations/oz/occurrences/${occurrenceId}`,
      jsonInit("PATCH", { negotiationState: "aired" }), // aired is time-driven, never settable
    );
    expect(illegal.status).toBe(409);
    const body = (await illegal.json()) as { kind: string };
    expect(body.kind).toBe("illegal-transition");
  });

  test("filters: negotiation filter drops non-matching occurrences", async () => {
    const dealing = OccurrencesResponseSchema.parse(
      await (await app.request(`/stations/oz/occurrences?${WEEK}&negotiation=dealing`)).json(),
    );
    expect(dealing.occurrences).toHaveLength(1);
    const validatedOnly = OccurrencesResponseSchema.parse(
      await (await app.request(`/stations/oz/occurrences?${WEEK}&negotiation=validated`)).json(),
    );
    expect(validatedOnly.occurrences).toHaveLength(0);
    const bad = await app.request(`/stations/oz/occurrences?${WEEK}&negotiation=approved`);
    expect(bad.status).toBe(422);
  });

  test("a moved occurrence renders in its new week, not its original one", async () => {
    // Move to the following week (Tue 2026-07-14 slot week).
    const response = await app.request(
      `/stations/oz/occurrences/${occurrenceId}`,
      jsonInit("PATCH", { startsAtWall: "2026-07-15T10:00" }),
    );
    expect(response.status).toBe(200);

    const thisWeek = OccurrencesResponseSchema.parse(
      await (await app.request(`/stations/oz/occurrences?${WEEK}`)).json(),
    );
    expect(thisWeek.occurrences).toHaveLength(0);

    const nextWeek = OccurrencesResponseSchema.parse(
      await (
        await app.request(
          "/stations/oz/occurrences?from=2026-07-12T22:00:00.000Z&to=2026-07-19T22:00:00.000Z",
        )
      ).json(),
    );
    // The moved exception + the following Tuesday's computed occurrence.
    const starts = nextWeek.occurrences.map((o) => o.startsAt).sort();
    expect(starts).toEqual(["2026-07-14T20:00:00.000Z", "2026-07-15T08:00:00.000Z"]);
  });

  test("unknown occurrences and foreign stations are 404", async () => {
    const noSlot = await app.request(
      "/stations/oz/occurrences/999_1751913600000",
      jsonInit("PATCH", { durationMin: 60 }),
    );
    expect(noSlot.status).toBe(404);

    const wrongStation = await app.request(
      `/stations/wz-test/occurrences/${occurrenceId}`,
      jsonInit("PATCH", { durationMin: 60 }),
    );
    expect(wrongStation.status).toBe(404);

    // A time that is not a real series instance of the slot:
    const notAnInstance = await app.request(
      "/stations/oz/occurrences/1_1751917200000", // Tue 21:00 UTC ≠ series 20:00 UTC
      jsonInit("PATCH", { durationMin: 60 }),
    );
    expect(notAnInstance.status).toBe(404);
  });

  test("mirror endpoint serves playout blocks separately from OS occurrences", async () => {
    const response = await app.request(`/stations/oz/mirror?${WEEK}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { blocks: { label: string; mode: string }[] };
    expect(body.blocks[0]?.label).toBe("[MIXS]");
    expect(body.blocks[0]?.mode).toBe("band");
  });

  test("slot delete cascades: occurrences and exceptions disappear", async () => {
    const slots = (await (await app.request("/stations/oz/slots")).json()) as {
      slots: { id: number }[];
    };
    const slotId = slots.slots[0]?.id;
    const del = await app.request(`/stations/oz/slots/${slotId}`, { method: "DELETE" });
    expect(del.status).toBe(204);

    const after = OccurrencesResponseSchema.parse(
      await (
        await app.request(
          "/stations/oz/occurrences?from=2026-07-12T22:00:00.000Z&to=2026-07-19T22:00:00.000Z",
        )
      ).json(),
    );
    expect(after.occurrences).toHaveLength(0);
  });
});
