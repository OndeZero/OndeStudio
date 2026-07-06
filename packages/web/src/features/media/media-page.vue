<script setup lang="ts">
import type { MediaEntry } from "@ondestudio/shared";
import { watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useStationStore } from "../../stores/station";
import { useMediaStore } from "./media-store";

/**
 * The disk lens (PD §5.3 first cut): breadcrumbs + a dirs-first table with
 * ownership badges linking each entry to its show hub (PD §5.4). Read-only
 * on purpose — intake stays SFTP/AzuraCast (docs/2 §8.5, decided 2026-07-05).
 */
const store = useMediaStore();
const stationStore = useStationStore();
const route = useRoute();
const router = useRouter();

// The URL is the source of truth: /media?path=… is shareable, and show
// pages' drop-folder links land here with a path preloaded.
watch(
  [() => route.query.path, () => stationStore.current],
  ([path]) => {
    if (route.name !== "media") return; // leaving the page must not refetch
    void store.browse(typeof path === "string" ? path : "");
  },
  { immediate: true },
);

function open(entry: MediaEntry): void {
  if (entry.kind !== "dir") return;
  void router.push({ path: "/media", query: entry.path === "" ? {} : { path: entry.path } });
}
function goCrumb(path: string): void {
  void router.push({ path: "/media", query: path === "" ? {} : { path } });
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return "";
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
function formatMeta(entry: MediaEntry): string {
  return [entry.title, entry.artist].filter((part) => part !== null).join(" — ");
}
</script>

<template>
  <section class="media-page">
    <nav class="crumbs" aria-label="Path">
      <button
        type="button"
        class="crumb"
        :class="{ current: store.path === '' }"
        @click="goCrumb('')"
      >
        media root
      </button>
      <template v-for="crumb in store.breadcrumbs" :key="crumb.path">
        <span class="crumb-sep">/</span>
        <button
          type="button"
          class="crumb"
          :class="{ current: crumb.path === store.path }"
          @click="goCrumb(crumb.path)"
        >
          {{ crumb.name }}
        </button>
      </template>
      <span v-if="store.loading" class="loading-dot" title="Loading…" />
    </nav>

    <div v-if="store.degraded" class="degraded-notice" role="status">
      <span>
        Media library unavailable — the playout link may be down.
        <span class="degraded-detail">{{ store.degraded }}</span>
      </span>
      <button type="button" class="notice-dismiss" title="Dismiss" @click="store.dismissDegraded()">
        ×
      </button>
    </div>

    <div class="media-table-wrap">
      <table class="media-table">
        <thead>
          <tr>
            <th class="col-name">name</th>
            <th class="col-dur">duration</th>
            <th class="col-meta">title — artist</th>
            <th class="col-owner">show</th>
          </tr>
        </thead>
        <tbody>
          <tr
            v-for="entry in store.entries"
            :key="entry.path"
            class="media-row"
            :class="{ dir: entry.kind === 'dir' }"
            @click="open(entry)"
          >
            <td class="col-name">
              <span class="entry-name">{{ entry.name }}<template v-if="entry.kind === 'dir'">/</template></span>
              <span v-if="entry.kind === 'dir' && entry.childCount !== null" class="child-count">
                {{ entry.childCount }} items
              </span>
            </td>
            <td class="col-dur">{{ formatDuration(entry.durationSec) }}</td>
            <td class="col-meta">{{ formatMeta(entry) }}</td>
            <td class="col-owner">
              <RouterLink
                v-if="entry.ownerShow"
                class="os-chip owner-chip"
                :to="`/shows/${entry.ownerShow.id}`"
                :title="`open the ${entry.ownerShow.name} page`"
                @click.stop
              >
                {{ entry.ownerShow.name }}
              </RouterLink>
            </td>
          </tr>
          <tr v-if="!store.loading && store.entries.length === 0 && !store.degraded">
            <td colspan="4" class="empty-cell os-hint">empty directory</td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.media-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-3);
}

.crumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-1);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.crumb {
  padding: 0 var(--space-1);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font: inherit;
  cursor: pointer;
}
.crumb:hover {
  color: var(--color-accent);
}
.crumb.current {
  color: var(--color-text);
}

.crumb-sep {
  color: var(--color-text-muted);
}

.loading-dot {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--color-accent);
  border-radius: 50%;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.2;
  }
}

/* Same voice as the grid's mirror notice: degraded, not dead. */
.degraded-notice {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-3);
  background: var(--color-surface-raised);
  border-left: 3px solid var(--flag-warning);
  color: var(--flag-warning);
  font-size: var(--text-sm);
}
.degraded-detail {
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

.media-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  background: var(--color-surface);
}

.media-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

.media-table th {
  position: sticky;
  top: 0;
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
}

.media-table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--grid-line-faint);
  vertical-align: baseline;
}

.media-row.dir {
  cursor: pointer;
}
.media-row.dir:hover {
  background: var(--color-accent-soft);
}

.entry-name {
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}
.dir .entry-name {
  color: var(--color-accent);
}

.child-count {
  margin-left: var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

.col-dur {
  font-family: var(--font-mono);
  white-space: nowrap;
}

.col-meta {
  color: var(--color-text-muted);
  overflow-wrap: anywhere;
}

.owner-chip {
  text-decoration: none;
}

.empty-cell {
  text-align: center;
}
</style>
