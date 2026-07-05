import { describe, expect, test } from "bun:test";
import { DomainError } from "../../kernel/domain-error";
import { EventBus } from "../../kernel/event-bus";
import { err, ok, type Result, unwrap } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { silentLogger } from "../../platform/logger";
import type { NowSnapshot } from "./domain/now-snapshot";
import type { OnAirStatus } from "./domain/on-air-status";
import type { PlayoutStatePort } from "./ports";
import type { NowCacheRepo } from "./repo";
import { PlayoutService } from "./service";

const oz = unwrap(StationId.parse("oz"));

const snapshot = (title: string): NowSnapshot => ({
  live: { isLive: false, streamerName: null },
  current: { title, artist: null, playlist: null, startedAt: null, durationSec: null },
  next: null,
  observedAt: new Date("2026-07-05T20:00:00Z"),
});

class FakePort implements PlayoutStatePort {
  constructor(public result: Result<NowSnapshot, DomainError>) {}
  fetchNow(): Promise<Result<NowSnapshot, DomainError>> {
    return Promise.resolve(this.result);
  }
}

class MemoryCache implements NowCacheRepo {
  private store = new Map<string, OnAirStatus>();
  save(status: OnAirStatus): Promise<void> {
    this.store.set(status.station, status);
    return Promise.resolve();
  }
  load(station: StationId): Promise<OnAirStatus | null> {
    return Promise.resolve(this.store.get(station.value) ?? null);
  }
}

function build(port: FakePort) {
  const events: string[] = [];
  const bus = new EventBus(() => {});
  bus.on("playout.on-air-changed", ({ status }) => events.push(status.current?.title ?? "none"));
  const cache = new MemoryCache();
  const service = new PlayoutService({
    playoutState: port,
    nowCache: cache,
    bus,
    logger: silentLogger,
  });
  return { service, cache, events };
}

describe("PlayoutService.getNow", () => {
  test("fresh fetch: caches, returns non-stale, emits on first observation only while unchanged", async () => {
    const port = new FakePort(ok(snapshot("Track A")));
    const { service, cache, events } = build(port);

    const first = unwrap(await service.getNow(oz));
    expect(first.stale).toBe(false);
    expect((await cache.load(oz))?.current?.title).toBe("Track A");
    expect(events).toEqual(["Track A"]);

    // Same on-air state on the next poll: no new event.
    await service.getNow(oz);
    expect(events).toEqual(["Track A"]);

    // A real transition emits again.
    port.result = ok(snapshot("Track B"));
    await service.getNow(oz);
    expect(events).toEqual(["Track A", "Track B"]);
  });

  test("upstream down with cache: serves last-known state marked stale", async () => {
    const port = new FakePort(ok(snapshot("Track A")));
    const { service } = build(port);
    await service.getNow(oz);

    port.result = err(DomainError.upstreamUnavailable("down"));
    const degraded = unwrap(await service.getNow(oz));
    expect(degraded.stale).toBe(true);
    expect(degraded.current?.title).toBe("Track A");
  });

  test("upstream down with no cache: the failure surfaces", async () => {
    const port = new FakePort(err(DomainError.upstreamUnavailable("down")));
    const { service } = build(port);
    const result = await service.getNow(oz);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("upstream-unavailable");
  });
});
