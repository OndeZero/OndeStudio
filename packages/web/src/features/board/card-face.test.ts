import type { Card } from "@ondestudio/shared";
import { mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CardFace from "./card-face.vue";

// Rendering-spec assertions (PD §5.2): the face must make the conversation
// graspable without opening it — tally, my-vote highlight, unread dot,
// discussion-state line.

function cardFixture(overrides: Partial<Card> = {}): Card {
  return {
    id: 1,
    intent: "idea",
    status: "open",
    subject: "Invite the Kraut Kontrol crew",
    body: null,
    anchor: null,
    createdBy: { id: 2, displayName: "Nina Radio" },
    createdAt: "2026-07-01T10:00:00.000Z",
    assignees: [{ id: 3, displayName: "Thomas Wilde" }],
    votes: { want_on_air: 2, love: 0, needs_discussion: 0, no: 0 },
    myVote: null,
    commentCount: 1,
    lastActivityAt: "2026-07-04T18:00:00.000Z",
    lastComment: {
      author: "Nina Radio",
      snippet: "They said maybe October",
      at: "2026-07-04T18:00:00.000Z",
    },
    unread: true,
    outcome: null,
    ...overrides,
  };
}

function mountFace(card: Card) {
  return mount(CardFace, { props: { card } });
}

describe("card-face vote tally", () => {
  it("renders one button per vote kind, counting only non-zero kinds", () => {
    const wrapper = mountFace(cardFixture());
    const buttons = wrapper.findAll(".vote-btn");
    expect(buttons).toHaveLength(4);
    expect(wrapper.find('[aria-label="vote want_on_air"] .vote-count').text()).toBe("2");
    expect(wrapper.find('[aria-label="vote love"] .vote-count').exists()).toBe(false);
  });

  it("highlights my vote", () => {
    const wrapper = mountFace(cardFixture({ myVote: "want_on_air" }));
    expect(wrapper.find(".vote-btn.mine").attributes("aria-label")).toBe("vote want_on_air");
    expect(mountFace(cardFixture()).find(".vote-btn.mine").exists()).toBe(false);
  });

  it("emits the clicked kind without opening the card", async () => {
    const wrapper = mountFace(cardFixture());
    await wrapper.find('[aria-label="vote love"]').trigger("click");
    expect(wrapper.emitted("vote")).toEqual([["love"]]);
    expect(wrapper.emitted("open")).toBeUndefined();
  });
});

describe("card-face discussion-state indicator", () => {
  it("shows the unread dot only while there is unseen activity", () => {
    expect(
      mountFace(cardFixture({ unread: true }))
        .find(".unread-dot")
        .exists(),
    ).toBe(true);
    expect(
      mountFace(cardFixture({ unread: false }))
        .find(".unread-dot")
        .exists(),
    ).toBe(false);
  });

  it("shows reply count, assignee initials and the latest-reply snippet", () => {
    const wrapper = mountFace(cardFixture());
    expect(wrapper.find(".face-activity").text()).toContain("1 reply");
    expect(wrapper.find(".assignee-initials").text()).toBe("TW");
    expect(wrapper.find(".face-snippet").text()).toContain("Nina Radio: They said maybe October");
  });

  it("opens on click", async () => {
    const wrapper = mountFace(cardFixture());
    await wrapper.trigger("click");
    expect(wrapper.emitted("open")).toHaveLength(1);
  });
});
