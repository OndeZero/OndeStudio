import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import type {
  PlayoutWritePort,
  ProjectableSlot,
  ScheduleBlock,
  ScheduleBlockSnapshot,
  ScheduleItem,
  SlotSinkPort,
  SlotSourcePort,
} from "./ports";
import type { ProjectionRepo, ProjectionRow } from "./projection-repo";

const DEBOUNCE_MS = 4_000;

interface NormalizedBlock {
  name: string;
  isEnabled: boolean;
  scheduleItems: ScheduleItem[];
}

/**
 * The write-back driver (M3, RFC 0001): keeps AzuraCast's tagged playlists in
 * step with OndeStudio's validated slots. One reconcile loop per write station,
 * ordered so a manual AzuraCast edit always wins over a stale re-push — never
 * fight an emergency fix (PD §6). Runs debounced after grid changes (the undo
 * window) and periodically (drift). Air is never in its path (invariant 1):
 * every upstream failure degrades the overlay and is retried next tick.
 */
export class PlayoutDriver {
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private lastRunAt: Date | null = null;
  private running = false;

  constructor(
    private readonly deps: {
      write: PlayoutWritePort;
      projections: ProjectionRepo;
      slots: SlotSourcePort;
      sink: SlotSinkPort;
      writeStations: StationId[];
      adapterHealthy: () => boolean;
      clock: Clock;
      logger: Logger;
    },
  ) {}

  get isDriving(): boolean {
    return this.deps.writeStations.length > 0;
  }
  get lastRun(): Date | null {
    return this.lastRunAt;
  }

  /** Debounced trigger from a grid change — the apply-with-undo window (§7.5). */
  scheduleRun(stationValue: string): void {
    if (!this.deps.writeStations.some((s) => s.value === stationValue)) return;
    const existing = this.debounces.get(stationValue);
    if (existing) clearTimeout(existing);
    this.debounces.set(
      stationValue,
      setTimeout(() => {
        this.debounces.delete(stationValue);
        void this.runOnce();
      }, DEBOUNCE_MS),
    );
  }

  /** One pass over every write station — the periodic drift sweep also calls this. */
  async runOnce(): Promise<void> {
    if (this.running) return; // never overlap: reads-then-writes must not interleave
    this.running = true;
    try {
      for (const station of this.deps.writeStations) {
        await this.reconcileStation(station);
      }
      this.lastRunAt = this.deps.clock.now();
    } catch (error) {
      this.deps.logger.error("driver run crashed", { error: String(error) });
    } finally {
      this.running = false;
    }
  }

  stop(): void {
    for (const timer of this.debounces.values()) clearTimeout(timer);
    this.debounces.clear();
  }

  private async reconcileStation(station: StationId): Promise<void> {
    const desired = await this.deps.slots.listProjectable(station);
    if (!desired.ok) {
      this.deps.logger.warn("driver: desired-state read failed", {
        station: station.value,
        reason: desired.error.message,
      });
      return; // AzuraCast/DB hiccup — leave everything as-is, retry next tick
    }
    const desiredBySlot = new Map(desired.value.map((slot) => [slot.slotId, slot]));
    const projections = await this.deps.projections.listByStation(station.value);
    const handled = new Set<number>();

    for (const proj of projections) {
      handled.add(proj.osObjectId);
      const slot = desiredBySlot.get(proj.osObjectId);
      await this.reconcileProjection(station, proj, slot);
    }

    // Desired slots with no projection yet → first push.
    for (const slot of desired.value) {
      if (handled.has(slot.slotId)) continue;
      await this.createProjection(station, slot);
    }
  }

  private async reconcileProjection(
    station: StationId,
    proj: ProjectionRow,
    slot: ProjectableSlot | undefined,
  ): Promise<void> {
    const frozen = await this.deps.projections.hasOpenReconciliation(proj.id);

    // Observe current AzuraCast state.
    let cur: ScheduleBlockSnapshot | null = null;
    if (proj.azId) {
      const read = await this.deps.write.readScheduleBlock(station, proj.azId);
      if (!read.ok) {
        this.deps.logger.warn("driver: readback failed", {
          station: station.value,
          slotId: proj.osObjectId,
        });
        return; // transient — try next tick, never guess
      }
      cur = read.value;
    }

    if (frozen) {
      // Awaiting the team's decision: track AzuraCast but push nothing.
      if (cur) await this.persist(proj, { lastSeen: normalizeSnapshot(cur), state: "drifted" });
      return;
    }

    // Drift: AzuraCast changed under a synced projection → never overwrite it.
    if (proj.azId) {
      if (cur === null) {
        if (slot) {
          await this.openDrift(proj, "deleted", slot, null);
          return;
        }
        await this.deps.projections.remove(proj.id); // slot gone too — just drop the ledger row
        return;
      }
      const seen = proj.lastSeen as NormalizedBlock | null;
      if (seen && !stableEqual(normalizeSnapshot(cur), seen)) {
        await this.openDrift(proj, "edited", slot ?? null, cur);
        return;
      }
    }

    // Synced. Retract if the slot is no longer projectable.
    if (!slot) {
      if (proj.azId) {
        const removed = await this.deps.write.removeScheduleBlock(station, proj.azId);
        if (!removed.ok) {
          this.deps.logger.warn("driver: retract delete failed", { slotId: proj.osObjectId });
          return; // keep the row; retry next tick
        }
      }
      await this.deps.projections.remove(proj.id);
      return;
    }

    // Push OndeStudio's desired state when AzuraCast doesn't already match it.
    const desiredNorm = normalizeDesired(slot);
    if (cur !== null && stableEqual(normalizeSnapshot(cur), desiredNorm)) return; // already in sync
    if (!proj.azId || cur === null) {
      await this.createProjection(station, slot); // upserts onto the same ledger row
      return;
    }
    const block = blockFor(slot, proj.tagMarker);
    const updated = await this.deps.write.updateScheduleBlock(station, proj.azId, block);
    if (!updated.ok) {
      this.deps.logger.warn("driver: update push failed", { slotId: slot.slotId });
      return;
    }
    if (slot.mediaIds.length > 0)
      await this.deps.write.setBlockMedia(station, proj.azId, slot.mediaIds);
    await this.persistAfterPush(station, proj.azId, slot, desiredNorm);
  }

  private async createProjection(station: StationId, slot: ProjectableSlot): Promise<void> {
    const marker = markerFor(slot.slotId);
    const created = await this.deps.write.createScheduleBlock(station, blockFor(slot, marker));
    if (!created.ok) {
      this.deps.logger.warn("driver: create push failed", {
        slotId: slot.slotId,
        reason: created.error.message,
      });
      return;
    }
    if (slot.mediaIds.length > 0) {
      await this.deps.write.setBlockMedia(station, created.value.ref, slot.mediaIds);
    }
    const readback = await this.deps.write.readScheduleBlock(station, created.value.ref);
    const lastSeen =
      readback.ok && readback.value ? normalizeSnapshot(readback.value) : normalizeDesired(slot);
    await this.deps.projections.upsert({
      osObjectType: "slot",
      osObjectId: slot.slotId,
      stationId: station.value,
      azKind: "playlist",
      azId: created.value.ref,
      tagMarker: marker,
      lastPushed: normalizeDesired(slot),
      lastSeen,
      reconcileState: "synced",
      lastSyncedAt: this.deps.clock.now().toISOString(),
    });
    this.deps.logger.info("driver: projected slot", {
      station: station.value,
      slotId: slot.slotId,
    });
  }

  private async persistAfterPush(
    station: StationId,
    azId: string,
    slot: ProjectableSlot,
    desiredNorm: NormalizedBlock,
  ): Promise<void> {
    const readback = await this.deps.write.readScheduleBlock(station, azId);
    const lastSeen =
      readback.ok && readback.value ? normalizeSnapshot(readback.value) : desiredNorm;
    const existing = await this.deps.projections.getByObject("slot", slot.slotId, station.value);
    if (!existing) return;
    await this.deps.projections.upsert({
      ...toUpsert(existing),
      azId,
      lastPushed: desiredNorm,
      lastSeen,
      reconcileState: "synced",
      lastSyncedAt: this.deps.clock.now().toISOString(),
    });
  }

  private async openDrift(
    proj: ProjectionRow,
    kind: "edited" | "deleted",
    slot: ProjectableSlot | null,
    cur: ScheduleBlockSnapshot | null,
  ): Promise<void> {
    const osDesc = slot ? describeItems(slot.scheduleItems) : "(no longer scheduled)";
    const acDesc =
      kind === "deleted" ? "(deleted in AzuraCast)" : describeItems(cur?.scheduleItems ?? []);
    await this.deps.projections.openReconciliation({
      projectionId: proj.id,
      kind,
      summary:
        kind === "deleted"
          ? "Projected playlist was deleted in AzuraCast"
          : "Projected playlist was edited in AzuraCast",
      detail: { ondestudio: osDesc, azuracast: acDesc },
      detectedAt: this.deps.clock.now().toISOString(),
    });
    await this.persist(proj, {
      lastSeen: cur ? normalizeSnapshot(cur) : proj.lastSeen,
      state: "drifted",
    });
    this.deps.logger.info("driver: drift queued", { slotId: proj.osObjectId, kind });
  }

  private async persist(
    proj: ProjectionRow,
    patch: { lastSeen: unknown; state: "synced" | "drifted" },
  ): Promise<void> {
    await this.deps.projections.upsert({
      ...toUpsert(proj),
      lastSeen: patch.lastSeen,
      reconcileState: patch.state,
    });
  }

  /** Pick a side (PD §6): re-push OndeStudio, or pull AzuraCast's edit into the slot. */
  async resolve(
    reconciliationId: number,
    resolution: "keep-ondestudio" | "keep-azuracast",
  ): Promise<Result<void, DomainError>> {
    const item = await this.deps.projections.getOpenReconciliation(reconciliationId);
    if (!item) return err(DomainError.notFound("reconciliation"));
    const station = StationId.parse(item.projection.stationId);
    if (!station.ok) return station;

    if (resolution === "keep-azuracast") {
      const azId = item.projection.azId;
      const cur = azId ? await this.deps.write.readScheduleBlock(station.value, azId) : null;
      const snapshot = cur?.ok ? cur.value : null;
      const inverted = snapshot ? invertToRecurrence(snapshot.scheduleItems) : null;
      if (inverted) {
        const applied = await this.deps.sink.applyScheduleFromAzuracast(
          station.value,
          item.projection.osObjectId,
          inverted,
        );
        if (!applied.ok) return applied;
      } else {
        this.deps.logger.warn("driver: cannot invert AC schedule; accepting baseline only", {
          reconciliationId,
        });
      }
      await this.persist(item.projection, {
        lastSeen: snapshot ? normalizeSnapshot(snapshot) : item.projection.lastSeen,
        state: "synced",
      });
    } else {
      // keep-ondestudio: unfreeze; the next reconcile re-pushes over the manual edit.
      await this.persist(item.projection, { lastSeen: item.projection.lastSeen, state: "synced" });
    }

    await this.deps.projections.resolveReconciliation(
      reconciliationId,
      resolution,
      this.deps.clock.now().toISOString(),
    );
    // Re-push (keep-ondestudio) or re-baseline (keep-azuracast) before returning,
    // so the resolve response already reflects the settled state.
    await this.runOnce();
    return ok(undefined);
  }

  async listProjections(station: StationId): Promise<ProjectionRow[]> {
    return this.deps.projections.listByStation(station.value);
  }
  async listReconciliations() {
    return this.deps.projections.listOpenReconciliations();
  }
  adapterHealthy(): boolean {
    return this.deps.adapterHealthy();
  }
}

function markerFor(slotId: number): string {
  return `[ondestudio:slot:${slotId}]`;
}

function blockFor(slot: ProjectableSlot, marker: string): ScheduleBlock {
  return { name: slot.name, tagMarker: marker, scheduleItems: slot.scheduleItems };
}

function normalizeDesired(slot: ProjectableSlot): NormalizedBlock {
  return { name: slot.name, isEnabled: true, scheduleItems: sortItems(slot.scheduleItems) };
}
function normalizeSnapshot(snap: ScheduleBlockSnapshot): NormalizedBlock {
  return {
    name: snap.name,
    isEnabled: snap.isEnabled,
    scheduleItems: sortItems(snap.scheduleItems),
  };
}
function sortItems(items: ScheduleItem[]): ScheduleItem[] {
  return [...items]
    .map((i) => ({
      startTime: i.startTime,
      endTime: i.endTime,
      days: [...i.days].sort((a, b) => a - b),
    }))
    .sort((a, b) => a.startTime - b.startTime || a.endTime - b.endTime);
}
function stableEqual(a: NormalizedBlock, b: NormalizedBlock): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function describeItems(items: ScheduleItem[]): string {
  const days = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    items
      .map((i) => {
        const when = i.days.length ? i.days.map((d) => days[d] ?? d).join(",") : "daily";
        return `${when} ${hhmm(i.startTime)}–${hhmm(i.endTime)}`;
      })
      .join("; ") || "(no schedule)"
  );
}
function hhmm(value: number): string {
  return `${String(Math.floor(value / 100)).padStart(2, "0")}:${String(value % 100).padStart(2, "0")}`;
}

/** Single weekly schedule_item → recurrence + duration (inverse of the write mapping). */
function invertToRecurrence(
  items: ScheduleItem[],
): { weekdays: number[]; time: string; durationMin: number } | null {
  if (items.length !== 1) return null;
  const item = items[0];
  if (!item || item.days.length === 0) return null;
  const startMin = Math.floor(item.startTime / 100) * 60 + (item.startTime % 100);
  const endMin = Math.floor(item.endTime / 100) * 60 + (item.endTime % 100);
  const durationMin = (endMin - startMin + 24 * 60) % (24 * 60) || 24 * 60;
  return {
    weekdays: [...item.days].sort((a, b) => a - b),
    time: hhmm(item.startTime),
    durationMin,
  };
}

/** Re-serialize a ledger row as the upsert input, preserving its identity. */
function toUpsert(proj: ProjectionRow) {
  return {
    osObjectType: proj.osObjectType,
    osObjectId: proj.osObjectId,
    stationId: proj.stationId,
    azKind: proj.azKind,
    azId: proj.azId,
    tagMarker: proj.tagMarker,
    lastPushed: proj.lastPushed,
    lastSeen: proj.lastSeen,
    reconcileState: proj.reconcileState,
    lastSyncedAt: proj.lastSyncedAt,
  };
}
