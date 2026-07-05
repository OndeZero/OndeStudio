import { describe, expect, it } from "vitest";
import { dayStartUtc } from "../../lib/station-time";
import {
  dayGeometry,
  durationMinToPx,
  gapsBetween,
  instantToY,
  packLanes,
  pxToDurationMin,
  snapInstant,
  snapMinutes,
  yToInstant,
} from "./grid-geometry";

const ZONE = "Europe/Paris";
const HOUR = 3_600_000;

function geoOf(isoDay: string, nextIsoDay: string, pxPerHour = 48) {
  return dayGeometry(dayStartUtc(isoDay, ZONE), dayStartUtc(nextIsoDay, ZONE), pxPerHour);
}

describe("day geometry", () => {
  it("maps a normal 24h day to 24 × pxPerHour", () => {
    const geo = geoOf("2026-07-08", "2026-07-09");
    expect(geo.heightPx).toBe(24 * 48);
    expect(instantToY(geo, geo.startUtcMs)).toBe(0);
    expect(instantToY(geo, geo.startUtcMs + 7 * HOUR)).toBe(7 * 48);
  });

  it("maps DST days to their actual duration at the same px-per-hour", () => {
    const short = geoOf("2026-03-29", "2026-03-30");
    const long = geoOf("2026-10-25", "2026-10-26");
    expect(short.heightPx).toBe(23 * 48);
    expect(long.heightPx).toBe(25 * 48);
    // Same scale everywhere: one hour is one hour of pixels on any day.
    expect(instantToY(long, long.startUtcMs + 25 * HOUR)).toBe(long.heightPx);
  });

  it("round-trips instant ↔ y and duration ↔ px", () => {
    const geo = geoOf("2026-07-08", "2026-07-09");
    const instant = geo.startUtcMs + 90 * 60_000;
    expect(yToInstant(geo, instantToY(geo, instant))).toBe(instant);
    expect(durationMinToPx(geo, 90)).toBe(72);
    expect(pxToDurationMin(geo, 72)).toBe(90);
  });

  it("clamps yToInstant into the day window", () => {
    const geo = geoOf("2026-07-08", "2026-07-09");
    expect(yToInstant(geo, -50)).toBe(geo.startUtcMs);
    expect(yToInstant(geo, geo.heightPx + 50)).toBe(geo.endUtcMs);
  });
});

describe("snapping", () => {
  it("snaps minutes to the nearest 15", () => {
    expect(snapMinutes(52)).toBe(45);
    expect(snapMinutes(53)).toBe(60);
    expect(snapMinutes(7)).toBe(0);
  });

  it("snaps instants to the wall raster from the real day start", () => {
    const geo = geoOf("2026-07-08", "2026-07-09");
    const at = geo.startUtcMs + 52 * 60_000;
    expect(snapInstant(geo, at)).toBe(geo.startUtcMs + 45 * 60_000);
  });

  it("stays wall-aligned on the 25h day (shift is a whole hour)", () => {
    const geo = geoOf("2026-10-25", "2026-10-26");
    // 03:07 wall time on the 25h day is start + 4h07 elapsed (one hour repeats).
    const at = geo.startUtcMs + (4 * 60 + 7) * 60_000;
    expect(snapInstant(geo, at)).toBe(geo.startUtcMs + 4 * HOUR);
  });
});

describe("lane packing", () => {
  it("keeps non-overlapping items full width", () => {
    const boxes = packLanes([
      { startMs: 0, endMs: 10 },
      { startMs: 10, endMs: 20 },
    ]);
    expect(boxes).toEqual([
      { lane: 0, lanes: 1 },
      { lane: 0, lanes: 1 },
    ]);
  });

  it("splits an overlap cluster side by side", () => {
    const boxes = packLanes([
      { startMs: 0, endMs: 30 },
      { startMs: 10, endMs: 20 },
      { startMs: 40, endMs: 50 },
    ]);
    expect(boxes[0]).toEqual({ lane: 0, lanes: 2 });
    expect(boxes[1]).toEqual({ lane: 1, lanes: 2 });
    expect(boxes[2]).toEqual({ lane: 0, lanes: 1 });
  });

  it("reuses freed lanes inside one cluster", () => {
    const boxes = packLanes([
      { startMs: 0, endMs: 10 },
      { startMs: 5, endMs: 30 },
      { startMs: 12, endMs: 20 },
    ]);
    // Third item starts after the first ended: lane 0 is free again,
    // but the chain overlap keeps all three in one 2-lane cluster.
    expect(boxes[2]).toEqual({ lane: 0, lanes: 2 });
    expect(boxes[1]).toEqual({ lane: 1, lanes: 2 });
  });
});

describe("derived rotation gaps", () => {
  const MIN = 30 * 60_000;

  it("finds the gaps between the occupied union, clipped to the window", () => {
    const gaps = gapsBetween(
      [
        { startMs: 2 * HOUR, endMs: 3 * HOUR },
        { startMs: 5 * HOUR, endMs: 6 * HOUR },
      ],
      0,
      8 * HOUR,
      MIN,
    );
    expect(gaps).toEqual([
      { startMs: 0, endMs: 2 * HOUR },
      { startMs: 3 * HOUR, endMs: 5 * HOUR },
      { startMs: 6 * HOUR, endMs: 8 * HOUR },
    ]);
  });

  it("ignores gaps shorter than the threshold and overlapping ranges", () => {
    const gaps = gapsBetween(
      [
        { startMs: 0, endMs: 4 * HOUR },
        { startMs: 2 * HOUR, endMs: 5 * HOUR },
        { startMs: 5 * HOUR + 10 * 60_000, endMs: 8 * HOUR },
      ],
      0,
      8 * HOUR,
      MIN,
    );
    expect(gaps).toEqual([]);
  });

  it("covers an empty day with one full gap", () => {
    expect(gapsBetween([], 0, 24 * HOUR, MIN)).toEqual([{ startMs: 0, endMs: 24 * HOUR }]);
  });
});
