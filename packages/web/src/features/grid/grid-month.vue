<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { computed } from "vue";
import { formatHm, isoDayOf } from "../../lib/station-time";
import { useGridStore } from "./grid-store";

/**
 * The month lens (docs/2 §11 fast-follow): a calendar of Monday-aligned weeks,
 * each day summarising its occurrences as compact, state-coloured chips. It
 * reuses the grid's occurrence merge (loaded over the month window) — clicking a
 * day drops into that week's time-axis view.
 */
const emit = defineEmits<{ open: [dayIso: string] }>();

const store = useGridStore();

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const CHIP_CAP = 4;

const monthKey = computed(() => store.anchorDay.slice(0, 7));
const todayIso = computed(() => isoDayOf(new Date(), store.zone));

function dayNumber(dayIso: string): string {
  return String(Number(dayIso.slice(8, 10)));
}
function inMonth(dayIso: string): boolean {
  return dayIso.slice(0, 7) === monthKey.value;
}
function occurrencesOf(dayIso: string): Occurrence[] {
  return [...(store.occurrencesByDayIso.get(dayIso) ?? [])].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
}
</script>

<template>
  <div class="month">
    <div class="month-head">
      <div v-for="label in WEEKDAY_LABELS" :key="label" class="month-head-cell">{{ label }}</div>
    </div>
    <div class="month-body">
      <div v-for="(week, w) in store.monthWeeks" :key="w" class="month-week">
        <button
          v-for="dayIso in week"
          :key="dayIso"
          type="button"
          class="month-cell"
          :class="{ 'out-of-month': !inMonth(dayIso), today: dayIso === todayIso }"
          @click="emit('open', dayIso)"
        >
          <span class="cell-date">{{ dayNumber(dayIso) }}</span>
          <span class="cell-events">
            <span
              v-for="occ in occurrencesOf(dayIso).slice(0, CHIP_CAP)"
              :key="occ.id"
              class="month-chip"
              :style="{ '--chip-color': `var(--state-${occ.negotiationState})` }"
              :title="`${formatHm(new Date(occ.startsAt), store.zone)} ${occ.title}`"
            >
              <span class="chip-time">{{ formatHm(new Date(occ.startsAt), store.zone) }}</span>
              {{ occ.title }}
            </span>
            <span v-if="occurrencesOf(dayIso).length > CHIP_CAP" class="month-more">
              +{{ occurrencesOf(dayIso).length - CHIP_CAP }} more
            </span>
          </span>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.month {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
  overflow: hidden;
}

.month-head {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  border-bottom: 1px solid var(--color-border);
}
.month-head-cell {
  padding: var(--space-1) var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  text-align: center;
}

.month-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow-y: auto;
}
.month-week {
  display: grid;
  grid-template-columns: repeat(7, 1fr);
  flex: 1;
  min-height: 6rem;
}

.month-cell {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: var(--space-1);
  background: var(--color-surface);
  border: none;
  border-top: 1px solid var(--grid-line);
  border-left: 1px solid var(--grid-line);
  text-align: left;
  cursor: pointer;
  overflow: hidden;
  transition: background var(--transition-fast);
}
.month-cell:hover { background: var(--color-surface-raised); }
.month-week > .month-cell:first-child { border-left: none; }
.out-of-month { background: var(--color-bg); }
.out-of-month .cell-date { color: var(--color-text-muted); opacity: 0.5; }

.cell-date {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.today .cell-date {
  align-self: flex-start;
  padding: 0 0.4em;
  background: var(--color-accent);
  border-radius: 999px;
  color: var(--color-bg);
  font-weight: 700;
}

.cell-events {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

/* One occurrence, one line — the negotiation state on the left edge. */
.month-chip {
  overflow: hidden;
  padding-left: 0.4em;
  border-left: 3px solid var(--chip-color, var(--color-border));
  color: var(--color-text);
  font-size: var(--text-xs);
  line-height: 1.5;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.chip-time {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  margin-right: 0.35em;
}
.month-more {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

@media (max-width: 720px) {
  .month-chip .chip-time { display: none; }
}
</style>
