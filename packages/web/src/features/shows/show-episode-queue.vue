<script setup lang="ts">
import type { Episode } from "@ondestudio/shared";
import { computed, watch } from "vue";
import { formatDayLabel, formatHm, isoDayOf } from "../../lib/station-time";
import { useGridStore } from "../grid/grid-store";
import { useEpisodeQueueStore } from "./episode-queue-store";

/**
 * The show's drop-folder episode queue (PD §4.5): what is waiting to air, in
 * order, with which upcoming occurrence each will fill. Rescan pulls fresh
 * arrivals from the folder; up/down hand-reorders the queue.
 */
const props = defineProps<{ showId: number; dropFolderPath: string | null }>();

const store = useEpisodeQueueStore();
const grid = useGridStore();

watch(
  () => [props.showId, props.dropFolderPath] as const,
  ([id, path]) => {
    if (path) void store.load(id);
  },
  { immediate: true },
);

/** Only paint the loaded show's queue — never a previous show's while switching. */
const ready = computed(() => store.showId === props.showId && !store.loading);
const episodes = computed(() => (ready.value ? store.episodes : []));

/** durationSec → "m:ss"; null when the length is not (yet) known. */
function durationHint(sec: number | null): string | null {
  if (sec === null) return null;
  const minutes = Math.floor(sec / 60);
  const seconds = Math.floor(sec % 60);
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

/** The "→ fills Fri 6 · 14:00" hint, in station time (reuses the grid zone). */
function fillsLabel(episode: Episode): string | null {
  if (episode.filledOccurrenceId === null || episode.filledOccurrenceAt === null) return null;
  const at = new Date(episode.filledOccurrenceAt);
  return `${formatDayLabel(isoDayOf(at, grid.zone))} · ${formatHm(at, grid.zone)}`;
}

function move(id: number, delta: number): void {
  const ids = store.episodes.map((e) => e.id);
  const from = ids.indexOf(id);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(from, 1);
  ids.splice(to, 0, id);
  void store.reorder(props.showId, ids);
}
</script>

<template>
  <section class="show-section">
    <header class="section-head">
      <h3 class="section-title">episode queue</h3>
      <button
        v-if="dropFolderPath"
        type="button"
        class="lens-link"
        :disabled="store.rescanning"
        @click="store.rescan(showId)"
      >
        {{ store.rescanning ? "rescanning…" : "rescan drop folder →" }}
      </button>
    </header>

    <p v-if="!dropFolderPath" class="os-hint">
      Set a drop folder in settings to enable the episode queue.
    </p>
    <p v-else-if="store.showId === showId && store.loading" class="os-hint">Loading episodes…</p>
    <p v-else-if="episodes.length === 0" class="os-hint">
      No episodes queued — drop files in {{ dropFolderPath }}.
    </p>
    <ol v-else class="plain-list">
      <li v-for="(episode, index) in episodes" :key="episode.id" class="episode-row">
        <span class="episode-index">{{ index + 1 }}</span>
        <span class="episode-body">
          <span class="episode-title">{{ episode.title }}</span>
          <span v-if="episode.artist" class="episode-artist">{{ episode.artist }}</span>
          <span v-if="durationHint(episode.durationSec)" class="episode-meta">
            {{ durationHint(episode.durationSec) }}
          </span>
          <span v-if="fillsLabel(episode)" class="episode-fills">→ fills {{ fillsLabel(episode) }}</span>
        </span>
        <span class="episode-move">
          <button
            type="button"
            class="move-button"
            :disabled="index === 0"
            aria-label="Move up"
            title="Move up"
            @click="move(episode.id, -1)"
          >
            ↑
          </button>
          <button
            type="button"
            class="move-button"
            :disabled="index === episodes.length - 1"
            aria-label="Move down"
            title="Move down"
            @click="move(episode.id, 1)"
          >
            ↓
          </button>
        </span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.show-section {
  display: grid;
  gap: var(--space-2);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
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

.lens-link {
  padding: 0;
  background: none;
  border: none;
  color: var(--color-accent);
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
}
.lens-link:hover {
  text-decoration: underline;
}
.lens-link:disabled {
  color: var(--color-text-muted);
  cursor: default;
  text-decoration: none;
}

.plain-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.episode-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.episode-index {
  flex: none;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.episode-body {
  display: flex;
  flex: 1;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
  overflow-wrap: anywhere;
}

.episode-title {
  font-weight: 600;
}

.episode-artist {
  color: var(--color-text-muted);
}

.episode-meta {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.episode-fills {
  color: var(--color-accent);
  font-size: var(--text-xs);
}

.episode-move {
  display: flex;
  flex: none;
  gap: 2px;
}

.move-button {
  padding: 0 var(--space-1);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  line-height: 1.4;
  cursor: pointer;
}
.move-button:hover:not(:disabled) {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.move-button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
