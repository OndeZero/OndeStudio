import { CARD_INTENTS, CARD_STATUSES, VOTE_KINDS } from "@ondestudio/shared";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Collaboration-owned tables (docs/2 §5.2, M2 subset): the board (cards,
 * comments, votes, read markers), polymorphic assignment and the notification
 * inbox. All timestamps are UTC ISO strings.
 *
 * User ids are plain integer columns, deliberately WITHOUT `.references()`:
 * a drizzle FK would import the people module's schema file, coupling schema
 * files across modules — integrity is enforced by the service layer (assignees
 * are resolved through UserDirectoryPort before writing). Revisit if drizzle
 * relations ever span modules cleanly.
 */
export const cards = sqliteTable("card", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stationId: text("station_id").notNull(),
  intent: text("intent", { enum: CARD_INTENTS }).notNull(),
  status: text("status", { enum: CARD_STATUSES }).notNull().default("open"),
  subject: text("subject").notNull(),
  body: text("body"),
  /** Polymorphic anchor (docs/2 §5.5). TEXT id: occurrence ids are composite strings. */
  anchorType: text("anchor_type"),
  anchorId: text("anchor_id"),
  /** Recorded conclusion — explicit, never buried in the thread (PD §4.14). */
  outcome: text("outcome"),
  createdBy: integer("created_by").notNull(), // user id — no cross-module FK, see above
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  /** Drives sorting and the per-user unread dot (PD §5.2); votes never bump it. */
  lastActivityAt: text("last_activity_at").notNull(),
});

export const comments = sqliteTable("comment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  cardId: integer("card_id")
    .notNull()
    .references(() => cards.id, { onDelete: "cascade" }),
  authorId: integer("author_id").notNull(), // user id — no cross-module FK, see above
  body: text("body").notNull(),
  createdAt: text("created_at").notNull(),
});

/** One vote per person per card, changeable (PD §5.2) — the pair IS the identity. */
export const votes = sqliteTable(
  "vote",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull(), // user id — no cross-module FK, see above
    kind: text("kind", { enum: VOTE_KINDS }).notNull(),
  },
  (table) => [unique().on(table.cardId, table.userId)],
);

/** High-water mark behind the unread dot (docs/2 §5.2, PD §5.2). */
export const cardReads = sqliteTable(
  "card_read",
  {
    cardId: integer("card_id")
      .notNull()
      .references(() => cards.id, { onDelete: "cascade" }),
    userId: integer("user_id").notNull(), // user id — no cross-module FK, see above
    lastSeenAt: text("last_seen_at").notNull(),
  },
  (table) => [unique().on(table.cardId, table.userId)],
);

/**
 * Polymorphic assignment (docs/2 §5.5, PD §4.13): any object can carry
 * assignees. M2 only writes ("card", String(cardId)); shows/slots/episodes
 * join later without a schema change — which is why object_id is TEXT.
 */
export const assignments = sqliteTable(
  "assignment",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    objectType: text("object_type").notNull(),
    objectId: text("object_id").notNull(),
    userId: integer("user_id").notNull(), // user id — no cross-module FK, see above
  },
  (table) => [unique().on(table.objectType, table.objectId, table.userId)],
);

/**
 * The in-app inbox (PD §5.12). No FK to card: notifications are an immutable
 * log that must survive whatever happens to the object they point at.
 */
export const notifications = sqliteTable("notification", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  userId: integer("user_id").notNull(), // user id — no cross-module FK, see above
  kind: text("kind").notNull(),
  message: text("message").notNull(),
  /** Reserved for non-card triggers (slot moved, content arrived…); M2 writes null. */
  anchorType: text("anchor_type"),
  anchorId: text("anchor_id"),
  /** The card's station — cross-station deep-links need it. Null: pre-station rows, future station-less triggers. */
  stationId: text("station_id"),
  cardId: integer("card_id"),
  createdAt: text("created_at").notNull(),
  readAt: text("read_at"),
});
