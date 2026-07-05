import type { Occurrence } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { useGridStore } from "./grid-store";
import { toasts } from "./toast";

// The store is tested against the contract, not the network (same stance as
// the on-air tests): every IO edge is mocked.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/mutate", () => ({ apiMutate: vi.fn() }));
vi.mock("../../lib/api/sse", () => ({ subscribeStationSse: vi.fn(() => () => {}) }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last overload returns void, which
// would reject mock payloads at the type level.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

const ZONE = "Europe/Paris";

/** Wed 8 Jul 2026, 23:00–01:00 Paris — spans midnight into Thursday. */
function occurrenceFixture(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    id: "1_1752008400000",
    slotId: 1,
    station: "oz",
    kind: "show",
    title: "Minuit Décousu",
    startsAt: "2026-07-08T21:00:00.000Z",
    endsAt: "2026-07-08T23:00:00.000Z",
    durationMin: 120,
    originalStartsAt: "2026-07-08T21:00:00.000Z",
    moved: false,
    negotiationState: "validated",
    contentState: "ready",
    issueFlags: [],
    contentDurationMin: 118,
    ...overrides,
  };
}

function primeApi(occurrences: Occurrence[], opts: { mirrorFails?: boolean } = {}): void {
  apiGetMock.mockImplementation((path: string) => {
    if (path.includes("/occurrences")) {
      return Promise.resolve({ station: "oz", zone: ZONE, occurrences });
    }
    if (path.includes("/mirror")) {
      return opts.mirrorFails
        ? Promise.reject(new Error("GET mirror failed with 503: playout system unreachable"))
        : Promise.resolve({ station: "oz", zone: ZONE, blocks: [] });
    }
    return Promise.resolve({ station: "oz", zone: ZONE, slots: [] });
  });
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  toasts.splice(0);
});

describe("grid-store day segmentation", () => {
  it("splits a midnight-spanning occurrence into one segment per touched day", async () => {
    primeApi([occurrenceFixture()]);
    const store = useGridStore();
    await store.setWeek("2026-07-06");

    const wednesday = store.occurrencesByDay.get("2026-07-08") ?? [];
    const thursday = store.occurrencesByDay.get("2026-07-09") ?? [];
    const dayBoundary = Date.parse("2026-07-08T22:00:00.000Z"); // Thu 00:00 Paris

    expect(wednesday).toHaveLength(1);
    expect(wednesday[0]?.continuesBefore).toBe(false);
    expect(wednesday[0]?.continuesAfter).toBe(true);
    expect(wednesday[0]?.endMs).toBe(dayBoundary);

    expect(thursday).toHaveLength(1);
    expect(thursday[0]?.continuesBefore).toBe(true);
    expect(thursday[0]?.continuesAfter).toBe(false);
    expect(thursday[0]?.startMs).toBe(dayBoundary);
  });
});

describe("grid-store optimistic patching", () => {
  it("applies a move locally before the wire answers, then keeps the server truth", async () => {
    primeApi([occurrenceFixture()]);
    const store = useGridStore();
    await store.setWeek("2026-07-06");

    const serverEcho = occurrenceFixture({
      startsAt: "2026-07-08T22:00:00.000Z",
      endsAt: "2026-07-09T00:00:00.000Z",
      moved: true,
    });
    let resolvePatch: (value: unknown) => void = () => {};
    apiMutateMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePatch = resolve;
        }),
    );

    const pending = store.patchOccurrence("1_1752008400000", {
      startsAtWall: "2026-07-09T00:00",
      durationMin: 120,
    });

    // Optimistic: 00:00 Paris = 22:00Z, applied synchronously.
    expect(store.occurrences[0]?.startsAt).toBe("2026-07-08T22:00:00.000Z");
    expect(store.occurrences[0]?.moved).toBe(true);

    resolvePatch(serverEcho);
    await expect(pending).resolves.toBe(true);
    expect(store.occurrences[0]).toEqual(serverEcho);
    expect(toasts).toHaveLength(0);
  });

  it("rolls back and toasts when the PATCH fails", async () => {
    primeApi([occurrenceFixture()]);
    const store = useGridStore();
    await store.setWeek("2026-07-06");

    apiMutateMock.mockRejectedValue(
      new Error("PATCH failed with 409: illegal transition validated → dealing"),
    );
    const result = await store.patchOccurrence("1_1752008400000", {
      negotiationState: "dealing",
    });

    expect(result).toBe(false);
    expect(store.occurrences[0]).toEqual(occurrenceFixture());
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toContain("illegal transition");
  });
});

describe("grid-store mirror degradation", () => {
  it("keeps the grid alive and raises a dismissible notice when the mirror 503s", async () => {
    primeApi([occurrenceFixture()], { mirrorFails: true });
    const store = useGridStore();
    await store.setWeek("2026-07-06");

    expect(store.occurrences).toHaveLength(1);
    expect(store.mirrorBlocks).toHaveLength(0);
    expect(store.mirrorError).toContain("playout system unreachable");

    store.dismissMirrorNotice();
    expect(store.mirrorError).toBeNull();
  });
});
