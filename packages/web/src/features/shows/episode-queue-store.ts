import {
  type Episode,
  EpisodeQueueResponseSchema,
  type ReorderEpisodesInput,
  RescanResultSchema,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { useStationStore } from "../../stores/station";
import { pushToast } from "../grid/toast";

/**
 * A show's drop-folder episode queue (PD §4.5): files dropped in the show's
 * folder queue up here and auto-fill its upcoming empty occurrences. The team
 * can rescan the folder and reorder the queue by hand. Same stance as the
 * shows store — everything is refreshed from the server's authoritative
 * response, and a stale fetch never paints the page.
 */
export const useEpisodeQueueStore = defineStore("episodeQueue", () => {
  const stationStore = useStationStore();

  /** The show the loaded queue belongs to — guards against painting a stale show. */
  const showId = ref<number | null>(null);
  const dropFolderPath = ref<string | null>(null);
  const episodes = ref<Episode[]>([]);
  const loading = ref(false);
  const rescanning = ref(false);

  /** Monotonic ids per fetch: a stale response must never paint the page. */
  let loadEpoch = 0;

  async function load(id: number): Promise<void> {
    const epoch = ++loadEpoch;
    showId.value = id;
    loading.value = true;
    try {
      const res = await apiGet(
        `/stations/${stationStore.current}/shows/${id}/episodes`,
        EpisodeQueueResponseSchema,
      );
      if (epoch !== loadEpoch) return;
      dropFolderPath.value = res.dropFolderPath;
      episodes.value = res.episodes;
    } catch (cause) {
      if (epoch === loadEpoch) {
        episodes.value = [];
        pushToast("error", messageOf(cause));
      }
    } finally {
      if (epoch === loadEpoch) loading.value = false;
    }
  }

  /** Rescan the drop folder, toast a one-line summary, then reload the queue. */
  async function rescan(id: number): Promise<void> {
    rescanning.value = true;
    try {
      const result = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/shows/${id}/rescan`,
        {},
        RescanResultSchema,
      );
      const parts = [`Scanned ${result.scanned}`, `added ${result.added}`];
      if (result.removed > 0) parts.push(`removed ${result.removed}`);
      parts.push(`filled ${result.filled}`);
      pushToast("info", `${parts.join(", ")}.`);
      await load(id);
    } catch (cause) {
      pushToast("error", messageOf(cause));
    } finally {
      rescanning.value = false;
    }
  }

  /** Persist a new full queue order; refresh from the server's echo. */
  async function reorder(id: number, orderedIds: number[]): Promise<void> {
    try {
      const body: ReorderEpisodesInput = { orderedIds };
      const res = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/shows/${id}/episodes/reorder`,
        body,
        EpisodeQueueResponseSchema,
      );
      if (showId.value === id) {
        dropFolderPath.value = res.dropFolderPath;
        episodes.value = res.episodes;
      }
    } catch (cause) {
      pushToast("error", messageOf(cause));
    }
  }

  return { showId, dropFolderPath, episodes, loading, rescanning, load, rescan, reorder };
});

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
