import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../kernel/result";
import { StationId } from "../../../kernel/station-id";
import type { NowSnapshot } from "./now-snapshot";
import { OnAirStatus } from "./on-air-status";

const oz = unwrap(StationId.parse("oz"));

const snapshot = (overrides: Partial<NowSnapshot> = {}): NowSnapshot => ({
  live: { isLive: false, streamerName: null },
  current: {
    title: "Track A",
    artist: "Artist",
    playlist: "[TRACKS]",
    startedAt: new Date("2026-07-05T20:00:00Z"),
    durationSec: 240,
  },
  next: null,
  observedAt: new Date("2026-07-05T20:01:00Z"),
  ...overrides,
});

describe("OnAirStatus", () => {
  test("fromSnapshot maps fields and is not stale", () => {
    const status = OnAirStatus.fromSnapshot(oz, snapshot());
    expect(status.station).toBe("oz");
    expect(status.current?.title).toBe("Track A");
    expect(status.stale).toBe(false);
  });

  test("staleCopy marks stale and preserves the observation", () => {
    const status = OnAirStatus.fromSnapshot(oz, snapshot());
    const stale = status.staleCopy();
    expect(stale.stale).toBe(true);
    expect(stale.current?.title).toBe("Track A");
    expect(stale.observedAt).toEqual(status.observedAt);
  });

  test("sameOnAirAs ignores observation time but sees track and live transitions", () => {
    const a = OnAirStatus.fromSnapshot(oz, snapshot());
    const later = OnAirStatus.fromSnapshot(
      oz,
      snapshot({ observedAt: new Date("2026-07-05T20:02:00Z") }),
    );
    expect(a.sameOnAirAs(later)).toBe(true);

    const otherTrack = OnAirStatus.fromSnapshot(
      oz,
      snapshot({
        current: {
          title: "Track B",
          artist: "Artist",
          playlist: "[TRACKS]",
          startedAt: new Date("2026-07-05T20:04:00Z"),
          durationSec: 180,
        },
      }),
    );
    expect(a.sameOnAirAs(otherTrack)).toBe(false);

    const wentLive = OnAirStatus.fromSnapshot(
      oz,
      snapshot({ live: { isLive: true, streamerName: "Maigre" } }),
    );
    expect(a.sameOnAirAs(wentLive)).toBe(false);

    // The wire payload carries `next` — a mid-track change of what's coming
    // up is a transition, not noise to absorb.
    const nextChanged = OnAirStatus.fromSnapshot(
      oz,
      snapshot({
        next: {
          title: "Up Next",
          artist: null,
          playlist: null,
          startedAt: null,
          durationSec: null,
        },
      }),
    );
    expect(a.sameOnAirAs(nextChanged)).toBe(false);
  });
});
