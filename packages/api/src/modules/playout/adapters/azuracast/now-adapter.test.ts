import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../../kernel/result";
import { StationId } from "../../../../kernel/station-id";
import { silentLogger } from "../../../../platform/logger";
import { AzuracastClient } from "./client";
import { AzuracastPlayoutStateAdapter } from "./now-adapter";
import type { AzNowPlayingResponse } from "./types";

const oz = unwrap(StationId.parse("oz"));
const fixedClock = { now: () => new Date("2026-07-05T20:00:00Z") };

/** Shape recorded from AzuraCast 0.23.3 /api/nowplaying/{station} (trimmed to the read subset). */
const fixture: AzNowPlayingResponse = {
  station: { shortcode: "oz", name: "WaveZero" },
  live: { is_live: false, streamer_name: "" },
  now_playing: {
    song: { title: "Nadir", artist: "Habibi Funk", text: "Habibi Funk - Nadir" },
    played_at: 1_751_745_500,
    duration: 254,
    playlist: "[TRACKS]",
  },
  playing_next: {
    song: { title: "", artist: "", text: "jingle_03" },
    played_at: 0,
    // Fractional duration recorded from the live API (2026-07-05) — must round, the contract is int.
    duration: 134.60898,
    playlist: "",
  },
};

function adapterServing(body: unknown) {
  const client = new AzuracastClient({
    baseUrl: "https://az.example.net",
    apiKey: "k",
    logger: silentLogger,
    maxRetries: 0,
    fetchImpl: (async () =>
      new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch,
  });
  return new AzuracastPlayoutStateAdapter(client, fixedClock);
}

describe("AzuracastPlayoutStateAdapter", () => {
  test("maps the AzuraCast payload into a NowSnapshot", async () => {
    const snapshot = unwrap(await adapterServing(fixture).fetchNow(oz));

    expect(snapshot.live).toEqual({ isLive: false, streamerName: null });
    expect(snapshot.current).toEqual({
      title: "Nadir",
      artist: "Habibi Funk",
      playlist: "[TRACKS]",
      startedAt: new Date(1_751_745_500 * 1000),
      durationSec: 254,
    });
    // Empty strings and zero timestamps mean absence, not values.
    expect(snapshot.next?.title).toBe("jingle_03");
    expect(snapshot.next?.artist).toBeNull();
    expect(snapshot.next?.playlist).toBeNull();
    expect(snapshot.next?.startedAt).toBeNull();
    // Fractional upstream duration is rounded to whole seconds.
    expect(snapshot.next?.durationSec).toBe(135);
    expect(snapshot.observedAt).toEqual(new Date("2026-07-05T20:00:00Z"));
  });

  test("live broadcast: streamer name surfaces, no current song required", async () => {
    const live: AzNowPlayingResponse = {
      ...fixture,
      live: { is_live: true, streamer_name: "Maigre" },
      now_playing: null,
      playing_next: null,
    };
    const snapshot = unwrap(await adapterServing(live).fetchNow(oz));
    expect(snapshot.live).toEqual({ isLive: true, streamerName: "Maigre" });
    expect(snapshot.current).toBeNull();
    expect(snapshot.next).toBeNull();
  });
});
