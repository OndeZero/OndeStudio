import { type Clock, systemClock } from "../../../../kernel/clock";
import type { DomainError } from "../../../../kernel/domain-error";
import { ok, type Result } from "../../../../kernel/result";
import type { StationId } from "../../../../kernel/station-id";
// Cross-module import through content's public index only (docs/2 §3.4);
// type-only, so playout keeps zero runtime coupling to content.
import type { MediaFileRecord, MediaStorePort } from "../../../content";
import type { AzuracastClient } from "./client";

/**
 * Subset of `/api/station/{station}/files` this adapter reads. Adapter-private
 * (like directory-adapter's AzAdminUser): no other file speaks this shape, so
 * it stays out of types.ts.
 */
interface AzStationFile {
  id: number;
  path: string;
  /** Seconds, possibly fractional; 0 or absent when the scanner has no duration. */
  length?: number;
  title?: string | null;
  artist?: string | null;
  /** AzuraCast's combined "Artist - Title" display string. */
  text?: string | null;
}

/** Raw mapping cached per station, for the TTL check. */
interface CachedFiles {
  files: MediaFileRecord[];
  fetchedAtMs: number;
}

/**
 * The library changes at human speed (SFTP drops, manual moves) — 60 s keeps
 * browse navigation snappy without hammering AzuraCast on every directory
 * click; twice the structural freshness bar (docs/2 §7.3) is fine for a
 * read-only lens.
 */
const CACHE_TTL_MS = 60_000;

/**
 * Phase-1 MediaStorePort over AzuraCast's files API (PD §4.11 substrate):
 * the flat file index of a station's media root, one request per station per
 * TTL window. Content derives the browsable tree; AzuraCast shapes never
 * leave this folder (invariant 2).
 */
export class AzuracastFilesAdapter implements MediaStorePort {
  private readonly cache = new Map<string, CachedFiles>();

  constructor(
    private readonly client: AzuracastClient,
    private readonly clock: Clock = systemClock,
  ) {}

  async listFiles(station: StationId): Promise<Result<MediaFileRecord[], DomainError>> {
    const nowMs = this.clock.now().getTime();
    const cached = this.cache.get(station.value);
    if (cached && nowMs - cached.fetchedAtMs < CACHE_TTL_MS) return ok(cached.files);

    const response = await this.client.getJson<AzStationFile[]>(
      `/api/station/${station.value}/files`,
    );
    if (!response.ok) return response;

    const files = response.value.map(toRecord);
    this.cache.set(station.value, { files, fetchedAtMs: nowMs });
    return ok(files);
  }
}

/** Field conventions shared with now-adapter's toTrack: ""→null, title falls back to text. */
function toRecord(az: AzStationFile): MediaFileRecord {
  return {
    azFileId: String(az.id),
    path: az.path,
    // 0/absent means "not scanned/untimed" — absence, not a zero-length file.
    // AzuraCast reports fractional seconds; the record speaks whole seconds.
    durationSec: az.length && az.length > 0 ? Math.round(az.length) : null,
    title: az.title || az.text || null,
    artist: az.artist || null,
  };
}
