import type { Card } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { toasts } from "../grid/toast";
import { useBoardStore } from "./board-store";

// The store is tested against the contract, not the network (grid-store
// stance): every IO edge is mocked.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/mutate", () => ({ apiMutate: vi.fn() }));
vi.mock("../../lib/api/sse", () => ({ subscribeStationSse: vi.fn(() => () => {}) }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last overload returns void, which
// would reject mock payloads at the type level.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

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
    assignees: [],
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

function primeCards(cards: Card[]): void {
  apiGetMock.mockImplementation(() => Promise.resolve({ cards }));
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  toasts.splice(0);
});

describe("board-store optimistic voting", () => {
  it("applies my vote locally before the wire answers, then keeps the server truth", async () => {
    primeCards([cardFixture()]);
    const store = useBoardStore();
    await store.loadCards();

    const serverEcho = cardFixture({
      myVote: "love",
      votes: { want_on_air: 2, love: 1, needs_discussion: 0, no: 0 },
    });
    let resolveVote: (value: unknown) => void = () => {};
    apiMutateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveVote = resolve;
        }),
    );

    const pending = store.vote(1, "love");
    // Optimistic: applied synchronously, before the PUT resolves.
    expect(store.cards[0]?.myVote).toBe("love");
    expect(store.cards[0]?.votes.love).toBe(1);

    resolveVote(serverEcho);
    await pending;
    expect(store.cards[0]).toEqual(serverEcho);
    expect(toasts).toHaveLength(0);
  });

  it("clicking my current kind clears the vote (one changeable vote per person)", async () => {
    primeCards([cardFixture({ myVote: "want_on_air" })]);
    const store = useBoardStore();
    await store.loadCards();

    // Never resolves: only the optimistic state is under test here.
    apiMutateMock.mockImplementation(() => new Promise(() => {}));
    void store.vote(1, "want_on_air");

    expect(store.cards[0]?.myVote).toBeNull();
    expect(store.cards[0]?.votes.want_on_air).toBe(1);
    expect(apiMutateMock).toHaveBeenCalledWith(
      "PUT",
      "/stations/oz/cards/1/vote",
      { kind: null },
      expect.anything(),
    );
  });

  it("refetches and toasts when the vote write fails", async () => {
    primeCards([cardFixture()]);
    const store = useBoardStore();
    await store.loadCards();

    apiMutateMock.mockRejectedValue(new Error("PUT vote failed with 503: playout melted"));
    await store.vote(1, "no");

    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    // The failure path refetches instead of splicing a snapshot back.
    expect(apiGetMock).toHaveBeenCalledTimes(2);
    expect(store.cards[0]).toEqual(cardFixture());
  });
});

describe("board-store unread transitions", () => {
  it("clears the unread dot instantly when a card is read", async () => {
    primeCards([cardFixture({ unread: true })]);
    const store = useBoardStore();
    await store.loadCards();

    apiMutateMock.mockResolvedValue(undefined);
    await store.markCardRead(1);

    expect(store.cards[0]?.unread).toBe(false);
    expect(apiMutateMock).toHaveBeenCalledWith("POST", "/stations/oz/cards/1/read");
  });

  it("keeps the optimistic read even when the cursor write fails (next refetch decides)", async () => {
    primeCards([cardFixture({ unread: true })]);
    const store = useBoardStore();
    await store.loadCards();

    apiMutateMock.mockRejectedValue(new Error("POST read failed with 500: hiccup"));
    await store.markCardRead(1);

    expect(store.cards[0]?.unread).toBe(false);
    expect(toasts).toHaveLength(0);
  });
});
