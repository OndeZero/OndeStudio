<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { formatHm, isoDayOf } from "../../lib/station-time";
import { useGridStore } from "../grid/grid-store";

/**
 * A hub mini-schedule (PD §5.4): negotiation state-dot + 24h station-time
 * datetime per occurrence. One component for both the next and past lists —
 * every row is one click into the grid week it lives in.
 */
defineProps<{ title: string; occurrences: Occurrence[]; emptyText: string }>();
const emit = defineEmits<{ open: [occurrence: Occurrence] }>();

const grid = useGridStore();

function label(occ: Occurrence): string {
  const start = new Date(occ.startsAt);
  return `${isoDayOf(start, grid.zone)} · ${formatHm(start, grid.zone)}`;
}
</script>

<template>
  <section class="occ-section">
    <h3 class="section-title">{{ title }}</h3>
    <p v-if="occurrences.length === 0" class="os-hint">{{ emptyText }}</p>
    <ul class="plain-list">
      <li v-for="occ in occurrences" :key="occ.id">
        <button type="button" class="occ-row" @click="emit('open', occ)">
          <span
            class="state-dot"
            :style="{ background: `var(--state-${occ.negotiationState})` }"
            :title="occ.negotiationState"
          />
          <span class="occ-when">{{ label(occ) }}</span>
          <span class="occ-title">{{ occ.title }}</span>
          <span v-if="occ.episodeTitle" class="occ-episode">· {{ occ.episodeTitle }}</span>
        </button>
      </li>
    </ul>
  </section>
</template>

<style scoped>
.occ-section {
  display: grid;
  gap: var(--space-2);
  align-content: start;
}

.section-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.os-hint {
  margin: 0;
}

.plain-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.occ-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: 2px var(--space-1);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.occ-row:hover {
  background: var(--color-accent-soft);
}

.state-dot {
  flex: none;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}

.occ-when {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.occ-title {
  overflow-wrap: anywhere;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

/* The episode filling this occurrence (PD §4.5) — a quiet trailing note. */
.occ-episode {
  overflow-wrap: anywhere;
  color: var(--color-accent);
  font-size: var(--text-xs);
}
</style>
