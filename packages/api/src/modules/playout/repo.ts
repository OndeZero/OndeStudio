import { eq } from "drizzle-orm";
import type { StationId } from "../../kernel/station-id";
import type { Db } from "../../platform/db";
import type { LiveState, SnapshotTrack } from "./domain/now-snapshot";
import { OnAirStatus } from "./domain/on-air-status";
import { acNowCache } from "./schema";

/** Last-known on-air state per station, so /now can degrade instead of failing. */
export interface NowCacheRepo {
  save(status: OnAirStatus): Promise<void>;
  load(station: StationId): Promise<OnAirStatus | null>;
}

/** JSON shape stored in ac_now_cache.payload_json — dates as ISO strings. */
interface CachePayload {
  live: LiveState;
  current: SerializedTrack | null;
  next: SerializedTrack | null;
}

interface SerializedTrack {
  title: string;
  artist: string | null;
  playlist: string | null;
  startedAt: string | null;
  durationSec: number | null;
}

export class DrizzleNowCacheRepo implements NowCacheRepo {
  constructor(private readonly db: Db) {}

  async save(status: OnAirStatus): Promise<void> {
    const payload: CachePayload = {
      live: status.live,
      current: serializeTrack(status.current),
      next: serializeTrack(status.next),
    };
    const row = {
      stationId: status.station,
      payloadJson: JSON.stringify(payload),
      observedAt: status.observedAt.toISOString(),
    };
    await this.db
      .insert(acNowCache)
      .values(row)
      .onConflictDoUpdate({ target: acNowCache.stationId, set: row });
  }

  async load(station: StationId): Promise<OnAirStatus | null> {
    const rows = await this.db
      .select()
      .from(acNowCache)
      .where(eq(acNowCache.stationId, station.value))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const payload = JSON.parse(row.payloadJson) as CachePayload;
    return OnAirStatus.rehydrate({
      station: row.stationId,
      live: payload.live,
      current: deserializeTrack(payload.current),
      next: deserializeTrack(payload.next),
      observedAt: new Date(row.observedAt),
    });
  }
}

function serializeTrack(track: SnapshotTrack | null): SerializedTrack | null {
  if (!track) return null;
  return { ...track, startedAt: track.startedAt ? track.startedAt.toISOString() : null };
}

function deserializeTrack(track: SerializedTrack | null): SnapshotTrack | null {
  if (!track) return null;
  return { ...track, startedAt: track.startedAt ? new Date(track.startedAt) : null };
}
