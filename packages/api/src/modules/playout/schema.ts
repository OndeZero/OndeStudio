import { integer, sqliteTable, text, unique } from "drizzle-orm/sqlite-core";

/**
 * Playout-owned persistence. `ac_now_cache` is a read-only ingest cache of
 * AzuraCast-owned reality (docs/2 §3.7): it lets /now degrade to last-known
 * state instead of erroring when the upstream link drops.
 */
export const acNowCache = sqliteTable("ac_now_cache", {
  stationId: text("station_id").primaryKey(),
  /** Serialized OnAirStatus fields — a cache, never a source of truth. */
  payloadJson: text("payload_json").notNull(),
  observedAt: text("observed_at").notNull(),
});

/**
 * The projection ledger (docs/2 §5.2/§3.7, RFC 0001): one row per OndeStudio
 * object projected to AzuraCast. `last_pushed_json` is what we pushed;
 * `last_seen_json` is the last AzuraCast snapshot the driver observed — their
 * divergence is drift. `reconcile_state` = `drifted` excludes the row from the
 * push pass until the team picks a side (never fight a manual edit, PD §6).
 */
export const projections = sqliteTable(
  "projection",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    osObjectType: text("os_object_type", { enum: ["slot"] }).notNull(),
    osObjectId: integer("os_object_id").notNull(),
    stationId: text("station_id").notNull(),
    azKind: text("az_kind", { enum: ["playlist", "streamer"] }).notNull(),
    /** AzuraCast id of the projected object; null between intent and first push. */
    azId: text("az_id"),
    tagMarker: text("tag_marker").notNull(),
    lastPushedJson: text("last_pushed_json"),
    lastSeenJson: text("last_seen_json"),
    reconcileState: text("reconcile_state", { enum: ["synced", "drifted"] })
      .notNull()
      .default("synced"),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => [unique().on(table.osObjectType, table.osObjectId, table.stationId)],
);

/**
 * Open reconciliation items — a manual AzuraCast edit to a projected object
 * the team must resolve in one click (docs/2 §7.5). Resolved rows are kept
 * (resolved_at set) for a short audit trail.
 */
export const reconciliations = sqliteTable("reconciliation", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  projectionId: integer("projection_id")
    .notNull()
    .references(() => projections.id, { onDelete: "cascade" }),
  kind: text("kind", { enum: ["edited", "deleted"] }).notNull(),
  summary: text("summary").notNull(),
  /** OS-desired vs AC-current, JSON — rendered in the inbox. */
  detailJson: text("detail_json").notNull(),
  detectedAt: text("detected_at").notNull(),
  resolvedAt: text("resolved_at"),
  resolution: text("resolution", { enum: ["keep-ondestudio", "keep-azuracast"] }),
});
