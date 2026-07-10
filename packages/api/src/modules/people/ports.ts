import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";

/**
 * What people requires from outside (docs/2 §3.5 IdentityPort, M2 subset):
 * account seeding from the playout system's user directory. Broadcaster
 * credential verification (verifyBroadcaster) joins in M4.
 */
export interface AccountSeed {
  /** Stable upstream id, kept as the az_account_ref. */
  ref: string;
  email: string;
  displayName: string;
}

export interface AccountDirectoryPort {
  fetchAccounts(): Promise<Result<AccountSeed[], DomainError>>;
}

/**
 * Streamer accounts on the playout system — the write half of IdentityPort
 * (docs/2 §3.5), M4's fan-out surface. The adapter enforces docs/2 §7.7 on
 * top of the composition root's config: writes reach ONLY allowed stations.
 */
/** A weekly airtime window (HHMM ints, weekday array) — mirrors the grid slot. */
export interface StreamerScheduleItem {
  startTime: number;
  endTime: number;
  days: number[];
}

export interface StreamerDef {
  username: string;
  /** Present on create/rotate only — never read back from upstream. */
  password?: string;
  displayName: string;
  /** Free text; carries the `[ondestudio:broadcaster:<id>]` marker (docs/2 §3.7). */
  comments: string;
  isActive: boolean;
  enforceSchedule: boolean;
  /**
   * Weekly airtime from the grid's validated live slots (PD §5.10). Whether it
   * actually restricts the streamer is `enforceSchedule` — a per-broadcaster
   * choice (internal accounts stay open; external ones are enforced).
   */
  scheduleItems?: StreamerScheduleItem[];
}

export interface StreamerRecord {
  ref: string;
  username: string;
  displayName: string;
  isActive: boolean;
  enforceSchedule: boolean;
  comments: string;
}

export interface StreamerDirectoryPort {
  list(station: StationId): Promise<Result<StreamerRecord[], DomainError>>;
  create(station: StationId, def: StreamerDef): Promise<Result<{ ref: string }, DomainError>>;
  update(
    station: StationId,
    ref: string,
    def: Partial<StreamerDef>,
  ): Promise<Result<void, DomainError>>;
  remove(station: StationId, ref: string): Promise<Result<void, DomainError>>;
}
