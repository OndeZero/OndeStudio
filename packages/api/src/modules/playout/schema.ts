import { sqliteTable, text } from "drizzle-orm/sqlite-core";

/**
 * Playout-owned persistence. `ac_now_cache` is a read-only ingest cache of
 * AzuraCast-owned reality (docs/2 §3.7): it lets /now degrade to last-known
 * state instead of erroring when the upstream link drops. The `projection`
 * table (docs/2 §5.2) arrives with write-back (M3).
 */
export const acNowCache = sqliteTable("ac_now_cache", {
  stationId: text("station_id").primaryKey(),
  /** Serialized OnAirStatus fields — a cache, never a source of truth. */
  payloadJson: text("payload_json").notNull(),
  observedAt: text("observed_at").notNull(),
});
