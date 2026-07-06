import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";

/**
 * What content requires from outside (docs/2 §3.2). Phase 1 browses the
 * playout system's canonical filetree read-only (PD §4.11 substrate):
 * MediaStorePort is implemented by the playout module's files adapter,
 * ShowOwnershipPort over scheduling's drop folders — both wired in app.ts.
 */

/** One file of the station media tree, as the playout system indexes it. */
export interface MediaFileRecord {
  /** Upstream file id, kept opaque (the future `media.az_file_id`, docs/2 §5.2). */
  azFileId: string;
  /** Path relative to the station media root, no leading slash. */
  path: string;
  /** Whole seconds; null = unscanned/untimed, absence not zero-length. */
  durationSec: number | null;
  title: string | null;
  artist: string | null;
}

/** The full flat file index of a station's media root. */
export interface MediaStorePort {
  listFiles(station: StationId): Promise<Result<MediaFileRecord[], DomainError>>;
}

/** A show's configured drop folder (PD §4.5) — the ownership badge source (PD §5.4). */
export interface OwnedFolder {
  showId: number;
  name: string;
  path: string;
}

export interface ShowOwnershipPort {
  ownedFolders(station: StationId): Promise<OwnedFolder[]>;
}
