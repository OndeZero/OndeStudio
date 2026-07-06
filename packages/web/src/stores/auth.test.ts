import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../lib/api/client";
import { apiMutate } from "../lib/api/mutate";
import { useAuthStore } from "./auth";

// The store is tested against the contract, not the network (grid-store
// stance): both IO edges are mocked.
vi.mock("../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../lib/api/mutate", () => ({ apiMutate: vi.fn() }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last overload returns void, which
// would reject mock payloads at the type level.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

const ME = { id: 1, displayName: "Maigre", email: "thomas@37m.gr", role: "team" as const };

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
});

describe("auth store startup probe", () => {
  it("keeps me null but flips loaded when the probe answers 401", async () => {
    apiGetMock.mockImplementation(() =>
      Promise.reject(new Error("GET /auth/me failed with 401: unauthenticated")),
    );
    const store = useAuthStore();
    await store.loadMe();
    expect(store.me).toBeNull();
    expect(store.loaded).toBe(true);
  });

  it("stores the session identity on success", async () => {
    apiGetMock.mockImplementation(() => Promise.resolve(ME));
    const store = useAuthStore();
    await store.loadMe();
    expect(store.me).toEqual(ME);
    expect(store.loaded).toBe(true);
  });
});

describe("auth store login/logout", () => {
  it("sets me from the login response", async () => {
    apiMutateMock.mockResolvedValue(ME);
    const store = useAuthStore();
    await store.login("thomas@37m.gr", "pw");
    expect(store.me).toEqual(ME);
    expect(apiMutateMock).toHaveBeenCalledWith(
      "POST",
      "/auth/login",
      { email: "thomas@37m.gr", password: "pw" },
      expect.anything(),
    );
  });

  it("rethrows a failed login and leaves me null (the page shows the reason inline)", async () => {
    apiMutateMock.mockRejectedValue(
      new Error("POST /auth/login failed with 401: invalid credentials"),
    );
    const store = useAuthStore();
    await expect(store.login("thomas@37m.gr", "wrong")).rejects.toThrow(/invalid credentials/);
    expect(store.me).toBeNull();
  });

  it("clears the whole session (me and the user roster) on logout", async () => {
    apiMutateMock.mockResolvedValue(ME);
    const store = useAuthStore();
    await store.login("thomas@37m.gr", "pw");

    apiGetMock.mockImplementation(() => Promise.resolve({ users: [ME] }));
    await store.loadUsers();
    expect(store.users).toHaveLength(1);

    apiMutateMock.mockResolvedValue(undefined);
    await store.logout();
    expect(store.me).toBeNull();
    expect(store.users).toHaveLength(0);
  });
});
