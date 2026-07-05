import { describe, expect, it } from "vitest";
import {
  addDays,
  dayStartUtc,
  formatDayLabel,
  formatHm,
  formatWeekLabel,
  isoDayOf,
  isoWeekdayOf,
  utcToWall,
  wallToUtc,
  weekMondayOf,
} from "./station-time";

const ZONE = "Europe/Paris";
const HOUR = 3_600_000;

// Paris 2026: spring forward Sun 29 Mar (02:00→03:00 CET→CEST, at 01:00Z),
// fall back Sun 25 Oct (03:00→02:00 CEST→CET, at 01:00Z).

describe("station-time on normal days", () => {
  it("converts wall time to UTC (summer +2, winter +1)", () => {
    expect(wallToUtc("2026-07-08T14:00", ZONE).toISOString()).toBe("2026-07-08T12:00:00.000Z");
    expect(wallToUtc("2026-01-15T14:00", ZONE).toISOString()).toBe("2026-01-15T13:00:00.000Z");
  });

  it("round-trips utcToWall / wallToUtc", () => {
    const wall = "2026-07-08T23:45";
    expect(utcToWall(wallToUtc(wall, ZONE), ZONE)).toBe(wall);
  });

  it("computes real day starts and 24h day lengths", () => {
    const start = dayStartUtc("2026-07-08", ZONE);
    const next = dayStartUtc("2026-07-09", ZONE);
    expect(start.toISOString()).toBe("2026-07-07T22:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(24 * HOUR);
  });

  it("formats 24-hour times and day labels", () => {
    expect(formatHm(new Date("2026-07-08T12:05:00.000Z"), ZONE)).toBe("14:05");
    expect(formatDayLabel("2026-07-06")).toBe("Mon 6");
    expect(formatWeekLabel("2026-07-06")).toBe("Mon 6 – Sun 12 Jul 2026");
    expect(formatWeekLabel("2026-06-29")).toBe("Mon 29 Jun – Sun 5 Jul 2026");
  });
});

describe("station-time on the 23h day (2026-03-29, spring forward)", () => {
  it("derives a 23h day from real day-start instants", () => {
    const start = dayStartUtc("2026-03-29", ZONE);
    const next = dayStartUtc("2026-03-30", ZONE);
    expect(start.toISOString()).toBe("2026-03-28T23:00:00.000Z");
    expect(next.toISOString()).toBe("2026-03-29T22:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(23 * HOUR);
  });

  it("maps times after the jump with the summer offset", () => {
    expect(wallToUtc("2026-03-29T14:00", ZONE).toISOString()).toBe("2026-03-29T12:00:00.000Z");
    expect(formatHm(new Date("2026-03-29T12:00:00.000Z"), ZONE)).toBe("14:00");
  });

  it("resolves the nonexistent 02:30 deterministically, one hour later", () => {
    const resolved = wallToUtc("2026-03-29T02:30", ZONE);
    expect(resolved.toISOString()).toBe("2026-03-29T01:30:00.000Z");
    expect(formatHm(resolved, ZONE)).toBe("03:30");
  });
});

describe("station-time on the 25h day (2026-10-25, fall back)", () => {
  it("derives a 25h day from real day-start instants", () => {
    const start = dayStartUtc("2026-10-25", ZONE);
    const next = dayStartUtc("2026-10-26", ZONE);
    expect(start.toISOString()).toBe("2026-10-24T22:00:00.000Z");
    expect(next.toISOString()).toBe("2026-10-25T23:00:00.000Z");
    expect(next.getTime() - start.getTime()).toBe(25 * HOUR);
  });

  it("maps times after the repeat with the winter offset", () => {
    expect(wallToUtc("2026-10-25T12:00", ZONE).toISOString()).toBe("2026-10-25T11:00:00.000Z");
  });

  it("resolves the ambiguous 02:30 to the later (post-transition) reading", () => {
    // Documented divergence: Luxon on the server picks the earlier reading;
    // the optimistic UI is corrected by the server response for that one hour.
    const resolved = wallToUtc("2026-10-25T02:30", ZONE);
    expect(resolved.toISOString()).toBe("2026-10-25T01:30:00.000Z");
    expect(formatHm(resolved, ZONE)).toBe("02:30");
  });
});

describe("calendar helpers", () => {
  it("addDays crosses months and years without touching zones", () => {
    expect(addDays("2026-07-31", 1)).toBe("2026-08-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
    expect(addDays("2026-07-06", 7)).toBe("2026-07-13");
  });

  it("isoWeekdayOf uses ISO numbering (1 = Monday)", () => {
    expect(isoWeekdayOf("2026-07-06")).toBe(1);
    expect(isoWeekdayOf("2026-07-12")).toBe(7);
  });

  it("weekMondayOf respects the station zone across the UTC midnight seam", () => {
    // 23:30Z on Sunday 5 Jul is already 01:30 Monday 6 Jul in Paris.
    expect(weekMondayOf(new Date("2026-07-05T23:30:00.000Z"), ZONE)).toBe("2026-07-06");
    expect(weekMondayOf(new Date("2026-07-05T12:00:00.000Z"), ZONE)).toBe("2026-06-29");
  });

  it("isoDayOf follows the zone, not UTC", () => {
    expect(isoDayOf(new Date("2026-07-05T23:30:00.000Z"), ZONE)).toBe("2026-07-06");
  });
});
