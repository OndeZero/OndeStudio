<script setup lang="ts">
import { useStationStore } from "./stores/station";

const stationStore = useStationStore();
</script>

<template>
  <div class="shell">
    <header class="shell-header">
      <!-- Kept as one text run so the accessible name is exactly "OndeStudio". -->
      <h1 class="wordmark">Onde<span class="wordmark-accent">Studio</span></h1>
      <nav class="shell-nav" aria-label="Main">
        <RouterLink to="/">Grid</RouterLink>
        <RouterLink to="/onair">On air</RouterLink>
      </nav>
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

.shell-nav {
  display: flex;
  gap: var(--space-3);
}

.shell-nav a {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.shell-nav a:hover {
  color: var(--color-text);
}

.shell-nav a.router-link-exact-active {
  color: var(--color-accent);
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

/* The shell owns the viewport; pages decide their own scrolling. The grid
   needs full width and an internal scroll container (docs/2 §8.4), so the
   old max-width moved into the pages that want a narrow column. */
.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.shell-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}
</style>
