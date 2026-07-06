/**
 * Events this module emits (docs/2 §3.4). app.ts fans `grid-changed` out to
 * the `grid` SSE channel; later modules (collaboration notifications, playout
 * write-back) subscribe here without scheduling knowing them.
 */
export interface GridChangedDomainEvent {
  station: string;
  /** `show-updated` = a rename repainted the titles slots fall back to. */
  reason: "slot-created" | "slot-updated" | "slot-deleted" | "occurrence-patched" | "show-updated";
}

declare module "../../kernel/event-bus" {
  interface DomainEvents {
    "scheduling.grid-changed": GridChangedDomainEvent;
  }
}
