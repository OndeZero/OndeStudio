import {
  FALLBACK_POLICIES,
  NEGOTIATION_STATES,
  REPLAY_FLAGS,
  SLOT_KINDS,
} from "@ondestudio/shared";
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
  /** What airs when the episode queue runs dry (PD §4.5). */
  fallbackPolicy: text("fallback_policy", { enum: FALLBACK_POLICIES }).notNull().default("discard"),
  /** Auto-fed episodes air directly, or wait flagged for a quick review (PD §4.5). */
  trustAutoAir: integer("trust_auto_air", { mode: "boolean" }).notNull().default(false),
  replayFlag: text("replay_flag", { enum: REPLAY_FLAGS }).notNull().default("not_specified"),
  /** IANA zone of the contributor, for translated-time helpers (PD §8.1). */
  contributorTz: text("contributor_tz"),
  /** Media path feeding this show's episode queue (PD §4.5); badges the media lens (PD §5.4). */
  dropFolderPath: text("drop_folder_path"),
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
  /** The bound live broadcaster (people.broadcaster.id); soft ref — no cross-module FK. */
  broadcasterId: integer("broadcaster_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

/**
 * Episodes feeding a show's occurrences (PD §4.5, ADR-0013). Phase-1 identity
 * is the AzuraCast file id (fingerprints need the media filesystem — deferred).
 * A file dropped in the show's folder becomes an episode; the queue is ordered
 * by arrival and manually reorderable.
 */
export const episodes = sqliteTable(
  "episode",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    showId: integer("show_id")
      .notNull()
      .references(() => shows.id, { onDelete: "cascade" }),
    /** AzuraCast file id — the phase-1 episode identity (ADR-0013). */
    azFileId: text("az_file_id").notNull(),
    path: text("path").notNull(),
    title: text("title").notNull(),
    artist: text("artist"),
    durationSec: integer("duration_sec"),
    /** Manual reorder within the queue; ties break on arrival (id). */
    queueOrder: integer("queue_order").notNull().default(0),
    arrivedAt: text("arrived_at").notNull(),
  },
  (table) => [unique().on(table.showId, table.azFileId)],
);

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
    /** The bound episode (PD §4.5); NULL = empty/rotation-covered. */
    episodeId: integer("episode_id").references(() => episodes.id, { onDelete: "set null" }),
    /** JSON array of issue flags (PD §4.4) — orthogonal to the pipeline state. */
    issueFlags: text("issue_flags").notNull().default("[]"),
    contentDurationMin: integer("content_duration_min"),
  },
  (table) => [unique().on(table.slotId, table.originalStartsAtUtc)],
);
