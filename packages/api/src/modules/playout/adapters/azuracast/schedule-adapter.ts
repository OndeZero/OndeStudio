import { DateTime } from "luxon";
import { type Clock, systemClock } from "../../../../kernel/clock";
import type { DomainError } from "../../../../kernel/domain-error";
import { ok, type Result } from "../../../../kernel/result";
import type { StationId } from "../../../../kernel/station-id";
// Cross-module import through scheduling's public index only (docs/2 §3.4);
// type-only, so playout keeps zero runtime coupling to scheduling.
import type { MirrorBlock, MirrorSchedulePort } from "../../../scheduling";
import type { AzuracastClient } from "./client";
import type { AzPlaylist, AzScheduleItem, AzStreamer } from "./types";

/** Raw per-station payloads plus when they were fetched, for the TTL check. */
interface RawSchedules {
  playlists: AzPlaylist[];
  streamers: AzStreamer[];
  fetchedAtMs: number;
}

/** Structural freshness bar is ≤ 30 s (docs/2 §7.3) — cache raw payloads that long, no longer. */
const CACHE_TTL_MS = 30_000;

/**
 * Increment-1 mirror read (docs/2 §2.5): expands AzuraCast's own
 * `schedule_items` into concrete blocks the grid renders read-only.
 *
 * This is the one place the DST-naive `HHMM`+`days` shape meets real time
 * (docs/2 §5.4, §7.8): wall times are built on zone-aware calendar days via
 * Luxon — never by adding fixed hour offsets — so a 22:00 block stays 22:00
 * across DST transitions.
 */
export class AzuracastMirrorScheduleAdapter implements MirrorSchedulePort {
  private readonly cache = new Map<string, RawSchedules>();

  constructor(
    private readonly client: AzuracastClient,
    /** Station tz (e.g. "Europe/Paris") — schedule_items are wall-clock in it. */
    private readonly zone: string,
    private readonly clock: Clock = systemClock,
  ) {}

  async fetchBlocks(
    station: StationId,
    windowFromUtc: Date,
    windowToUtc: Date,
  ): Promise<Result<MirrorBlock[], DomainError>> {
    const raw = await this.rawSchedules(station);
    if (!raw.ok) return raw;

    const blocks: MirrorBlock[] = [];
    for (const playlist of raw.value.playlists) {
      if (!playlist.is_enabled) continue;
      // Cadence playlists ([MIXS]-style `once_per_*` insert-rule windows) render
      // as thin overlay bands, not slots (PD §4.8).
      const mode = playlist.type.startsWith("once_per_") ? "band" : "block";
      this.expand(
        playlist.schedule_items,
        { source: "playlist", mode, label: playlist.name },
        windowFromUtc,
        windowToUtc,
        blocks,
      );
    }
    for (const streamer of raw.value.streamers) {
      if (!streamer.is_active) continue;
      this.expand(
        streamer.schedule_items,
        {
          source: "streamer",
          mode: "block",
          // AzuraCast allows an empty display name; the username always exists.
          label: streamer.display_name || streamer.streamer_username,
        },
        windowFromUtc,
        windowToUtc,
        blocks,
      );
    }
    blocks.sort((a, b) => a.startsAtUtc.getTime() - b.startsAtUtc.getTime());
    return ok(blocks);
  }

  /**
   * Raw payloads under a 30 s TTL so grid refetches don't hammer AzuraCast;
   * only the fetch is cached — expansion is cheap and computed per call, so a
   * changed window never sees stale block math.
   */
  private async rawSchedules(station: StationId): Promise<Result<RawSchedules, DomainError>> {
    const nowMs = this.clock.now().getTime();
    const cached = this.cache.get(station.value);
    if (cached && nowMs - cached.fetchedAtMs < CACHE_TTL_MS) return ok(cached);

    const playlists = await this.client.getJson<AzPlaylist[]>(
      `/api/station/${station.value}/playlists`,
    );
    if (!playlists.ok) return playlists;
    const streamers = await this.client.getJson<AzStreamer[]>(
      `/api/station/${station.value}/streamers`,
    );
    if (!streamers.ok) return streamers;

    const fresh = { playlists: playlists.value, streamers: streamers.value, fetchedAtMs: nowMs };
    this.cache.set(station.value, fresh);
    return ok(fresh);
  }

  /**
   * Expands one owner's schedule items over station-tz calendar days, with a
   * one-day margin before the window so an overnight block that started the
   * previous day is caught (same iteration shape as
   * RecurrenceRule.occurrencesBetween).
   */
  private expand(
    items: AzScheduleItem[],
    shape: Pick<MirrorBlock, "source" | "mode" | "label">,
    windowFromUtc: Date,
    windowToUtc: Date,
    out: MirrorBlock[],
  ): void {
    const firstDay = DateTime.fromJSDate(windowFromUtc, { zone: this.zone })
      .startOf("day")
      .minus({ days: 1 });
    const lastDay = DateTime.fromJSDate(windowToUtc, { zone: this.zone }).startOf("day");

    for (const item of items) {
      // start === end rows are manual-hack noise observed live ({0, 0, []} on
      // streamer ondepi-2), not real blocks.
      if (item.start_time === item.end_time) continue;
      for (let day = firstDay; day.toMillis() <= lastDay.toMillis(); day = day.plus({ days: 1 })) {
        // Empty days[] means "every day"; days are ISO 1=Mon…7=Sun (both
        // verified live on 0.23.3, 2026-07-05).
        if (item.days.length > 0 && !item.days.includes(day.weekday)) continue;
        const start = day.set(toWall(item.start_time));
        let end = day.set(toWall(item.end_time));
        // end <= start wraps past midnight; the block belongs to its start day.
        if (end.toMillis() <= start.toMillis()) end = end.plus({ days: 1 });
        if (start.toMillis() < windowToUtc.getTime() && end.toMillis() > windowFromUtc.getTime()) {
          out.push({
            ...shape,
            startsAtUtc: start.toUTC().toJSDate(),
            endsAtUtc: end.toUTC().toJSDate(),
          });
        }
      }
    }
  }
}

interface WallUnits {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

/** HHMM integer (1038 = 10:38) → Luxon `set` units applied to a zone-aware day. */
function toWall(hhmm: number): WallUnits {
  return { hour: Math.floor(hhmm / 100), minute: hhmm % 100, second: 0, millisecond: 0 };
}
