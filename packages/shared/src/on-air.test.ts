import { describe, expect, test } from "bun:test";
import { OnAirSchema } from "./on-air";

describe("OnAirSchema", () => {
  test("accepts a full on-air payload", () => {
    const parsed = OnAirSchema.safeParse({
      station: "oz",
      live: { isLive: true, streamerName: "Maigre" },
      current: {
        title: "Some Track",
        artist: "Some Artist",
        playlist: "[TRACKS]",
        startedAt: "2026-07-05T20:00:00.000Z",
        durationSec: 245,
      },
      next: null,
      observedAt: "2026-07-05T20:01:30.000Z",
      stale: false,
    });
    expect(parsed.success).toBe(true);
  });

  test("rejects an invalid station shortcode and missing fields", () => {
    const parsed = OnAirSchema.safeParse({
      station: "OZ !",
      live: { isLive: false, streamerName: null },
      current: null,
      observedAt: "not-a-date",
      stale: false,
    });
    expect(parsed.success).toBe(false);
  });
});
