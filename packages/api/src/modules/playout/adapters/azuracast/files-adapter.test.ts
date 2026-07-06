import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../../kernel/result";
import { StationId } from "../../../../kernel/station-id";
import { silentLogger } from "../../../../platform/logger";
import { AzuracastClient } from "./client";
import { AzuracastFilesAdapter } from "./files-adapter";

const oz = unwrap(StationId.parse("oz"));
const wz = unwrap(StationId.parse("wz-test"));

/** 0.23.3-style rows of /api/station/{station}/files (subset the adapter reads). */
const FIXTURE = [
  {
    id: 101,
    path: "[SHOWS]/Minuit Décousu/ep-01.mp3",
    length: 134.60898,
    title: "Ep 01",
    artist: "Maigre",
    text: "Maigre - Ep 01",
  },
  {
    // Unscanned upload: zero length, empty tags, only the combined text set.
    id: 102,
    path: "00 - STOCK/dropped.mp3",
    length: 0,
    title: "",
    artist: "",
    text: "dropped",
  },
  {
    // Sparse row: optional fields can be absent entirely.
    id: 103,
    path: "[TRACKS]/bare.mp3",
  },
];

/** Real client + fake fetch (schedule-adapter.test.ts style) with a controllable clock. */
function harness(options: { payload?: unknown; status?: number } = {}) {
  let nowMs = new Date("2026-07-06T12:00:00Z").getTime();
  const urls: string[] = [];
  const client = new AzuracastClient({
    baseUrl: "https://az.example.net",
    apiKey: "k",
    logger: silentLogger,
    maxRetries: 0,
    fetchImpl: (async (input: unknown) => {
      urls.push(String(input));
      return new Response(JSON.stringify(options.payload ?? FIXTURE), {
        status: options.status ?? 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch,
  });
  const adapter = new AzuracastFilesAdapter(client, { now: () => new Date(nowMs) });
  return {
    adapter,
    urls,
    advance: (ms: number) => {
      nowMs += ms;
    },
  };
}

describe("AzuracastFilesAdapter", () => {
  test("maps the upstream subset: string id, whole seconds, tags kept", async () => {
    const { adapter } = harness();
    const files = unwrap(await adapter.listFiles(oz));
    expect(files).toHaveLength(3);
    expect(files[0]).toEqual({
      azFileId: "101",
      path: "[SHOWS]/Minuit Décousu/ep-01.mp3",
      durationSec: 135, // fractional upstream seconds → whole (now-adapter convention)
      title: "Ep 01",
      artist: "Maigre",
    });
  });

  test("normalizes absence: 0/missing length and empty tags → null, title falls back to text", async () => {
    const { adapter } = harness();
    const files = unwrap(await adapter.listFiles(oz));
    expect(files[1]).toEqual({
      azFileId: "102",
      path: "00 - STOCK/dropped.mp3",
      durationSec: null, // 0 = unscanned, not a zero-length file
      title: "dropped", // empty title → the combined text
      artist: null,
    });
    expect(files[2]).toEqual({
      azFileId: "103",
      path: "[TRACKS]/bare.mp3",
      durationSec: null,
      title: null,
      artist: null,
    });
  });

  test("caches per station for 60s, refetches once the TTL has passed", async () => {
    const { adapter, urls, advance } = harness();

    await adapter.listFiles(oz);
    await adapter.listFiles(oz);
    expect(urls).toHaveLength(1); // within the TTL: served from cache

    await adapter.listFiles(wz);
    expect(urls).toHaveLength(2); // another station is its own cache entry
    expect(urls[0]).toContain("/api/station/oz/files");
    expect(urls[1]).toContain("/api/station/wz-test/files");

    advance(59_000);
    await adapter.listFiles(oz);
    expect(urls).toHaveLength(2); // still fresh at 59s

    advance(2_000);
    await adapter.listFiles(oz);
    expect(urls).toHaveLength(3); // past the TTL: refetched
  });

  test("an upstream failure is a Result error and is not cached", async () => {
    const { adapter, urls } = harness({ status: 500 });
    const result = await adapter.listFiles(oz);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("upstream-unavailable");

    // The failure did not poison the cache: the next call goes upstream again.
    await adapter.listFiles(oz);
    expect(urls).toHaveLength(2);
  });
});
