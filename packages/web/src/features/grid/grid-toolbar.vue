<script setup lang="ts">
import { NEGOTIATION_STATES, SLOT_KINDS } from "@ondestudio/shared";
import { computed } from "vue";
import { formatWeekLabel } from "../../lib/station-time";
import { useGridStore } from "./grid-store";
import { SLOT_KIND_GLYPHS } from "./grid-symbols";

/**
 * Week navigation, state/kind filter chips (empty selection = show all)
 * and the visual-coding legend. Store-driven so grid-page stays a thin
 * orchestrator.
 */
const emit = defineEmits<{ addSlot: [] }>();

const store = useGridStore();
const weekLabel = computed(() => formatWeekLabel(store.weekMonday));
</script>

<template>
  <div class="toolbar">
    <div class="toolbar-row">
      <nav class="week-nav" aria-label="Week navigation">
        <button type="button" class="nav-btn" title="Previous week" @click="store.prevWeek()">‹</button>
        <button type="button" class="nav-btn" @click="store.today()">Today</button>
        <button type="button" class="nav-btn" title="Next week" @click="store.nextWeek()">›</button>
      </nav>
      <h2 class="week-label">{{ weekLabel }}</h2>
      <span v-if="store.loading" class="loading-dot" title="Loading window…" />
      <div class="toolbar-actions">
        <details class="legend">
          <summary class="nav-btn">Legend</summary>
          <div class="legend-pop">
            <p class="legend-title">Frame — negotiation</p>
            <p class="legend-line">
              <span
                v-for="state in NEGOTIATION_STATES"
                :key="state"
                class="legend-item"
              >
                <span class="dot" :style="{ background: `var(--state-${state})` }" />{{ state }}
              </span>
            </p>
            <p class="legend-title">Fill — content</p>
            <p class="legend-line">
              <span class="legend-item"><span class="swatch swatch-empty" />empty</span>
              <span class="legend-item"><span class="swatch swatch-received" />received</span>
              <span class="legend-item"><span class="swatch swatch-ready" />ready</span>
              <span class="legend-item"><span class="swatch swatch-aired" />aired</span>
            </p>
            <p class="legend-title">Badges &amp; layers</p>
            <p class="legend-line legend-notes">
              ⚑T/M/E issue flags · +N min content over-run · ↷ moved ·
              [AC] playout mirror (read-only) · hatched ghost = rotation fills the gap ·
              tinted band = insert-rule window
            </p>
          </div>
        </details>
        <button type="button" class="add-btn" @click="emit('addSlot')">+ slot</button>
      </div>
    </div>

    <div class="toolbar-row chips-row">
      <div class="chip-group" role="group" aria-label="Filter by negotiation state">
        <button
          v-for="state in NEGOTIATION_STATES"
          :key="state"
          type="button"
          class="chip"
          :class="{ active: store.negotiationFilter.has(state) }"
          @click="store.toggleNegotiationFilter(state)"
        >
          <span class="dot" :style="{ background: `var(--state-${state})` }" />{{ state }}
        </button>
      </div>
      <div class="chip-group" role="group" aria-label="Filter by slot kind">
        <button
          v-for="kind in SLOT_KINDS"
          :key="kind"
          type="button"
          class="chip"
          :class="{ active: store.kindFilter.has(kind) }"
          @click="store.toggleKindFilter(kind)"
        >
          <span class="chip-glyph">{{ SLOT_KIND_GLYPHS[kind] }}</span>{{ kind }}
        </button>
      </div>
      <button
        type="button"
        class="chip mirror-chip"
        :class="{ active: store.showMirror }"
        title="Show or hide the read-only AzuraCast schedule layer"
        @click="store.toggleMirror()"
      >
        [AC] mirror
      </button>
    </div>
  </div>
</template>

<style scoped>
.toolbar {
  display: grid;
  gap: var(--space-2);
  padding: var(--space-2) 0;
}

.toolbar-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

.week-nav { display: flex; gap: var(--space-1); }

.nav-btn {
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast);
  list-style: none;
}
.nav-btn:hover { border-color: var(--color-accent); }

.week-label {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-md);
  font-weight: 600;
}

.loading-dot {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--color-accent);
  border-radius: 50%;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse { 50% { opacity: 0.2; } }

.toolbar-actions {
  display: flex;
  gap: var(--space-2);
  margin-left: auto;
}

.add-btn {
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}

.legend { position: relative; }
.legend summary::-webkit-details-marker { display: none; }
.legend summary { cursor: pointer; user-select: none; }

.legend-pop {
  position: absolute;
  top: calc(100% + var(--space-1));
  right: 0;
  z-index: 50;
  width: min(22rem, 88vw);
  padding: var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.35);
  font-size: var(--text-xs);
}
.legend-title {
  margin: var(--space-2) 0 var(--space-1);
  color: var(--color-text-muted);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.legend-title:first-child { margin-top: 0; }
.legend-line {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1) var(--space-2);
  margin: 0;
}
.legend-item { display: inline-flex; align-items: center; gap: 0.35em; }
.legend-notes { color: var(--color-text-muted); line-height: 1.7; }

.dot {
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}

.swatch {
  display: inline-block;
  width: 1em;
  height: 1em;
  border-radius: 2px;
}
.swatch-empty { border: 1px dotted var(--content-empty); }
.swatch-received {
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--content-received) 45%, transparent) 0 3px,
    transparent 3px 6px
  );
}
.swatch-ready { background: color-mix(in srgb, var(--content-ready) 40%, transparent); }
.swatch-aired { background: color-mix(in srgb, var(--content-aired) 50%, transparent); }

.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35em;
  padding: 1px var(--space-2);
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.chip:hover { border-color: var(--color-accent); }
.chip.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-text);
}
.chip-glyph { font-family: var(--font-mono); }

.mirror-chip { margin-left: auto; font-family: var(--font-mono); }
</style>
