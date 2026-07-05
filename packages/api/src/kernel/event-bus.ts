/**
 * Typed, synchronous, in-process domain-event bus (docs/2 §3.4) — the seam
 * where cross-cutting reactions live without coupling the modules that cause
 * them. No broker, no async infra: the simplest thing that works (invariant 6).
 *
 * Each module registers its events from its `events.ts` via declaration
 * merging:
 *
 *   declare module "../../kernel/event-bus" {
 *     interface DomainEvents { "playout.on-air-changed": OnAirChangedEvent }
 *   }
 */
// biome-ignore lint/suspicious/noEmptyInterface: extended by each module's events.ts
export interface DomainEvents {}

export type DomainEventName = keyof DomainEvents & string;

type Handler<K extends DomainEventName> = (payload: DomainEvents[K]) => void;

export class EventBus {
  private readonly handlers = new Map<string, Set<(payload: never) => void>>();

  /** `onHandlerError` keeps a failing subscriber from breaking the action that emitted. */
  constructor(private readonly onHandlerError: (event: string, error: unknown) => void) {}

  on<K extends DomainEventName>(event: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(event);
    if (!set) {
      set = new Set();
      this.handlers.set(event, set);
    }
    const entry = handler as (payload: never) => void;
    set.add(entry);
    return () => set.delete(entry);
  }

  emit<K extends DomainEventName>(event: K, payload: DomainEvents[K]): void {
    const set = this.handlers.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        (handler as Handler<K>)(payload);
      } catch (error) {
        this.onHandlerError(event, error);
      }
    }
  }
}
