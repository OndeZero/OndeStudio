import type { UpdateShowInput } from "@ondestudio/shared";
import { IANAZone } from "luxon";
import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import {
  type SchedulingRepo,
  type ShowRecord,
  type SlotRecord,
  slugify,
  type UpdateShowFields,
} from "./repo";
import type { EnrichedOccurrence, SchedulingService } from "./service";
import "./events";

/** How far ahead the library summary looks for a show's next airing. */
const NEXT_HORIZON_DAYS = 60;
/** Detail windows either side of now — exactly the grid's own window cap. */
const DETAIL_WINDOW_DAYS = 45;
const DETAIL_COUNT = 5;
const DAY_MS = 24 * 3_600_000;

export interface ShowSummaryData {
  show: ShowRecord;
  slotCount: number;
  nextOccurrenceAt: Date | null;
}

export interface ShowDetailData {
  show: ShowRecord;
  slots: SlotRecord[];
  next: EnrichedOccurrence[];
  past: EnrichedOccurrence[];
}

/**
 * Show-hub use-cases (PD §5.4, docs/2 §11 M2): the canonical page every lens
 * links into. A sibling of SchedulingService — split only to keep files small;
 * same module, same repo, and the occurrence merge is REUSED through the grid
 * service, never duplicated (docs/2 §5.3).
 */
export class ShowService {
  constructor(
    private readonly deps: {
      repo: SchedulingRepo;
      /** The grid's listOccurrences — the single merge implementation. */
      grid: Pick<SchedulingService, "listOccurrences">;
      bus: EventBus;
      clock: Clock;
      /** Station timezone wall-clock rules are materialized in (docs/2 §5.4). */
      zone: string;
    },
  ) {}

  /**
   * Library index (PD §5.4): every show — scheduled on this station or not —
   * with its slot count and next airing. `nextOccurrenceAt` reads the raw
   * series (exception rows ignored): at library altitude a single moved
   * occurrence rarely changes "when does this air next", and the detail view
   * has the exact merge. A currently-running occurrence counts as next.
   */
  async showsSummary(station: StationId): Promise<ShowSummaryData[]> {
    const [allShows, records] = await Promise.all([
      this.deps.repo.listShows(),
      this.deps.repo.listSlots(station.value),
    ]);
    const bound = new Map<number, SlotRecord[]>();
    for (const record of records) {
      if (record.slot.showId === null) continue;
      const list = bound.get(record.slot.showId) ?? [];
      list.push(record);
      bound.set(record.slot.showId, list);
    }
    const from = this.deps.clock.now();
    const to = new Date(from.getTime() + NEXT_HORIZON_DAYS * DAY_MS);
    return allShows.map((show) => {
      const slotRecords = bound.get(show.id) ?? [];
      let next: Date | null = null;
      for (const record of slotRecords) {
        for (const candidate of record.slot.materialize(from, to, this.deps.zone)) {
          if (next === null || candidate.originalStartsAtUtc < next) {
            next = candidate.originalStartsAtUtc;
          }
        }
      }
      return { show, slotCount: slotRecords.length, nextOccurrenceAt: next };
    });
  }

  /** The hub page data: settings, slot bindings, the coming 5 + last 5 occurrences. */
  async showDetail(station: StationId, id: number): Promise<Result<ShowDetailData, DomainError>> {
    const show = await this.deps.repo.getShow(id);
    if (!show) return err(DomainError.notFound("show"));
    const slots = (await this.deps.repo.slotsForShow(id)).filter(
      (record) => record.slot.stationId === station.value,
    );

    const now = this.deps.clock.now();
    const nowMs = now.getTime();
    // Two 45-day windows (the grid's cap); an occurrence running across now
    // intersects both and lands in `past` via the strict start-time split.
    const pastWindow = await this.deps.grid.listOccurrences(
      station,
      new Date(nowMs - DETAIL_WINDOW_DAYS * DAY_MS),
      now,
    );
    if (!pastWindow.ok) return pastWindow;
    const nextWindow = await this.deps.grid.listOccurrences(
      station,
      now,
      new Date(nowMs + DETAIL_WINDOW_DAYS * DAY_MS),
    );
    if (!nextWindow.ok) return nextWindow;

    const mine = (o: EnrichedOccurrence): boolean => o.slot.showId === id;
    const past = pastWindow.value
      .filter((o) => mine(o) && o.occurrence.startsAtUtc.getTime() < nowMs)
      .slice(-DETAIL_COUNT);
    const next = nextWindow.value
      .filter((o) => mine(o) && o.occurrence.startsAtUtc.getTime() >= nowMs)
      .slice(0, DETAIL_COUNT);
    return ok({ show, slots, next, past });
  }

  async updateShow(
    station: StationId,
    id: number,
    input: UpdateShowInput,
  ): Promise<Result<ShowDetailData, DomainError>> {
    const existing = await this.deps.repo.getShow(id);
    if (!existing) return err(DomainError.notFound("show"));

    const fields: UpdateShowFields = {};
    if (input.name !== undefined && input.name !== existing.name) {
      const twin = await this.deps.repo.findShowBySlug(slugify(input.name));
      if (twin && twin.id !== id) {
        return err(DomainError.conflict(`a show slugged like "${input.name}" already exists`));
      }
      fields.name = input.name;
    }
    if (input.fallbackPolicy !== undefined) fields.fallbackPolicy = input.fallbackPolicy;
    if (input.trustAutoAir !== undefined) fields.trustAutoAir = input.trustAutoAir;
    if (input.replayFlag !== undefined) fields.replayFlag = input.replayFlag;
    if (input.contributorTz !== undefined) {
      if (input.contributorTz !== null && !IANAZone.isValidZone(input.contributorTz)) {
        return err(DomainError.validation(`unknown IANA timezone: ${input.contributorTz}`));
      }
      fields.contributorTz = input.contributorTz;
    }
    if (input.dropFolderPath !== undefined) {
      if (input.dropFolderPath === null) {
        fields.dropFolderPath = null;
      } else {
        const normalized = normalizeFolderPath(input.dropFolderPath);
        if (!normalized.ok) return normalized;
        fields.dropFolderPath = normalized.value;
      }
    }

    if (Object.keys(fields).length > 0) await this.deps.repo.updateShow(id, fields);
    if (fields.name !== undefined) {
      // Only a rename repaints the grid — slot titles fall back to the show name.
      this.deps.bus.emit("scheduling.grid-changed", {
        station: station.value,
        reason: "show-updated",
      });
    }
    return this.showDetail(station, id);
  }

  /**
   * Backend for content's ShowOwnershipPort (wired in app.ts). Shows are
   * station-agnostic in phase 1 — the parameter keeps the port's shape.
   */
  async dropFolders(
    _station: StationId,
  ): Promise<{ showId: number; name: string; path: string }[]> {
    return this.deps.repo.dropFolders();
  }
}

/**
 * Same normalization the media browser applies to browse paths: relative to
 * the station media root, no traversal, no leading/trailing/doubled slashes.
 */
function normalizeFolderPath(raw: string): Result<string, DomainError> {
  // NFC to match the media browser's canonical form (content/service.ts).
  const cleaned = raw
    .normalize("NFC")
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (cleaned === "" || cleaned.split("/").some((s) => s === "." || s === "..")) {
    return err(DomainError.validation(`invalid drop folder path: ${raw}`));
  }
  return ok(cleaned);
}
