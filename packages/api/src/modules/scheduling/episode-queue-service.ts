import type { Episode, EpisodeQueueResponse, RescanResult } from "@ondestudio/shared";
import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import { encodeOccurrenceId, type Occurrence } from "./domain/occurrence";
import type { MediaScanPort } from "./ports";
import type { EpisodeRow, SchedulingRepo, ShowRecord } from "./repo";
import type { SchedulingService } from "./service";
import "./events";

const FILL_HORIZON_DAYS = 45;
const DAY_MS = 24 * 3_600_000;

/**
 * The episode queue (PD §4.5, ADR-0013): a show's drop folder feeds a queue
 * that auto-fills its upcoming empty occurrences. A sibling of ShowService in
 * the scheduling module; it reuses the grid's occurrence merge (never
 * duplicated) and emits `grid-changed` so the grid refetches and the driver
 * re-projects the new content.
 */
export class EpisodeQueueService {
  constructor(
    private readonly deps: {
      repo: SchedulingRepo;
      grid: Pick<SchedulingService, "listOccurrences">;
      media: MediaScanPort;
      bus: EventBus;
      clock: Clock;
      zone: string;
    },
  ) {}

  /** The queue view: each episode with the occurrence it fills, in queue order. */
  async queue(
    // Shows are station-agnostic in phase 1; the param keeps the route shape.
    _station: StationId,
    showId: number,
  ): Promise<Result<EpisodeQueueResponse, DomainError>> {
    const show = await this.deps.repo.getShow(showId);
    if (!show) return err(DomainError.notFound("show"));
    const episodes = await this.deps.repo.listEpisodes(showId);
    const fillByEpisode = await this.fillMap(showId);
    return ok({
      showId,
      dropFolderPath: show.dropFolderPath,
      episodes: episodes.map((episode) => this.toContract(episode, fillByEpisode.get(episode.id))),
    });
  }

  /** Scan the drop folder, sync episode rows, then fill occurrences (PD §4.5). */
  async scanAndFill(
    station: StationId,
    showId: number,
  ): Promise<Result<RescanResult, DomainError>> {
    const show = await this.deps.repo.getShow(showId);
    if (!show) return err(DomainError.notFound("show"));

    let scanned = 0;
    let added = 0;
    let removed = 0;
    if (show.dropFolderPath) {
      const files = await this.deps.media.listFolderFiles(station, show.dropFolderPath);
      if (!files.ok) return files;
      scanned = files.value.length;

      const existing = await this.deps.repo.listEpisodes(showId);
      const existingByFile = new Map(existing.map((e) => [e.azFileId, e]));
      const consumedFileIds = await this.consumedFileIds(showId, existing);

      // Append after the current tail — max(queueOrder)+1, NOT the row count.
      // deleteEpisodesExcept leaves holes without renumbering, so a count can
      // reuse a live order and sort a fresh arrival ahead of an older waiting
      // episode — corrupting the arrival order that drives airing (ADR-0013).
      let order = existing.reduce((max, episode) => Math.max(max, episode.queueOrder + 1), 0);
      for (const file of files.value) {
        if (existingByFile.has(file.azFileId)) continue;
        await this.deps.repo.insertEpisode({
          showId,
          azFileId: file.azFileId,
          path: file.path,
          title: file.title,
          artist: file.artist,
          durationSec: file.durationSec,
          queueOrder: order++,
          arrivedAt: this.deps.clock.now().toISOString(),
        });
        added += 1;
      }
      // Remove episodes whose file vanished — but keep any already bound to an
      // occurrence (deleting them would erase the record of what aired).
      const keep = new Set([...files.value.map((f) => f.azFileId), ...consumedFileIds]);
      removed = existing.filter((e) => !keep.has(e.azFileId)).length;
      await this.deps.repo.deleteEpisodesExcept(showId, [...keep]);
    }

    const filled = await this.fill(station, showId, show);
    this.deps.bus.emit("scheduling.grid-changed", {
      station: station.value,
      reason: "occurrence-patched",
    });
    return ok({ scanned, added, removed, filled });
  }

  /** Manual reorder (arrival order isn't always the airing order the team wants). */
  async reorder(
    station: StationId,
    showId: number,
    orderedIds: number[],
  ): Promise<Result<EpisodeQueueResponse, DomainError>> {
    const show = await this.deps.repo.getShow(showId);
    if (!show) return err(DomainError.notFound("show"));
    await this.deps.repo.setEpisodeOrder(showId, orderedIds);
    // Re-fill: order decides which episode lands on which occurrence.
    await this.fill(station, showId, show);
    this.deps.bus.emit("scheduling.grid-changed", {
      station: station.value,
      reason: "occurrence-patched",
    });
    return this.queue(station, showId);
  }

  /**
   * For the driver (deterministic episode selection, PD §4.11): the az file of
   * the episode airing on each slot's NEAREST upcoming occurrence. Recomputed
   * each reconcile, so the projected playlist swaps as occurrences advance.
   */
  async currentEpisodeMediaBySlot(station: StationId): Promise<Map<number, string>> {
    const now = this.deps.clock.now();
    const listed = await this.deps.grid.listOccurrences(
      station,
      now,
      new Date(now.getTime() + FILL_HORIZON_DAYS * DAY_MS),
    );
    if (!listed.ok) return new Map();

    const nearestBySlot = new Map<number, { at: number; episodeId: number }>();
    for (const { occurrence } of listed.value) {
      if (occurrence.endsAtUtc.getTime() <= now.getTime() || occurrence.episodeId === null)
        continue;
      const slotId = occurrence.key.slotId;
      const at = occurrence.startsAtUtc.getTime();
      const current = nearestBySlot.get(slotId);
      if (!current || at < current.at)
        nearestBySlot.set(slotId, { at, episodeId: occurrence.episodeId });
    }

    const media = new Map<number, string>();
    for (const [slotId, { episodeId }] of nearestBySlot) {
      const episode = await this.deps.repo.getEpisode(episodeId);
      if (episode) media.set(slotId, episode.azFileId);
    }
    return media;
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async fill(station: StationId, showId: number, show: ShowRecord): Promise<number> {
    const episodes = await this.deps.repo.listEpisodes(showId);
    const occRows = await this.deps.repo.occurrenceRowsForShow(showId);
    const consumed = new Set(
      occRows.map((o) => o.episodeId).filter((x): x is number => x !== null),
    );
    const unconsumed = episodes.filter((e) => !consumed.has(e.id));

    const now = this.deps.clock.now();
    const listed = await this.deps.grid.listOccurrences(
      station,
      now,
      new Date(now.getTime() + FILL_HORIZON_DAYS * DAY_MS),
    );
    if (!listed.ok) return 0;
    const empty = listed.value
      .filter(
        (o) =>
          o.slot.showId === showId &&
          o.occurrence.endsAtUtc.getTime() > now.getTime() &&
          o.occurrence.episodeId === null &&
          o.occurrence.content.value === "empty",
      )
      .sort((a, b) => a.occurrence.startsAtUtc.getTime() - b.occurrence.startsAtUtc.getTime());

    let filled = 0;
    const assignable = Math.min(unconsumed.length, empty.length);
    for (let i = 0; i < assignable; i++) {
      const target = empty[i];
      const episode = unconsumed[i];
      if (!target || !episode) continue;
      await this.deps.repo.upsertOccurrence(
        target.occurrence.withEpisode(episode.id, show.trustAutoAir),
      );
      filled += 1;
    }

    // Queue dry: apply the per-show fallback to just the NEAREST still-empty
    // occurrence (further ones fill as content arrives) — PD §4.5.
    const nextEmpty = empty[assignable];
    if (nextEmpty && show.fallbackPolicy === "replay_previous") {
      const previous = this.previousEpisodeId(occRows, now);
      if (previous !== null) {
        await this.deps.repo.upsertOccurrence(nextEmpty.occurrence.withEpisode(previous, true));
        filled += 1;
      }
    }
    return filled;
  }

  private previousEpisodeId(occRows: Occurrence[], now: Date): number | null {
    let best: { at: number; episodeId: number } | null = null;
    for (const o of occRows) {
      if (o.episodeId === null || o.startsAtUtc.getTime() >= now.getTime()) continue;
      if (!best || o.startsAtUtc.getTime() > best.at)
        best = { at: o.startsAtUtc.getTime(), episodeId: o.episodeId };
    }
    return best?.episodeId ?? null;
  }

  private async consumedFileIds(showId: number, existing: EpisodeRow[]): Promise<Set<string>> {
    const occRows = await this.deps.repo.occurrenceRowsForShow(showId);
    const consumedIds = new Set(
      occRows.map((o) => o.episodeId).filter((x): x is number => x !== null),
    );
    return new Set(existing.filter((e) => consumedIds.has(e.id)).map((e) => e.azFileId));
  }

  private async fillMap(showId: number): Promise<Map<number, { id: string; at: string }>> {
    const occRows = await this.deps.repo.occurrenceRowsForShow(showId);
    const map = new Map<number, { id: string; at: string }>();
    for (const o of occRows) {
      if (o.episodeId === null) continue;
      map.set(o.episodeId, { id: encodeOccurrenceId(o.key), at: o.startsAtUtc.toISOString() });
    }
    return map;
  }

  private toContract(episode: EpisodeRow, fill: { id: string; at: string } | undefined): Episode {
    return {
      id: episode.id,
      azFileId: episode.azFileId,
      path: episode.path,
      title: episode.title,
      artist: episode.artist,
      durationSec: episode.durationSec,
      arrivedAt: episode.arrivedAt,
      filledOccurrenceId: fill?.id ?? null,
      filledOccurrenceAt: fill?.at ?? null,
    };
  }
}
