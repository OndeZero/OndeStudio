import type { OnAir } from "@ondestudio/shared";
import { flushPromises, mount } from "@vue/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { apiGet } from "../../lib/api/client";
import OnAirPanel from "./on-air-panel.vue";

// The panel is tested against the contract, not the network: both IO edges
// are mocked so these tests stay fast and deterministic.
vi.mock("../../lib/api/client", () => ({ apiGet: vi.fn() }));
vi.mock("../../lib/api/sse", () => ({ subscribeStationSse: vi.fn(() => () => {}) }));

const apiGetMock = vi.mocked(apiGet);

function onAirFixture(overrides: Partial<OnAir> = {}): OnAir {
  return {
    station: "oz",
    live: { isLive: false, streamerName: null },
    current: {
      title: "Night Drift",
      artist: "Kaya Dune",
      playlist: "night-rotation",
      startedAt: "2026-07-05T21:00:00.000Z",
      durationSec: 3600,
    },
    next: null,
    observedAt: "2026-07-05T21:04:00.000Z",
    stale: false,
    ...overrides,
  };
}

async function mountPanel(state: OnAir) {
  apiGetMock.mockResolvedValue(state);
  const wrapper = mount(OnAirPanel, { props: { station: "oz" } });
  await flushPromises();
  return wrapper;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("on-air-panel", () => {
  it("renders the current track", async () => {
    const wrapper = await mountPanel(onAirFixture());
    expect(wrapper.text()).toContain("Night Drift");
    expect(wrapper.text()).toContain("Kaya Dune");
    expect(wrapper.find(".live-badge").exists()).toBe(false);
  });

  it("shows the LIVE badge with the streamer name when a live source is up", async () => {
    const wrapper = await mountPanel(
      onAirFixture({ live: { isLive: true, streamerName: "Ondine" } }),
    );
    const badge = wrapper.find(".live-badge");
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("LIVE");
    expect(badge.text()).toContain("Ondine");
  });

  it("shows the degraded-link banner when the state is stale", async () => {
    const wrapper = await mountPanel(onAirFixture({ stale: true }));
    expect(wrapper.text()).toContain("Playout link degraded");
  });
});
