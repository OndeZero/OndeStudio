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
  schedule_items: AzScheduleItem[];
}
interface AzFileRow {
  id: number;
  playlists: { id: number }[];
}

/**
 * Playlist write adapter (M3, RFC 0001) — the schedule-block half of
 * `PlayoutWritePort`. Two safety layers like the streamer adapter: the
 * composition root only wires allowed stations, and this adapter refuses the
 * rest itself (docs/2 §7.7). Projected playlists are OS-created (no folder
 * auto-fill), so OndeStudio owns their membership fully.
 */
export class AzuracastPlaylistAdapter implements PlayoutWritePort {
  constructor(
    private readonly client: AzuracastClient,
    private readonly allowedWriteStations: StationId[],
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
   * Ensure these media files belong to the playlist (additive — the file PUT
   * replaces a file's full membership, so we read-merge-write each one). Exact
   * membership with pruning lands with the episode queue; M3 assigns the single
   * deterministic episode when one exists (PD §4.11).
   */
  async setBlockMedia(
    station: StationId,
    ref: string,
    mediaIds: string[],
  ): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const playlistId = Number(ref);
    for (const mediaId of mediaIds) {
      const file = await this.client.getJson<AzFileRow>(
        `/api/station/${station.value}/file/${mediaId}`,
      );
      if (!file.ok) return file;
      const membership = new Set(file.value.playlists.map((p) => p.id));
      if (membership.has(playlistId)) continue;
      membership.add(playlistId);
      const put = await this.client.sendJson<unknown>(
        "PUT",
        `/api/station/${station.value}/file/${mediaId}`,
        { playlists: [...membership].map((id) => ({ id })) },
      );
      if (!put.ok) return put;
    }
    return ok(undefined);
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
      // Membership drift is out of M3 scope (no episode assignment yet).
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
