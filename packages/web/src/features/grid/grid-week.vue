<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { formatDayLabel, isoDayOf } from "../../lib/station-time";
import GridDayColumn from "./grid-day-column.vue";
import { type DayGeometry, dayGeometry, PX_PER_HOUR } from "./grid-geometry";
import { useGridInteractions } from "./grid-interactions";
import { useGridStore } from "./grid-store";

/**
 * The week surface: one scroll container, a canonical 00–23 gutter and
 * seven day columns whose heights derive from their real duration. All
 * drag/resize/create gestures are wired by useGridInteractions so this
 * component stays layout-only.
 */
const emit = defineEmits<{
  open: [payload: { occurrence: Occurrence; anchor: { x: number; y: number } }];
  create: [draft: { dayIso: string; time: string; durationMin: number }];
}>();

const store = useGridStore();
const scrollEl = ref<HTMLElement | null>(null);

interface DayEntry {
  dayIso: string;
  geometry: DayGeometry;
}
const days = computed<DayEntry[]>(() =>
  store.dayWindows.map((window) => ({
    dayIso: window.dayIso,
    geometry: dayGeometry(new Date(window.startMs), new Date(window.endMs)),
  })),
);

// The NOW line only needs 30s resolution (PD §5.1 attention, not a stopwatch).
const nowMs = ref(Date.now());
let nowTimer: ReturnType<typeof setInterval> | null = null;
const todayIso = computed(() => isoDayOf(new Date(nowMs.value), store.zone));

const interactions = useGridInteractions({
  geometryFor: (dayIso) => days.value.find((day) => day.dayIso === dayIso)?.geometry,
  zone: () => store.zone,
  onMove: (occurrenceId, startsAtWall, durationMin) => {
    void store.patchOccurrence(occurrenceId, { startsAtWall, durationMin });
  },
  onResize: (occurrenceId, durationMin) => {
    void store.patchOccurrence(occurrenceId, { durationMin });
  },
  onCreate: (dayIso, time, durationMin) => emit("create", { dayIso, time, durationMin }),
});

onMounted(() => {
  nowTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 30_000);
  const el = scrollEl.value;
  if (el) {
    interactions.attach(el);
    // Land where the broadcast day starts, not at 4 a.m. rotation.
    el.scrollTop = 7 * PX_PER_HOUR - 6;
  }
});

onBeforeUnmount(() => {
  if (nowTimer !== null) clearInterval(nowTimer);
  interactions.detach();
});

const gutterHours = Array.from({ length: 24 }, (_, h) => ({
  y: h * PX_PER_HOUR,
  label: `${String(h).padStart(2, "0")}:00`,
}));

/** Tallest column defines the body height (a 25h day sticks out by design). */
const bodyHeight = computed(() =>
  Math.max(...days.value.map((day) => day.geometry.heightPx), 24 * PX_PER_HOUR),
);
</script>

<template>
  <div ref="scrollEl" class="week-scroll">
    <div class="week-grid" :style="{ '--day-count': days.length }">
      <div class="corner" />
      <div
        v-for="day in days"
        :key="`head-${day.dayIso}`"
        class="day-head"
        :class="{ today: day.dayIso === todayIso }"
      >
        {{ formatDayLabel(day.dayIso) }}
      </div>

      <div class="gutter" :style="{ height: `${bodyHeight}px` }">
        <span
          v-for="hour in gutterHours"
          :key="hour.label"
          class="gutter-label"
          :style="{ top: `${hour.y}px` }"
        >
          {{ hour.label }}
        </span>
      </div>

      <div
        v-for="day in days"
        :key="day.dayIso"
        class="day-cell"
        :style="{ height: `${bodyHeight}px` }"
      >
        <GridDayColumn
          :day-iso="day.dayIso"
          :geometry="day.geometry"
          :zone="store.zone"
          :is-today="day.dayIso === todayIso"
          :now-ms="nowMs"
          :create-preview="
            interactions.createPreview.value?.dayIso === day.dayIso
              ? interactions.createPreview.value
              : null
          "
          @open="emit('open', $event)"
        />
      </div>
    </div>

    <!-- Snapped-time feedback riding next to the pointer during any gesture. -->
    <div
      v-if="interactions.dragChip.value"
      class="drag-chip"
      :style="{
        left: `${interactions.dragChip.value.x}px`,
        top: `${interactions.dragChip.value.y}px`,
      }"
    >
      {{ interactions.dragChip.value.label }}
    </div>
  </div>
</template>

<style scoped>
.week-scroll {
  position: relative;
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.week-grid {
  display: grid;
  grid-template-columns: 3.25rem repeat(var(--day-count, 7), minmax(7.5rem, 1fr));
  grid-template-rows: auto 1fr;
  min-width: min-content;
}

.corner,
.day-head {
  position: sticky;
  top: 0;
  z-index: 10;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}
.corner {
  left: 0;
  z-index: 12;
}

.day-head {
  padding: var(--space-1) var(--space-2);
  font-size: var(--text-sm);
  font-weight: 600;
  text-align: center;
  white-space: nowrap;
}
.day-head.today {
  color: var(--color-accent);
  box-shadow: inset 0 -2px 0 var(--color-accent);
}

.gutter {
  position: sticky;
  left: 0;
  z-index: 6;
  background: var(--color-surface);
  border-right: 1px solid var(--grid-line);
}
.gutter-label {
  position: absolute;
  right: var(--space-1);
  transform: translateY(-50%);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.6rem;
}
/* 00:00 sits at the top edge: no half-shift for the first label. */
.gutter-label:first-child { transform: none; }

.day-cell { position: relative; }

.drag-chip {
  position: fixed;
  z-index: 40;
  padding: 1px var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  pointer-events: none;
  white-space: nowrap;
}

/* Mobile (PD §8.1): one day per swipe, snap per column, drag still works
   via the 300ms hold in grid-interactions. */
@media (max-width: 720px) {
  .week-scroll { scroll-snap-type: x mandatory; }
  .week-grid { grid-template-columns: 2.75rem repeat(var(--day-count, 7), 80vw); }
  .day-cell { scroll-snap-align: start; }
}
</style>
