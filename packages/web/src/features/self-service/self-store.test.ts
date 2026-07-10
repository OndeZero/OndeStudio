import type { SelfProfile, SelfSlotsResponse, Slot } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useSelfStore } from "./self-store";

/**
 * The store is tested against the /self contract over a mocked global fetch —
 * NOT lib/api/client, on purpose: the guest realm speaks direct fetch so a 401
 * shows the login form instead of redirecting to the team /login.
 */
const BASE = "/api/v1";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const PROFILE: SelfProfile = {
  id: 7,
  username: "guest_dj",
  displayName: "Guest DJ",
  kind: "external",
};

function slotFixture(overrides: Partial<Slot> = {}): Slot {
  return {
    id: 1,
    station: "oz",
    kind: "show",
    title: "Night Drift",
    showId: null,
    showName: null,
    recurrence: { type: "weekly", weekdays: [2], time: "22:00" },
    durationMin: 60,
    negotiationDefault: "validated",
    broadcasterId: 7,
    ...overrides,
  };
}

const SLOTS: SelfSlotsResponse = {
  station: "oz",
  zone: "Europe/Athens",
  slots: [slotFixture()],
};

/**
 * Route a fetch by URL + method to a canned Response, so a login test can
 * answer both POST /self/login and the follow-up GET /self/slots. A fresh
 * Response per call: a body can only be read once.
 */
function stubRoutes(routes: Record<string, () => Response>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      const method = (init?.method ?? "GET").toUpperCase();
      const key = `${method} ${url}`;
      const make = routes[key];
      if (!make) throw new Error(`unexpected fetch: ${key}`);
      return make();
    }),
  );
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("self-store probe", () => {
  it("leaves the profile null on 401 (not signed in) and marks the probe done", async () => {
    stubRoutes({
      [`GET ${BASE}/self/me`]: () => jsonResponse({ error: "unauthorized" }, 401),
    });
    const store = useSelfStore();
    await store.probe();

    expect(store.profile).toBeNull();
    expect(store.checked).toBe(true);
    expect(store.slots).toEqual([]);
  });

  it("sets the profile and loads slots on 200", async () => {
    stubRoutes({
      [`GET ${BASE}/self/me`]: () => jsonResponse(PROFILE),
      [`GET ${BASE}/self/slots`]: () => jsonResponse(SLOTS),
    });
    const store = useSelfStore();
    await store.probe();

    expect(store.profile).toEqual(PROFILE);
    expect(store.slots).toHaveLength(1);
    expect(store.zone).toBe("Europe/Athens");
    expect(store.checked).toBe(true);
  });
});

describe("self-store login", () => {
  it("sets the profile and loads slots on success", async () => {
    stubRoutes({
      [`POST ${BASE}/self/login`]: () => jsonResponse(PROFILE),
      [`GET ${BASE}/self/slots`]: () => jsonResponse(SLOTS),
    });
    const store = useSelfStore();
    const ok = await store.login("guest_dj", "hunter2");

    expect(ok).toBe(true);
    expect(store.profile).toEqual(PROFILE);
    expect(store.slots).toHaveLength(1);
    expect(store.zone).toBe("Europe/Athens");
    expect(store.error).toBeNull();
    expect(store.loading).toBe(false);
  });

  it("surfaces the 422 message and leaves the profile null on bad credentials", async () => {
    stubRoutes({
      [`POST ${BASE}/self/login`]: () =>
        jsonResponse({ error: "Wrong username or password." }, 422),
    });
    const store = useSelfStore();
    const ok = await store.login("guest_dj", "nope");

    expect(ok).toBe(false);
    expect(store.profile).toBeNull();
    expect(store.error).toBe("Wrong username or password.");
    expect(store.loading).toBe(false);
  });
});

describe("self-store logout", () => {
  it("clears the profile, slots and zone", async () => {
    stubRoutes({
      [`POST ${BASE}/self/login`]: () => jsonResponse(PROFILE),
      [`GET ${BASE}/self/slots`]: () => jsonResponse(SLOTS),
      [`POST ${BASE}/self/logout`]: () => new Response(null, { status: 204 }),
    });
    const store = useSelfStore();
    await store.login("guest_dj", "hunter2");
    expect(store.profile).not.toBeNull();

    await store.logout();

    expect(store.profile).toBeNull();
    expect(store.slots).toEqual([]);
    expect(store.zone).toBe("");
  });
});
