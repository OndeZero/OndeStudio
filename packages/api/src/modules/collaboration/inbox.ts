import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import { err, ok, type Result } from "../../kernel/result";
import type { CollaborationRepo, NotificationRecord } from "./repo";
import "./events";

const NOTIFICATIONS_CAP = 100;

/**
 * The in-app inbox (PD §5.12): a small set of high-value triggers, written by
 * card use-cases via push(). Module-internal — routes talk to
 * CollaborationService, which delegates here. Every inbox change emits
 * `collaboration.notified` so a future per-user push channel can update
 * badges without polling (events.ts).
 */
export class Inbox {
  constructor(
    private readonly repo: CollaborationRepo,
    private readonly bus: EventBus,
    private readonly clock: Clock,
  ) {}

  /**
   * Fan a card trigger out to userIds — callers exclude the actor themselves.
   * Takes the card (not just its id) so every notification records the
   * station: the inbox is user-scoped, so deep-links must say where to point.
   */
  async push(
    userIds: number[],
    content: { kind: string; message: string },
    card: { id: number; stationId: string },
    now: string,
  ): Promise<void> {
    for (const userId of userIds) {
      await this.repo.insertNotification({
        userId,
        kind: content.kind,
        message: content.message,
        anchorType: null, // reserved for non-card triggers (schema.ts)
        anchorId: null,
        stationId: card.stationId,
        cardId: card.id,
        createdAt: now,
      });
      this.notified(userId);
    }
  }

  /** Newest first, capped — an inbox, not an archive. */
  async list(userId: number): Promise<{ rows: NotificationRecord[]; unreadCount: number }> {
    const [rows, unreadCount] = await Promise.all([
      this.repo.listNotifications(userId, NOTIFICATIONS_CAP),
      this.repo.countUnreadNotifications(userId),
    ]);
    return { rows, unreadCount };
  }

  async markRead(id: number, userId: number): Promise<Result<void, DomainError>> {
    const row = await this.repo.getNotification(id);
    // Someone else's notification answers exactly like a missing one — no id probing.
    if (!row || row.userId !== userId) return err(DomainError.notFound("notification"));
    if (row.readAt === null) {
      await this.repo.markNotificationRead(id, this.clock.now().toISOString());
      this.notified(userId);
    }
    return ok(undefined); // idempotent: re-reading keeps the original readAt
  }

  async markAllRead(userId: number): Promise<void> {
    await this.repo.markAllNotificationsRead(userId, this.clock.now().toISOString());
    this.notified(userId);
  }

  private notified(userId: number): void {
    this.bus.emit("collaboration.notified", { userId });
  }
}
