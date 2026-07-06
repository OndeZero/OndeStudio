/**
 * Events this module emits (docs/2 §3.4). Every board mutation — create,
 * update, comment, vote, read-mark, promote — emits `card-changed`; the
 * payload is a coarse refetch hint (station + card), never data. Read-marks
 * are included on purpose: one uniform rule, and a refetch is cheap for a
 * small team's board — revisit if it ever gets noisy.
 *
 * `notified` fires whenever a user's inbox changes (new notification, read,
 * read-all). It exists for a future user-scoped push channel (badge updates
 * across tabs); nothing subscribes yet — app.ts will, when the SSE surface
 * grows a per-user lane.
 */
export interface CardChangedDomainEvent {
  station: string;
  cardId: number;
}

export interface NotifiedDomainEvent {
  userId: number;
}

declare module "../../kernel/event-bus" {
  interface DomainEvents {
    "collaboration.card-changed": CardChangedDomainEvent;
    "collaboration.notified": NotifiedDomainEvent;
  }
}
