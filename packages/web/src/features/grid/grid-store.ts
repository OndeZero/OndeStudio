import {
  type CreateSlotInput,
  type MirrorBlock,
  MirrorResponseSchema,
  type NegotiationState,
  type Occurrence,
  OccurrenceSchema,
  OccurrencesResponseSchema,
  type PatchOccurrenceInput,
  type Slot,
  type SlotKind,
  SlotSchema,
  SlotsResponseSchema,
  type UpdateSlotInput,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { subscribeStationSse } from "../../lib/api/sse";
import {
  addDays,
  addMonthsIso,
  dayStartUtc,
  firstOfMonthIso,
  formatDayRangeLabel,
  formatMonthLabel,
  formatWeekLabel,
  isoDayOf,
  mondayOfIso,
  utcToWall,
  wallToUtc,
  weekMondayOf,
} from "../../lib/station-time";
import { useStationStore } from "../../stores/station";
import { type DayWindow, splitIntoDaySegments } from "./grid-segments";
import { pushToast } from "./toast";

/**
 * The undo window (docs/2 §7.5): the AzuraCast push is debounced server-side,
 * so reverting OS state within this window means the debounced reconcile reads
 * the reverted desired state and pushes nothing net. 6s > the 4s server
 * debounce, so the toast outlives the window it guards.
 */
const UNDO_TTL_MS = 6000;

/** Until a `stations` resource exposes per-station config (docs/2 §6.2). */
export const DEFAULT_ZONE = "Europe/Paris";

/** The time-lens zoom (docs/2 §11 fast-follow): a week, a 3-day, or a month. */
export type GridView = "week" | "day3" | "month";

export const useGridStore = defineStore("grid", () => {
  const stationStore = useStationStore();

  const viewMode = ref<GridView>("week");
  // The reference day the visible range is derived from (Monday in week mode,
  // the first column in 3-day mode, any day of the month in month mode).
  const anchorDay = ref(weekMondayOf(new Date(), DEFAULT_ZONE));
  const zone = ref(DEFAULT_ZONE);
  const occurrences = ref<Occurrence[]>([]);
  const mirrorBlocks = ref<MirrorBlock[]>([]);
  const mirrorError = ref<string | null>(null);
  const slots = ref<Slot[]>([]);
  const negotiationFilter = ref<ReadonlySet<NegotiationState>>(new Set());
  /** The AC layer can flood busy instances (dummy-playlist proliferation, PD §2.3) — hideable. */
  const showMirror = ref(true);
  const kindFilter = ref<ReadonlySet<SlotKind>>(new Set());
  const loading = ref(false);

  // The visible calendar days, derived from the lens. Month covers whole weeks
  // (Monday-aligned) so the grid is always rectangular.
  const rangeDays = computed<string[]>(() => {
    if (viewMode.value === "day3") {
      return Array.from({ length: 3 }, (_, i) => addDays(anchorDay.value, i));
    }
    if (viewMode.value === "month") {
      const last = addDays(firstOfMonthIso(addMonthsIso(anchorDay.value, 1)), -1);
      const days: string[] = [];
      let monday = mondayOfIso(firstOfMonthIso(anchorDay.value));
      while (monday <= last) {
        for (let i = 0; i < 7; i++) days.push(addDays(monday, i));
        monday = addDays(monday, 7);
      }
      return days;
    }
    const monday = mondayOfIso(anchorDay.value);
    return Array.from({ length: 7 }, (_, i) => addDays(monday, i));
  });

  /** Kept for the "jump to this week" callers (board, show hub, rail). */
  const weekMonday = computed(() => mondayOfIso(anchorDay.value));

  /** Month laid out as Monday-aligned weeks, for the calendar view. */
  const monthWeeks = computed<string[][]>(() => {
    const weeks: string[][] = [];
    for (let i = 0; i < rangeDays.value.length; i += 7) {
      weeks.push(rangeDays.value.slice(i, i + 7));
    }
    return weeks;
  });

  const visibleDays = computed(() => rangeDays.value);

  const dayWindows = computed<DayWindow[]>(() =>
    visibleDays.value.map((dayIso) => ({
      dayIso,
      startMs: dayStartUtc(dayIso, zone.value).getTime(),
      endMs: dayStartUtc(addDays(dayIso, 1), zone.value).getTime(),
    })),
  );

  /** Occurrences grouped by their start day — the month view's per-cell source. */
  const occurrencesByDayIso = computed(() => {
    const map = new Map<string, Occurrence[]>();
    for (const occurrence of occurrences.value) {
      const day = isoDayOf(new Date(occurrence.startsAt), zone.value);
      const list = map.get(day);
      if (list) list.push(occurrence);
      else map.set(day, [occurrence]);
    }
    return map;
  });

  /** The heading for the current lens ("Mon 6 – Sun 12 Jul 2026" / "July 2026"). */
  const rangeLabel = computed(() => {
    if (viewMode.value === "month") return formatMonthLabel(anchorDay.value);
    if (viewMode.value === "day3") {
      const days = rangeDays.value;
      return formatDayRangeLabel(
        days[0] ?? anchorDay.value,
        days[days.length - 1] ?? anchorDay.value,
      );
    }
    return formatWeekLabel(mondayOfIso(anchorDay.value));
  });

  const occurrencesByDay = computed(() =>
    splitIntoDaySegments(
      occurrences.value,
      (o) => ({ startMs: Date.parse(o.startsAt), endMs: Date.parse(o.endsAt) }),
      dayWindows.value,
    ),
  );

  const mirrorRange = (b: MirrorBlock) => ({
    startMs: Date.parse(b.startsAt),
    endMs: Date.parse(b.endsAt),
  });
  const mirrorBlocksByDay = computed(() =>
    splitIntoDaySegments(
      mirrorBlocks.value.filter((b) => b.mode === "block"),
      mirrorRange,
      dayWindows.value,
    ),
  );
  const mirrorBandsByDay = computed(() =>
    splitIntoDaySegments(
      mirrorBlocks.value.filter((b) => b.mode === "band"),
      mirrorRange,
      dayWindows.value,
    ),
  );

  const slotById = computed(() => new Map(slots.value.map((s) => [s.id, s])));

  /** Monotonic id per loadWindow call: a stale response must never paint the grid. */
  let windowEpoch = 0;

  async function loadWindow(): Promise<void> {
    const epoch = ++windowEpoch;
    const station = stationStore.current;
    loading.value = true;
    const days = rangeDays.value;
    const first = days[0] ?? anchorDay.value;
    const lastPlusOne = addDays(days[days.length - 1] ?? anchorDay.value, 1);
    const from = dayStartUtc(first, zone.value).toISOString();
    const to = dayStartUtc(lastPlusOne, zone.value).toISOString();

    const query = new URLSearchParams({ from, to });
    if (negotiationFilter.value.size > 0)
      query.set("negotiation", [...negotiationFilter.value].join(","));
    if (kindFilter.value.size > 0) query.set("kind", [...kindFilter.value].join(","));

    // Occurrences and mirror in parallel; a dead playout link must never
    // blank the grid (docs/2 §7.4): the mirror failure becomes a notice.
    const [occResult, mirrorResult] = await Promise.allSettled([
      apiGet(`/stations/${station}/occurrences?${query}`, OccurrencesResponseSchema),
      apiGet(
        `/stations/${station}/mirror?${new URLSearchParams({ from, to })}`,
        MirrorResponseSchema,
      ),
    ]);
    // A late response after a station switch, week change or filter change
    // must not paint a stale grid — the epoch covers the whole query identity
    // (completion order is not FIFO: a slow mirror holds older calls open).
    if (station !== stationStore.current || epoch !== windowEpoch) return;

    if (occResult.status === "fulfilled") {
      // Own copy: optimistic splices must never mutate the response object.
      occurrences.value = [...occResult.value.occurrences];
      zone.value = occResult.value.zone;
    } else {
      pushToast("error", messageOf(occResult.reason));
    }

    if (mirrorResult.status === "fulfilled") {
      mirrorBlocks.value = mirrorResult.value.blocks;
      mirrorError.value = null;
    } else {
      mirrorBlocks.value = [];
      mirrorError.value = messageOf(mirrorResult.reason);
    }
    loading.value = false;
  }

  async function loadSlots(): Promise<void> {
    const station = stationStore.current;
    try {
      const res = await apiGet(`/stations/${station}/slots`, SlotsResponseSchema);
      if (station === stationStore.current) slots.value = res.slots;
    } catch (cause) {
      pushToast("error", messageOf(cause));
    }
  }

  /** Jump to a specific week (the cross-lens links land here) — always week view. */
  async function setWeek(mondayIso: string): Promise<void> {
    viewMode.value = "week";
    anchorDay.value = mondayIso;
    await loadWindow();
  }

  function setViewMode(mode: GridView): void {
    if (mode === viewMode.value) return;
    // Snap to the week's Monday when entering week view so it stays aligned.
    if (mode === "week") anchorDay.value = mondayOfIso(anchorDay.value);
    viewMode.value = mode;
    void loadWindow();
  }

  /** Step one lens-span back/forward: a week, three days, or a month. */
  function step(direction: 1 | -1): void {
    if (viewMode.value === "day3") anchorDay.value = addDays(anchorDay.value, 3 * direction);
    else if (viewMode.value === "month") anchorDay.value = addMonthsIso(anchorDay.value, direction);
    else anchorDay.value = addDays(mondayOfIso(anchorDay.value), 7 * direction);
    void loadWindow();
  }
  function prev(): void {
    step(-1);
  }
  function next(): void {
    step(1);
  }
  function today(): void {
    const t = isoDayOf(new Date(), zone.value);
    anchorDay.value = viewMode.value === "week" ? mondayOfIso(t) : t;
    void loadWindow();
  }

  function toggleNegotiationFilter(state: NegotiationState): void {
    negotiationFilter.value = toggled(negotiationFilter.value, state);
    void loadWindow();
  }
  function toggleKindFilter(kind: SlotKind): void {
    kindFilter.value = toggled(kindFilter.value, kind);
    void loadWindow();
  }

  /**
   * Instant edit with an optimistic apply (docs/2 §8.4): the card lands
   * where the user dropped it before the wire answers; a failure rolls the
   * exact previous occurrence back and surfaces the reason as a toast.
   */
  async function patchOccurrence(
    id: string,
    patch: PatchOccurrenceInput,
    // The undo re-patch passes false so reverting a move doesn't itself spawn
    // an undo toast (which would toggle-toast forever).
    undoable = true,
  ): Promise<boolean> {
    const index = occurrences.value.findIndex((o) => o.id === id);
    const before = index >= 0 ? occurrences.value[index] : undefined;
    if (!before) return false;

    occurrences.value.splice(index, 1, applyPatchLocally(before, patch, zone.value));
    try {
      const updated = await apiMutate(
        "PATCH",
        `/stations/${stationStore.current}/occurrences/${id}`,
        patch,
        OccurrenceSchema,
      );
      replaceOccurrence(id, updated);
      if (undoable) pushUndoToast(id, before, patch);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      // Refetch instead of splicing the pre-flight snapshot back: the array
      // may hold FRESHER server state (an SSE refetch landed mid-request)
      // that a blind rollback would clobber.
      await loadWindow();
      return false;
    }
  }

  function replaceOccurrence(id: string, occurrence: Occurrence): void {
    const index = occurrences.value.findIndex((o) => o.id === id);
    if (index >= 0) occurrences.value.splice(index, 1, occurrence);
  }

  /**
   * Offer a one-click revert of the edit just applied (docs/2 §7.5). Only the
   * fields the edit touched are inverted back to `before`, so undo is a minimal
   * re-patch. Undoing within the window reverts OS state before the debounced
   * server reconcile fires, so the net AzuraCast push is nothing.
   */
  function pushUndoToast(id: string, before: Occurrence, patch: PatchOccurrenceInput): void {
    const inverse: PatchOccurrenceInput = {};
    if (patch.startsAtWall !== undefined)
      inverse.startsAtWall = utcToWall(new Date(before.startsAt), zone.value);
    if (patch.durationMin !== undefined) inverse.durationMin = before.durationMin;
    if (patch.negotiationState !== undefined) inverse.negotiationState = before.negotiationState;
    if (patch.issueFlags !== undefined) inverse.issueFlags = [...before.issueFlags];
    if (patch.contentDurationMin !== undefined)
      inverse.contentDurationMin = before.contentDurationMin;
    pushToast("info", "Edit applied.", UNDO_TTL_MS, {
      label: "Undo",
      run: () => void patchOccurrence(id, inverse, false),
    });
  }

  async function transitionOccurrence(id: string, state: NegotiationState): Promise<boolean> {
    return patchOccurrence(id, { negotiationState: state });
  }

  async function createSlot(input: CreateSlotInput): Promise<boolean> {
    try {
      const created = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/slots`,
        input,
        SlotSchema,
      );
      await Promise.all([loadWindow(), loadSlots()]);
      // Undo a fresh create by deleting it (docs/2 §7.5): the debounced push
      // then never projects it. Delete-undo (recreate) stays out of scope.
      pushToast("info", "Slot created.", UNDO_TTL_MS, {
        label: "Undo",
        run: () => void deleteSlot(created.id),
      });
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  async function updateSlot(id: number, input: UpdateSlotInput): Promise<boolean> {
    try {
      await apiMutate("PUT", `/stations/${stationStore.current}/slots/${id}`, input, SlotSchema);
      await Promise.all([loadWindow(), loadSlots()]);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  async function deleteSlot(id: number): Promise<boolean> {
    try {
      await apiMutate("DELETE", `/stations/${stationStore.current}/slots/${id}`);
      await Promise.all([loadWindow(), loadSlots()]);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  let closeSse: (() => void) | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRefetch(): void {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void loadWindow();
      void loadSlots();
    }, 300);
  }

  /**
   * Follow the `grid` channel: debounce 300ms, then refetch the visible
   * window. Also refetch on every (re)open — events emitted while the
   * EventSource was disconnected (laptop sleep, redeploy) are gone, so the
   * reconnect itself must resynchronize the grid.
   */
  function connectSse(): void {
    disconnectSse();
    const station = stationStore.current;
    closeSse = subscribeStationSse(station, ["grid"], scheduleRefetch, scheduleRefetch);
  }

  function disconnectSse(): void {
    closeSse?.();
    closeSse = null;
    if (refetchTimer !== null) {
      clearTimeout(refetchTimer);
      refetchTimer = null;
    }
  }

  function dismissMirrorNotice(): void {
    mirrorError.value = null;
  }

  function toggleMirror(): void {
    showMirror.value = !showMirror.value;
  }

  return {
    viewMode,
    anchorDay,
    weekMonday,
    rangeDays,
    monthWeeks,
    rangeLabel,
    zone,
    occurrences,
    mirrorBlocks,
    mirrorError,
    showMirror,
    slots,
    negotiationFilter,
    kindFilter,
    loading,
    visibleDays,
    dayWindows,
    occurrencesByDay,
    occurrencesByDayIso,
    mirrorBlocksByDay,
    mirrorBandsByDay,
    slotById,
    loadWindow,
    loadSlots,
    setWeek,
    setViewMode,
    prev,
    next,
    today,
    toggleNegotiationFilter,
    toggleKindFilter,
    patchOccurrence,
    transitionOccurrence,
    createSlot,
    updateSlot,
    deleteSlot,
    connectSse,
    disconnectSse,
    dismissMirrorNotice,
    toggleMirror,
  };
});

/** Mirror the server's own edit semantics so the optimistic card is honest. */
function applyPatchLocally(occ: Occurrence, patch: PatchOccurrenceInput, zone: string): Occurrence {
  const next: Occurrence = { ...occ, issueFlags: [...occ.issueFlags] };
  if (patch.negotiationState !== undefined) next.negotiationState = patch.negotiationState;
  if (patch.issueFlags !== undefined) next.issueFlags = [...patch.issueFlags];
  if (patch.contentDurationMin !== undefined) next.contentDurationMin = patch.contentDurationMin;
  if (patch.durationMin !== undefined) next.durationMin = patch.durationMin;
  if (patch.startsAtWall !== undefined)
    next.startsAt = wallToUtc(patch.startsAtWall, zone).toISOString();
  next.endsAt = new Date(Date.parse(next.startsAt) + next.durationMin * 60_000).toISOString();
  next.moved = next.startsAt !== next.originalStartsAt;
  return next;
}

function toggled<T>(current: ReadonlySet<T>, value: T): ReadonlySet<T> {
  const next = new Set(current);
  if (next.has(value)) next.delete(value);
  else next.add(value);
  return next;
}

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
