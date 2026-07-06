import { and, eq, isNull } from "drizzle-orm";
import type { Db } from "../../platform/db";
import { projections, reconciliations } from "./schema";

/** A projection ledger row with its JSON blobs parsed (RFC 0001). */
export interface ProjectionRow {
  id: number;
  osObjectType: "slot";
  osObjectId: number;
  stationId: string;
  azKind: "playlist" | "streamer";
  azId: string | null;
  tagMarker: string;
  lastPushed: unknown | null;
  lastSeen: unknown | null;
  reconcileState: "synced" | "drifted";
  lastSyncedAt: string | null;
}

export interface ReconciliationRow {
  id: number;
  projectionId: number;
  kind: "edited" | "deleted";
  summary: string;
  detail: { ondestudio: string; azuracast: string };
  detectedAt: string;
}

export interface ProjectionRepo {
  listByStation(stationId: string): Promise<ProjectionRow[]>;
  getByObject(type: "slot", id: number, stationId: string): Promise<ProjectionRow | null>;
  upsert(row: {
    osObjectType: "slot";
    osObjectId: number;
    stationId: string;
    azKind: "playlist" | "streamer";
    azId: string | null;
    tagMarker: string;
    lastPushed: unknown | null;
    lastSeen: unknown | null;
    reconcileState: "synced" | "drifted";
    lastSyncedAt: string | null;
  }): Promise<ProjectionRow>;
  remove(id: number): Promise<void>;
  openReconciliation(item: {
    projectionId: number;
    kind: "edited" | "deleted";
    summary: string;
    detail: { ondestudio: string; azuracast: string };
    detectedAt: string;
  }): Promise<void>;
  hasOpenReconciliation(projectionId: number): Promise<boolean>;
  listOpenReconciliations(): Promise<(ReconciliationRow & { projection: ProjectionRow })[]>;
  getOpenReconciliation(
    id: number,
  ): Promise<(ReconciliationRow & { projection: ProjectionRow }) | null>;
  resolveReconciliation(id: number, resolution: string, at: string): Promise<void>;
}

export class DrizzleProjectionRepo implements ProjectionRepo {
  constructor(private readonly db: Db) {}

  async listByStation(stationId: string): Promise<ProjectionRow[]> {
    const rows = await this.db
      .select()
      .from(projections)
      .where(eq(projections.stationId, stationId));
    return rows.map(toProjection);
  }

  async getByObject(type: "slot", id: number, stationId: string): Promise<ProjectionRow | null> {
    const row = (
      await this.db
        .select()
        .from(projections)
        .where(
          and(
            eq(projections.osObjectType, type),
            eq(projections.osObjectId, id),
            eq(projections.stationId, stationId),
          ),
        )
        .limit(1)
    )[0];
    return row ? toProjection(row) : null;
  }

  async upsert(row: Parameters<ProjectionRepo["upsert"]>[0]): Promise<ProjectionRow> {
    const values = {
      osObjectType: row.osObjectType,
      osObjectId: row.osObjectId,
      stationId: row.stationId,
      azKind: row.azKind,
      azId: row.azId,
      tagMarker: row.tagMarker,
      lastPushedJson: row.lastPushed === null ? null : JSON.stringify(row.lastPushed),
      lastSeenJson: row.lastSeen === null ? null : JSON.stringify(row.lastSeen),
      reconcileState: row.reconcileState,
      lastSyncedAt: row.lastSyncedAt,
    };
    const inserted = await this.db
      .insert(projections)
      .values(values)
      .onConflictDoUpdate({
        target: [projections.osObjectType, projections.osObjectId, projections.stationId],
        set: {
          azKind: values.azKind,
          azId: values.azId,
          tagMarker: values.tagMarker,
          lastPushedJson: values.lastPushedJson,
          lastSeenJson: values.lastSeenJson,
          reconcileState: values.reconcileState,
          lastSyncedAt: values.lastSyncedAt,
        },
      })
      .returning();
    const result = inserted[0];
    if (!result) throw new Error("projection upsert returned no row");
    return toProjection(result);
  }

  async remove(id: number): Promise<void> {
    await this.db.delete(projections).where(eq(projections.id, id));
  }

  async openReconciliation(
    item: Parameters<ProjectionRepo["openReconciliation"]>[0],
  ): Promise<void> {
    await this.db.insert(reconciliations).values({
      projectionId: item.projectionId,
      kind: item.kind,
      summary: item.summary,
      detailJson: JSON.stringify(item.detail),
      detectedAt: item.detectedAt,
    });
  }

  async hasOpenReconciliation(projectionId: number): Promise<boolean> {
    const row = (
      await this.db
        .select({ id: reconciliations.id })
        .from(reconciliations)
        .where(
          and(eq(reconciliations.projectionId, projectionId), isNull(reconciliations.resolvedAt)),
        )
        .limit(1)
    )[0];
    return row !== undefined;
  }

  async listOpenReconciliations(): Promise<(ReconciliationRow & { projection: ProjectionRow })[]> {
    const rows = await this.db
      .select({ reconciliation: reconciliations, projection: projections })
      .from(reconciliations)
      .innerJoin(projections, eq(reconciliations.projectionId, projections.id))
      .where(isNull(reconciliations.resolvedAt));
    return rows.map((row) => ({
      ...toReconciliation(row.reconciliation),
      projection: toProjection(row.projection),
    }));
  }

  async getOpenReconciliation(
    id: number,
  ): Promise<(ReconciliationRow & { projection: ProjectionRow }) | null> {
    const row = (
      await this.db
        .select({ reconciliation: reconciliations, projection: projections })
        .from(reconciliations)
        .innerJoin(projections, eq(reconciliations.projectionId, projections.id))
        .where(and(eq(reconciliations.id, id), isNull(reconciliations.resolvedAt)))
        .limit(1)
    )[0];
    return row
      ? { ...toReconciliation(row.reconciliation), projection: toProjection(row.projection) }
      : null;
  }

  async resolveReconciliation(id: number, resolution: string, at: string): Promise<void> {
    await this.db
      .update(reconciliations)
      .set({ resolvedAt: at, resolution: resolution as "keep-ondestudio" | "keep-azuracast" })
      .where(eq(reconciliations.id, id));
  }
}

type ProjectionDbRow = typeof projections.$inferSelect;
type ReconciliationDbRow = typeof reconciliations.$inferSelect;

function toProjection(row: ProjectionDbRow): ProjectionRow {
  return {
    id: row.id,
    osObjectType: row.osObjectType,
    osObjectId: row.osObjectId,
    stationId: row.stationId,
    azKind: row.azKind,
    azId: row.azId,
    tagMarker: row.tagMarker,
    lastPushed: row.lastPushedJson === null ? null : JSON.parse(row.lastPushedJson),
    lastSeen: row.lastSeenJson === null ? null : JSON.parse(row.lastSeenJson),
    reconcileState: row.reconcileState,
    lastSyncedAt: row.lastSyncedAt,
  };
}

function toReconciliation(row: ReconciliationDbRow): ReconciliationRow {
  return {
    id: row.id,
    projectionId: row.projectionId,
    kind: row.kind,
    summary: row.summary,
    detail: JSON.parse(row.detailJson) as { ondestudio: string; azuracast: string },
    detectedAt: row.detectedAt,
  };
}
