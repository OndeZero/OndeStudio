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
/** The observed upstream state for one marker: its AzuraCast id + snapshot. */
type TaggedMap = Map<string, { ref: string; snapshot: ScheduleBlockSnapshot }>;

/**
 * The write-back driver (M3, RFC 0001): keeps AzuraCast's tagged playlists in
 * step with OndeStudio's validated slots. One reconcile loop per write station,
 * ordered so a manual AzuraCast edit always wins over a stale re-push — never
 * fight an emergency fix (PD §6). Runs debounced after grid changes (the undo
 * window) and periodically (drift). Air is never in its path (invariant 1):
 * every upstream failure degrades the overlay and is retried next tick.
 *
 * Idempotency is by marker, not by DB row: each reconcile first OBSERVES every
 * tagged block upstream (`listTaggedBlocks`), so a create that landed but whose
 * ledger row was never written (timed-out response) is re-adopted, not
 * duplicated.
 */
export class PlayoutDriver {
  private readonly debounces = new Map<string, ReturnType<typeof setTimeout>>();
  private lock: Promise<void> = Promise.resolve();
  private lastRunAt: Date | null = null;

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

  /** One serialized pass over every write station (mutex: never interleave reads/writes). */
  async runOnce(): Promise<void> {
    await this.exclusive(async () => {
      for (const station of this.deps.writeStations) {
        // A station with a pending debounce is inside its undo window: observe
        // and detect drift, but push nothing yet — an undo can still cancel it.
        await this.reconcileStation(station, !this.debounces.has(station.value));
      }
      this.lastRunAt = this.deps.clock.now();
    });
  }

  stop(): void {
    for (const timer of this.debounces.values()) clearTimeout(timer);
    this.debounces.clear();
  }

  private async exclusive(fn: () => Promise<void>): Promise<void> {
    const previous = this.lock;
    let release: () => void = () => {};
    this.lock = new Promise((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await fn();
    } catch (error) {
      this.deps.logger.error("driver run crashed", { error: String(error) });
    } finally {
      release();
    }
  }

  private async reconcileStation(station: StationId, allowWrites: boolean): Promise<void> {
    // Observe by marker first (RFC step 1): one list replaces N readbacks and
    // makes create idempotent.
    const tagged = await this.deps.write.listTaggedBlocks(station);
    if (!tagged.ok) {
      this.deps.logger.warn("driver: observe failed", {
        station: station.value,
        reason: tagged.error.message,
      });
      return;
    }
    const byMarker: TaggedMap = new Map(
      tagged.value.map((t) => [t.marker, { ref: t.ref, snapshot: t.snapshot }]),
    );

    const desired = await this.deps.slots.listProjectable(station);
    if (!desired.ok) {
      this.deps.logger.warn("driver: desired-state read failed", {
        station: station.value,
        reason: desired.error.message,
      });
      return;
    }
    const desiredBySlot = new Map(desired.value.map((slot) => [slot.slotId, slot]));
    const projections = await this.deps.projections.listByStation(station.value);
    const handled = new Set<number>();

    for (const proj of projections) {
      handled.add(proj.osObjectId);
      await this.reconcileProjection(
        station,
        proj,
        desiredBySlot.get(proj.osObjectId),
        byMarker,
        allowWrites,
      );
    }
    for (const slot of desired.value) {
      if (handled.has(slot.slotId) || !allowWrites) continue;
      await this.pushCreateOrAdopt(station, slot, byMarker);
    }
  }

  private async reconcileProjection(
    station: StationId,
    proj: ProjectionRow,
    slot: ProjectableSlot | undefined,
    byMarker: TaggedMap,
    allowWrites: boolean,
  ): Promise<void> {
    const frozen = await this.deps.projections.hasOpenReconciliation(proj.id);
    const upstream = byMarker.get(proj.tagMarker);
    const cur = upstream ? upstream.snapshot : null;
    const curRef = upstream ? upstream.ref : proj.azId;

    if (frozen) {
      // Awaiting the team's decision: track AzuraCast but push nothing.
      if (cur)
        await this.persist(proj, {
          lastSeen: normalizeSnapshot(cur),
          azId: curRef,
          state: "drifted",
        });
      return;
    }

    // Drift: AzuraCast changed under a synced projection → never overwrite it.
    if (proj.azId) {
      if (cur === null) {
        if (slot) return this.openDrift(proj, "deleted", slot, null);
        await this.deps.projections.remove(proj.id); // slot gone too — drop the row
        return;
      }
      const seen = proj.lastSeen as NormalizedBlock | null;
      if (seen && !stableEqual(normalizeSnapshot(cur), seen)) {
        return this.openDrift(proj, "edited", slot ?? null, cur);
      }
    }

    // Synced. Retract if the slot is no longer projectable.
    if (!slot) {
      if (!allowWrites) return;
      if (curRef && upstream) {
        const removed = await this.deps.write.removeScheduleBlock(station, curRef);
        if (!removed.ok) {
          this.deps.logger.warn("driver: retract delete failed", { slotId: proj.osObjectId });
          return; // keep the row; retry next tick
        }
      }
      await this.deps.projections.remove(proj.id);
      return;
    }

    const desiredNorm = normalizeDesired(slot);
    if (cur !== null && stableEqual(normalizeSnapshot(cur), desiredNorm)) {
      // Already in sync; record the (possibly adopted) ref so drift has a baseline.
      if (proj.azId !== curRef) {
        await this.persist(proj, {
          lastSeen: desiredNorm,
          azId: curRef,
          state: "synced",
          lastPushed: desiredNorm,
          touch: true,
        });
      }
      // The schedule is settled but the episode may have advanced — keep the
      // playlist's media exactly the current episode (idempotent, PD §4.11).
      if (allowWrites && curRef) await this.enforceMedia(station, curRef, slot);
      return;
    }
    if (!allowWrites) return; // within the undo window — observe only
    if (!proj.azId || cur === null) {
      await this.pushCreateOrAdopt(station, slot, byMarker);
      return;
    }
    const upd = await this.deps.write.updateScheduleBlock(
      station,
      curRef ?? "",
      blockFor(slot, proj.tagMarker),
    );
    if (curRef) await this.enforceMedia(station, curRef, slot);
    if (!upd.ok) this.deps.logger.warn("driver: update push failed", { slotId: slot.slotId });
    // Refresh from the ACTUAL upstream state whether or not the write reported
    // ok: a timed-out PUT that landed must not read as our own edit next tick.
    await this.refreshBookkeeping(station, slot, curRef ?? "", desiredNorm);
  }

  private async pushCreateOrAdopt(
    station: StationId,
    slot: ProjectableSlot,
    byMarker: TaggedMap,
  ): Promise<void> {
    const marker = markerFor(slot.slotId);
    const upstream = byMarker.get(marker);
    if (upstream) {
      // ADOPT an already-tagged playlist (e.g. from a timed-out create) — no
      // second POST. The next reconcile pushes it toward `desired` if it differs.
      await this.enforceMedia(station, upstream.ref, slot);
      await this.persistNew(
        station,
        slot,
        upstream.ref,
        normalizeSnapshot(upstream.snapshot),
        normalizeSnapshot(upstream.snapshot),
      );
      return;
    }
    const created = await this.deps.write.createScheduleBlock(station, blockFor(slot, marker));
    if (!created.ok) {
      this.deps.logger.warn("driver: create push failed", {
        slotId: slot.slotId,
        reason: created.error.message,
      });
      return; // if it actually landed, next reconcile adopts it by marker
    }
    await this.enforceMedia(station, created.value.ref, slot);
    const readback = await this.deps.write.readScheduleBlock(station, created.value.ref);
    const lastSeen =
      readback.ok && readback.value ? normalizeSnapshot(readback.value) : normalizeDesired(slot);
    await this.persistNew(station, slot, created.value.ref, normalizeDesired(slot), lastSeen);
    this.deps.logger.info("driver: projected slot", {
      station: station.value,
      slotId: slot.slotId,
    });
  }

  /**
   * Assert the projected playlist's media = the slot's current episode (or empty
   * when none is filled). `setBlockMedia` is exact-membership and idempotent, so
   * this is a no-op upstream when already correct; a failure degrades the overlay
   * and retries next tick (invariant 1 — air is never in the path).
   */
  private async enforceMedia(
    station: StationId,
    ref: string,
    slot: ProjectableSlot,
  ): Promise<void> {
    const result = await this.deps.write.setBlockMedia(station, ref, slot.mediaIds);
    if (!result.ok) {
      this.deps.logger.warn("driver: media assign failed", {
        slotId: slot.slotId,
        reason: result.error.message,
      });
    }
  }

  private async refreshBookkeeping(
    station: StationId,
    slot: ProjectableSlot,
    ref: string,
    desiredNorm: NormalizedBlock,
  ): Promise<void> {
    const readback = await this.deps.write.readScheduleBlock(station, ref);
    const lastSeen =
      readback.ok && readback.value ? normalizeSnapshot(readback.value) : desiredNorm;
    const existing = await this.deps.projections.getByObject("slot", slot.slotId, station.value);
    if (!existing) return;
    await this.deps.projections.upsert({
      ...toUpsert(existing),
      azId: ref,
      lastPushed: desiredNorm,
      lastSeen,
      reconcileState: "synced",
      lastSyncedAt: this.deps.clock.now().toISOString(),
    });
  }

  private async persistNew(
    station: StationId,
    slot: ProjectableSlot,
    ref: string,
    lastPushed: NormalizedBlock,
    lastSeen: NormalizedBlock,
  ): Promise<void> {
    await this.deps.projections.upsert({
      osObjectType: "slot",
      osObjectId: slot.slotId,
      stationId: station.value,
      azKind: "playlist",
      azId: ref,
      tagMarker: markerFor(slot.slotId),
      lastPushed,
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
    patch: {
      lastSeen?: unknown;
      azId?: string | null;
      lastPushed?: unknown;
      state: "synced" | "drifted";
      touch?: boolean;
    },
  ): Promise<void> {
    await this.deps.projections.upsert({
      ...toUpsert(proj),
      ...(patch.azId !== undefined ? { azId: patch.azId } : {}),
      ...(patch.lastSeen !== undefined ? { lastSeen: patch.lastSeen } : {}),
      ...(patch.lastPushed !== undefined ? { lastPushed: patch.lastPushed } : {}),
      reconcileState: patch.state,
      lastSyncedAt: patch.touch ? this.deps.clock.now().toISOString() : proj.lastSyncedAt,
    });
  }

  /** Pick a side (PD §6). Serialized against the reconcile loop; re-runs after. */
  async resolve(
    reconciliationId: number,
    resolution: "keep-ondestudio" | "keep-azuracast",
  ): Promise<Result<void, DomainError>> {
    let rerun = false;
    let outcome: Result<void, DomainError> = ok(undefined);
    await this.exclusive(async () => {
      const item = await this.deps.projections.getOpenReconciliation(reconciliationId);
      if (!item) {
        outcome = err(DomainError.notFound("reconciliation"));
        return;
      }
      const station = StationId.parse(item.projection.stationId);
      if (!station.ok) {
        outcome = station;
        return;
      }
      const proj = item.projection;
      const read = proj.azId
        ? await this.deps.write.readScheduleBlock(station.value, proj.azId)
        : null;
      const snapshot = read?.ok ? read.value : null;

      if (resolution === "keep-azuracast") {
        if (snapshot === null) {
          // AzuraCast deleted the playlist and the team accepts it: un-validate
          // the slot so the driver stops projecting it (it stays a grid hold).
          const retracted = await this.deps.sink.retractSlot(station.value, proj.osObjectId);
          if (!retracted.ok) {
            outcome = retracted;
            return;
          }
          await this.deps.projections.remove(proj.id);
          await this.deps.projections.resolveReconciliation(
            reconciliationId,
            resolution,
            this.deps.clock.now().toISOString(),
          );
          return; // slot no longer projectable — no re-run needed
        }
        const inverted = invertToRecurrence(snapshot.scheduleItems);
        if (!inverted) {
          // Can't represent this edit in OndeStudio → do NOT overwrite it; leave
          // the reconciliation open (never fight a manual edit, PD §6).
          outcome = err(
            DomainError.conflict(
              "this AzuraCast schedule can't be pulled into OndeStudio (multiple items or every-day) — simplify it upstream, or choose keep-OndeStudio",
            ),
          );
          return;
        }
        const applied = await this.deps.sink.applyScheduleFromAzuracast(
          station.value,
          proj.osObjectId,
          inverted,
        );
        if (!applied.ok) {
          outcome = applied;
          return;
        }
        await this.persist(proj, {
          lastSeen: normalizeSnapshot(snapshot),
          lastPushed: normalizeSnapshot(snapshot),
          state: "synced",
        });
      } else {
        // keep-ondestudio: re-push OndeStudio over the edit; recreate if deleted.
        if (snapshot === null) {
          await this.persist(proj, { azId: null, state: "synced" });
        } else {
          await this.persist(proj, { lastSeen: normalizeSnapshot(snapshot), state: "synced" });
        }
      }
      await this.deps.projections.resolveReconciliation(
        reconciliationId,
        resolution,
        this.deps.clock.now().toISOString(),
      );
      rerun = true;
    });
    if (rerun) await this.runOnce();
    return outcome;
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
