import { describe, expect, test } from "bun:test";
import { CONTENT_STATES, CONTENT_TRANSITIONS } from "@ondestudio/shared";
import { ContentPipeline } from "./content-pipeline";

describe("ContentPipeline state machine", () => {
  test("exhaustive legal/illegal transition matrix", () => {
    for (const from of CONTENT_STATES) {
      for (const to of CONTENT_STATES) {
        const result = ContentPipeline.of(from).transitionTo(to);
        expect(result.ok).toBe(CONTENT_TRANSITIONS[from].includes(to));
        if (!result.ok) expect(result.error.kind).toBe("illegal-transition");
      }
    }
  });

  test("the pipeline shape: forward chain plus detach to empty; aired terminal", () => {
    expect(ContentPipeline.of("empty").transitionTo("received").ok).toBe(true);
    expect(ContentPipeline.of("received").transitionTo("ready").ok).toBe(true);
    expect(ContentPipeline.of("ready").transitionTo("empty").ok).toBe(true);
    expect(ContentPipeline.of("empty").transitionTo("ready").ok).toBe(false);
    expect(ContentPipeline.of("aired").transitionTo("empty").ok).toBe(false);
  });

  test("effectiveAt: only ready content airs by time", () => {
    const past = new Date("2026-07-01T12:00:00Z");
    const now = new Date("2026-07-05T12:00:00Z");
    expect(ContentPipeline.of("ready").effectiveAt(past, now)).toBe("aired");
    expect(ContentPipeline.of("received").effectiveAt(past, now)).toBe("received");
    expect(ContentPipeline.of("empty").effectiveAt(past, now)).toBe("empty");
  });
});
