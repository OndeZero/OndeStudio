import type { CardIntent, CardStatus, VoteKind } from "@ondestudio/shared";
import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "../../platform/db";
import { Card, type CardAnchor, type CardProps } from "./domain/card";
import { assignments, cardReads, cards, comments, notifications, votes } from "./schema";

export interface CardFilters {
  status?: CardStatus[];
  intent?: CardIntent[];
}

export interface CommentRecord {
  id: number;
  cardId: number;
  authorId: number;
  body: string;
  createdAt: string;
}

export interface VoteRecord {
  cardId: number;
  userId: number;
  kind: VoteKind;
}

export interface NotificationRecord {
  id: number;
  userId: number;
  kind: string;
  message: string;
  anchorType: string | null;
  anchorId: string | null;
  cardId: number | null;
  createdAt: string;
  readAt: string | null;
}

/**
 * Board persistence. Cards come back as domain objects; comments, votes,
 * reads and notifications stay plain records — they carry no behavior, so an
 * entity wrapper would be ceremony. Batch reads take id lists because the
 * board enriches a whole listing in one pass, not row by row.
 */
export interface CollaborationRepo {
  listCards(stationId: string, filters: CardFilters): Promise<Card[]>;
  getCard(id: number): Promise<Card | null>;
  insertCard(props: Omit<CardProps, "id">): Promise<Card>;
  saveCard(card: Card): Promise<void>;
  listComments(cardId: number): Promise<CommentRecord[]>;
  listCommentsForCards(cardIds: number[]): Promise<CommentRecord[]>;
  insertComment(fields: Omit<CommentRecord, "id">): Promise<CommentRecord>;
  listVotes(cardIds: number[]): Promise<VoteRecord[]>;
  setVote(cardId: number, userId: number, kind: VoteKind): Promise<void>;
  clearVote(cardId: number, userId: number): Promise<void>;
  /** The caller's read high-water marks: cardId → lastSeenAt. */
  listReads(cardIds: number[], userId: number): Promise<Map<number, string>>;
  markRead(cardId: number, userId: number, lastSeenAt: string): Promise<void>;
  listAssignees(objectType: string, objectIds: string[]): Promise<Map<string, number[]>>;
  setAssignees(objectType: string, objectId: string, userIds: number[]): Promise<void>;
  insertNotification(fields: Omit<NotificationRecord, "id" | "readAt">): Promise<void>;
  getNotification(id: number): Promise<NotificationRecord | null>;
  listNotifications(userId: number, limit: number): Promise<NotificationRecord[]>;
  countUnreadNotifications(userId: number): Promise<number>;
  markNotificationRead(id: number, readAt: string): Promise<void>;
  markAllNotificationsRead(userId: number, readAt: string): Promise<void>;
}

export class DrizzleCollaborationRepo implements CollaborationRepo {
  constructor(private readonly db: Db) {}

  async listCards(stationId: string, filters: CardFilters): Promise<Card[]> {
    const rows = await this.db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.stationId, stationId),
          filters.status ? inArray(cards.status, filters.status) : undefined,
          filters.intent ? inArray(cards.intent, filters.intent) : undefined,
        ),
      )
      .orderBy(desc(cards.lastActivityAt), desc(cards.id));
    return rows.map(toCard);
  }

  async getCard(id: number): Promise<Card | null> {
    const rows = await this.db.select().from(cards).where(eq(cards.id, id)).limit(1);
    const row = rows[0];
    return row ? toCard(row) : null;
  }

  async insertCard(props: Omit<CardProps, "id">): Promise<Card> {
    const inserted = await this.db.insert(cards).values(toRow(props)).returning();
    const row = inserted[0];
    if (!row) throw new Error("card insert returned no row");
    return toCard(row);
  }

  async saveCard(card: Card): Promise<void> {
    const { id, ...fields } = card.toProps();
    await this.db.update(cards).set(toRow(fields)).where(eq(cards.id, id));
  }

  async listComments(cardId: number): Promise<CommentRecord[]> {
    return this.db
      .select()
      .from(comments)
      .where(eq(comments.cardId, cardId))
      .orderBy(comments.createdAt, comments.id);
  }

  async listCommentsForCards(cardIds: number[]): Promise<CommentRecord[]> {
    // Whole rows, counted/last-picked in the service: a small team's board is
    // tiny — revisit with a GROUP BY only if listings ever get slow.
    if (cardIds.length === 0) return [];
    return this.db
      .select()
      .from(comments)
      .where(inArray(comments.cardId, cardIds))
      .orderBy(comments.createdAt, comments.id);
  }

  async insertComment(fields: Omit<CommentRecord, "id">): Promise<CommentRecord> {
    const inserted = await this.db.insert(comments).values(fields).returning();
    const row = inserted[0];
    if (!row) throw new Error("comment insert returned no row");
    return row;
  }

  async listVotes(cardIds: number[]): Promise<VoteRecord[]> {
    if (cardIds.length === 0) return [];
    return this.db.select().from(votes).where(inArray(votes.cardId, cardIds));
  }

  async setVote(cardId: number, userId: number, kind: VoteKind): Promise<void> {
    await this.db
      .insert(votes)
      .values({ cardId, userId, kind })
      .onConflictDoUpdate({ target: [votes.cardId, votes.userId], set: { kind } });
  }

  async clearVote(cardId: number, userId: number): Promise<void> {
    await this.db.delete(votes).where(and(eq(votes.cardId, cardId), eq(votes.userId, userId)));
  }

  async listReads(cardIds: number[], userId: number): Promise<Map<number, string>> {
    if (cardIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(cardReads)
      .where(and(inArray(cardReads.cardId, cardIds), eq(cardReads.userId, userId)));
    return new Map(rows.map((row) => [row.cardId, row.lastSeenAt]));
  }

  async markRead(cardId: number, userId: number, lastSeenAt: string): Promise<void> {
    await this.db
      .insert(cardReads)
      .values({ cardId, userId, lastSeenAt })
      .onConflictDoUpdate({ target: [cardReads.cardId, cardReads.userId], set: { lastSeenAt } });
  }

  async listAssignees(objectType: string, objectIds: string[]): Promise<Map<string, number[]>> {
    if (objectIds.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(assignments)
      .where(and(eq(assignments.objectType, objectType), inArray(assignments.objectId, objectIds)))
      .orderBy(assignments.id); // stable assignee order = insertion order
    const byObject = new Map<string, number[]>();
    for (const row of rows) {
      const list = byObject.get(row.objectId) ?? [];
      list.push(row.userId);
      byObject.set(row.objectId, list);
    }
    return byObject;
  }

  async setAssignees(objectType: string, objectId: string, userIds: number[]): Promise<void> {
    await this.db
      .delete(assignments)
      .where(and(eq(assignments.objectType, objectType), eq(assignments.objectId, objectId)));
    if (userIds.length === 0) return;
    await this.db
      .insert(assignments)
      .values(userIds.map((userId) => ({ objectType, objectId, userId })));
  }

  async insertNotification(fields: Omit<NotificationRecord, "id" | "readAt">): Promise<void> {
    await this.db.insert(notifications).values(fields);
  }

  async getNotification(id: number): Promise<NotificationRecord | null> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.id, id))
      .limit(1);
    return rows[0] ?? null;
  }

  async listNotifications(userId: number, limit: number): Promise<NotificationRecord[]> {
    return this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit);
  }

  async countUnreadNotifications(userId: number): Promise<number> {
    const rows = await this.db
      .select({ unread: count() })
      .from(notifications)
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
    return rows[0]?.unread ?? 0;
  }

  async markNotificationRead(id: number, readAt: string): Promise<void> {
    await this.db.update(notifications).set({ readAt }).where(eq(notifications.id, id));
  }

  async markAllNotificationsRead(userId: number, readAt: string): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  }
}

type CardRow = typeof cards.$inferSelect;

function toCard(row: CardRow): Card {
  const { anchorType, anchorId, ...core } = row;
  return Card.rehydrate({
    ...core,
    // Only the service writes these columns, always from a CardAnchor — a bad
    // pair here means corrupt data, which is exceptional, not an expected Result.
    anchor:
      anchorType && anchorId ? { type: anchorType as CardAnchor["type"], id: anchorId } : null,
  });
}

function toRow(props: Omit<CardProps, "id">): Omit<CardRow, "id"> {
  const { anchor, ...rest } = props;
  return { ...rest, anchorType: anchor?.type ?? null, anchorId: anchor?.id ?? null };
}
