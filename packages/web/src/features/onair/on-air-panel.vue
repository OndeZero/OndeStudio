<script setup lang="ts">
import { type OnAir, OnAirSchema, type StationSlug } from "@ondestudio/shared";
import { onUnmounted, ref, watch } from "vue";
import { apiGet } from "../../lib/api/client";
import { subscribeStationSse } from "../../lib/api/sse";

const props = defineProps<{ station: StationSlug }>();

const onAir = ref<OnAir | null>(null);
const loading = ref(true);
const error = ref<string | null>(null);

let closeSse: (() => void) | null = null;

async function load(station: StationSlug): Promise<void> {
  loading.value = true;
  error.value = null;
  try {
    onAir.value = await apiGet(`/stations/${station}/now`, OnAirSchema);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    loading.value = false;
  }
}

function subscribe(station: StationSlug): void {
  closeSse?.();
  closeSse = subscribeStationSse(station, ["onair"], (event, data) => {
    if (event !== "onair") return;
    // SSE frames carry the same OnAir payload as the REST endpoint. Dropping
    // a non-conforming frame beats corrupting the display; the guard on
    // `station` discards a late frame from a just-closed subscription.
    const parsed = OnAirSchema.safeParse(data);
    if (parsed.success && parsed.data.station === props.station) onAir.value = parsed.data;
  });
}

// `immediate` covers mount; the same path re-runs on every station switch.
watch(
  () => props.station,
  (station) => {
    void load(station);
    subscribe(station);
  },
  { immediate: true },
);

onUnmounted(() => closeSse?.());

// 24-hour, station-referenced time (PD §8.1). The station timezone is a
// constant until station config arrives over the API.
const timeFormat = new Intl.DateTimeFormat("en-GB", {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
  timeZone: "Europe/Paris",
});

function formatObservedAt(iso: string): string {
  return timeFormat.format(new Date(iso));
}
</script>

<template>
  <article class="onair-panel">
    <p v-if="loading" class="onair-loading">Loading on-air state…</p>

    <div v-else-if="error" class="onair-error" role="alert">
      <p class="onair-error-title">Could not load the on-air state.</p>
      <p class="onair-error-detail">{{ error }}</p>
      <button type="button" @click="load(station)">Retry</button>
    </div>

    <template v-else-if="onAir">
      <div v-if="onAir.stale" class="onair-stale" role="alert">
        Playout link degraded — showing the last known state.
      </div>

      <header class="onair-head">
        <span v-if="onAir.live.isLive" class="live-badge">
          LIVE<template v-if="onAir.live.streamerName"> · {{ onAir.live.streamerName }}</template>
        </span>
        <span v-else class="onair-kind">rotation / playlist</span>
        <time class="onair-observed" :datetime="onAir.observedAt">
          {{ formatObservedAt(onAir.observedAt) }}
        </time>
      </header>

      <section v-if="onAir.current" class="onair-current">
        <h2 class="track-title">{{ onAir.current.title }}</h2>
        <p v-if="onAir.current.artist" class="track-artist">{{ onAir.current.artist }}</p>
        <span v-if="onAir.current.playlist" class="playlist-chip">
          {{ onAir.current.playlist }}
        </span>
      </section>
      <p v-else class="onair-nothing">Nothing playing right now.</p>

      <section v-if="onAir.next" class="onair-next">
        <h3 class="next-label">Next</h3>
        <p class="next-track">
          {{ onAir.next.title }}<template v-if="onAir.next.artist"> — {{ onAir.next.artist }}</template>
        </p>
        <span v-if="onAir.next.playlist" class="playlist-chip">{{ onAir.next.playlist }}</span>
      </section>
    </template>
  </article>
</template>

<style scoped>
.onair-panel {
  display: grid;
  gap: var(--space-4);
  padding: var(--space-5);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
}

.onair-loading,
.onair-nothing {
  margin: 0;
  color: var(--color-text-muted);
}

.onair-error {
  display: grid;
  gap: var(--space-2);
  justify-items: start;
  padding: var(--space-3);
  border-left: 3px solid var(--color-danger);
  background: var(--color-surface-raised);
}

.onair-error-title {
  margin: 0;
  color: var(--color-danger);
}

.onair-error-detail {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  font-family: var(--font-mono);
  overflow-wrap: anywhere;
}

.onair-error button {
  padding: var(--space-1) var(--space-3);
  background: var(--color-surface);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: background var(--transition-fast);
}

.onair-error button:hover {
  background: var(--color-accent-soft);
}

.onair-stale {
  padding: var(--space-2) var(--space-3);
  border-left: 3px solid var(--flag-warning);
  background: var(--color-surface-raised);
  color: var(--flag-warning);
  font-size: var(--text-sm);
}

.onair-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.live-badge {
  padding: var(--space-1) var(--space-2);
  background: var(--color-live);
  /* bg token doubles as contrast color: dark text in dark theme, light in light. */
  color: var(--color-bg);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  font-weight: 700;
  letter-spacing: 0.08em;
  animation: live-pulse 2.4s ease-in-out infinite;
}

@keyframes live-pulse {
  50% {
    opacity: 0.75;
  }
}

.onair-kind {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.onair-observed {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.onair-current {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
}

.track-title {
  margin: 0;
  font-size: var(--text-xl);
  line-height: 1.25;
}

.track-artist {
  margin: 0;
  color: var(--color-text-muted);
}

.playlist-chip {
  padding: 0 var(--space-2);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  line-height: 1.8;
}

.onair-next {
  display: grid;
  gap: var(--space-1);
  justify-items: start;
  padding-top: var(--space-3);
  border-top: 1px solid var(--color-border);
}

.next-label {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.1em;
  text-transform: uppercase;
}

.next-track {
  margin: 0;
}
</style>
