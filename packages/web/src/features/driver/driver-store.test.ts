import type { DriverStatusResponse, ReconciliationItem } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { subscribeStationSse } from "../../lib/api/sse";
import { toasts } from "../grid/toast";
import { useDriverStore } from "./driver-store";

// Contract, not the network (grid-store stance): every IO edge is mocked.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/mutate", () => ({ apiMutate: vi.fn() }));
vi.mock("../../lib/api/sse", () => ({ subscribeStationSse: vi.fn(() => () => {}) }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last returns void, rejecting payloads.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

function statusFixture(overrides: Partial<DriverStatusResponse> = {}): DriverStatusResponse {
  return {
    writeStations: ["wz-test"],
    driving: true,
    projections: [],
    openReconciliations: 2,
    lastRunAt: "2026-07-06T10:00:00.000Z",
    adapterHealthy: true,
    ...overrides,
  };
}

function reconFixture(overrides: Partial<ReconciliationItem> = {}): ReconciliationItem {
  return {
    id: 1,
    slotId: 5,
    station: "wz-test",
    title: "Nuit Blanche",
    kind: "edited",
    summary: "start time changed in AzuraCast",
    ondestudio: "Fri 22:00",
    azuracast: "Fri 23:00",
    detectedAt: "2026-07-06T09:00:00.000Z",
    ...overrides,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  toasts.splice(0);
});

describe("driver-store load", () => {
  it("stores the status and exposes the open-reconciliation count", async () => {
    apiGetMock.mockImplementation(() => Promise.resolve(statusFixture()));
    const store = useDriverStore();
    await store.load();

    expect(store.status?.driving).toBe(true);
    expect(store.status?.writeStations).toEqual(["wz-test"]);
    expect(store.openReconciliationCount).toBe(2);
    expect(apiGetMock).toHaveBeenCalledWith("/driver", expect.anything());
  });

  it("stores the reconciliation inbox from its own endpoint", async () => {
    apiGetMock.mockImplementation(() =>
      Promise.resolve({ items: [reconFixture(), reconFixture({ id: 2 })] }),
    );
    const store = useDriverStore();
    await store.loadReconciliations();

    expect(store.reconciliations).toHaveLength(2);
    expect(apiGetMock).toHaveBeenCalledWith("/reconciliations", expect.anything());
  });
});

describe("driver-store resolve", () => {
  it("posts the resolution then refetches both status and inbox", async () => {
    apiGetMock.mockImplementation((path: string) =>
      path === "/driver"
        ? Promise.resolve(statusFixture({ openReconciliations: 1 }))
        : Promise.resolve({ items: [] }),
    );
    apiMutateMock.mockResolvedValue(undefined);

    const store = useDriverStore();
    const ok = await store.resolve(7, "keep-ondestudio");

    expect(ok).toBe(true);
    expect(apiMutateMock).toHaveBeenCalledWith("POST", "/reconciliations/7/resolve", {
      resolution: "keep-ondestudio",
    });
    // Both reads refetched: the resolved item leaves and the count settles.
    expect(apiGetMock).toHaveBeenCalledWith("/driver", expect.anything());
    expect(apiGetMock).toHaveBeenCalledWith("/reconciliations", expect.anything());
    expect(store.reconciliations).toHaveLength(0);
    expect(store.openReconciliationCount).toBe(1);
  });

  it("toasts and returns false when the resolve POST fails", async () => {
    apiMutateMock.mockRejectedValue(
      new Error("POST /reconciliations/7/resolve failed with 409: already resolved"),
    );
    const store = useDriverStore();
    const ok = await store.resolve(7, "keep-azuracast");

    expect(ok).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toMatch(/already resolved/);
  });
});

describe("driver-store epoch guard", () => {
  it("drops a stale inbox response when a newer load already answered", async () => {
    let resolveStale: (value: unknown) => void = () => {};
    apiGetMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve({ items: [reconFixture({ id: 99, title: "fresh" })] }),
      );

    const store = useDriverStore();
    const stale = store.loadReconciliations();
    await store.loadReconciliations();
    expect(store.reconciliations[0]?.title).toBe("fresh");

    // The first fetch answers late — it must not overwrite the newer inbox.
    resolveStale({ items: [reconFixture({ id: 1, title: "stale" })] });
    await stale;
    expect(store.reconciliations[0]?.title).toBe("fresh");
  });
});

describe("driver-store lifecycle", () => {
  it("subscribes to the grid channel on start and closes it on stop", () => {
    const closeSpy = vi.fn();
    vi.mocked(subscribeStationSse).mockReturnValue(closeSpy);

    const store = useDriverStore();
    store.start();
    expect(subscribeStationSse).toHaveBeenCalledWith(
      expect.anything(),
      ["grid"],
      expect.any(Function),
      expect.any(Function),
    );

    store.stop();
    expect(closeSpy).toHaveBeenCalled();
  });
});
