<script setup lang="ts">
import { ref } from "vue";

/**
 * One-time credential display (docs/2 §12: OndeStudio stores only a hash).
 * Deliberately NOT a toast — a toast expires on a timer, and an expired
 * secret is a lost secret. This banner stays until the user says they have
 * stored it.
 */
const props = defineProps<{ username: string; password: string; warnings: string[] }>();
const emit = defineEmits<{ dismiss: [] }>();

const copyLabel = ref("copy");
let resetTimer: ReturnType<typeof setTimeout> | null = null;

async function copy(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.password);
    copyLabel.value = "copied ✓";
  } catch {
    // Clipboard can be denied (permissions, non-secure context). The code
    // element is select-all, so hand-copying stays one click away.
    copyLabel.value = "copy failed — select it";
  }
  if (resetTimer !== null) clearTimeout(resetTimer);
  resetTimer = setTimeout(() => {
    copyLabel.value = "copy";
  }, 2500);
}
</script>

<template>
  <aside class="os-surface secret-banner" role="alert">
    <header class="os-dlg-head">
      <strong>Credential for {{ username }} — shown once</strong>
      <button type="button" class="os-close" title="Dismiss" @click="emit('dismiss')">×</button>
    </header>
    <div class="os-row">
      <code class="secret-code">{{ password }}</code>
      <button type="button" class="os-btn os-btn--ghost" @click="copy">{{ copyLabel }}</button>
    </div>
    <p class="secret-note os-hint">
      Hand it to the broadcaster now — OndeStudio keeps only a hash and cannot show it again.
    </p>
    <ul v-if="warnings.length > 0" class="secret-warnings">
      <li v-for="(warning, i) in warnings" :key="i">{{ warning }}</li>
    </ul>
    <button type="button" class="os-btn os-btn--primary dismiss-btn" @click="emit('dismiss')">
      I stored it — dismiss
    </button>
  </aside>
</template>

<style scoped>
/* Louder than any sibling surface on purpose: this is the one thing on the
   page that cannot be recovered once dismissed. */
.secret-banner {
  border-color: var(--color-accent);
  box-shadow: 0 0 0 1px var(--color-accent-soft), 0 10px 40px var(--color-accent-soft);
}

.secret-code {
  padding: var(--space-1) var(--space-2);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
  /* One click selects the whole secret — the manual fallback for copy(). */
  user-select: all;
}

.secret-note {
  margin: 0;
}

.secret-warnings {
  margin: 0;
  padding-left: var(--space-4);
  color: var(--flag-warning);
  font-size: var(--text-xs);
}

.dismiss-btn {
  justify-self: start;
}
</style>
