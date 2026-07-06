import { beforeEach, describe, expect, test } from "bun:test";
import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result, unwrap } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createDb } from "../../platform/db";
import { silentLogger } from "../../platform/logger";
import { PlayoutDriver } from "./driver";
import type {
  PlayoutWritePort,
  ProjectableSlot,
  ScheduleBlock,
  ScheduleBlockSnapshot,
  SlotSinkPort,
  SlotSourcePort,
} from "./ports";
import { DrizzleProjectionRepo } from "./projection-repo";

const wzTest = unwrap(StationId.parse("wz-test"));

/** In-memory AzuraCast playlists — supports manual-edit/delete injection for drift tests. */
class FakePlayout implements PlayoutWritePort {
  playlists = new Map<
    string,
    {
      name: string;
      isEnabled: boolean;
      scheduleItems: ScheduleBlock["scheduleItems"];
      marker: string;
    }
  >();
  createCalls = 0;
  updateCalls = 0;
  deleteCalls = 0;
  /** Simulate a PUT that lands upstream but whose response times out. */
  landButFailNextUpdate = false;
  private nextId = 500;

  /** Seed an already-tagged playlist as if a prior create landed untracked. */
  seed(marker: string, scheduleItems: ScheduleBlock["scheduleItems"], name = "seeded"): string {
    const ref = String(this.nextId++);
    this.playlists.set(ref, { name, isEnabled: true, scheduleItems, marker });
    return ref;
  }

  async createScheduleBlock(
    _s: StationId,
    block: ScheduleBlock,
  ): Promise<Result<{ ref: string }, DomainError>> {
    this.createCalls += 1;
    const ref = String(this.nextId++);
    this.playlists.set(ref, {
      name: block.name,
      isEnabled: true,
      scheduleItems: block.scheduleItems,
      marker: block.tagMarker,
    });
    return ok({ ref });
  }
  async updateScheduleBlock(
    _s: StationId,
    ref: string,
    block: ScheduleBlock,
  ): Promise<Result<void, DomainError>> {
    this.updateCalls += 1;
    const existing = this.playlists.get(ref);
    if (existing) {
      existing.name = block.name;
      existing.scheduleItems = block.scheduleItems;
      existing.isEnabled = true;
    }
    if (this.landButFailNextUpdate) {
      this.landButFailNextUpdate = false;
      return err(DomainError.upstreamUnavailable("timed out after landing"));
    }
    return ok(undefined);
  }
  async listTaggedBlocks(
    _s: StationId,
  ): Promise<
    Result<{ ref: string; marker: string; snapshot: ScheduleBlockSnapshot }[], DomainError>
  > {
    return ok(
      [...this.playlists.entries()].map(([ref, p]) => ({
        ref,
        marker: p.marker,
        snapshot: {
          name: p.name,
          isEnabled: p.isEnabled,
          scheduleItems: p.scheduleItems,
          mediaIds: [],
        },
      })),
    );
  }
  async removeScheduleBlock(_s: StationId, ref: string): Promise<Result<void, DomainError>> {
    this.deleteCalls += 1;
    this.playlists.delete(ref);
    return ok(undefined);
  }
  async setBlockMedia(): Promise<Result<void, DomainError>> {
    return ok(undefined);
  }
  async readScheduleBlock(
    _s: StationId,
    ref: string,
  ): Promise<Result<ScheduleBlockSnapshot | null, DomainError>> {
    const p = this.playlists.get(ref);
    if (!p) return ok(null);
    return ok({
      name: p.name,
      isEnabled: p.isEnabled,
      scheduleItems: p.scheduleItems,
      mediaIds: [],
    });
  }
}

const oneSlot = (overrides: Partial<ProjectableSlot> = {}): ProjectableSlot => ({
  slotId: 1,
  title: "Minuit Décousu",
  name: "[OndeStudio] Minuit Décousu",
  scheduleItems: [{ startTime: 2200, endTime: 0, days: [4] }],
  mediaIds: [],
  ...overrides,
});

let write: FakePlayout;
let repo: DrizzleProjectionRepo;
let desired: ProjectableSlot[];
let sinkCalls: { slotId: number; time: string; durationMin: number }[];
let retractCalls: number[];
let driver: PlayoutDriver;

beforeEach(() => {
  write = new FakePlayout();
  repo = new DrizzleProjectionRepo(createDb(":memory:", silentLogger));
  desired = [oneSlot()];
  sinkCalls = [];
  retractCalls = [];
  const slots: SlotSourcePort = { listProjectable: async () => ok([...desired]) };
  const sink: SlotSinkPort = {
    applyScheduleFromAzuracast: async (_s, slotId, sched) => {
      sinkCalls.push({ slotId, time: sched.time, durationMin: sched.durationMin });
      return ok(undefined);
    },
    // Un-validating a slot removes it from the desired set (real behaviour).
    retractSlot: async (_s, slotId) => {
      retractCalls.push(slotId);
      desired = desired.filter((s) => s.slotId !== slotId);
      return ok(undefined);
    },
  };
  driver = new PlayoutDriver({
    write,
    projections: repo,
    slots,
    sink,
    writeStations: [wzTest],
    adapterHealthy: () => true,
    clock: { now: () => new Date("2026-07-07T12:00:00Z") },
    logger: silentLogger,
  });
});

describe("PlayoutDriver reconcile loop (RFC 0001)", () => {
  test("first run creates the tagged playlist; a second run is a no-op (stable, no false drift)", async () => {
    await driver.runOnce();
    expect(write.createCalls).toBe(1);
    expect([...write.playlists.values()][0]?.marker).toBe("[ondestudio:slot:1]");
    const proj = await repo.getByObject("slot", 1, "wz-test");
    expect(proj?.azId).not.toBeNull();
    expect(proj?.reconcileState).toBe("synced");

    await driver.runOnce();
    expect(write.createCalls).toBe(1);
    expect(write.updateCalls).toBe(0); // already in sync — nothing pushed
  });

  test("an OndeStudio edit pushes an update; unchanged desired never re-pushes", async () => {
    await driver.runOnce();
    desired = [oneSlot({ scheduleItems: [{ startTime: 2300, endTime: 100, days: [4] }] })];
    await driver.runOnce();
    expect(write.updateCalls).toBe(1);
    expect([...write.playlists.values()][0]?.scheduleItems[0]?.startTime).toBe(2300);
    await driver.runOnce();
    expect(write.updateCalls).toBe(1); // stable again
  });

  test("a manual AzuraCast edit queues a reconciliation and freezes the push (never fight)", async () => {
    await driver.runOnce();
    const ref = [...write.playlists.keys()][0];
    if (!ref) throw new Error("no playlist");
    // Someone edits the playlist directly in AzuraCast.
    const row = write.playlists.get(ref);
    if (row) row.scheduleItems = [{ startTime: 1000, endTime: 1100, days: [1] }];

    await driver.runOnce();
    const open = await driver.listReconciliations();
    expect(open).toHaveLength(1);
    expect(open[0]?.kind).toBe("edited");
    const proj = await repo.getByObject("slot", 1, "wz-test");
    expect(proj?.reconcileState).toBe("drifted");

    // While drifted, OndeStudio never overwrites the manual edit.
    await driver.runOnce();
    expect(write.updateCalls).toBe(0);
    expect(write.playlists.get(ref)?.scheduleItems[0]?.startTime).toBe(1000);
  });

  test("keep-ondestudio re-pushes OndeStudio's version over the manual edit", async () => {
    await driver.runOnce();
    const ref = [...write.playlists.keys()][0] ?? "";
    const row = write.playlists.get(ref);
    if (row) row.scheduleItems = [{ startTime: 1000, endTime: 1100, days: [1] }];
    await driver.runOnce();
    const item = (await driver.listReconciliations())[0];
    if (!item) throw new Error("no reconciliation");

    unwrap(await driver.resolve(item.id, "keep-ondestudio"));
    // resolve triggers a run; the manual edit is overwritten with the OS schedule.
    expect(write.playlists.get(ref)?.scheduleItems[0]?.startTime).toBe(2200);
    expect(await driver.listReconciliations()).toHaveLength(0);
  });

  test("keep-azuracast pulls the manual edit into the OndeStudio slot", async () => {
    await driver.runOnce();
    const ref = [...write.playlists.keys()][0] ?? "";
    const row = write.playlists.get(ref);
    if (row) row.scheduleItems = [{ startTime: 1000, endTime: 1130, days: [1, 3] }];
    await driver.runOnce();
    const item = (await driver.listReconciliations())[0];
    if (!item) throw new Error("no reconciliation");

    unwrap(await driver.resolve(item.id, "keep-azuracast"));
    expect(sinkCalls).toHaveLength(1);
    expect(sinkCalls[0]).toEqual({ slotId: 1, time: "10:00", durationMin: 90 });
    expect(await driver.listReconciliations()).toHaveLength(0);
  });

  test("a slot that stops being projectable retracts its playlist", async () => {
    await driver.runOnce();
    expect(write.playlists.size).toBe(1);
    desired = []; // un-validated / deleted
    await driver.runOnce();
    expect(write.deleteCalls).toBe(1);
    expect(write.playlists.size).toBe(0);
    expect(await repo.getByObject("slot", 1, "wz-test")).toBeNull();
  });

  test("a manual AzuraCast delete of a still-wanted slot queues a reconciliation, not a silent recreate", async () => {
    await driver.runOnce();
    write.playlists.clear(); // deleted in AzuraCast
    await driver.runOnce();
    const open = await driver.listReconciliations();
    expect(open).toHaveLength(1);
    expect(open[0]?.kind).toBe("deleted");
    // No blind recreate while it's unresolved.
    expect(write.createCalls).toBe(1);
  });

  test("create is idempotent by marker: a tagged playlist that already exists is adopted, not duplicated", async () => {
    // Simulate a create that landed upstream but whose ledger row was never
    // written (timed-out response) — the marker is present with no projection.
    write.seed("[ondestudio:slot:1]", [{ startTime: 2200, endTime: 0, days: [4] }]);
    await driver.runOnce();
    expect(write.createCalls).toBe(0); // adopted, not re-created
    expect(write.playlists.size).toBe(1);
    const proj = await repo.getByObject("slot", 1, "wz-test");
    expect(proj?.azId).not.toBeNull();
    expect(proj?.reconcileState).toBe("synced");
  });

  test("keep-azuracast on a non-invertible manual edit refuses and leaves it untouched (never fight)", async () => {
    await driver.runOnce();
    const ref = [...write.playlists.keys()][0] ?? "";
    const row = write.playlists.get(ref);
    // Two schedule_items — cannot be represented as one OndeStudio recurrence.
    if (row)
      row.scheduleItems = [
        { startTime: 1000, endTime: 1100, days: [1] },
        { startTime: 1500, endTime: 1600, days: [3] },
      ];
    await driver.runOnce();
    const item = (await driver.listReconciliations())[0];
    if (!item) throw new Error("no reconciliation");

    const result = await driver.resolve(item.id, "keep-azuracast");
    expect(result.ok).toBe(false); // refused — can't pull it in
    expect(sinkCalls).toHaveLength(0); // the OS slot was NOT changed
    expect(await driver.listReconciliations()).toHaveLength(1); // still open
    expect(write.playlists.get(ref)?.scheduleItems).toHaveLength(2); // edit untouched
  });

  test("keep-ondestudio on a playlist deleted in AzuraCast recreates it", async () => {
    await driver.runOnce();
    write.playlists.clear();
    await driver.runOnce();
    const item = (await driver.listReconciliations())[0];
    if (!item) throw new Error("no reconciliation");

    unwrap(await driver.resolve(item.id, "keep-ondestudio"));
    expect(write.createCalls).toBe(2); // recreated
    expect(write.playlists.size).toBe(1);
    expect(await driver.listReconciliations()).toHaveLength(0);
  });

  test("keep-azuracast on a deleted playlist un-validates the slot and stops projecting it", async () => {
    await driver.runOnce();
    write.playlists.clear();
    await driver.runOnce();
    const item = (await driver.listReconciliations())[0];
    if (!item) throw new Error("no reconciliation");

    unwrap(await driver.resolve(item.id, "keep-azuracast"));
    expect(retractCalls).toEqual([1]); // slot un-validated
    expect(await repo.getByObject("slot", 1, "wz-test")).toBeNull(); // projection dropped
    // And a later sweep does not resurrect it (the slot is no longer projectable).
    await driver.runOnce();
    expect(write.createCalls).toBe(1);
    expect(await driver.listReconciliations()).toHaveLength(0);
  });

  test("an update that lands upstream but times out does not open a false drift", async () => {
    await driver.runOnce();
    desired = [oneSlot({ scheduleItems: [{ startTime: 2300, endTime: 100, days: [4] }] })];
    write.landButFailNextUpdate = true; // the PUT applies but returns err
    await driver.runOnce();
    // The playlist did change upstream; the readback keeps last_seen truthful.
    expect([...write.playlists.values()][0]?.scheduleItems[0]?.startTime).toBe(2300);
    await driver.runOnce();
    expect(await driver.listReconciliations()).toHaveLength(0); // no false "edited" drift
  });
});
