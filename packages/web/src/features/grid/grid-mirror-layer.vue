<script setup lang="ts">
/**
 * Read-only playout reality (docs/2 §7.4): AzuraCast mirror blocks as
 * dimmed dashed cards and insert-rule windows as thin overlay bands
 * (PD §4.8). Purely presentational — the day column computes the boxes.
 * Never interactive: bands ignore the pointer entirely; blocks only keep
 * it for the tooltip (and are excluded from drag-to-create by class).
 */
interface BandBox {
  topPx: number;
  heightPx: number;
  label: string;
}

interface MirrorBox {
  topPx: number;
  heightPx: number;
  leftPct: number;
  widthPct: number;
  label: string;
  title: string;
}

defineProps<{ bands: BandBox[]; mirrors: MirrorBox[] }>();
</script>

<template>
  <div
    v-for="(band, i) in bands"
    :key="`band-${i}`"
    class="insert-band"
    :style="{ top: `${band.topPx}px`, height: `${band.heightPx}px` }"
  >
    <span class="band-label">{{ band.label }}</span>
  </div>

  <div
    v-for="(mirror, i) in mirrors"
    :key="`mirror-${i}`"
    class="mirror-card"
    :style="{
      top: `${mirror.topPx}px`,
      height: `${mirror.heightPx}px`,
      left: `${mirror.leftPct}%`,
      width: `${mirror.widthPct}%`,
    }"
    :title="mirror.title"
  >
    <span class="ac-chip">AC</span>
    <span class="mirror-label">{{ mirror.label }}</span>
  </div>
</template>

<style scoped>
.insert-band {
  position: absolute;
  right: 0;
  left: 0;
  overflow: hidden;
  background: var(--grid-band);
  pointer-events: none;
}
.band-label {
  position: absolute;
  top: 2px;
  right: 1px;
  color: var(--grid-band-label);
  font-size: 0.55rem;
  letter-spacing: 0.08em;
  writing-mode: vertical-rl;
}

.mirror-card {
  position: absolute;
  z-index: 2;
  overflow: hidden;
  padding: 1px var(--space-1);
  background: color-mix(in srgb, var(--color-surface-raised) 55%, transparent);
  border: 1px dashed var(--color-text-muted);
  border-radius: var(--radius-sm);
  color: var(--color-text-muted);
  font-size: 0.65rem;
  opacity: 0.75;
}
.ac-chip {
  margin-right: 0.35em;
  padding: 0 3px;
  border: 1px solid currentcolor;
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.55rem;
}
.mirror-label { overflow-wrap: anywhere; }
</style>
