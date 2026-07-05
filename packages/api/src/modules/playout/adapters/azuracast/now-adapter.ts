import { type Clock, systemClock } from "../../../../kernel/clock";
import type { DomainError } from "../../../../kernel/domain-error";
import { ok, type Result } from "../../../../kernel/result";
import type { StationId } from "../../../../kernel/station-id";
import type { NowSnapshot, SnapshotTrack } from "../../domain/now-snapshot";
import type { PlayoutStatePort } from "../../ports";
import type { AzuracastClient } from "./client";
import type { AzNowPlayingResponse, AzQueuedSong } from "./types";

/**
 * Phase-1 PlayoutStatePort over AzuraCast's `/api/nowplaying/{station}`
 * (docs/2 §7.3). Polled by the ingest loop; the AzuraCast SSE feed is a
 * planned upgrade (ADR-0011).
 */
export class AzuracastPlayoutStateAdapter implements PlayoutStatePort {
  constructor(
    private readonly client: AzuracastClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async fetchNow(station: StationId): Promise<Result<NowSnapshot, DomainError>> {
    const response = await this.client.getJson<AzNowPlayingResponse>(
      `/api/nowplaying/${station.value}`,
    );
    if (!response.ok) return response;
    return ok(this.toSnapshot(response.value));
  }

  private toSnapshot(az: AzNowPlayingResponse): NowSnapshot {
    return {
      live: {
        isLive: az.live.is_live,
        // AzuraCast reports "" when nobody is live.
        streamerName: az.live.streamer_name || null,
      },
      current: toTrack(az.now_playing),
      next: toTrack(az.playing_next),
      observedAt: this.clock.now(),
    };
  }
}

function toTrack(az: AzQueuedSong | null): SnapshotTrack | null {
  if (!az?.song) return null;
  return {
    title: az.song.title || az.song.text || "unknown",
    artist: az.song.artist || null,
    playlist: az.playlist || null,
    startedAt: az.played_at > 0 ? new Date(az.played_at * 1000) : null,
    // 0 means "untimed" (live input) — absence, not a zero-length track.
    // AzuraCast reports fractional seconds (e.g. 134.60898); the contract speaks whole seconds.
    durationSec: az.duration > 0 ? Math.round(az.duration) : null,
  };
}
