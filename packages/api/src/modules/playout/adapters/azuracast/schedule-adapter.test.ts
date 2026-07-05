import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../../kernel/result";
import { StationId } from "../../../../kernel/station-id";
import { silentLogger } from "../../../../platform/logger";
import { AzuracastClient } from "./client";
import { AzuracastMirrorScheduleAdapter } from "./schedule-adapter";
import type { AzPlaylist, AzStreamer } from "./types";

const oz = unwrap(StationId.parse("oz"));

// A Monday→Monday UTC week in July 2026 — Europe/Paris is CEST (UTC+2), 2026-07-06 is Monday.
const weekFrom = new Date("2026-07-06T00:00:00Z");
const weekTo = new Date("2026-07-13T00:00:00Z");

/** Real payload recorded from AzuraCast 0.23.3 (2026-07-05): Thu 23:00→01:01, Fri 01:00→02:10. */
const minuitDecousu: AzPlaylist = {
  id: 77,
  name: "[SHOW] - Minuit Décousu",
  type: "default",
  is_enabled: true,
  schedule_items: [
    { start_time: 2300, end_time: 101, days: [4] },
    { start_time: 100, end_time: 210, days: [5] },
  ],
};

/** [MIXS]-style cadence playlist: empty days[] = nightly, 22:00 wrapping to 09:00 next day. */
const mixs: AzPlaylist = {
  id: 12,
  name: "[MIXS]",
  type: "once_per_x_minutes",
  is_enabled: true,
  schedule_items: [{ start_time: 2200, end_time: 900, days: [] }],
};

/** Real client + fake fetch (now-adapter.test.ts style) with a controllable clock for the TTL. */
function harness(options: { playlists?: AzPlaylist[]; streamers?: AzStreamer[] }) {
  let nowMs = new Date("2026-07-06T12:00:00Z").getTime();
  const urls: string[] = [];
  const client = new AzuracastClient({
    baseUrl: "https://az.example.net",
    apiKey: "k",
    logger: silentLogger,
    maxRetries: 0,
    fetchImpl: (async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      const body = url.includes("/playlists")
        ? (options.playlists ?? [])
        : (options.streamers ?? []);
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
  const adapter = new AzuracastMirrorScheduleAdapter(client, "Europe/Paris", {
    now: () => new Date(nowMs),
  });
  return {
    adapter,
    urls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("AzuracastMirrorScheduleAdapter", () => {
  test("expands the Minuit Décousu two-item playlist to correct CEST→UTC instants", async () => {
    const { adapter } = harness({ playlists: [minuitDecousu] });
    const blocks = unwrap(await adapter.fetchBlocks(oz, weekFrom, weekTo));

    expect(blocks).toHaveLength(2);
    // Thursday 2026-07-09 23:00 CEST = 21:00Z; end 0101 <= start 2300 wraps to Friday 01:01 CEST.
    expect(blocks[0]).toEqual({
      source: "playlist",
      mode: "block",
      label: "[SHOW] - Minuit Décousu",
      startsAtUtc: new Date("2026-07-09T21:00:00Z"),
      endsAtUtc: new Date("2026-07-09T23:01:00Z"),
    });
    // Friday 2026-07-10 01:00–02:10 CEST — no wrap, plain same-day item.
    expect(blocks[1]).toEqual({
      source: "playlist",
      mode: "block",
      label: "[SHOW] - Minuit Décousu",
      startsAtUtc: new Date("2026-07-09T23:00:00Z"),
      endsAtUtc: new Date("2026-07-10T00:10:00Z"),
    });
  });

  test("empty days[] + wrap: nightly bands, incl. one entering from the previous day", async () => {
    const { adapter } = harness({ playlists: [mixs] });
    const to = new Date("2026-07-08T00:00:00Z");
    const blocks = unwrap(await adapter.fetchBlocks(oz, weekFrom, to));

    // Cadence type (once_per_*) renders as a band, not a slot (PD §4.8).
    expect(blocks.every((b) => b.mode === "band" && b.label === "[MIXS]")).toBe(true);
    // Sunday's 22:00 CEST band started before the window but runs into it (ends 09:00 Monday).
    expect(blocks.map((b) => b.startsAtUtc.toISOString())).toEqual([
      "2026-07-05T20:00:00.000Z",
      "2026-07-06T20:00:00.000Z",
      "2026-07-07T20:00:00.000Z",
    ]);
    expect(blocks[0]?.endsAtUtc).toEqual(new Date("2026-07-06T07:00:00Z"));
  });

  test("degenerate start === end rows are skipped", async () => {
    const streamer: AzStreamer = {
      id: 3,
      streamer_username: "ondepi-2",
      display_name: "",
      is_active: true,
      enforce_schedule: false,
      // Observed live on streamer ondepi-2: manual-hack noise, not a real block.
      schedule_items: [{ start_time: 0, end_time: 0, days: [] }],
    };
    const { adapter } = harness({ streamers: [streamer] });
    expect(unwrap(await adapter.fetchBlocks(oz, weekFrom, weekTo))).toEqual([]);
  });

  test("disabled playlists and inactive streamers are skipped", async () => {
    const { adapter } = harness({
      playlists: [{ ...minuitDecousu, is_enabled: false }],
      streamers: [
        {
          id: 9,
          streamer_username: "gone",
          display_name: "Gone",
          is_active: false,
          enforce_schedule: true,
          schedule_items: [{ start_time: 1000, end_time: 1100, days: [1] }],
        },
      ],
    });
    expect(unwrap(await adapter.fetchBlocks(oz, weekFrom, weekTo))).toEqual([]);
  });

  test("a block starting exactly at windowTo is excluded (half-open window)", async () => {
    const morning: AzPlaylist = {
      id: 5,
      name: "Morning",
      type: "default",
      is_enabled: true,
      schedule_items: [{ start_time: 1000, end_time: 1100, days: [1] }],
    };
    const { adapter } = harness({ playlists: [morning] });
    // The window closes exactly at Monday 10:00 CEST (08:00Z) — the block must not appear.
    const to = new Date("2026-07-06T08:00:00Z");
    expect(unwrap(await adapter.fetchBlocks(oz, weekFrom, to))).toEqual([]);
  });

  test("caches raw payloads for 30s, refetches once the TTL has passed", async () => {
    const { adapter, urls, advance } = harness({ playlists: [minuitDecousu] });

    await adapter.fetchBlocks(oz, weekFrom, weekTo);
    expect(urls).toHaveLength(2); // one playlists + one streamers request
    await adapter.fetchBlocks(oz, weekFrom, weekTo);
    expect(urls).toHaveLength(2); // within the TTL: served from cache, no refetch

    advance(31_000);
    await adapter.fetchBlocks(oz, weekFrom, weekTo);
    expect(urls).toHaveLength(4); // past the TTL: both endpoints hit again
  });

  test("maps streamers with display_name, falling back to the username", async () => {
    const streamers: AzStreamer[] = [
      {
        id: 1,
        streamer_username: "maigre",
        display_name: "Maigre",
        is_active: true,
        enforce_schedule: true,
        schedule_items: [{ start_time: 2000, end_time: 2200, days: [1] }],
      },
      {
        id: 2,
        streamer_username: "ondepi-2",
        display_name: "",
        is_active: true,
        enforce_schedule: false,
        schedule_items: [{ start_time: 900, end_time: 1000, days: [2] }],
      },
    ];
    const { adapter } = harness({ streamers });
    const blocks = unwrap(await adapter.fetchBlocks(oz, weekFrom, weekTo));

    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({
      source: "streamer",
      mode: "block",
      label: "Maigre",
      startsAtUtc: new Date("2026-07-06T18:00:00Z"), // Monday 20:00 CEST
      endsAtUtc: new Date("2026-07-06T20:00:00Z"),
    });
    // Empty display_name falls back to the username; blocks come back time-sorted.
    expect(blocks[1]?.label).toBe("ondepi-2");
    expect(blocks[1]?.startsAtUtc).toEqual(new Date("2026-07-07T07:00:00Z")); // Tuesday 09:00 CEST
  });
});
