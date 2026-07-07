import type { Episode, EpisodeQueueResponse, RescanResult } from "@ondestudio/shared";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { toasts } from "../grid/toast";
import { useEpisodeQueueStore } from "./episode-queue-store";

// The store is tested against the contract, not the network (same stance as
// the grid-store tests): every IO edge is mocked.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/mutate", () => ({ apiMutate: vi.fn() }));

const apiGetMock = vi.mocked(apiGet);
// Cast around apiMutate's overloads: the last overload returns void, which
// would reject mock payloads at the type level.
const apiMutateMock = apiMutate as unknown as Mock<(...args: unknown[]) => Promise<unknown>>;

function episodeFixture(overrides: Partial<Episode> = {}): Episode {
  return {
    id: 1,
    azFileId: "az-1",
    path: "shows/minuit/ep1.mp3",
    title: "Episode 1",
    artist: "Minuit",
    durationSec: 3600,
    arrivedAt: "2026-07-06T10:00:00.000Z",
    filledOccurrenceId: null,
    filledOccurrenceAt: null,
    ...overrides,
  };
}

function queueFixture(episodes: Episode[]): EpisodeQueueResponse {
  return { showId: 1, dropFolderPath: "shows/minuit", episodes };
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.clearAllMocks();
  toasts.splice(0);
});

describe("episode-queue-store load", () => {
  it("populates the queue from the episodes endpoint", async () => {
    const episodes = [episodeFixture({ id: 1 }), episodeFixture({ id: 2, title: "Episode 2" })];
    apiGetMock.mockResolvedValue(queueFixture(episodes));

    const store = useEpisodeQueueStore();
    await store.load(1);

    expect(apiGetMock).toHaveBeenCalledWith("/stations/oz/shows/1/episodes", expect.anything());
    expect(store.showId).toBe(1);
    expect(store.dropFolderPath).toBe("shows/minuit");
    expect(store.episodes).toEqual(episodes);
    expect(store.loading).toBe(false);
  });
});

describe("episode-queue-store rescan", () => {
  it("posts to the rescan endpoint, toasts a summary, and reloads the queue", async () => {
    const rescan: RescanResult = { scanned: 5, added: 2, removed: 0, filled: 2 };
    apiMutateMock.mockResolvedValue(rescan);
    apiGetMock.mockResolvedValue(queueFixture([episodeFixture()]));

    const store = useEpisodeQueueStore();
    await store.rescan(1);

    expect(apiMutateMock).toHaveBeenCalledWith(
      "POST",
      "/stations/oz/shows/1/rescan",
      {},
      expect.anything(),
    );
    // The queue is reloaded from the folder after the rescan.
    expect(apiGetMock).toHaveBeenCalledWith("/stations/oz/shows/1/episodes", expect.anything());
    expect(store.episodes).toHaveLength(1);
    expect(store.rescanning).toBe(false);
    expect(toasts).toHaveLength(1);
    expect(toasts[0]?.kind).toBe("info");
    expect(toasts[0]?.message).toContain("Scanned 5");
    expect(toasts[0]?.message).toContain("added 2");
    expect(toasts[0]?.message).toContain("filled 2");
  });
});

describe("episode-queue-store reorder", () => {
  it("posts the full ordered ids and refreshes from the response", async () => {
    apiGetMock.mockResolvedValue(
      queueFixture([episodeFixture({ id: 1 }), episodeFixture({ id: 2, title: "Episode 2" })]),
    );
    const store = useEpisodeQueueStore();
    await store.load(1);

    const reordered = [episodeFixture({ id: 2, title: "Episode 2" }), episodeFixture({ id: 1 })];
    apiMutateMock.mockResolvedValue(queueFixture(reordered));

    await store.reorder(1, [2, 1]);

    expect(apiMutateMock).toHaveBeenCalledWith(
      "POST",
      "/stations/oz/shows/1/episodes/reorder",
      { orderedIds: [2, 1] },
      expect.anything(),
    );
    expect(store.episodes.map((e) => e.id)).toEqual([2, 1]);
  });
});
