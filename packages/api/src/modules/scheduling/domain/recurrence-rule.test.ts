import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../kernel/result";
import { RecurrenceRule } from "./recurrence-rule";

const ZONE = "Europe/Paris";
const utc = (iso: string): Date => new Date(iso);

const weekly = (weekdays: number[], time: string): RecurrenceRule =>
  unwrap(RecurrenceRule.from({ type: "weekly", weekdays, time }));

describe("RecurrenceRule — weekly expansion", () => {
  // Week of Mon 2026-07-06 … Sun 2026-07-12 (CEST, UTC+2).
  const from = utc("2026-07-05T22:00:00Z"); // Monday 00:00 Paris
  const to = utc("2026-07-12T22:00:00Z");

  test("one weekday, wall time 22:00 CEST → 20:00 UTC", () => {
    const rule = weekly([2], "22:00"); // Tuesdays
    const result = rule.occurrencesBetween(120, from, to, ZONE);
    expect(result).toHaveLength(1);
    expect(result[0]?.originalStartsAtUtc.toISOString()).toBe("2026-07-07T20:00:00.000Z");
    expect(result[0]?.endsAtUtc.toISOString()).toBe("2026-07-07T22:00:00.000Z");
  });

  test("multiple weekdays expand once per matching day", () => {
    const rule = weekly([1, 4, 6], "09:30");
    const starts = rule
      .occurrencesBetween(60, from, to, ZONE)
      .map((o) => o.originalStartsAtUtc.toISOString());
    expect(starts).toEqual([
      "2026-07-06T07:30:00.000Z", // Monday
      "2026-07-09T07:30:00.000Z", // Thursday
      "2026-07-11T07:30:00.000Z", // Saturday
    ]);
  });

  test("overnight run started before the window is still included (Minuit Décousu case)", () => {
    // Thursday 23:00 + 3h ends Friday 02:00. Window = Friday only.
    const rule = weekly([4], "23:00");
    const fridayOnly = rule.occurrencesBetween(
      180,
      utc("2026-07-09T22:00:00Z"), // Friday 00:00 Paris
      utc("2026-07-10T22:00:00Z"),
      ZONE,
    );
    expect(fridayOnly).toHaveLength(1);
    expect(fridayOnly[0]?.originalStartsAtUtc.toISOString()).toBe("2026-07-09T21:00:00.000Z");
  });

  test("an occurrence starting exactly at window end is excluded; ending at window start too", () => {
    const rule = weekly([2], "22:00");
    const before = rule.occurrencesBetween(
      60,
      utc("2026-07-06T20:00:00Z"),
      utc("2026-07-07T20:00:00Z"), // window ends exactly at start
      ZONE,
    );
    expect(before).toHaveLength(0);
  });
});

describe("RecurrenceRule — DST (Europe/Paris 2026: spring 2026-03-29, fall 2026-10-25)", () => {
  test("wall time survives the fall-back: 14:00 is 12:00 UTC before, 13:00 UTC after", () => {
    const rule = weekly([7], "14:00"); // Sundays
    const around = rule.occurrencesBetween(
      60,
      utc("2026-10-18T00:00:00Z"),
      utc("2026-11-02T00:00:00Z"),
      ZONE,
    );
    const starts = around.map((o) => o.originalStartsAtUtc.toISOString());
    expect(starts).toContain("2026-10-18T12:00:00.000Z"); // CEST (UTC+2)
    expect(starts).toContain("2026-10-25T13:00:00.000Z"); // CET (UTC+1) — same 14:00 wall
    expect(starts).toContain("2026-11-01T13:00:00.000Z");
  });

  test("nonexistent spring-forward time shifts forward instead of vanishing", () => {
    const rule = weekly([7], "02:30"); // 02:30 does not exist on 2026-03-29
    const around = rule.occurrencesBetween(
      60,
      utc("2026-03-28T00:00:00Z"),
      utc("2026-03-30T00:00:00Z"),
      ZONE,
    );
    expect(around).toHaveLength(1);
    // Luxon lands on 03:30 CEST = 01:30 UTC — the show still exists that night.
    expect(around[0]?.originalStartsAtUtc.toISOString()).toBe("2026-03-29T01:30:00.000Z");
  });
});

describe("RecurrenceRule — one-off and DB round-trip", () => {
  test("one-off wall datetime materializes once, only when intersecting", () => {
    const rule = unwrap(RecurrenceRule.from({ type: "once", startsAtWall: "2026-07-10T21:00" }));
    const inWindow = rule.occurrencesBetween(
      90,
      utc("2026-07-05T22:00:00Z"),
      utc("2026-07-12T22:00:00Z"),
      ZONE,
    );
    expect(inWindow).toHaveLength(1);
    expect(inWindow[0]?.originalStartsAtUtc.toISOString()).toBe("2026-07-10T19:00:00.000Z");
    const outside = rule.occurrencesBetween(
      90,
      utc("2026-07-12T22:00:00Z"),
      utc("2026-07-19T22:00:00Z"),
      ZONE,
    );
    expect(outside).toHaveLength(0);
  });

  test("weekly ↔ rrule text round-trip", () => {
    const rule = weekly([2, 6], "22:00");
    const db = rule.toDb();
    expect(db).toEqual({ rrule: "FREQ=WEEKLY;BYDAY=TU,SA", startWall: "22:00" });
    const back = unwrap(RecurrenceRule.fromDb(db.rrule, db.startWall));
    expect(back.pattern).toEqual({ type: "weekly", weekdays: [2, 6], time: "22:00" });
  });

  test("one-off ↔ null rrule round-trip; unsupported rrule rejected", () => {
    const rule = unwrap(RecurrenceRule.from({ type: "once", startsAtWall: "2026-07-10T21:00" }));
    const db = rule.toDb();
    expect(db).toEqual({ rrule: null, startWall: "2026-07-10T21:00" });
    expect(unwrap(RecurrenceRule.fromDb(null, "2026-07-10T21:00")).pattern.type).toBe("once");
    expect(RecurrenceRule.fromDb("FREQ=MONTHLY;BYMONTHDAY=1", "10:00").ok).toBe(false);
  });

  test("validation: weekdays deduped and sorted, bad values rejected", () => {
    expect(weekly([6, 2, 2], "10:00").pattern).toEqual({
      type: "weekly",
      weekdays: [2, 6],
      time: "10:00",
    });
    expect(RecurrenceRule.from({ type: "weekly", weekdays: [], time: "10:00" }).ok).toBe(false);
    expect(RecurrenceRule.from({ type: "weekly", weekdays: [8], time: "10:00" }).ok).toBe(false);
    expect(RecurrenceRule.from({ type: "weekly", weekdays: [1], time: "25:00" }).ok).toBe(false);
  });
});
