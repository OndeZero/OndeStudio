import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";

/**
 * What scheduling requires from outside (docs/2 §3.2). In Increment 1 the
 * grid *mirrors* playout reality read-only (docs/2 §2.5); the playout module
 * provides the implementation, wired in app.ts.
 */

/** One already-scheduled block living in the playout system, expanded to concrete times. */
export interface MirrorBlock {
  source: "playlist" | "streamer";
  /** `band` = cadence-window insert rules ([MIXS]-style `once_per_x_minutes`) — thin overlay, not a slot (PD §4.8). */
  mode: "block" | "band";
  label: string;
  startsAtUtc: Date;
  endsAtUtc: Date;
}

/** Read-only view of the playout system's own schedule over a UTC window. */
export interface MirrorSchedulePort {
  fetchBlocks(
    station: StationId,
    windowFromUtc: Date,
    windowToUtc: Date,
  ): Promise<Result<MirrorBlock[], DomainError>>;
}
