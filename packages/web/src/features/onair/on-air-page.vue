<script setup lang="ts">
import { useStationStore } from "../../stores/station";
import OnAirPanel from "./on-air-panel.vue";

// The page stays a thin wrapper: it binds the panel to the app-wide station
// choice; the panel itself is reusable with any station (docs/2 §8.1).
const stationStore = useStationStore();
</script>

<template>
  <!-- The narrow reading column the shell used to provide app-wide. -->
  <div class="onair-wrap">
    <OnAirPanel :station="stationStore.current" />
  </div>
</template>

<style scoped>
.onair-wrap {
  width: 100%;
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-6);
}
</style>
