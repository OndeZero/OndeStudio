import type {
  CreateSlotInput,
  NegotiationState,
  PatchOccurrenceInput,
  SlotKind,
  UpdateSlotInput,
} from "@ondestudio/shared";
import { DateTime } from "luxon";
import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import { decodeOccurrenceId, encodeOccurrenceId, Occurrence } from "./domain/occurrence";
import { RecurrenceRule } from "./domain/recurrence-rule";
import { SlotDefinition } from "./domain/slot-definition";
import type { MirrorBlock, MirrorSchedulePort } from "./ports";
import type { SchedulingRepo, SlotRecord } from "./repo";
import "./events";

export interface GridFilters {
  negotiation?: NegotiationState[];
  kind?: SlotKind[];
}

/** An occurrence with the slot context the contract mapping needs. */
export interface EnrichedOccurrence {
  occurrence: Occurrence;
  slot: SlotDefinition;
  title: string;
}

const MAX_WINDOW_DAYS = 45;

/**
 * Grid use-cases (docs/2 §11 M1): list = sparse materialization merged with
 * exception rows; every edit is an exception row upsert (docs/2 §5.3).
 * Mirror blocks (playout reality) are served separately so the grid still
 * works when the playout link is down (invariant 1).
 */
export class SchedulingService {
  constructor(
    private readonly deps: {
      repo: SchedulingRepo;
      mirror: MirrorSchedulePort;
      bus: EventBus;
      clock: Clock;
      logger: Logger;
      /** Station timezone all wall-clock inputs are interpreted in (docs/2 §5.4). */
      zone: string;
    },
  ) {}

  get zone(): string {
    return this.deps.zone;
  }

  async listSlots(station: StationId): Promise<SlotRecord[]> {
    return this.deps.repo.listSlots(station.value);
  }

  async listOccurrences(
    station: StationId,
    fromUtc: Date,
    toUtc: Date,
    filters: GridFilters = {},
  ): Promise<Result<EnrichedOccurrence[], DomainError>> {
    const window = validateWindow(fromUtc, toUtc);
    if (!window.ok) return window;

    const records = await this.deps.repo.listSlots(station.value);
    const bySlotId = new Map(records.map((record) => [record.slot.id, record]));
    const rows = await this.deps.repo.findOccurrenceRows(station.value, fromUtc, toUtc);
    const rowById = new Map(rows.map((row) => [row.id, row]));

    const merged: { occurrence: Occurrence; record: SlotRecord }[] = [];
    const seen = new Set<string>();

    for (const record of records) {
      for (const candidate of record.slot.materialize(fromUtc, toUtc, this.deps.zone)) {
        const key = {
          slotId: candidate.slotId,
          originalStartsAtUtc: candidate.originalStartsAtUtc,
        };
        const id = encodeOccurrenceId(key);
        seen.add(id);
        const row = rowById.get(id);
        if (row) {
          // A moved row may have left the window — it renders where it now lives.
          if (intersects(row, fromUtc, toUtc)) merged.push({ occurrence: row, record });
        } else {
          merged.push({
            occurrence: Occurrence.fromCandidate(
              key,
              candidate.endsAtUtc,
              record.slot.negotiationDefault,
            ),
            record,
          });
        }
      }
    }

    // Rows moved INTO the window from an original series time outside it.
    for (const row of rows) {
      if (seen.has(row.id) || !intersects(row, fromUtc, toUtc)) continue;
      const record = bySlotId.get(row.key.slotId);
      if (record) merged.push({ occurrence: row, record });
    }

    const now = this.deps.clock.now();
    const filtered = merged.filter(({ occurrence, record }) => {
      if (filters.kind && !filters.kind.includes(record.slot.kind)) return false;
      if (filters.negotiation) {
        const effective = occurrence.negotiation.effectiveAt(occurrence.endsAtUtc, now);
        if (!filters.negotiation.includes(effective)) return false;
      }
      return true;
    });

    filtered.sort(
      (a, b) => a.occurrence.startsAtUtc.getTime() - b.occurrence.startsAtUtc.getTime(),
    );
    return ok(
      filtered.map(({ occurrence, record }) => ({
        occurrence,
        slot: record.slot,
        title: record.slot.displayTitle(record.showName),
      })),
    );
  }

  async getMirror(
    station: StationId,
    fromUtc: Date,
    toUtc: Date,
  ): Promise<Result<MirrorBlock[], DomainError>> {
    const window = validateWindow(fromUtc, toUtc);
    if (!window.ok) return window;
    return this.deps.mirror.fetchBlocks(station, fromUtc, toUtc);
  }

  async createSlot(
    station: StationId,
    input: CreateSlotInput,
  ): Promise<Result<SlotRecord, DomainError>> {
    const rule = RecurrenceRule.from(input.recurrence);
    if (!rule.ok) return rule;

    let showId: number | null = null;
    if (input.showName) {
      showId = (await this.deps.repo.findOrCreateShow(input.showName)).id;
    }
    const planned = SlotDefinition.plan({
      stationId: station.value,
      kind: input.kind,
      title: input.title ?? null,
      showId,
      rule: rule.value,
      durationMin: input.durationMin,
      bornValidated: input.bornValidated,
    });
    if (!planned.ok) return planned;

    const record = await this.deps.repo.insertSlot(planned.value);
    this.changed(station, "slot-created");
    return ok(record);
  }

  async updateSlot(
    station: StationId,
    slotId: number,
    input: UpdateSlotInput,
  ): Promise<Result<SlotRecord, DomainError>> {
    const existing = await this.getOwnSlot(station, slotId);
    if (!existing.ok) return existing;

    let rule: RecurrenceRule | undefined;
    if (input.recurrence) {
      const parsed = RecurrenceRule.from(input.recurrence);
      if (!parsed.ok) return parsed;
      rule = parsed.value;
    }
    await this.deps.repo.updateSlotFields(slotId, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.durationMin !== undefined ? { durationMin: input.durationMin } : {}),
      ...(rule ? { rule } : {}),
    });
    this.changed(station, "slot-updated");
    const updated = await this.deps.repo.getSlot(slotId);
    if (!updated) return err(DomainError.notFound("slot"));
    return ok(updated);
  }

  async deleteSlot(station: StationId, slotId: number): Promise<Result<void, DomainError>> {
    const existing = await this.getOwnSlot(station, slotId);
    if (!existing.ok) return existing;
    await this.deps.repo.deleteSlot(slotId);
    this.changed(station, "slot-deleted");
    return ok(undefined);
  }

  async patchOccurrence(
    station: StationId,
    rawOccurrenceId: string,
    input: PatchOccurrenceInput,
  ): Promise<Result<EnrichedOccurrence, DomainError>> {
    const key = decodeOccurrenceId(rawOccurrenceId);
    if (!key.ok) return key;

    const record = await this.getOwnSlot(station, key.value.slotId);
    if (!record.ok) return err(DomainError.notFound("occurrence"));

    let occurrence = await this.deps.repo.getOccurrenceRow(key.value);
    if (!occurrence) {
      // Not yet persisted: it must be a genuine computed instance of the series.
      const around = record.value.slot.materialize(
        new Date(key.value.originalStartsAtUtc.getTime() - 1),
        new Date(key.value.originalStartsAtUtc.getTime() + 1),
        this.deps.zone,
      );
      const match = around.find(
        (c) => c.originalStartsAtUtc.getTime() === key.value.originalStartsAtUtc.getTime(),
      );
      if (!match) return err(DomainError.notFound("occurrence"));
      occurrence = Occurrence.fromCandidate(
        key.value,
        match.endsAtUtc,
        record.value.slot.negotiationDefault,
      );
    }

    if (input.startsAtWall !== undefined || input.durationMin !== undefined) {
      let startsAt = occurrence.startsAtUtc;
      if (input.startsAtWall !== undefined) {
        const wall = DateTime.fromISO(input.startsAtWall, { zone: this.deps.zone });
        if (!wall.isValid) {
          return err(DomainError.validation(`invalid wall datetime: ${input.startsAtWall}`));
        }
        startsAt = wall.toUTC().toJSDate();
      }
      const moved = occurrence.moveTo(startsAt, input.durationMin);
      if (!moved.ok) return moved;
      occurrence = moved.value;
    }
    if (input.negotiationState !== undefined) {
      const transitioned = occurrence.transitionNegotiationTo(input.negotiationState);
      if (!transitioned.ok) return transitioned;
      occurrence = transitioned.value;
    }
    if (input.issueFlags !== undefined) occurrence = occurrence.withIssueFlags(input.issueFlags);
    if (input.contentDurationMin !== undefined) {
      occurrence = occurrence.withContentDuration(input.contentDurationMin);
    }

    await this.deps.repo.upsertOccurrence(occurrence);
    this.changed(station, "occurrence-patched");
    return ok({
      occurrence,
      slot: record.value.slot,
      title: record.value.slot.displayTitle(record.value.showName),
    });
  }

  private async getOwnSlot(
    station: StationId,
    slotId: number,
  ): Promise<Result<SlotRecord, DomainError>> {
    const record = await this.deps.repo.getSlot(slotId);
    if (!record || record.slot.stationId !== station.value) {
      return err(DomainError.notFound("slot"));
    }
    return ok(record);
  }

  private changed(
    station: StationId,
    reason: "slot-created" | "slot-updated" | "slot-deleted" | "occurrence-patched",
  ): void {
    this.deps.bus.emit("scheduling.grid-changed", { station: station.value, reason });
  }
}

function validateWindow(fromUtc: Date, toUtc: Date): Result<void, DomainError> {
  if (Number.isNaN(fromUtc.getTime()) || Number.isNaN(toUtc.getTime())) {
    return err(DomainError.validation("invalid window dates"));
  }
  if (toUtc.getTime() <= fromUtc.getTime()) {
    return err(DomainError.validation("window end must be after start"));
  }
  if (toUtc.getTime() - fromUtc.getTime() > MAX_WINDOW_DAYS * 24 * 3_600_000) {
    return err(DomainError.validation(`window larger than ${MAX_WINDOW_DAYS} days`));
  }
  return ok(undefined);
}

function intersects(occurrence: Occurrence, fromUtc: Date, toUtc: Date): boolean {
  return (
    occurrence.startsAtUtc.getTime() < toUtc.getTime() &&
    occurrence.endsAtUtc.getTime() > fromUtc.getTime()
  );
}
