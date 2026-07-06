import type { Broadcaster, BroadcastersResponse, BroadcasterWithSecret } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { toasts } from "../grid/toast";
import { useBroadcastersStore } from "./broadcasters-store";

// The store is tested against the contract, not the network (grid-store
// stance): both IO edges are mocked.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/mutate", () => ({ apiMutate: vi.fn() }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last overload returns void, which
// would reject mock payloads at the type level.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

function broadcasterFixture(overrides: Partial<Broadcaster> = {}): Broadcaster {
  return {
    id: 1,
    username: "nina",
    displayName: "Nina Radio",
    kind: "team",
    commentMeta: null,
    enforceSchedule: false,
    replayFlag: "not_specified",
    hasPassword: true,
    stations: [
      // The canonical M4 shape: test pushed, production held by docs/2 §7.7.
      { station: "oz", ref: null, status: "blocked" },
      { station: "wz-test", ref: "42", status: "pushed" },
    ],
    ...overrides,
  };
}

function responseFixture(broadcasters: Broadcaster[]): BroadcastersResponse {
  return { broadcasters, writeStations: ["wz-test"] };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  toasts.splice(0);
});

describe("broadcasters-store load", () => {
  it("stores the roster and the §7.7 write reach from the root-level endpoint", async () => {
    apiGetMock.mockImplementation(() => Promise.resolve(responseFixture([broadcasterFixture()])));
    const store = useBroadcastersStore();
    await store.load();

    expect(store.broadcasters).toHaveLength(1);
    expect(store.writeStations).toEqual(["wz-test"]);
    expect(store.loading).toBe(false);
    // Root-level, NOT station-scoped: a broadcaster IS the main+test pair.
    expect(apiGetMock).toHaveBeenCalledWith("/broadcasters", expect.anything());
  });

  it("drops a stale response when a newer load already answered (epoch guard)", async () => {
    let resolveStale: (value: unknown) => void = () => {};
    apiGetMock
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveStale = resolve;
          }),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(responseFixture([broadcasterFixture({ id: 2, username: "fresh" })])),
      );

    const store = useBroadcastersStore();
    const stale = store.load();
    await store.load();
    expect(store.broadcasters[0]?.username).toBe("fresh");

    // The first fetch answers late — it must not overwrite the newer state.
    resolveStale(responseFixture([broadcasterFixture({ id: 1, username: "stale" })]));
    await stale;
    expect(store.broadcasters[0]?.username).toBe("fresh");
    expect(store.loading).toBe(false);
  });
});

describe("broadcasters-store create", () => {
  it("returns the one-time secret to the caller and surfaces warnings as toasts", async () => {
    const result: BroadcasterWithSecret = {
      broadcaster: broadcasterFixture({ id: 3, username: "guest_dj", kind: "external" }),
      generatedPassword: "s3cret-s3cret",
      warnings: ["oz: not pushed (writes blocked, docs/2 §7.7)"],
    };
    apiMutateMock.mockResolvedValue(result);

    const store = useBroadcastersStore();
    const res = await store.create({
      username: "guest_dj",
      displayName: "Guest DJ",
      kind: "external",
      enforceSchedule: false,
      replayFlag: "not_specified",
    });

    // The secret travels back to the page (banner), never into store state.
    expect(res?.generatedPassword).toBe("s3cret-s3cret");
    expect(store.broadcasters.map((b) => b.username)).toContain("guest_dj");
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("info");
    expect(toasts[0]?.message).toMatch(/writes blocked/);
    expect(apiMutateMock).toHaveBeenCalledWith(
      "POST",
      "/broadcasters",
      expect.objectContaining({ username: "guest_dj" }),
      expect.anything(),
    );
  });

  it("toasts the failure (e.g. 409 duplicate username) and returns null", async () => {
    apiMutateMock.mockRejectedValue(
      new Error("POST /broadcasters failed with 409: username already exists"),
    );

    const store = useBroadcastersStore();
    const res = await store.create({
      username: "nina",
      displayName: "Nina Again",
      kind: "team",
      enforceSchedule: false,
      replayFlag: "not_specified",
    });

    expect(res).toBeNull();
    expect(store.broadcasters).toHaveLength(0);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("error");
    expect(toasts[0]?.message).toMatch(/already exists/);
  });
});
