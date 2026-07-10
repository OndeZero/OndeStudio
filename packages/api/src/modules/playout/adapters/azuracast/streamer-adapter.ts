import { DomainError } from "../../../../kernel/domain-error";
import { err, ok, type Result } from "../../../../kernel/result";
import type { StationId } from "../../../../kernel/station-id";
// Cross-module import through people's public index only (docs/2 §3.4); type-only.
import type { StreamerDef, StreamerDirectoryPort, StreamerRecord } from "../../../people";
import type { AzuracastClient } from "./client";

/** Subset of /api/station/{station}/streamer(s) this adapter reads/writes ([AUDIT]). */
interface AzStreamerRow {
  id: number;
  streamer_username: string;
  display_name: string | null;
  is_active: boolean;
  enforce_schedule: boolean;
  comments: string | null;
}

/**
 * The FIRST write adapter (docs/2 §11 M4). Two safety layers, on purpose:
 * the composition root only wires allowed stations, and this adapter refuses
 * anything else itself — defense in depth around docs/2 §7.7 ("never against
 * `oz` until the per-feature adoption step says so").
 */
export class AzuracastStreamerAdapter implements StreamerDirectoryPort {
  constructor(
    private readonly client: AzuracastClient,
    /** Stations writes may reach (config AZURACAST_WRITE_STATIONS). Reads are unrestricted. */
    private readonly allowedWriteStations: StationId[],
  ) {}

  async list(station: StationId): Promise<Result<StreamerRecord[], DomainError>> {
    const response = await this.client.getJson<AzStreamerRow[]>(
      `/api/station/${station.value}/streamers`,
    );
    if (!response.ok) return response;
    return ok(response.value.map(toRecord));
  }

  async create(
    station: StationId,
    def: StreamerDef,
  ): Promise<Result<{ ref: string }, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<AzStreamerRow>(
      "POST",
      `/api/station/${station.value}/streamers`,
      toPayload(def),
    );
    if (!response.ok) return response;
    return ok({ ref: String(response.value.id) });
  }

  async update(
    station: StationId,
    ref: string,
    def: Partial<StreamerDef>,
  ): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<unknown>(
      "PUT",
      `/api/station/${station.value}/streamer/${ref}`,
      toPayload(def),
    );
    return response.ok ? ok(undefined) : response;
  }

  async remove(station: StationId, ref: string): Promise<Result<void, DomainError>> {
    const guard = this.guardWrite(station);
    if (guard) return err(guard);
    const response = await this.client.sendJson<unknown>(
      "DELETE",
      `/api/station/${station.value}/streamer/${ref}`,
    );
    return response.ok ? ok(undefined) : response;
  }

  private guardWrite(station: StationId): DomainError | null {
    if (this.allowedWriteStations.some((allowed) => allowed.equals(station))) return null;
    return DomainError.conflict(
      `writes to station "${station.value}" are blocked (docs/2 §7.7 — adoption pending)`,
    );
  }
}

function toRecord(row: AzStreamerRow): StreamerRecord {
  return {
    ref: String(row.id),
    username: row.streamer_username,
    displayName: row.display_name?.trim() || row.streamer_username,
    isActive: row.is_active,
    enforceSchedule: row.enforce_schedule,
    comments: row.comments ?? "",
  };
}

function toPayload(def: Partial<StreamerDef>): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (def.username !== undefined) payload.streamer_username = def.username;
  if (def.password !== undefined) payload.streamer_password = def.password;
  if (def.displayName !== undefined) payload.display_name = def.displayName;
  if (def.comments !== undefined) payload.comments = def.comments;
  if (def.isActive !== undefined) payload.is_active = def.isActive;
  if (def.enforceSchedule !== undefined) payload.enforce_schedule = def.enforceSchedule;
  if (def.scheduleItems !== undefined) {
    payload.schedule_items = def.scheduleItems.map((item) => ({
      start_time: item.startTime,
      end_time: item.endTime,
      days: item.days,
    }));
  }
  return payload;
}
