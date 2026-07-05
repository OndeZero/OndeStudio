import { describe, expect, test } from "bun:test";
import { OnAirSchema } from "@ondestudio/shared";
import { DomainError } from "../../kernel/domain-error";
import { EventBus } from "../../kernel/event-bus";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import { createApiApp } from "../../platform/http";
import { silentLogger } from "../../platform/logger";
import type { NowSnapshot } from "./domain/now-snapshot";
import type { OnAirStatus } from "./domain/on-air-status";
import type { PlayoutStatePort } from "./ports";
import type { NowCacheRepo } from "./repo";
import { createPlayoutRoutes } from "./routes";
import { PlayoutService } from "./service";

/**
 * The walking-skeleton proof at HTTP level (docs/2 §11 M0): request → route →
 * service → domain → (fake) adapter → response, validated against the shared
 * contract.
 */
function appWith(portResult: Result<NowSnapshot, DomainError>) {
  const port: PlayoutStatePort = { fetchNow: () => Promise.resolve(portResult) };
  const cache: NowCacheRepo = {
    save: () => Promise.resolve(),
    load: (_station: StationId) => Promise.resolve(null),
  };
  const service = new PlayoutService({
    playoutState: port,
    nowCache: cache,
    bus: new EventBus(() => {}),
    logger: silentLogger,
  });
  const app = createApiApp(silentLogger);
  app.route("/", createPlayoutRoutes(service));
  return app;
}

const snapshot: NowSnapshot = {
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
};

describe("GET /stations/{station}/now", () => {
  test("200: returns a contract-valid OnAir payload", async () => {
    const response = await appWith(ok(snapshot)).request("/stations/oz/now");
    expect(response.status).toBe(200);
    const parsed = OnAirSchema.parse(await response.json());
    expect(parsed.station).toBe("oz");
    expect(parsed.current?.title).toBe("Track A");
    expect(parsed.stale).toBe(false);
  });

  test("422: invalid station shortcode is rejected with the uniform envelope", async () => {
    const response = await appWith(ok(snapshot)).request("/stations/OZ!/now");
    expect(response.status).toBe(422);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBeString();
  });

  test("503: upstream down with no cache surfaces as upstream-unavailable", async () => {
    const response = await appWith(err(DomainError.upstreamUnavailable("down"))).request(
      "/stations/oz/now",
    );
    expect(response.status).toBe(503);
    const body = (await response.json()) as { kind: string };
    expect(body.kind).toBe("upstream-unavailable");
  });

  test("404: unknown paths get the uniform not-found envelope", async () => {
    const response = await appWith(ok(snapshot)).request("/nope");
    expect(response.status).toBe(404);
  });
});
