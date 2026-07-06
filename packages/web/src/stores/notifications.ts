import { type Notification, NotificationsResponseSchema } from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiGet } from "../lib/api/client";
import { apiMutate } from "../lib/api/mutate";
import { subscribeStationSse } from "../lib/api/sse";
import { useStationStore } from "./station";

/**
 * The in-app inbox (PD §5.12): assignment/state triggers land here and feed
 * the header bell and the grid's attention rail. The list itself is global,
 * but activity arrives over the current station's `board` SSE channel, so
 * the shell (re)starts the store per station while a session exists.
 */
export const useNotificationsStore = defineStore("notifications", () => {
  const stationStore = useStationStore();

  const notifications = ref<Notification[]>([]);
  const unreadCount = ref(0);
  const unread = computed(() => notifications.value.filter((n) => n.readAt === null));

  /**
   * Monotonic id per load (the board-store.loadCards idiom): a stale response
   * must never repaint the list. markRead/markAllRead also bump it — a fetch
   * already in flight carries the pre-flip server truth, and letting it land
   * would resurrect the unread state the user just cleared.
   */
  let epoch = 0;

  async function load(): Promise<void> {
    const myEpoch = ++epoch;
    try {
      const res = await apiGet("/notifications", NotificationsResponseSchema);
      if (myEpoch !== epoch) return;
      notifications.value = res.notifications;
      unreadCount.value = res.unreadCount;
    } catch {
      // Awareness is best-effort chrome: a failed poll must never toast over
      // the page the user is actually working in — the next tick retries.
    }
  }

  async function markRead(id: number): Promise<void> {
    const target = notifications.value.find((n) => n.id === id);
    if (target && target.readAt === null) {
      epoch++; // any in-flight load predates this optimistic flip — discard it
      target.readAt = new Date().toISOString();
      unreadCount.value = Math.max(0, unreadCount.value - 1);
    }
    try {
      await apiMutate("POST", `/notifications/${id}/read`);
    } catch {
      await load(); // the optimistic flip lied — resync
    }
  }

  async function markAllRead(): Promise<void> {
    epoch++; // any in-flight load predates this optimistic flip — discard it
    const stamp = new Date().toISOString();
    for (const n of notifications.value) if (n.readAt === null) n.readAt = stamp;
    unreadCount.value = 0;
    try {
      await apiMutate("POST", "/notifications/read-all");
    } catch {
      await load();
    }
  }

  let closeSse: (() => void) | null = null;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  /** Same 300ms debounce as the grid store: SSE hints coalesce into one fetch. */
  function scheduleRefetch(): void {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void load();
    }, 300);
  }

  /**
   * Start (or restart, on station switch) the freshness loop: board SSE with
   * reconnect resync, plus a 60s poll that only fires while the tab is
   * visible — notifications for a hidden tab can wait.
   */
  function start(): void {
    stop();
    void load();
    closeSse = subscribeStationSse(
      stationStore.current,
      ["board"],
      scheduleRefetch,
      scheduleRefetch,
    );
    pollTimer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, 60_000);
  }

  function stop(): void {
    closeSse?.();
    closeSse = null;
    if (pollTimer !== null) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    if (refetchTimer !== null) {
      clearTimeout(refetchTimer);
      refetchTimer = null;
    }
  }

  return { notifications, unreadCount, unread, load, markRead, markAllRead, start, stop };
});
