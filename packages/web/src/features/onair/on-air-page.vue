<script setup lang="ts">
import { useStationStore } from "../../stores/station";
import OnAirPanel from "./on-air-panel.vue";

// The page stays a thin wrapper: it binds the panel to the app-wide station
// choice; the panel itself is reusable with any station (docs/2 §8.1).
const stationStore = useStationStore();
</script>

<template>
  <OnAirPanel :station="stationStore.current" />
</template>
