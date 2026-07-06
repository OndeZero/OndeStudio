import { MediaBrowseResponseSchema, type MediaEntry } from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiGet } from "../../lib/api/client";
import { useStationStore } from "../../stores/station";

/**
 * The disk lens, read-only (docs/2 §8.5 — upload deliberately deferred):
 * browse the canonical filetree through the API's playout mirror. A dead
 * playout link degrades to a dismissible notice, the grid-mirror stance
 * (docs/2 §7.4) — never a dead page.
 */
export const useMediaStore = defineStore("media", () => {
  const stationStore = useStationStore();

  const path = ref("");
  const entries = ref<MediaEntry[]>([]);
  const loading = ref(false);
  const degraded = ref<string | null>(null);

  const breadcrumbs = computed(() => {
    const parts = path.value.split("/").filter((part) => part !== "");
    return parts.map((name, index) => ({ name, path: parts.slice(0, index + 1).join("/") }));
  });

  /** Monotonic id per browse: a slow parent listing must never overwrite a child's. */
  let epoch = 0;

  async function browse(target: string): Promise<void> {
    const myEpoch = ++epoch;
    const station = stationStore.current;
    path.value = target;
    loading.value = true;
    try {
      const query = target === "" ? "" : `?${new URLSearchParams({ path: target })}`;
      const res = await apiGet(`/stations/${station}/media${query}`, MediaBrowseResponseSchema);
      if (myEpoch !== epoch || station !== stationStore.current) return;
      entries.value = sortEntries(res.entries);
      degraded.value = null;
    } catch (cause) {
      if (myEpoch !== epoch) return;
      // 503 = AzuraCast unreachable; any failure leaves the same honest
      // empty-with-notice state, and the notice carries the reason.
      entries.value = [];
      degraded.value = cause instanceof Error ? cause.message : String(cause);
    } finally {
      if (myEpoch === epoch) loading.value = false;
    }
  }

  function dismissDegraded(): void {
    degraded.value = null;
  }

  return { path, entries, loading, degraded, breadcrumbs, browse, dismissDegraded };
});

/** Directories first, then files, each A→Z — the fixed browse order. */
function sortEntries(entries: MediaEntry[]): MediaEntry[] {
  return [...entries].sort(
    (a, b) => Number(a.kind === "file") - Number(b.kind === "file") || a.name.localeCompare(b.name),
  );
}
