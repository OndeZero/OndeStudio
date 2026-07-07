import { describe, expect, test } from "bun:test";
import { EpisodeQueueResponseSchema } from "@ondestudio/shared";
import type { Clock } from "../../kernel/clock";
import { EventBus } from "../../kernel/event-bus";
import { ok } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import { createDb } from "../../platform/db";
import { silentLogger } from "../../platform/logger";
import { EpisodeQueueService } from "./episode-queue-service";
import type { FolderFile, MediaScanPort, MirrorSchedulePort } from "./ports";
import { DrizzleSchedulingRepo } from "./repo";
import { type EnrichedOccurrence, SchedulingService } from "./service";
import { ShowService } from "./show-service";

/**
 * Fill-logic proof for the episode queue (PD §4.5, ADR-0013): real repo →
 * SQLite (in-memory, real migrations) → the grid's own occurrence merge. Only
 * the drop-folder scan is faked (AzuraCast's files API). A fixed clock makes
 * "nearest upcoming occurrence" deterministic without hardcoding wall-clock
 * math — assertions read the merged grid rather than expected timestamps.
 */
const ZONE = "Europe/Paris";
const HOUR_MS = 3_600_000;
const FOLDER = "[SHOWS]/Test";

const parsedStation = StationId.parse("oz");
if (!parsedStation.ok) throw new Error("station fixture is invalid");
const station = parsedStation.value;

const mirror: MirrorSchedulePort = { fetchBlocks: () => Promise.resolve(ok([])) };

/** Shared mutable drop folder — a test sets its contents before each scan. */
let folder: FolderFile[] = [];
function setFolder(...files: FolderFile[]): void {
  folder = files;
}
function file(id: string, path: string): FolderFile {
  return {
    azFileId: id,
    path,
    title: path.split("/").pop() ?? path,
    artist: null,
    durationSec: 60,
  };
}

/** Filters the shared folder by prefix, exactly as the real files adapter does. */
const media: MediaScanPort = {
  listFolderFiles: async (_s, folderPath) => {
    const prefix = `${folderPath.replace(/\/+$/, "")}/`;
    return ok(folder.filter((f) => f.path.startsWith(prefix)));
  },
};

class MutableClock implements Clock {
  constructor(private current: Date) {}
  now(): Date {
    return this.current;
  }
  set(next: Date): void {
    this.current = next;
  }
}

/** A weekly show (Tue 22:00) with a drop folder, on a fixed Monday-noon clock. */
async function setup(opts?: { trustAutoAir?: boolean; fallback?: "discard" | "replay_previous" }) {
  const clock = new MutableClock(new Date("2026-01-05T12:00:00Z")); // Monday
  const repo = new DrizzleSchedulingRepo(createDb(":memory:", silentLogger));
  const bus = new EventBus(() => {});
  const grid = new SchedulingService({
    repo,
    mirror,
    bus,
    clock,
    logger: silentLogger,
    zone: ZONE,
  });
  const shows = new ShowService({ repo, grid, bus, clock, zone: ZONE });
  const eq = new EpisodeQueueService({ repo, grid, media, bus, clock, zone: ZONE });

  const created = await grid.createSlot(station, {
    kind: "show",
    showName: "Test Show",
    recurrence: { type: "weekly", weekdays: [2], time: "22:00" },
    durationMin: 60,
    bornValidated: true,
  });
  if (!created.ok) throw new Error(created.error.message);
  const showId = created.value.slot.showId;
  if (showId === null) throw new Error("slot not bound to a show");
  const updated = await shows.updateShow(station, showId, {
    dropFolderPath: FOLDER,
    trustAutoAir: opts?.trustAutoAir ?? true,
    fallbackPolicy: opts?.fallback ?? "discard",
  });
  if (!updated.ok) throw new Error(updated.error.message);

  return { clock, repo, grid, eq, showId };
}

async function upcomingForShow(
  grid: SchedulingService,
  showId: number,
  from: Date,
): Promise<EnrichedOccurrence[]> {
  const to = new Date(from.getTime() + 40 * 24 * HOUR_MS);
  const listed = await grid.listOccurrences(station, from, to);
  if (!listed.ok) throw new Error(listed.error.message);
  return listed.value
    .filter((o) => o.slot.showId === showId && o.occurrence.startsAtUtc.getTime() >= from.getTime())
    .sort((a, b) => a.occurrence.startsAtUtc.getTime() - b.occurrence.startsAtUtc.getTime());
}

describe("episode queue fill", () => {
  test("fills the nearest upcoming occurrences in queue order and flips content to ready", async () => {
    const { clock, grid, eq, showId } = await setup({ trustAutoAir: true });
    setFolder(file("707", `${FOLDER}/ep1.flac`), file("708", `${FOLDER}/ep2.flac`));

    const scan = await eq.scanAndFill(station, showId);
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.value).toMatchObject({ scanned: 2, added: 2, removed: 0, filled: 2 });

    const filled = (await upcomingForShow(grid, showId, clock.now())).filter(
      (o) => o.occurrence.episodeId !== null,
    );
    expect(filled).toHaveLength(2);
    expect(filled[0]?.occurrence.content.value).toBe("ready");
    expect(filled[1]?.occurrence.content.value).toBe("ready");

    const q = await eq.queue(station, showId);
    expect(q.ok).toBe(true);
    if (!q.ok) return;
    const queue = EpisodeQueueResponseSchema.parse(q.value);
    expect(queue.episodes.map((e) => e.azFileId)).toEqual(["707", "708"]);
    expect(queue.episodes.every((e) => e.filledOccurrenceId !== null)).toBe(true);
  });

  test("without trust, a filled occurrence lands in received (awaiting review)", async () => {
    const { clock, grid, eq, showId } = await setup({ trustAutoAir: false });
    setFolder(file("707", `${FOLDER}/ep1.flac`));

    expect((await eq.scanAndFill(station, showId)).ok).toBe(true);
    const filled = (await upcomingForShow(grid, showId, clock.now())).filter(
      (o) => o.occurrence.episodeId !== null,
    );
    expect(filled).toHaveLength(1);
    expect(filled[0]?.occurrence.content.value).toBe("received");
  });

  test("currentEpisodeMediaBySlot resolves each slot to its nearest occurrence's file", async () => {
    const { grid, eq, showId } = await setup();
    setFolder(file("707", `${FOLDER}/ep1.flac`), file("708", `${FOLDER}/ep2.flac`));
    await eq.scanAndFill(station, showId);

    const slotId = (await grid.listSlots(station))[0]?.slot.id;
    expect(slotId).toBeDefined();
    const mediaBySlot = await eq.currentEpisodeMediaBySlot(station);
    expect(mediaBySlot.get(slotId as number)).toBe("707"); // nearest upcoming = ep1
  });

  test("a rescan is idempotent — same files add nothing and re-fill nothing", async () => {
    const { eq, showId } = await setup();
    setFolder(file("707", `${FOLDER}/ep1.flac`), file("708", `${FOLDER}/ep2.flac`));
    await eq.scanAndFill(station, showId);

    const again = await eq.scanAndFill(station, showId);
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.value).toMatchObject({ scanned: 2, added: 0, removed: 0, filled: 0 });
  });

  test("a vanished file's episode is kept while it's bound to an occurrence", async () => {
    const { eq, showId } = await setup();
    setFolder(file("707", `${FOLDER}/ep1.flac`), file("708", `${FOLDER}/ep2.flac`));
    await eq.scanAndFill(station, showId); // both consumed by upcoming occurrences

    setFolder(file("707", `${FOLDER}/ep1.flac`)); // ep2's file vanished from the folder
    const scan = await eq.scanAndFill(station, showId);
    expect(scan.ok).toBe(true);
    if (!scan.ok) return;
    expect(scan.value.removed).toBe(0); // ep2 kept — it's the record of what aired
    const q = await eq.queue(station, showId);
    expect(q.ok && q.value.episodes.map((e) => e.azFileId).sort()).toEqual(["707", "708"]);
  });

  test("an unconsumed vanished file IS removed (no occurrence to protect)", async () => {
    // A show with a drop folder but no slot → no occurrences → episodes stay unconsumed.
    const { repo, eq } = await setup();
    const orphan = await repo.findOrCreateShow("Orphan Show");
    await repo.updateShow(orphan.id, { dropFolderPath: "[SHOWS]/Orphan" });

    setFolder(file("A", "[SHOWS]/Orphan/a.flac"), file("B", "[SHOWS]/Orphan/b.flac"));
    const first = await eq.scanAndFill(station, orphan.id);
    expect(first.ok && first.value).toMatchObject({ added: 2, filled: 0 });

    setFolder(file("A", "[SHOWS]/Orphan/a.flac"));
    const scan = await eq.scanAndFill(station, orphan.id);
    expect(scan.ok && scan.value.removed).toBe(1);
    const q = await eq.queue(station, orphan.id);
    expect(q.ok && q.value.episodes.map((e) => e.azFileId)).toEqual(["A"]);
  });

  test("queue order survives an unconsumed delete-then-add (no order collision)", async () => {
    // Orphan show (no slot) keeps episodes unconsumed so the queue order is the
    // whole story — regression for queueOrder derived from the row count.
    const { repo, eq } = await setup();
    const orphan = await repo.findOrCreateShow("Order Show");
    await repo.updateShow(orphan.id, { dropFolderPath: "[SHOWS]/Order" });

    setFolder(
      file("F1", "[SHOWS]/Order/1.flac"),
      file("F2", "[SHOWS]/Order/2.flac"),
      file("F3", "[SHOWS]/Order/3.flac"),
    );
    await eq.scanAndFill(station, orphan.id); // qo 0,1,2

    // F1 and F2 vanish while unconsumed → their episodes are deleted, F3 stays.
    setFolder(file("F3", "[SHOWS]/Order/3.flac"));
    await eq.scanAndFill(station, orphan.id);

    // A fresh file arrives — it must queue AFTER the older still-waiting F3.
    setFolder(file("F3", "[SHOWS]/Order/3.flac"), file("F4", "[SHOWS]/Order/4.flac"));
    await eq.scanAndFill(station, orphan.id);

    const q = await eq.queue(station, orphan.id);
    expect(q.ok && q.value.episodes.map((e) => e.azFileId)).toEqual(["F3", "F4"]);
  });

  test("replay_previous fills the nearest still-empty occurrence when the queue runs dry", async () => {
    const { clock, grid, eq, showId } = await setup({
      trustAutoAir: true,
      fallback: "replay_previous",
    });
    setFolder(file("707", `${FOLDER}/ep1.flac`), file("708", `${FOLDER}/ep2.flac`));
    await eq.scanAndFill(station, showId);

    // Advance past the nearest occurrence so it becomes a consumed PAST airing.
    const nearest = (await upcomingForShow(grid, showId, clock.now()))[0];
    if (!nearest) throw new Error("no upcoming occurrence");
    const ep1 = nearest.occurrence.episodeId;
    clock.set(new Date(nearest.occurrence.endsAtUtc.getTime() + HOUR_MS));

    // Queue is dry (both files consumed); the fallback replays the last aired ep1.
    const scan = await eq.scanAndFill(station, showId);
    expect(scan.ok && scan.value.filled).toBe(1);

    const upcoming = await upcomingForShow(grid, showId, clock.now());
    const replayed = upcoming.filter((o) => o.occurrence.episodeId === ep1);
    expect(replayed).toHaveLength(1); // exactly the nearest still-empty, not all of them
    expect(replayed[0]?.occurrence.content.value).toBe("ready");
    // The nearest upcoming is still ep2's occurrence — the replay sits after it.
    const slotId = (await grid.listSlots(station))[0]?.slot.id as number;
    const mediaBySlot = await eq.currentEpisodeMediaBySlot(station);
    expect(mediaBySlot.get(slotId)).toBe("708");
  });
});
