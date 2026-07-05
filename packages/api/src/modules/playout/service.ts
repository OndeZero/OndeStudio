import type { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import type { Logger } from "../../kernel/logger";
import { ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import { OnAirStatus } from "./domain/on-air-status";
import type { PlayoutStatePort } from "./ports";
import type { NowCacheRepo } from "./repo";
import "./events";

/**
 * Use-cases around playout state (docs/2 §4.1: orchestration only — the rules
 * live in the domain objects and behind the ports).
 */
export class PlayoutService {
  /** Last observation per station, for transition detection across poll ticks. */
  private readonly lastSeen = new Map<string, OnAirStatus>();

  constructor(
    private readonly deps: {
      playoutState: PlayoutStatePort;
      nowCache: NowCacheRepo;
      bus: EventBus;
      logger: Logger;
    },
  ) {}

  /**
   * Live-first, cache-degraded read of what's on air — the M0 vertical slice
   * (docs/2 §11). A fresh observation is cached and change-detected; when the
   * upstream is unreachable we serve the last-known state marked `stale`.
   */
  async getNow(station: StationId): Promise<Result<OnAirStatus, DomainError>> {
    const fetched = await this.deps.playoutState.fetchNow(station);
    if (fetched.ok) {
      const status = OnAirStatus.fromSnapshot(station, fetched.value);
      await this.deps.nowCache.save(status);
      this.notifyIfChanged(status);
      return ok(status);
    }

    const cached = await this.deps.nowCache.load(station);
    if (cached) {
      this.deps.logger.warn("serving stale on-air state", {
        station: station.value,
        reason: fetched.error.message,
      });
      return ok(cached.staleCopy());
    }
    return fetched;
  }

  /** One ingest tick — the poll loop calls this; fan-out happens via the bus. */
  async refreshNow(station: StationId): Promise<void> {
    const result = await this.getNow(station);
    if (!result.ok) {
      this.deps.logger.warn("on-air refresh failed", {
        station: station.value,
        error: result.error.message,
      });
    }
  }

  private notifyIfChanged(status: OnAirStatus): void {
    const previous = this.lastSeen.get(status.station);
    this.lastSeen.set(status.station, status);
    if (previous?.sameOnAirAs(status)) return;
    this.deps.bus.emit("playout.on-air-changed", { station: status.station, status });
  }
}
