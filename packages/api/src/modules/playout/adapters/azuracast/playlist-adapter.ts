import { type Clock, systemClock } from "../../../../kernel/clock";
import { DomainError } from "../../../../kernel/domain-error";
import { err, ok, type Result } from "../../../../kernel/result";
import type { StationId } from "../../../../kernel/station-id";
import type {
  PlayoutWritePort,
  ScheduleBlock,
  ScheduleBlockSnapshot,
  ScheduleItem,
} from "../../ports";
import type { AzuracastClient } from "./client";

/** Subset of the AzuraCast playlist object ([AUDIT]) this adapter reads/writes. */
interface AzScheduleItem {
  start_time: number;
  end_time: number;
  days: number[];
}
interface AzPlaylistRow {
  id: number;
  name: string;
  is_enabled: boolean;
  description?: string | null;
  schedule_items: AzScheduleItem[];
}
interface AzFileRow {
  id: number;
  playlists: { id: number }[];
}

/** Per-file playlist membership, cached briefly so one reconcile pass fetches once. */
interface CachedMembership {
  byFile: Map<number, Set<number>>;
  atMs: number;
}

/**
 * Membership changes at human speed and each reconcile pass runs synchronously;
 * a short window lets every `setBlockMedia` in one pass share a single files
 * read. Any write invalidates it, so it never serves state we just changed.
 */
const MEMBERSHIP_TTL_MS = 5_000;

/**
 * Playlist write adapter (M3, RFC 0001) — the schedule-block half of
 * `PlayoutWritePort`. Two safety layers like the streamer adapter: the
 * composition root only wires allowed stations, and this adapter refuses the
 * rest itself (docs/2 §7.7). Projected playlists are OS-created (no folder
 * auto-fill), so OndeStudio owns their membership fully.
 */
export class AzuracastPlaylistAdapter implements PlayoutWritePort {
  private readonly membershipCache = new Map<string, CachedMembership>();

  constructor(
    private readonly client: AzuracastClient,
    private readonly allowedWriteStations: StationId[],
    private readonly clock: Clock = systemClock,
  ) {}

  async createScheduleBlock(
    station: StationId,
    block: ScheduleBlock,
  ): Promise<Result<{ ref: string }, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<AzPlaylistRow>(
      "POST",
      `/api/station/${station.value}/playlists`,
      {
        name: block.name,
        type: "default",
        source: "songs",
        order: "sequential",
        is_enabled: true,
        // The ownership marker (§3.7) lives in the free-text description.
        description: block.tagMarker,
        schedule_items: block.scheduleItems.map(toAzItem),
      },
    );
    if (!response.ok) return response;
    return ok({ ref: String(response.value.id) });
  }

  async updateScheduleBlock(
    station: StationId,
    ref: string,
    block: ScheduleBlock,
  ): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<unknown>(
      "PUT",
      `/api/station/${station.value}/playlist/${ref}`,
      {
        name: block.name,
        is_enabled: true,
        description: block.tagMarker,
        schedule_items: block.scheduleItems.map(toAzItem),
      },
    );
    return response.ok ? ok(undefined) : response;
  }

  async removeScheduleBlock(station: StationId, ref: string): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<unknown>(
      "DELETE",
      `/api/station/${station.value}/playlist/${ref}`,
    );
    return response.ok ? ok(undefined) : response;
  }

  /**
   * Make the playlist's membership EXACTLY `mediaIds` (episode queue, PD §4.11 /
   * ADR-0013): the deterministic episode of each slot's current occurrence, and
   * nothing else. Prunes files that left and adds the ones that arrived; a file
   * PUT replaces the file's full playlist set, so we edit around the other
   * memberships we already know. Idempotent — zero writes when already exact.
   *
   * Projected playlists are OS-owned content, so this simply asserts the queue's
   * truth; it is enforced on every reconcile rather than routed through the
   * drift workflow (which stays scoped to schedule/name edits).
   */
  async setBlockMedia(
    station: StationId,
    ref: string,
    mediaIds: string[],
  ): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const playlistId = Number(ref);

    const membership = await this.membershipByFile(station);
    if (!membership.ok) return membership;
    const byFile = membership.value;

    // A desired file that no longer exists upstream can't be assigned — skip it
    // (the drop-folder rescan drops its episode row on the next pass).
    const desired = new Set(mediaIds.map(Number).filter((id) => byFile.has(id)));
    const current = new Set<number>();
    for (const [fileId, playlists] of byFile) if (playlists.has(playlistId)) current.add(fileId);

    const toAdd = [...desired].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !desired.has(id));
    if (toAdd.length === 0 && toRemove.length === 0) return ok(undefined);

    for (const fileId of toRemove) {
      const next = new Set(byFile.get(fileId) ?? []);
      next.delete(playlistId);
      const put = await this.putFilePlaylists(station, fileId, next);
      if (!put.ok) return put;
    }
    for (const fileId of toAdd) {
      const next = new Set(byFile.get(fileId) ?? []);
      next.add(playlistId);
      const put = await this.putFilePlaylists(station, fileId, next);
      if (!put.ok) return put;
    }
    this.membershipCache.delete(station.value); // membership changed — force a fresh read
    return ok(undefined);
  }

  /** Per-file playlist membership for the station, cached for one reconcile pass. */
  private async membershipByFile(
    station: StationId,
  ): Promise<Result<Map<number, Set<number>>, DomainError>> {
    const nowMs = this.clock.now().getTime();
    const cached = this.membershipCache.get(station.value);
    if (cached && nowMs - cached.atMs < MEMBERSHIP_TTL_MS) return ok(cached.byFile);

    const response = await this.client.getJson<AzFileRow[]>(`/api/station/${station.value}/files`);
    if (!response.ok) return response;
    const byFile = new Map<number, Set<number>>();
    for (const file of response.value) {
      byFile.set(file.id, new Set(file.playlists.map((p) => p.id)));
    }
    this.membershipCache.set(station.value, { byFile, atMs: nowMs });
    return ok(byFile);
  }

  private async putFilePlaylists(
    station: StationId,
    fileId: number,
    playlistIds: Set<number>,
  ): Promise<Result<void, DomainError>> {
    const put = await this.client.sendJson<unknown>(
      "PUT",
      `/api/station/${station.value}/file/${fileId}`,
      { playlists: [...playlistIds].map((id) => ({ id })) },
    );
    return put.ok ? ok(undefined) : put;
  }

  async listTaggedBlocks(
    station: StationId,
  ): Promise<
    Result<{ ref: string; marker: string; snapshot: ScheduleBlockSnapshot }[], DomainError>
  > {
    const response = await this.client.getJson<AzPlaylistRow[]>(
      `/api/station/${station.value}/playlists`,
    );
    if (!response.ok) return response;
    const tagged: { ref: string; marker: string; snapshot: ScheduleBlockSnapshot }[] = [];
    for (const row of response.value) {
      const marker = extractMarker(row.description ?? "");
      if (!marker) continue;
      tagged.push({
        ref: String(row.id),
        marker,
        snapshot: {
          name: row.name,
          isEnabled: row.is_enabled,
          scheduleItems: row.schedule_items.map(fromAzItem),
          // Media isn't part of drift detection — the driver enforces episode
          // membership directly (setBlockMedia), so snapshots omit it.
          mediaIds: [],
        },
      });
    }
    return ok(tagged);
  }

  async readScheduleBlock(
    station: StationId,
    ref: string,
  ): Promise<Result<ScheduleBlockSnapshot | null, DomainError>> {
    const response = await this.client.getJson<AzPlaylistRow>(
      `/api/station/${station.value}/playlist/${ref}`,
    );
    if (!response.ok) {
      // Deleted upstream (manual removal) — a reconciliation signal, not an error.
      if (response.error.kind === "not-found") return ok(null);
      return response;
    }
    return ok({
      name: response.value.name,
      isEnabled: response.value.is_enabled,
      scheduleItems: response.value.schedule_items.map(fromAzItem),
      // Media isn't compared via snapshots — the driver enforces it directly.
      mediaIds: [],
    });
  }

  private guardWrite(station: StationId): DomainError | null {
    if (this.allowedWriteStations.some((allowed) => allowed.equals(station))) return null;
    return DomainError.conflict(
      `writes to station "${station.value}" are blocked (docs/2 §7.7 — adoption pending)`,
    );
  }
}

function toAzItem(item: ScheduleItem): AzScheduleItem {
  return { start_time: item.startTime, end_time: item.endTime, days: item.days };
}
function fromAzItem(item: AzScheduleItem): ScheduleItem {
  return { startTime: item.start_time, endTime: item.end_time, days: item.days ?? [] };
}

/** The first `[ondestudio:...]` marker in a free-text description, or null. */
function extractMarker(description: string): string | null {
  return description.match(/\[ondestudio:[^\]]*\]/)?.[0] ?? null;
}
