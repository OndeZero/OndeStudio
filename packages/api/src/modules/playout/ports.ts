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
