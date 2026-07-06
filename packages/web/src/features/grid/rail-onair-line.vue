<script setup lang="ts">
import { type OnAir, OnAirSchema } from "@ondestudio/shared";
import { onUnmounted, ref, watch } from "vue";
import { apiGet } from "../../lib/api/client";
import { subscribeStationSse } from "../../lib/api/sse";
import { useStationStore } from "../../stores/station";

/**
 * The rail's one-line on-air status (PD §5.1): the public /now read, kept
 * live by onair frames. Failures stay silent — this line is chrome; the
 * on-air page owns the error surface.
 */
const stationStore = useStationStore();

const onAir = ref<OnAir | null>(null);
let closeSse: (() => void) | null = null;

watch(
  () => stationStore.current,
  (station) => {
    onAir.value = null;
    apiGet(`/stations/${station}/now`, OnAirSchema)
      .then((res) => {
        // A slow response for a previously selected station must never win.
        if (station === stationStore.current) onAir.value = res;
      })
      .catch(() => {});
    closeSse?.();
    closeSse = subscribeStationSse(station, ["onair"], (_event, data) => {
      const parsed = OnAirSchema.safeParse(data);
      if (parsed.success && parsed.data.station === stationStore.current) {
        onAir.value = parsed.data;
      }
    });
  },
  { immediate: true },
);
onUnmounted(() => closeSse?.());
</script>

<template>
  <RouterLink class="rail-onair" to="/onair">
    <span v-if="onAir?.live.isLive" class="live-dot" title="LIVE" />
    <span class="rail-onair-text">{{ onAir?.current?.title ?? "nothing playing" }}</span>
  </RouterLink>
</template>

<style scoped>
.rail-onair {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-xs);
  text-decoration: none;
}
.rail-onair:hover {
  background: var(--color-accent-soft);
}

.rail-onair-text {
  overflow-wrap: anywhere;
}

/* Broadcast red is reserved for LIVE — nothing else may claim it. */
.live-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  background: var(--color-live);
  border-radius: 50%;
  animation: rail-live-pulse 2.4s ease-in-out infinite;
}
@keyframes rail-live-pulse {
  50% {
    opacity: 0.5;
  }
}
</style>
