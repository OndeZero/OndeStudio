import { describe, expect, test } from "bun:test";
import { unwrap } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createDb } from "../../platform/db";
import { silentLogger } from "../../platform/logger";
import type { NowSnapshot } from "./domain/now-snapshot";
import { OnAirStatus } from "./domain/on-air-status";
import { DrizzleNowCacheRepo } from "./repo";

const oz = unwrap(StationId.parse("oz"));

const snapshot: NowSnapshot = {
  live: { isLive: true, streamerName: "Maigre" },
  current: {
    title: "Live from GZ",
    artist: null,
    playlist: null,
    startedAt: new Date("2026-07-05T21:00:00Z"),
    durationSec: null,
  },
  next: null,
  observedAt: new Date("2026-07-05T21:05:00Z"),
};

describe("DrizzleNowCacheRepo", () => {
  // In-memory DB runs the real migrations — this test also proves the first migration applies.
  const repo = new DrizzleNowCacheRepo(createDb(":memory:", silentLogger));

  test("round-trips an OnAirStatus and upserts per station", async () => {
    expect(await repo.load(oz)).toBeNull();

    await repo.save(OnAirStatus.fromSnapshot(oz, snapshot));
    const loaded = await repo.load(oz);
    expect(loaded?.station).toBe("oz");
    expect(loaded?.live).toEqual({ isLive: true, streamerName: "Maigre" });
    expect(loaded?.current?.startedAt).toEqual(new Date("2026-07-05T21:00:00Z"));
    expect(loaded?.observedAt).toEqual(new Date("2026-07-05T21:05:00Z"));
    // Cache rehydration is never stale by itself — the service marks it when serving degraded.
    expect(loaded?.stale).toBe(false);

    const updated: NowSnapshot = { ...snapshot, live: { isLive: false, streamerName: null } };
    await repo.save(OnAirStatus.fromSnapshot(oz, updated));
    expect((await repo.load(oz))?.live.isLive).toBe(false);
  });
});
