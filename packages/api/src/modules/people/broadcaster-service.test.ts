import { beforeEach, describe, expect, test } from "bun:test";
import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result, unwrap } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createDb } from "../../platform/db";
import { silentLogger } from "../../platform/logger";
import { DrizzleBroadcasterRepo } from "./broadcaster-repo";
import { BroadcasterService } from "./broadcaster-service";
import type { StreamerDef, StreamerDirectoryPort, StreamerRecord } from "./ports";

const oz = unwrap(StationId.parse("oz"));
const wzTest = unwrap(StationId.parse("wz-test"));

/** In-memory playout side, recording every write per station. */
class FakeStreamers implements StreamerDirectoryPort {
  streamers = new Map<string, Map<string, StreamerRecord & { password?: string }>>();
  private nextRef = 100;
  fail = false;

  seed(station: StationId, records: Partial<StreamerRecord>[]): void {
    const map = this.mapFor(station);
    for (const record of records) {
      const ref = record.ref ?? String(this.nextRef++);
      map.set(ref, {
        ref,
        username: record.username ?? "user",
        displayName: record.displayName ?? record.username ?? "user",
        isActive: record.isActive ?? true,
        enforceSchedule: record.enforceSchedule ?? false,
        comments: record.comments ?? "",
      });
    }
  }
  private mapFor(station: StationId) {
    let map = this.streamers.get(station.value);
    if (!map) {
      map = new Map();
      this.streamers.set(station.value, map);
    }
    return map;
  }
  async list(station: StationId): Promise<Result<StreamerRecord[], DomainError>> {
    if (this.fail) return err(DomainError.upstreamUnavailable("down"));
    return ok([...this.mapFor(station).values()]);
  }
  async create(station: StationId, def: StreamerDef): Promise<Result<{ ref: string }, DomainError>> {
    if (this.fail) return err(DomainError.upstreamUnavailable("down"));
    const ref = String(this.nextRef++);
    this.mapFor(station).set(ref, {
      ref,
      username: def.username,
      displayName: def.displayName,
      isActive: def.isActive,
      enforceSchedule: def.enforceSchedule,
      comments: def.comments,
      password: def.password,
    });
    return ok({ ref });
  }
  async update(
    station: StationId,
    ref: string,
    def: Partial<StreamerDef>,
  ): Promise<Result<void, DomainError>> {
    const existing = this.mapFor(station).get(ref);
    if (!existing) return err(DomainError.notFound("streamer"));
    Object.assign(existing, {
      ...(def.displayName !== undefined ? { displayName: def.displayName } : {}),
      ...(def.comments !== undefined ? { comments: def.comments } : {}),
      ...(def.enforceSchedule !== undefined ? { enforceSchedule: def.enforceSchedule } : {}),
      ...(def.password !== undefined ? { password: def.password } : {}),
    });
    return ok(undefined);
  }
  async remove(station: StationId, ref: string): Promise<Result<void, DomainError>> {
    this.mapFor(station).delete(ref);
    return ok(undefined);
  }
}

let streamers: FakeStreamers;
let service: BroadcasterService;

beforeEach(() => {
  streamers = new FakeStreamers();
  service = new BroadcasterService({
    repo: new DrizzleBroadcasterRepo(createDb(":memory:", silentLogger)),
    streamers,
    mainStation: oz,
    testStation: wzTest,
    // The §7.7 posture under test: wz-test writable, oz blocked.
    writeStations: [wzTest],
    logger: silentLogger,
  });
});

describe("BroadcasterService fan-out (docs/2 §7.7 posture: wz-test only)", () => {
  test("create pushes the tagged streamer to wz-test only; oz reports blocked", async () => {
    const created = unwrap(
      await service.create({
        username: "NewDJ",
        displayName: "New DJ",
        kind: "external",
        enforceSchedule: true,
        replayFlag: "not_specified",
      }),
    );
    expect(created.generatedPassword).toHaveLength(16);
    expect(created.warnings.some((w) => w.includes("oz"))).toBe(true);

    const pushed = [...(streamers.streamers.get("wz-test")?.values() ?? [])];
    expect(pushed).toHaveLength(1);
    expect(pushed[0]?.comments).toContain("[ondestudio:broadcaster:");
    // Test mirrors NEVER enforce, whatever the definition says (PD §2.2).
    expect(pushed[0]?.enforceSchedule).toBe(false);
    expect(streamers.streamers.get("oz")).toBeUndefined();

    const stations = Object.fromEntries(created.broadcaster.stations.map((s) => [s.station, s]));
    expect(stations.oz?.status).toBe("blocked");
    expect(stations["wz-test"]?.status).toBe("linked");
  });

  test("update fans out to linked writable stations; duplicate usernames are 409", async () => {
    const created = unwrap(
      await service.create({
        username: "NewDJ",
        displayName: "New DJ",
        kind: "external",
        enforceSchedule: false,
        replayFlag: "not_specified",
      }),
    );
    const duplicate = await service.create({
      username: "NewDJ",
      displayName: "Again",
      kind: "external",
      enforceSchedule: false,
      replayFlag: "not_specified",
    });
    expect(duplicate.ok).toBe(false);

    unwrap(await service.update(created.broadcaster.id, { displayName: "Renamed DJ" }));
    const pushed = [...(streamers.streamers.get("wz-test")?.values() ?? [])];
    expect(pushed[0]?.displayName).toBe("Renamed DJ");
  });

  test("rotate sets a fresh credential on writable stations and returns it once", async () => {
    const created = unwrap(
      await service.create({
        username: "NewDJ",
        displayName: "New DJ",
        kind: "external",
        enforceSchedule: false,
        replayFlag: "not_specified",
      }),
    );
    const before = [...(streamers.streamers.get("wz-test")?.values() ?? [])][0]?.password;
    const rotated = unwrap(await service.rotatePassword(created.broadcaster.id));
    const after = [...(streamers.streamers.get("wz-test")?.values() ?? [])][0]?.password;
    expect(rotated.generatedPassword).toHaveLength(16);
    expect(after).toBe(rotated.generatedPassword ?? "");
    expect(after).not.toBe(before);
  });

  test("delete removes writable streamers, leaves blocked ones with a warning", async () => {
    streamers.seed(oz, [{ ref: "7", username: "Adopted" }]);
    streamers.seed(wzTest, [{ ref: "8", username: "Adopted" }]);
    unwrap(await service.importExisting());
    const adopted = (await service.list()).find((b) => b.username === "Adopted");
    if (!adopted) throw new Error("missing adopted broadcaster");

    const warnings = unwrap(await service.remove(adopted.id));
    expect(warnings.some((w) => w.includes("oz"))).toBe(true);
    expect(streamers.streamers.get("oz")?.has("7")).toBe(true); // untouched
    expect(streamers.streamers.get("wz-test")?.has("8")).toBe(false); // removed
  });

  test("import adopts main streamers, links test mirrors, reports the real drift", async () => {
    // The PD §2.3 situation: PWood missing on test, pld2 a leftover there.
    streamers.seed(oz, [
      { ref: "1", username: "Maigre", displayName: "Maigre", enforceSchedule: false },
      { ref: "2", username: "PWood", displayName: "Flotilla", enforceSchedule: true },
    ]);
    streamers.seed(wzTest, [
      { ref: "11", username: "Maigre" },
      { ref: "12", username: "pld2" },
    ]);

    const result = unwrap(await service.importExisting());
    expect(result.imported).toBe(2);
    expect(result.missingOnTest).toEqual(["PWood"]);
    expect(result.onlyOnTest).toEqual(["pld2"]);

    const list = await service.list();
    const maigre = list.find((b) => b.username === "Maigre");
    expect(maigre?.hasPassword).toBe(false); // adopted creds are unknowable
    expect(maigre?.stations.find((s) => s.station === "wz-test")?.ref).toBe("11");
    // Re-import links, never duplicates.
    const again = unwrap(await service.importExisting());
    expect(again.imported).toBe(0);
    expect(again.linked).toBe(2);
  });

  test("sync-test creates the missing mirror with a fresh credential and an honest warning", async () => {
    streamers.seed(oz, [{ ref: "2", username: "PWood", displayName: "Flotilla" }]);
    unwrap(await service.importExisting());
    const pwood = (await service.list()).find((b) => b.username === "PWood");
    if (!pwood) throw new Error("missing PWood");

    const synced = unwrap(await service.syncTestMirror(pwood.id));
    expect(synced.generatedPassword).toHaveLength(16);
    expect(synced.warnings.some((w) => w.includes("main"))).toBe(true);
    expect(synced.broadcaster.stations.find((s) => s.station === "wz-test")?.ref).toBeTruthy();
    // Idempotence guard: a linked mirror refuses a second sync.
    expect((await service.syncTestMirror(pwood.id)).ok).toBe(false);
  });
});
