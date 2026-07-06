import { z } from "zod";
import { StationSlugSchema } from "./station";

/**
 * Driver contract (docs/2 §11 M3, RFC 0001): write-back turns validated slots
 * into tagged AzuraCast objects. These read models expose what OndeStudio has
 * projected and where a manual AzuraCast edit needs the team to pick a side —
 * OndeStudio's model only; AzuraCast shapes never leak (PD §7.2).
 */
export const PROJECTION_STATES = ["synced", "pending", "drifted"] as const;
export const ProjectionStateSchema = z.enum(PROJECTION_STATES);
export type ProjectionState = z.infer<typeof ProjectionStateSchema>;

export const ProjectionViewSchema = z.object({
  slotId: z.number().int(),
  station: StationSlugSchema,
  title: z.string(),
  /** What the projection became in AzuraCast (never the raw shape — just the kind). */
  azKind: z.enum(["playlist", "streamer"]),
  azRef: z.string().nullable(),
  state: ProjectionStateSchema,
  lastSyncedAt: z.iso.datetime().nullable(),
});
export type ProjectionView = z.infer<typeof ProjectionViewSchema>;

/** A manual AzuraCast edit to a projected object that OndeStudio will not silently overwrite. */
export const ReconciliationItemSchema = z.object({
  id: z.number().int(),
  slotId: z.number().int(),
  station: StationSlugSchema,
  title: z.string(),
  kind: z.enum(["edited", "deleted"]),
  /** One-line human summary of the divergence. */
  summary: z.string(),
  /** What OndeStudio wants vs what AzuraCast currently has (free-form, for the inbox). */
  ondestudio: z.string(),
  azuracast: z.string(),
  detectedAt: z.iso.datetime(),
});
export type ReconciliationItem = z.infer<typeof ReconciliationItemSchema>;

export const ReconciliationResponseSchema = z.object({
  items: z.array(ReconciliationItemSchema),
});
export type ReconciliationResponse = z.infer<typeof ReconciliationResponseSchema>;

/**
 * Pick a side (PD §6): `keep-ondestudio` re-pushes OndeStudio's version;
 * `keep-azuracast` pulls the manual edit into the OndeStudio slot.
 */
export const ResolveReconciliationInputSchema = z.object({
  resolution: z.enum(["keep-ondestudio", "keep-azuracast"]),
});
export type ResolveReconciliationInput = z.infer<typeof ResolveReconciliationInputSchema>;

export const DriverStatusResponseSchema = z.object({
  /** Stations OndeStudio may write to right now (docs/2 §7.7). */
  writeStations: z.array(StationSlugSchema),
  /** True while the driver actively projects (false when no station is writable). */
  driving: z.boolean(),
  projections: z.array(ProjectionViewSchema),
  openReconciliations: z.number().int(),
  lastRunAt: z.iso.datetime().nullable(),
  /** The AzuraCast write link health, surfaced so a degraded driver is visible (docs/2 §13). */
  adapterHealthy: z.boolean(),
});
export type DriverStatusResponse = z.infer<typeof DriverStatusResponseSchema>;
