import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import type { NowSnapshot } from "./domain/now-snapshot";

/**
 * The phase-2 seam (docs/2 §3.5): capabilities the PD moves in-house sit
 * behind these interfaces; phase 1 backs them with AzuraCast adapters, phase 2
 * swaps the implementation without touching anything above.
 *
 * Only the port the walking skeleton needs exists yet. The others join at
 * their milestones, not speculatively (docs/2 §2.4): PlayoutPort (write-back,
 * M3) · MediaStorePort (M2) · IdentityPort (M4).
 */

/** Read-only view of playout reality — AzuraCast-owned data, never written (PD §6). */
export interface PlayoutStatePort {
  fetchNow(station: StationId): Promise<Result<NowSnapshot, DomainError>>;
}

/** One scheduled airing window on a playout object — DST-naive HHMM local time (RFC 0001). */
export interface ScheduleItem {
  startTime: number;
  endTime: number;
  days: number[];
}

/** A schedule block OndeStudio maintains in AzuraCast: a tagged playlist + its items. */
export interface ScheduleBlock {
  /** Playlist display name (carries no meaning to us beyond legibility). */
  name: string;
  /** Free-text marker written into `description` so drift can recognize what we own (§3.7). */
  tagMarker: string;
  scheduleItems: ScheduleItem[];
}

/** What the driver last observed of a projected AzuraCast object — the drift comparison basis. */
export interface ScheduleBlockSnapshot {
  name: string;
  isEnabled: boolean;
  scheduleItems: ScheduleItem[];
  /** Media file ids currently in the playlist (membership we own for projected objects). */
  mediaIds: string[];
}

/**
 * The write half of the phase-2 seam (docs/2 §3.5, M3): drive AzuraCast's
 * management API. Every method is a single attempt (no blind retry — a
 * timed-out create must not duplicate) and refuses stations outside the
 * configured write set (docs/2 §7.7) — the composition root gates it too.
 */
export interface PlayoutWritePort {
  /** Create the tagged playlist + schedule_items; returns its AzuraCast id. */
  createScheduleBlock(
    station: StationId,
    block: ScheduleBlock,
  ): Promise<Result<{ ref: string }, DomainError>>;
  updateScheduleBlock(
    station: StationId,
    ref: string,
    block: ScheduleBlock,
  ): Promise<Result<void, DomainError>>;
  removeScheduleBlock(station: StationId, ref: string): Promise<Result<void, DomainError>>;
  /** Deterministic episode selection: set the playlist's exact media membership (PD §4.11). */
  setBlockMedia(
    station: StationId,
    ref: string,
    mediaIds: string[],
  ): Promise<Result<void, DomainError>>;
  /** Read one projected object back for drift detection; null when it was deleted upstream. */
  readScheduleBlock(
    station: StationId,
    ref: string,
  ): Promise<Result<ScheduleBlockSnapshot | null, DomainError>>;
  /**
   * Every OndeStudio-tagged block upstream, keyed by its marker (RFC 0001
   * step 1 — observe by marker). This is what makes create idempotent: a
   * timed-out create that actually landed is re-adopted here instead of
   * duplicated. One list call per reconcile also replaces N per-row readbacks.
   */
  listTaggedBlocks(
    station: StationId,
  ): Promise<
    Result<{ ref: string; marker: string; snapshot: ScheduleBlockSnapshot }[], DomainError>
  >;
}

/** A slot the driver should maintain in AzuraCast, already resolved to its block shape. */
export interface ProjectableSlot {
  slotId: number;
  title: string;
  /** Playlist display name (tagged separately via the marker). */
  name: string;
  scheduleItems: ScheduleItem[];
  /** Deterministic episode media (PD §4.11) — empty until the episode queue lands. */
  mediaIds: string[];
}

/**
 * The driver's read of the desired state (RFC 0001): validated weekly
 * show/series/echo slots for a station. Implemented by the composition root
 * over `SchedulingService` — playout never imports scheduling at runtime.
 */
export interface SlotSourcePort {
  listProjectable(station: StationId): Promise<Result<ProjectableSlot[], DomainError>>;
}

/**
 * Absorbing a manual AzuraCast edit back onto the OndeStudio slot
 * (`keep-azuracast` resolution, PD §6). Implemented over `SchedulingService`.
 */
export interface SlotSinkPort {
  applyScheduleFromAzuracast(
    station: StationId,
    slotId: number,
    schedule: { weekdays: number[]; time: string; durationMin: number },
  ): Promise<Result<void, DomainError>>;
  /**
   * Accepting a manual AzuraCast *deletion* of a projected slot (the
   * `keep-azuracast` resolution on a delete): un-validate the slot so the
   * driver stops projecting it — it stays on the grid as a hold, not on air.
   */
  retractSlot(station: StationId, slotId: number): Promise<Result<void, DomainError>>;
}
