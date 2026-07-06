<script setup lang="ts">
import type { ReconciliationItem } from "@ondestudio/shared";

/**
 * One drift awaiting a decision (RFC 0001 §reconcile, PD §6): a manual
 * AzuraCast edit OndeStudio will not silently overwrite. Presentational — the
 * page owns the confirm + resolve mutation (broadcaster-row idiom).
 */
defineProps<{ item: ReconciliationItem; busy: boolean }>();
defineEmits<{ resolve: [resolution: "keep-ondestudio" | "keep-azuracast"] }>();
</script>

<template>
  <article class="os-surface dv-recon">
    <header class="dv-recon-head">
      <strong class="dv-recon-title">{{ item.title }}</strong>
      <span class="os-chip dv-chip">{{ item.station }}</span>
      <span class="os-chip dv-chip">{{ item.kind }}</span>
    </header>
    <p class="dv-summary">{{ item.summary }}</p>
    <div class="dv-diff">
      <div class="dv-diff-col">
        <span class="dv-diff-label">OndeStudio wants</span>
        <code class="dv-diff-val">{{ item.ondestudio }}</code>
      </div>
      <div class="dv-diff-col">
        <span class="dv-diff-label">AzuraCast has</span>
        <code class="dv-diff-val">{{ item.azuracast }}</code>
      </div>
    </div>
    <div class="os-row dv-recon-actions">
      <button
        type="button"
        class="os-btn os-btn--primary"
        :disabled="busy"
        @click="$emit('resolve', 'keep-ondestudio')"
      >
        Keep OndeStudio (re-push)
      </button>
      <button type="button" class="os-btn" :disabled="busy" @click="$emit('resolve', 'keep-azuracast')">
        Keep AzuraCast (pull the edit in)
      </button>
    </div>
  </article>
</template>

<style scoped>
.dv-recon {
  max-width: 44rem;
}
.dv-recon-head {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.dv-recon-title {
  font-size: var(--text-md);
}
/* Read-only status chips — undo the os-chip hand cursor. */
.dv-chip {
  cursor: default;
}
.dv-summary {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}
/* The two sides of the drift, side by side and monospace so they line up. */
.dv-diff {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--space-2);
}
.dv-diff-col {
  display: grid;
  gap: 2px;
  padding: var(--space-2);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.dv-diff-label {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.dv-diff-val {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
.dv-recon-actions {
  margin-top: var(--space-1);
}
</style>
