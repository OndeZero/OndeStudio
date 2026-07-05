/**
 * Events this module emits (docs/2 §3.4). app.ts fans `grid-changed` out to
 * the `grid` SSE channel; later modules (collaboration notifications, playout
 * write-back) subscribe here without scheduling knowing them.
 */
export interface GridChangedDomainEvent {
  station: string;
  reason: "slot-created" | "slot-updated" | "slot-deleted" | "occurrence-patched";
}

declare module "../../kernel/event-bus" {
  interface DomainEvents {
    "scheduling.grid-changed": GridChangedDomainEvent;
  }
}
