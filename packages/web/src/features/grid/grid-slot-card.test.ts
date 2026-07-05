import type { Occurrence } from "@ondestudio/shared";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import type { CardBox } from "./grid-geometry";
import type { DaySegment } from "./grid-segments";
import GridSlotCard from "./grid-slot-card.vue";

// Rendering-spec assertions (docs/2 §8.4): frame = negotiation, fill =
// content pipeline, badges = flags — checked channel by channel.

const ZONE = "Europe/Paris";
const BOX: CardBox = { topPx: 100, heightPx: 96, leftPct: 0, widthPct: 100 };

/** 12:00–14:00 Paris on Wed 8 Jul 2026. */
function occurrenceFixture(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: "1_1752055200000",
    slotId: 1,
    station: "oz",
    kind: "show",
    title: "Habibi Funk Hour",
    startsAt: "2026-07-08T10:00:00.000Z",
    endsAt: "2026-07-08T12:00:00.000Z",
    durationMin: 120,
    originalStartsAt: "2026-07-08T10:00:00.000Z",
    moved: false,
    negotiationState: "validated",
    contentState: "ready",
    issueFlags: [],
    contentDurationMin: 118,
    ...overrides,
  };
}

function segmentOf(occurrence: Occurrence): DaySegment<Occurrence> {
  return {
    item: occurrence,
    dayIso: "2026-07-08",
    startMs: Date.parse(occurrence.startsAt),
    endMs: Date.parse(occurrence.endsAt),
    continuesBefore: false,
    continuesAfter: false,
  };
}

function mountCard(occurrence: Occurrence) {
  return mount(GridSlotCard, {
    props: { segment: segmentOf(occurrence), box: BOX, zone: ZONE },
  });
}

describe("grid-slot-card frame channel (negotiation)", () => {
  it("colours the frame by negotiation state", () => {
    expect(mountCard(occurrenceFixture()).classes()).toContain("frame-validated");
    expect(mountCard(occurrenceFixture({ negotiationState: "dealing" })).classes()).toContain(
      "frame-dealing",
    );
  });

  it("ghosts declined and cancelled occurrences", () => {
    const declined = mountCard(occurrenceFixture({ negotiationState: "declined" }));
    expect(declined.classes()).toContain("ghosted");
    const cancelled = mountCard(occurrenceFixture({ negotiationState: "cancelled" }));
    expect(cancelled.classes()).toContain("ghosted");
  });

  it("dims the whole card once aired", () => {
    const aired = mountCard(
      occurrenceFixture({ negotiationState: "aired", contentState: "aired" }),
    );
    expect(aired.classes()).toContain("frame-aired");
    expect(aired.classes()).toContain("aired");
  });
});

describe("grid-slot-card fill channel (content pipeline)", () => {
  it("renders no fill but a hollow hint when empty", () => {
    const card = mountCard(occurrenceFixture({ contentState: "empty", contentDurationMin: null }));
    expect(card.find(".card-fill").exists()).toBe(false);
    expect(card.find(".fill-hint").exists()).toBe(true);
  });

  it("renders a hatched fill sized by content duration when received", () => {
    const card = mountCard(occurrenceFixture({ contentState: "received", contentDurationMin: 45 }));
    const fill = card.find(".card-fill");
    expect(fill.classes()).toContain("fill-received");
    expect(fill.attributes("style")).toContain("height: 37.5%");
  });

  it("renders a solid fill proportional to the booked frame when ready", () => {
    const card = mountCard(occurrenceFixture());
    const fill = card.find(".card-fill");
    expect(fill.classes()).toContain("fill-ready");
    // 118 of 120 booked minutes — the sliver left is what rotation covers.
    expect(fill.attributes("style")).toContain("height: 98.33");
  });

  it("fills the whole frame when content is present but unmeasured", () => {
    const card = mountCard(
      occurrenceFixture({ contentState: "received", contentDurationMin: null }),
    );
    expect(card.find(".card-fill").attributes("style")).toContain("height: 100%");
  });

  it("clamps the fill and raises the over-run indicator when content is too long", () => {
    const card = mountCard(
      occurrenceFixture({
        durationMin: 60,
        contentDurationMin: 75,
        endsAt: "2026-07-08T11:00:00.000Z",
      }),
    );
    expect(card.find(".card-fill").attributes("style")).toContain("height: 100%");
    expect(card.find(".overrun-edge").exists()).toBe(true);
    expect(card.find(".overrun-chip").text()).toBe("+15 min");
  });
});

describe("grid-slot-card badges and markers", () => {
  it("shows one lettered badge per issue flag", () => {
    const card = mountCard(occurrenceFixture({ issueFlags: ["technical", "metadata"] }));
    const badges = card.findAll(".flag-badge");
    expect(badges).toHaveLength(2);
    expect(badges[0]?.text()).toBe("⚑T");
    expect(badges[1]?.text()).toBe("⚑M");
    expect(badges[0]?.attributes("title")).toContain("Technical");
  });

  it("marks moved occurrences with the ↷ glyph", () => {
    expect(
      mountCard(occurrenceFixture({ moved: true }))
        .find(".moved-glyph")
        .exists(),
    ).toBe(true);
    expect(mountCard(occurrenceFixture()).find(".moved-glyph").exists()).toBe(false);
  });

  it("shows the 24-hour station-time range and the kind glyph", () => {
    const card = mountCard(occurrenceFixture());
    expect(card.find(".card-time").text()).toBe("12:00–14:00");
    expect(card.find(".kind-glyph").text()).toBe("▸");
  });

  it("offers the resize handle only where the occurrence actually ends", () => {
    const occurrence = occurrenceFixture();
    const continuing = mount(GridSlotCard, {
      props: {
        segment: { ...segmentOf(occurrence), continuesAfter: true },
        box: BOX,
        zone: ZONE,
      },
    });
    expect(continuing.find(".card-resize").exists()).toBe(false);
    expect(mountCard(occurrence).find(".card-resize").exists()).toBe(true);
  });
});
