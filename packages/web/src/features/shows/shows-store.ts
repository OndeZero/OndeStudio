import {
  type ShowDetail,
  ShowDetailSchema,
  type ShowSummary,
  ShowsResponseSchema,
  type UpdateShowInput,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { useStationStore } from "../../stores/station";
import { pushToast } from "../grid/toast";

export type ShowsSortBy = "name" | "slots" | "next";

/**
 * The show library + hub data (PD §5.4). List and detail are separate
 * fetches: the list stays light for the master pane, the detail carries the
 * whole hub payload (settings, slots, occurrences).
 */
export const useShowsStore = defineStore("shows", () => {
  const stationStore = useStationStore();

  const shows = ref<ShowSummary[]>([]);
  const listLoading = ref(false);
  const sortBy = ref<ShowsSortBy>("name");

  const detail = ref<ShowDetail | null>(null);
  const detailLoading = ref(false);

  const sortedShows = computed(() => [...shows.value].sort(comparators[sortBy.value]));

  /** Monotonic ids per fetch: a stale response must never paint the page. */
  let listEpoch = 0;
  let detailEpoch = 0;

  async function loadShows(): Promise<void> {
    const epoch = ++listEpoch;
    const station = stationStore.current;
    listLoading.value = true;
    try {
      const res = await apiGet(`/stations/${station}/shows`, ShowsResponseSchema);
      if (epoch !== listEpoch || station !== stationStore.current) return;
      shows.value = res.shows;
    } catch (cause) {
      if (epoch === listEpoch) pushToast("error", messageOf(cause));
    } finally {
      if (epoch === listEpoch) listLoading.value = false;
    }
  }

  async function loadDetail(id: number): Promise<void> {
    const epoch = ++detailEpoch;
    detailLoading.value = true;
    try {
      const res = await apiGet(`/stations/${stationStore.current}/shows/${id}`, ShowDetailSchema);
      if (epoch !== detailEpoch) return;
      detail.value = res;
    } catch (cause) {
      if (epoch === detailEpoch) {
        detail.value = null;
        pushToast("error", messageOf(cause));
      }
    } finally {
      if (epoch === detailEpoch) detailLoading.value = false;
    }
  }

  /** Save-on-change with a small confirmation — the 30-second-fix stance (PD §8.1). */
  async function updateShow(id: number, patch: UpdateShowInput): Promise<boolean> {
    try {
      const res = await apiMutate(
        "PUT",
        `/stations/${stationStore.current}/shows/${id}`,
        patch,
        ShowDetailSchema,
      );
      if (detail.value?.id === id) detail.value = res;
      // Keep the master list honest without a refetch.
      const index = shows.value.findIndex((s) => s.id === id);
      const summary = index >= 0 ? shows.value[index] : undefined;
      if (summary) {
        shows.value.splice(index, 1, {
          ...summary,
          name: res.name,
          dropFolderPath: res.dropFolderPath,
          slotCount: res.slots.length,
        });
      }
      pushToast("info", "Saved.");
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      // The forms hold local drafts — reload the truth so they snap back.
      await loadDetail(id);
      return false;
    }
  }

  return {
    shows,
    listLoading,
    sortBy,
    sortedShows,
    detail,
    detailLoading,
    loadShows,
    loadDetail,
    updateShow,
  };
});

const comparators: Record<ShowsSortBy, (a: ShowSummary, b: ShowSummary) => number> = {
  name: (a, b) => a.name.localeCompare(b.name),
  slots: (a, b) => b.slotCount - a.slotCount || a.name.localeCompare(b.name),
  next: (a, b) => nextMs(a) - nextMs(b) || a.name.localeCompare(b.name),
};

/** Shows with no upcoming occurrence sink to the end of the "next" sort. */
function nextMs(s: ShowSummary): number {
  return s.nextOccurrenceAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(s.nextOccurrenceAt);
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
