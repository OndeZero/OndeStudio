<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { computed, onUnmounted, ref, watch } from "vue";
import { addDays, formatHm, isoDayOf, isoWeekdayOf } from "../../lib/station-time";
import { useStationStore } from "../../stores/station";
import AttentionRail from "./attention-rail.vue";
import CreateSlotDialog from "./create-slot-dialog.vue";
import GridMonth from "./grid-month.vue";
import { useGridStore } from "./grid-store";
import GridToolbar from "./grid-toolbar.vue";
import GridWeek from "./grid-week.vue";
import QuickEditPopover from "./quick-edit-popover.vue";

/**
 * The home surface (PD §5.1): thin orchestration only — loads the window
 * per station, routes card clicks to quick-edit and empty-space drags to
 * the create dialog, docks the attention rail and shows the mirror notice.
 * The toast stack lives in the shell since M2 (all surfaces share it).
 */
const stationStore = useStationStore();
const store = useGridStore();

watch(
  () => stationStore.current,
  () => {
    void store.loadWindow();
    void store.loadSlots();
    store.connectSse();
  },
  { immediate: true },
);
onUnmounted(() => store.disconnectSse());

// Quick-edit tracks the occurrence by id so live refetches flow through;
// it closes itself when the occurrence leaves the window.
const quickEdit = ref<{ occurrenceId: string; anchor: { x: number; y: number } } | null>(null);
const quickEditOccurrence = computed<Occurrence | null>(() =>
  quickEdit.value
    ? (store.occurrences.find((o) => o.id === quickEdit.value?.occurrenceId) ?? null)
    : null,
);
watch(quickEditOccurrence, (occ) => {
  if (!occ && quickEdit.value) quickEdit.value = null;
});

function openQuickEdit(payload: {
  occurrence: Occurrence;
  anchor: { x: number; y: number };
}): void {
  quickEdit.value = { occurrenceId: payload.occurrence.id, anchor: payload.anchor };
}

/** Month → week drill-down: clicking a day lands on the week that contains it. */
function openMonthDay(dayIso: string): void {
  void store.setWeek(addDays(dayIso, 1 - isoWeekdayOf(dayIso)));
}

const createDraft = ref<{ dayIso: string; time: string; durationMin: number } | null>(null);

function openCreateDefault(): void {
  createDraft.value = {
    dayIso: isoDayOf(new Date(), store.zone),
    time: defaultTime(),
    durationMin: 60,
  };
}

/** "+ slot" without a drag: suggest the next full hour today. */
function defaultTime(): string {
  const [hour = "20"] = formatHm(new Date(), store.zone).split(":");
  return `${String((Number(hour) + 1) % 24).padStart(2, "0")}:00`;
}
</script>

<template>
  <section class="grid-page">
    <GridToolbar @add-slot="openCreateDefault" />

    <div v-if="store.mirrorError" class="mirror-notice" role="status">
      <span>
        Playout mirror unavailable — showing OndeStudio slots only.
        <span class="mirror-detail">{{ store.mirrorError }}</span>
      </span>
      <button type="button" class="notice-dismiss" title="Dismiss" @click="store.dismissMirrorNotice()">
        ×
      </button>
    </div>

    <!-- The rail docks beside the grid without disturbing its internal scroll. -->
    <div class="grid-body">
      <div class="grid-main">
        <GridMonth v-if="store.viewMode === 'month'" @open="openMonthDay" />
        <GridWeek v-else @open="openQuickEdit" @create="createDraft = $event" />
      </div>
      <AttentionRail />
    </div>

    <QuickEditPopover
      v-if="quickEditOccurrence && quickEdit"
      :occurrence="quickEditOccurrence"
      :anchor="quickEdit.anchor"
      @close="quickEdit = null"
    />

    <CreateSlotDialog v-if="createDraft" :draft="createDraft" @close="createDraft = null" />
  </section>
</template>

<style scoped>
.grid-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  padding: 0 var(--space-3) var(--space-3);
}

.mirror-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  margin-bottom: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-surface-raised);
  border-left: 3px solid var(--flag-warning);
  color: var(--flag-warning);
  font-size: var(--text-sm);
}
.mirror-detail {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.notice-dismiss {
  padding: 0 var(--space-1);
  background: none;
  border: none;
  color: inherit;
  font-size: var(--text-md);
  cursor: pointer;
}

.grid-body {
  display: flex;
  flex: 1;
  gap: var(--space-2);
  min-height: 0;
}

.grid-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  min-width: 0;
}
</style>
