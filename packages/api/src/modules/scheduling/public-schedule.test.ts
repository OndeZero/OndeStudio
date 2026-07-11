import { describe, expect, test } from "bun:test";
import type { SlotKind } from "@ondestudio/shared";
import { occurrenceToPublicScheduleItem } from "./contract";
import { Occurrence } from "./domain/occurrence";
import { RecurrenceRule } from "./domain/recurrence-rule";
import { SlotDefinition } from "./domain/slot-definition";
import type { EnrichedOccurrence } from "./service";

/**
 * The public projection (RFC 0003; PD §5.5/§6.4): occurrence → announceable
 * item. Real domain objects so the revert-to-generic pivot (`effectiveAt`) and
 * the live-broadcaster mapping are exercised, not mocked.
 */
const NOW = new Date("2026-07-11T12:00:00Z");

function slot(kind: SlotKind): SlotDefinition {
  const rule = RecurrenceRule.from({ type: "weekly", weekdays: [1], time: "10:00" });
  if (!rule.ok) throw new Error("rule");
  return SlotDefinition.rehydrate({
    id: 1,
    stationId: "oz",
    kind,
    title: null,
    showId: null,
    rule: rule.value,
    durationMin: 60,
    negotiationDefault: "validated",
    broadcasterId: kind === "live" ? 7 : null,
    meta: null,
  });
}

function enriched(
  kind: SlotKind,
  start: Date,
  end: Date,
  title: string,
  episodeTitle: string | null,
): EnrichedOccurrence {
  const occurrence = Occurrence.fromCandidate(
    { slotId: 1, originalStartsAtUtc: start },
    end,
    "validated",
  );
  return { occurrence, slot: slot(kind), title, episodeTitle };
}

describe("occurrenceToPublicScheduleItem", () => {
  test("an upcoming validated occurrence keeps its episode announcement", () => {
    const start = new Date("2026-07-11T13:00:00Z");
    const end = new Date("2026-07-11T14:00:00Z");
    const item = occurrenceToPublicScheduleItem(
      enriched("show", start, end, "Morning Show", "Ep 12: deep cuts"),
      NOW,
      null,
    );
    expect(item).toEqual({
      id: `1_${start.getTime()}`,
      kind: "show",
      title: "Morning Show",
      episodeTitle: "Ep 12: deep cuts",
      live: null,
      startsAt: start.toISOString(),
      endsAt: end.toISOString(),
      durationMin: 60,
    });
  });

  test("an aired occurrence reverts to the generic title (PD §5.5)", () => {
    const start = new Date("2026-07-11T10:00:00Z"); // before NOW
    const end = new Date("2026-07-11T11:00:00Z");
    const item = occurrenceToPublicScheduleItem(
      enriched("show", start, end, "Morning Show", "Ep 12: deep cuts"),
      NOW,
      null,
    );
    expect(item.title).toBe("Morning Show");
    expect(item.episodeTitle).toBeNull(); // reverted — the episode no longer announced
  });

  test("a live occurrence carries the broadcaster's public streamer name", () => {
    const start = new Date("2026-07-11T20:00:00Z");
    const end = new Date("2026-07-11T21:00:00Z");
    const item = occurrenceToPublicScheduleItem(
      enriched("live", start, end, "Live", null),
      NOW,
      "DJ Nova",
    );
    expect(item.kind).toBe("live");
    expect(item.live).toEqual({ streamerName: "DJ Nova" });
  });

  test("a non-live occurrence never carries a live block, even if a name is passed", () => {
    const start = new Date("2026-07-11T13:00:00Z");
    const end = new Date("2026-07-11T14:00:00Z");
    const item = occurrenceToPublicScheduleItem(
      enriched("series", start, end, "The Series", null),
      NOW,
      "should-be-ignored",
    );
    expect(item.live).toBeNull();
  });
});
