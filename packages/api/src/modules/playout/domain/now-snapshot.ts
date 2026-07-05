/**
 * What the playout system reports as happening on air, in OndeStudio's own
 * vocabulary. Adapters translate upstream shapes (AzuraCast today) into this —
 * nothing above the adapter ever sees an upstream payload (docs/2 §3.1).
 */
export interface NowSnapshot {
  live: LiveState;
  current: SnapshotTrack | null;
  next: SnapshotTrack | null;
  /** When the observation was made. */
  observedAt: Date;
}

export interface LiveState {
  isLive: boolean;
  streamerName: string | null;
}

export interface SnapshotTrack {
  title: string;
  artist: string | null;
  playlist: string | null;
  startedAt: Date | null;
  durationSec: number | null;
}
