import { describe, expect, test } from "bun:test";
import { NEGOTIATION_STATES, NEGOTIATION_TRANSITIONS } from "@ondestudio/shared";
import { Negotiation } from "./negotiation";

describe("Negotiation state machine", () => {
  test("every legal transition succeeds, exhaustively", () => {
    for (const from of NEGOTIATION_STATES) {
      for (const to of NEGOTIATION_TRANSITIONS[from]) {
        const result = Negotiation.of(from).transitionTo(to);
        expect(result.ok).toBe(true);
      }
    }
  });

  test("every non-listed transition is an illegal-transition error, exhaustively", () => {
    for (const from of NEGOTIATION_STATES) {
      for (const to of NEGOTIATION_STATES) {
        if (NEGOTIATION_TRANSITIONS[from].includes(to)) continue;
        const result = Negotiation.of(from).transitionTo(to);
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.kind).toBe("illegal-transition");
      }
    }
  });

  test("the PD §4.4 shape: prebooked may skip dealing; validated can only be cancelled", () => {
    expect(Negotiation.of("prebooked").transitionTo("validated").ok).toBe(true);
    expect(Negotiation.of("validated").transitionTo("declined").ok).toBe(false);
    expect(Negotiation.of("validated").transitionTo("cancelled").ok).toBe(true);
    // aired is time-driven — never a human transition target
    for (const from of NEGOTIATION_STATES) {
      expect(Negotiation.of(from).transitionTo("aired").ok).toBe(false);
    }
  });

  test("effectiveAt computes aired from time for validated slots only", () => {
    const past = new Date("2026-07-01T12:00:00Z");
    const now = new Date("2026-07-05T12:00:00Z");
    expect(Negotiation.of("validated").effectiveAt(past, now)).toBe("aired");
    expect(Negotiation.of("prebooked").effectiveAt(past, now)).toBe("prebooked");
    expect(Negotiation.of("cancelled").effectiveAt(past, now)).toBe("cancelled");
    const future = new Date("2026-07-09T12:00:00Z");
    expect(Negotiation.of("validated").effectiveAt(future, now)).toBe("validated");
  });

  test("parse rejects unknown states", () => {
    expect(Negotiation.parse("validated").ok).toBe(true);
    expect(Negotiation.parse("approved").ok).toBe(false);
  });
});
