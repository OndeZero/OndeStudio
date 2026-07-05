import type { OnAir, OnAirTrack } from "@ondestudio/shared";
import type { SnapshotTrack } from "./domain/now-snapshot";
import type { OnAirStatus } from "./domain/on-air-status";

/**
 * Domain → wire contract, the "map out" step (docs/2 §3.2). The only place the
 * two shapes meet, used by both the HTTP route and the SSE fan-out.
 */
export function onAirToContract(status: OnAirStatus): OnAir {
  return {
    station: status.station,
    live: { isLive: status.live.isLive, streamerName: status.live.streamerName },
    current: trackToContract(status.current),
    next: trackToContract(status.next),
    observedAt: status.observedAt.toISOString(),
    stale: status.stale,
  };
}

function trackToContract(track: SnapshotTrack | null): OnAirTrack | null {
  if (!track) return null;
  return {
    title: track.title,
    artist: track.artist,
    playlist: track.playlist,
    startedAt: track.startedAt ? track.startedAt.toISOString() : null,
    durationSec: track.durationSec,
  };
}
