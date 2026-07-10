import type {
  MirrorBlock as MirrorBlockDto,
  Occurrence as OccurrenceDto,
  ShowDetail as ShowDetailDto,
  ShowSummary as ShowSummaryDto,
  Slot as SlotDto,
} from "@ondestudio/shared";
import type { MirrorBlock } from "./ports";
import type { SlotRecord } from "./repo";
import type { EnrichedOccurrence } from "./service";
import type { ShowDetailData, ShowSummaryData } from "./show-service";

/** Domain → wire contract, the "map out" step (docs/2 §3.2). */
export function occurrenceToContract(
  enriched: EnrichedOccurrence,
  station: string,
  now: Date,
): OccurrenceDto {
  const { occurrence, slot, title, episodeTitle } = enriched;
  return {
    id: occurrence.id,
    slotId: slot.id,
    station,
    kind: slot.kind,
    title,
    episodeTitle,
    startsAt: occurrence.startsAtUtc.toISOString(),
    endsAt: occurrence.endsAtUtc.toISOString(),
    durationMin: occurrence.durationMin,
    originalStartsAt: occurrence.key.originalStartsAtUtc.toISOString(),
    moved: occurrence.moved,
    // `aired` is computed against the clock, never stored (PD §4.4).
    negotiationState: occurrence.negotiation.effectiveAt(occurrence.endsAtUtc, now),
    contentState: occurrence.content.effectiveAt(occurrence.endsAtUtc, now),
    issueFlags: [...occurrence.issueFlags],
    contentDurationMin: occurrence.contentDurationMin,
    broadcasterId: slot.broadcasterId,
  };
}

export function slotToContract(record: SlotRecord, station: string): SlotDto {
  const { slot, showName } = record;
  return {
    id: slot.id,
    station,
    kind: slot.kind,
    title: slot.title,
    showId: slot.showId,
    showName,
    recurrence: slot.rule.pattern,
    durationMin: slot.durationMin,
    negotiationDefault: slot.negotiationDefault,
    broadcasterId: slot.broadcasterId,
  };
}

export function mirrorBlockToContract(block: MirrorBlock): MirrorBlockDto {
  return {
    source: block.source,
    mode: block.mode,
    label: block.label,
    startsAt: block.startsAtUtc.toISOString(),
    endsAt: block.endsAtUtc.toISOString(),
  };
}

export function showSummaryToContract(summary: ShowSummaryData): ShowSummaryDto {
  const { show } = summary;
  return {
    id: show.id,
    name: show.name,
    slug: show.slug,
    slotCount: summary.slotCount,
    nextOccurrenceAt: summary.nextOccurrenceAt ? summary.nextOccurrenceAt.toISOString() : null,
    dropFolderPath: show.dropFolderPath,
  };
}

export function showDetailToContract(
  detail: ShowDetailData,
  station: string,
  now: Date,
): ShowDetailDto {
  const { show } = detail;
  return {
    id: show.id,
    name: show.name,
    slug: show.slug,
    fallbackPolicy: show.fallbackPolicy,
    trustAutoAir: show.trustAutoAir,
    replayFlag: show.replayFlag,
    contributorTz: show.contributorTz,
    dropFolderPath: show.dropFolderPath,
    slots: detail.slots.map((record) => slotToContract(record, station)),
    next: detail.next.map((occurrence) => occurrenceToContract(occurrence, station, now)),
    past: detail.past.map((occurrence) => occurrenceToContract(occurrence, station, now)),
  };
}
