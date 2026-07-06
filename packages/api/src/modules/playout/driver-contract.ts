import type { ProjectionState, ProjectionView, ReconciliationItem } from "@ondestudio/shared";
import type { ProjectionRow, ReconciliationRow } from "./projection-repo";

interface NamedBlock {
  name?: string;
}

/** Domain → wire (docs/2 §3.2). Title comes from the pushed playlist name. */
export function projectionToContract(proj: ProjectionRow): ProjectionView {
  const pushed = proj.lastPushed as NamedBlock | null;
  return {
    slotId: proj.osObjectId,
    station: proj.stationId,
    title: pushed?.name ?? `slot #${proj.osObjectId}`,
    azKind: proj.azKind,
    azRef: proj.azId,
    state: projectionState(proj),
    lastSyncedAt: proj.lastSyncedAt,
  };
}

function projectionState(proj: ProjectionRow): ProjectionState {
  if (proj.reconcileState === "drifted") return "drifted";
  if (proj.azId === null) return "pending";
  return "synced";
}

export function reconciliationToContract(
  row: ReconciliationRow & { projection: ProjectionRow },
): ReconciliationItem {
  const pushed = row.projection.lastPushed as NamedBlock | null;
  return {
    id: row.id,
    slotId: row.projection.osObjectId,
    station: row.projection.stationId,
    title: pushed?.name ?? `slot #${row.projection.osObjectId}`,
    kind: row.kind,
    summary: row.summary,
    ondestudio: row.detail.ondestudio,
    azuracast: row.detail.azuracast,
    detectedAt: row.detectedAt,
  };
}
