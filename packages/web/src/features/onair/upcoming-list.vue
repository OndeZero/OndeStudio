<script setup lang="ts">
import { type Occurrence, OccurrencesResponseSchema, type StationSlug } from "@ondestudio/shared";
import { ref, watch } from "vue";
import { apiGet } from "../../lib/api/client";
import { formatDayLabel, formatHm, isoDayOf } from "../../lib/station-time";
import { SLOT_KIND_GLYPHS } from "../grid/grid-symbols";

/**
 * PD §5.5, read-only cut: what the audience gets next — the validated
 * occurrences of the coming 7 days. The editing half (quick metadata)
 * belongs to a later milestone; this is the awareness half.
 */
const props = defineProps<{ station: StationSlug }>();

const items = ref<Occurrence[]>([]);
const zone = ref("Europe/Paris");
const loading = ref(true);
const error = ref<string | null>(null);

const LIMIT = 10;
const DAY_MS = 86_400_000;

async function load(station: StationSlug): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + 7 * DAY_MS).toISOString();
    const query = new URLSearchParams({ from, to, negotiation: "validated" });
    const res = await apiGet(
      `/stations/${station}/occurrences?${query}`,
      OccurrencesResponseSchema,
    );
    // A slow response for a previously selected station must never win.
    if (station !== props.station) return;
    zone.value = res.zone;
    items.value = [...res.occurrences]
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))
      .slice(0, LIMIT);
  } catch (cause) {
    if (station === props.station)
      error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (station === props.station) loading.value = false;
  }
}

watch(
  () => props.station,
  (station) => void load(station),
  { immediate: true },
);

function dayOf(occ: Occurrence): string {
  return formatDayLabel(isoDayOf(new Date(occ.startsAt), zone.value));
}
function timeOf(occ: Occurrence): string {
  return formatHm(new Date(occ.startsAt), zone.value);
}
</script>

<template>
  <section class="upcoming">
    <h3 class="upcoming-title">Upcoming</h3>
    <p v-if="loading" class="os-hint">Loading the week…</p>
    <p v-else-if="error" class="upcoming-error">
      Could not load upcoming slots. <span class="upcoming-detail">{{ error }}</span>
    </p>
    <p v-else-if="items.length === 0" class="os-hint">Nothing validated in the next 7 days.</p>
    <ul v-else class="upcoming-list">
      <li v-for="occ in items" :key="occ.id" class="upcoming-row">
        <span class="up-day">{{ dayOf(occ) }}</span>
        <span class="up-time">{{ timeOf(occ) }}</span>
        <span class="kind-glyph" :title="occ.kind">{{ SLOT_KIND_GLYPHS[occ.kind] }}</span>
        <span class="up-title">{{ occ.title }}</span>
        <span
          class="content-dot"
          :style="{ background: `var(--content-${occ.contentState})` }"
          :title="`content: ${occ.contentState}`"
        />
      </li>
    </ul>
  </section>
</template>

<style scoped>
.upcoming {
  display: grid;
  gap: var(--space-3);
  margin-top: var(--space-4);
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.upcoming-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.upcoming-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}
.upcoming-detail {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  overflow-wrap: anywhere;
}

.upcoming-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.upcoming-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.up-day,
.up-time {
  flex: none;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}
.up-day {
  width: 3.5rem;
}

.kind-glyph {
  flex: none;
  font-family: var(--font-mono);
}

.up-title {
  flex: 1;
  overflow-wrap: anywhere;
}

.content-dot {
  flex: none;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}
</style>
