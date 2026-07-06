<script setup lang="ts">
import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { formatDayLabel, formatHm, isoDayOf } from "../../lib/station-time";
import { useStationStore } from "../../stores/station";
import { DEFAULT_ZONE } from "../grid/grid-store";
import ShowPage from "./show-page.vue";
import { type ShowsSortBy, useShowsStore } from "./shows-store";

/**
 * The show library (PD §5.4): master-detail — sortable list left, the hub
 * page as the detail pane; /shows/{id} keeps the page URL-addressable and
 * full-width on mobile.
 */
const store = useShowsStore();
const stationStore = useStationStore();
const route = useRoute();
const router = useRouter();

const SORTS: ShowsSortBy[] = ["name", "slots", "next"];

watch(
  () => stationStore.current,
  () => void store.loadShows(),
  { immediate: true },
);

const selectedId = computed(() => {
  const raw = route.params.id;
  const id = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(id) ? id : null;
});

function select(id: number): void {
  void router.push(`/shows/${id}`);
}

function nextLabel(iso: string | null): string {
  if (iso === null) return "no upcoming";
  const start = new Date(iso);
  const day = isoDayOf(start, DEFAULT_ZONE);
  return `${formatDayLabel(day)} · ${formatHm(start, DEFAULT_ZONE)}`;
}
</script>

<template>
  <section class="shows-page" :class="{ 'detail-open': selectedId !== null }">
    <aside class="shows-list">
      <div class="os-row list-sorts" role="group" aria-label="Sort shows">
        <span class="os-hint">sort</span>
        <button
          v-for="mode in SORTS"
          :key="mode"
          type="button"
          class="os-chip"
          :class="{ active: store.sortBy === mode }"
          @click="store.sortBy = mode"
        >
          {{ mode }}
        </button>
      </div>
      <p v-if="store.listLoading && store.shows.length === 0" class="os-hint list-note">
        Loading shows…
      </p>
      <p v-else-if="store.shows.length === 0" class="os-hint list-note">
        No shows yet — create one from the grid (+ slot).
      </p>
      <button
        v-for="show in store.sortedShows"
        :key="show.id"
        type="button"
        class="show-row"
        :class="{ active: show.id === selectedId }"
        @click="select(show.id)"
      >
        <span class="show-name">{{ show.name }}</span>
        <span class="show-meta">
          {{ show.slotCount }} slot{{ show.slotCount === 1 ? "" : "s" }} ·
          {{ nextLabel(show.nextOccurrenceAt) }}
        </span>
      </button>
    </aside>

    <section class="shows-detail">
      <RouterLink v-if="selectedId !== null" class="back-link" to="/shows">
        ‹ all shows
      </RouterLink>
      <ShowPage v-if="selectedId !== null" :show-id="selectedId" />
      <p v-else class="detail-placeholder os-hint">
        Select a show — its page groups slots, settings, files and discussions (the hub every
        lens links into).
      </p>
    </section>
  </section>
</template>

<style scoped>
.shows-page {
  display: flex;
  flex: 1;
  min-height: 0;
}

.shows-list {
  display: flex;
  flex: none;
  flex-direction: column;
  gap: var(--space-1);
  width: 20rem;
  padding: var(--space-3);
  overflow-y: auto;
  border-right: 1px solid var(--color-border);
}

.list-sorts {
  margin-bottom: var(--space-2);
}

.list-note {
  margin: 0;
}

.show-row {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  color: var(--color-text);
  text-align: left;
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.show-row:hover {
  border-color: var(--color-border);
}
.show-row.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}

.show-name {
  font-size: var(--text-sm);
  font-weight: 600;
}

.show-meta {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.shows-detail {
  flex: 1;
  min-width: 0;
  padding: var(--space-4);
  overflow-y: auto;
}

.detail-placeholder {
  max-width: 28rem;
}

/* Desktop shows both panes; the back link is a mobile affordance. */
.back-link {
  display: none;
  margin-bottom: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-decoration: none;
}

@media (max-width: 720px) {
  .shows-list {
    flex: 1;
    width: auto;
    border-right: none;
  }
  .detail-open .shows-list {
    display: none;
  }
  .shows-page:not(.detail-open) .shows-detail {
    display: none;
  }
  .back-link {
    display: inline-block;
  }
}
</style>
