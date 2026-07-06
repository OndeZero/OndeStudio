import {
  type DriverStatusResponse,
  DriverStatusResponseSchema,
  type ReconciliationItem,
  ReconciliationResponseSchema,
  type ResolveReconciliationInput,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { subscribeStationSse } from "../../lib/api/sse";
import { useStationStore } from "../../stores/station";
import { pushToast } from "../grid/toast";

/**
 * The write-back driver's read surface (RFC 0001, docs/2 §11 M3): what
 * OndeStudio has projected into AzuraCast, plus the reconciliation inbox where
 * a manual AzuraCast edit waits for the team to pick a side (PD §6).
 *
 * Root-level like the broadcasters store — the driver spans every write
 * station (docs/2 §7.7), it is not scoped to the active grid station. Its only
 * per-station tie is the SSE trigger: it reacts to the active station's grid
 * edits by refetching, because a grid change is what moves desired state.
 */
export const useDriverStore = defineStore("driver", () => {
  const stationStore = useStationStore();

  const status = ref<DriverStatusResponse | null>(null);
  const reconciliations = ref<ReconciliationItem[]>([]);

  /** The rail badge reads this; the /driver inbox length agrees after a load. */
  const openReconciliationCount = computed(() => status.value?.openReconciliations ?? 0);

  // Two independent resources → two epoch counters: refetching one must never
  // let a slow response from the other be judged stale (broadcasters-store
  // stance, doubled).
  let statusEpoch = 0;
  let reconEpoch = 0;

  /**
   * Best-effort refreshes: a failed status/inbox fetch keeps the last good
   * view and stays silent, because this runs on a 30s poll and an SSE burst —
   * toasting each cycle would bury the screen. A genuinely degraded link
   * surfaces through `adapterHealthy` on the page, not a toast storm.
   */
  async function load(): Promise<void> {
    const myEpoch = ++statusEpoch;
    try {
      const res = await apiGet("/driver", DriverStatusResponseSchema);
      if (myEpoch === statusEpoch) status.value = res;
    } catch {
      // keep the last snapshot; the next poll/SSE tick retries
    }
  }

  async function loadReconciliations(): Promise<void> {
    const myEpoch = ++reconEpoch;
    try {
      const res = await apiGet("/reconciliations", ReconciliationResponseSchema);
      // Own copy: never mutate the response object.
      if (myEpoch === reconEpoch) reconciliations.value = [...res.items];
    } catch {
      // best-effort, as above
    }
  }

  /**
   * Pick a side for one drift (PD §6). The POST answers 204; both reads are
   * refetched on success so the resolved item leaves the inbox and the badge
   * count settles. This is the one driver mutation that DOES toast on failure —
   * the user asked for it, so a silent no-op would be dishonest.
   */
  async function resolve(
    id: number,
    resolution: ResolveReconciliationInput["resolution"],
  ): Promise<boolean> {
    try {
      await apiMutate("POST", `/reconciliations/${id}/resolve`, { resolution });
      await Promise.all([load(), loadReconciliations()]);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  // ---- lifecycle: poll + SSE while a driver surface (page or rail) is up ----

  let mountCount = 0;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let closeSse: (() => void) | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Debounce SSE bursts: one drag emits many grid events; one refetch suffices. */
  function scheduleRefetch(): void {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void load();
      void loadReconciliations();
    }, 500);
  }

  function connectSse(): void {
    disconnectSse();
    // Follow the active station's grid channel (grid-store idiom): refetch on
    // every event AND on every (re)connect, since events emitted while the
    // stream was down (sleep, redeploy) are gone.
    closeSse = subscribeStationSse(
      stationStore.current,
      ["grid"],
      scheduleRefetch,
      scheduleRefetch,
    );
  }

  function disconnectSse(): void {
    closeSse?.();
    closeSse = null;
    if (refetchTimer !== null) {
      clearTimeout(refetchTimer);
      refetchTimer = null;
    }
  }

  // A station switch re-points the SSE trigger — but only while something is
  // actually listening (closeSse set), so no consumer need think about it.
  watch(
    () => stationStore.current,
    () => {
      if (closeSse !== null) connectSse();
    },
  );

  /**
   * Refcounted so the grid's attention rail and the /driver page can both hold
   * the poll+stream open; the interval and stream drop only when the last one
   * unmounts. 30s matches the driver loop's own freshness bound (RFC 0001 §6).
   */
  function start(): void {
    mountCount += 1;
    if (mountCount === 1) {
      pollTimer = setInterval(() => void load(), 30_000);
      connectSse();
    }
  }

  function stop(): void {
    mountCount = Math.max(0, mountCount - 1);
    if (mountCount === 0) {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      disconnectSse();
    }
  }

  return {
    status,
    reconciliations,
    openReconciliationCount,
    load,
    loadReconciliations,
    resolve,
    start,
    stop,
  };
});

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
