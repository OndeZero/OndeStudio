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

/** One media file in a show's drop folder — the raw material of an episode (ADR-0013). */
export interface FolderFile {
  azFileId: string;
  path: string;
  title: string;
  artist: string | null;
  durationSec: number | null;
}

/**
 * Reads the files in a show's drop folder (PD §4.5) so the episode queue can
 * form itself. Implemented by the composition root over the content module's
 * media store — scheduling never imports content at runtime.
 */
export interface MediaScanPort {
  listFolderFiles(
    station: StationId,
    folderPath: string,
  ): Promise<Result<FolderFile[], DomainError>>;
}
