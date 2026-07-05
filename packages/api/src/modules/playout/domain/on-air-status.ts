import type { StationId } from "../../../kernel/station-id";
import type { LiveState, NowSnapshot, SnapshotTrack } from "./now-snapshot";

/**
 * The on-air state of one station as the domain sees it. Built from a live
 * playout snapshot — or rehydrated from cache and marked `stale` when the
 * playout link is down: the overlay degrades, air does not (invariant 1).
 */
export class OnAirStatus {
  private constructor(
    readonly station: string,
    readonly live: LiveState,
    readonly current: SnapshotTrack | null,
    readonly next: SnapshotTrack | null,
    readonly observedAt: Date,
    readonly stale: boolean,
  ) {}

  static fromSnapshot(station: StationId, snapshot: NowSnapshot): OnAirStatus {
    return new OnAirStatus(
      station.value,
      snapshot.live,
      snapshot.current,
      snapshot.next,
      snapshot.observedAt,
      false,
    );
  }

  /** Used by the repository mapper only — carries persisted state back to life. */
  static rehydrate(props: {
    station: string;
    live: LiveState;
    current: SnapshotTrack | null;
    next: SnapshotTrack | null;
    observedAt: Date;
  }): OnAirStatus {
    return new OnAirStatus(
      props.station,
      props.live,
      props.current,
      props.next,
      props.observedAt,
      false,
    );
  }

  staleCopy(): OnAirStatus {
    return new OnAirStatus(this.station, this.live, this.current, this.next, this.observedAt, true);
  }

  /**
   * Same broadcast moment? Drives change detection: the on-air-changed event
   * (and thus SSE pushes) fires only on real transitions, not on every poll.
   */
  sameOnAirAs(other: OnAirStatus): boolean {
    return (
      this.live.isLive === other.live.isLive &&
      this.live.streamerName === other.live.streamerName &&
      (this.current?.title ?? null) === (other.current?.title ?? null) &&
      (this.current?.artist ?? null) === (other.current?.artist ?? null) &&
      (this.current?.startedAt?.getTime() ?? null) === (other.current?.startedAt?.getTime() ?? null)
    );
  }
}
