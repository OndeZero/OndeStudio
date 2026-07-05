import { NEGOTIATION_STATES, SLOT_KINDS } from "@ondestudio/shared";
import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Scheduling-owned tables (docs/2 §5.2, M1 subset — columns land when a
 * milestone uses them, docs/2 §2.4). Times: wall-clock strings for slot
 * definitions (station tz, docs/2 §5.4), UTC ISO strings for occurrence
 * instants. `occurrence` rows are sparse: one row per *diverging* occurrence,
 * keyed by (slot, original series time) — docs/2 §5.3.
 */
export const shows = sqliteTable("show", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const slots = sqliteTable("slot", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  stationId: text("station_id").notNull(),
  showId: integer("show_id").references(() => shows.id),
  kind: text("kind", { enum: SLOT_KINDS }).notNull(),
  /** Display label; NULL when the bound show's name is the label. */
  title: text("title"),
  /** NULL = one-off slot; else the weekly rrule subset (docs/2 §5.3). */
  rrule: text("rrule"),
  /** "HH:MM" for weekly rules, "YYYY-MM-DDTHH:mm" for one-offs — station-tz wall clock. */
  startWall: text("start_wall").notNull(),
  durationMin: integer("duration_min").notNull(),
  negotiationDefault: text("negotiation_default", { enum: NEGOTIATION_STATES })
    .notNull()
    .default("prebooked"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const occurrences = sqliteTable(
  "occurrence",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    slotId: integer("slot_id")
      .notNull()
      .references(() => slots.id, { onDelete: "cascade" }),
    /** The recurrence key: pins this row to the computed instance it overrides (docs/2 §5.3). */
    originalStartsAtUtc: text("original_starts_at_utc").notNull(),
    startsAtUtc: text("starts_at_utc").notNull(),
    endsAtUtc: text("ends_at_utc").notNull(),
    negotiationState: text("negotiation_state", { enum: NEGOTIATION_STATES }).notNull(),
    contentState: text("content_state", { enum: ["empty", "received", "ready", "aired"] })
      .notNull()
      .default("empty"),
    /** JSON array of issue flags (PD §4.4) — orthogonal to the pipeline state. */
    issueFlags: text("issue_flags").notNull().default("[]"),
    contentDurationMin: integer("content_duration_min"),
  },
  (table) => [unique().on(table.slotId, table.originalStartsAtUtc)],
);
