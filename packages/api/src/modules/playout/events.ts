import type { OnAirStatus } from "./domain/on-air-status";

/**
 * Events this module emits (docs/2 §3.4). Reactions subscribe in app.ts or in
 * their own module's events.ts — the emitter never knows its consumers.
 */
export interface OnAirChangedEvent {
  station: string;
  status: OnAirStatus;
}

declare module "../../kernel/event-bus" {
  interface DomainEvents {
    /** Fired on genuine on-air transitions (not on every poll tick). */
    "playout.on-air-changed": OnAirChangedEvent;
  }
}
