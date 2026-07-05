<script setup lang="ts">
import { useStationStore } from "./stores/station";

const stationStore = useStationStore();
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <!-- Kept as one text run so the accessible name is exactly "OndeStudio". -->
      <h1 class="wordmark">Onde<span class="wordmark-accent">Studio</span></h1>
      <label class="station-switcher">
        <span class="station-switcher-label">station</span>
        <select v-model="stationStore.current" aria-label="Active station">
          <option v-for="slug in stationStore.available" :key="slug" :value="slug">
            {{ slug }}
          </option>
        </select>
      </label>
    </header>
    <main class="shell-main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.shell-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
}

.wordmark {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: 0.12em;
}

.wordmark-accent {
  color: var(--color-accent);
  /* The whole retrofuturist glow budget: one soft halo on the wordmark. */
  text-shadow: 0 0 14px var(--color-accent-soft);
}

.station-switcher {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.station-switcher-label {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.station-switcher select {
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface-raised);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  transition: border-color var(--transition-fast);
}

.station-switcher select:hover {
  border-color: var(--color-accent);
}

/* Single-column shell: fits the M0 panel and phone screens alike. */
.shell-main {
  max-width: 52rem;
  margin: 0 auto;
  padding: var(--space-5) var(--space-4) var(--space-6);
}
</style>
