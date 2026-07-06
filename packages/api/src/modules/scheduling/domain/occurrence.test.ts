import { describe, expect, test } from "bun:test";
import { unwrap } from "../../../kernel/result";
import { decodeOccurrenceId, encodeOccurrenceId, Occurrence } from "./occurrence";

const original = new Date("2026-07-07T20:00:00Z");
const key = { slotId: 12, originalStartsAtUtc: original };

const candidate = (): Occurrence =>
  Occurrence.fromCandidate(key, new Date("2026-07-07T22:00:00Z"), "prebooked");

describe("occurrence identity", () => {
  test("encode/decode round-trip", () => {
    const id = encodeOccurrenceId(key);
    expect(id).toBe(`12_${original.getTime()}`);
    const decoded = unwrap(decodeOccurrenceId(id));
    expect(decoded.slotId).toBe(12);
    expect(decoded.originalStartsAtUtc.getTime()).toBe(original.getTime());
  });

  test("invalid ids are validation errors", () => {
    for (const raw of ["12", "12_", "_123", "12_abc", "a_1"]) {
      expect(decodeOccurrenceId(raw).ok).toBe(false);
    }
  });
});

describe("Occurrence", () => {
  test("a candidate starts at its series time with slot defaults and is not persisted", () => {
    const occ = candidate();
    expect(occ.startsAtUtc).toEqual(original);
    expect(occ.durationMin).toBe(120);
    expect(occ.negotiation.value).toBe("prebooked");
    expect(occ.content.value).toBe("empty");
    expect(occ.moved).toBe(false);
    expect(occ.persisted).toBe(false);
  });

  test("moveTo relocates and resizes without ever failing on overlap (soft boundaries)", () => {
    const moved = unwrap(candidate().moveTo(new Date("2026-07-08T15:30:00Z"), 90));
    expect(moved.startsAtUtc.toISOString()).toBe("2026-07-08T15:30:00.000Z");
    expect(moved.endsAtUtc.toISOString()).toBe("2026-07-08T17:00:00.000Z");
    expect(moved.moved).toBe(true);
    // The original key never changes — that's the series anchor.
    expect(moved.key.originalStartsAtUtc).toEqual(original);
    // But a sub-5-minute duration is nonsense:
    expect(candidate().moveTo(new Date("2026-07-08T15:30:00Z"), 2).ok).toBe(false);
  });

  test("negotiation transitions go through the state machine", () => {
    const validated = unwrap(candidate().transitionNegotiationTo("validated"));
    expect(validated.negotiation.value).toBe("validated");
    // Reversible since ADR-0012 — but aired stays time-driven, never settable.
    expect(validated.transitionNegotiationTo("dealing").ok).toBe(true);
    const illegal = validated.transitionNegotiationTo("aired");
    expect(illegal.ok).toBe(false);
    if (!illegal.ok) expect(illegal.error.kind).toBe("illegal-transition");
  });

  test("issue flags are deduped and sorted; content duration is settable and clearable", () => {
    const flagged = candidate().withIssueFlags(["metadata", "technical", "metadata"]);
    expect(flagged.issueFlags).toEqual(["metadata", "technical"]);
    const withFill = flagged.withContentDuration(45);
    expect(withFill.contentDurationMin).toBe(45);
    expect(withFill.withContentDuration(null).contentDurationMin).toBeNull();
  });
});
