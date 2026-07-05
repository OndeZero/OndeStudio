<script setup lang="ts">
import type { CreateSlotInput, SlotKind } from "@ondestudio/shared";
import { SLOT_KINDS } from "@ondestudio/shared";
import { computed, ref } from "vue";
import { formatDayLabel, isoWeekdayOf } from "../../lib/station-time";
import { useGridStore } from "./grid-store";
import { SLOT_KIND_GLYPHS } from "./grid-symbols";

/**
 * Slot creation straight from a drag on empty grid space (or the "+ slot"
 * button): the drag gives day, start and duration; this dialog only asks
 * what cannot be drawn — kind, name, recurrence, born-validated (PD §4.4).
 */
const props = defineProps<{
  draft: { dayIso: string; time: string; durationMin: number };
}>();

const emit = defineEmits<{ close: [] }>();

const store = useGridStore();

const kind = ref<SlotKind>("show");
const title = ref("");
const showName = ref("");
const time = ref(props.draft.time);
const durationMin = ref(props.draft.durationMin);
const weekly = ref(true);
const bornValidated = ref(false);
const submitting = ref(false);

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const weekdayName = computed(() => WEEKDAY_NAMES[isoWeekdayOf(props.draft.dayIso) - 1] ?? "");

const needsShow = computed(
  () => kind.value === "show" || kind.value === "series" || kind.value === "echo",
);
const valid = computed(() => {
  if (!/^\d{2}:\d{2}$/.test(time.value) || durationMin.value < 15) return false;
  // Show-bound kinds need an identity; live/rotation need at least a label.
  return needsShow.value
    ? showName.value.trim().length > 0 || title.value.trim().length > 0
    : title.value.trim().length > 0;
});

async function submit(): Promise<void> {
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  const input: CreateSlotInput = {
    kind: kind.value,
    recurrence: weekly.value
      ? { type: "weekly", weekdays: [isoWeekdayOf(props.draft.dayIso)], time: time.value }
      : { type: "once", startsAtWall: `${props.draft.dayIso}T${time.value}` },
    durationMin: Math.round(durationMin.value),
    bornValidated: bornValidated.value,
  };
  if (title.value.trim()) input.title = title.value.trim();
  if (needsShow.value && showName.value.trim()) input.showName = showName.value.trim();
  const created = await store.createSlot(input);
  submitting.value = false;
  if (created) emit("close");
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <form class="dialog" @submit.prevent="submit">
      <header class="dlg-head">
        <strong>New slot</strong>
        <button type="button" class="dlg-close" title="Close" @click="emit('close')">×</button>
      </header>

      <div class="kind-row" role="radiogroup" aria-label="Slot kind">
        <button
          v-for="k in SLOT_KINDS"
          :key="k"
          type="button"
          class="kind-chip"
          :class="{ active: kind === k }"
          role="radio"
          :aria-checked="kind === k"
          @click="kind = k"
        >
          <span class="kind-glyph">{{ SLOT_KIND_GLYPHS[k] }}</span>{{ k }}
        </button>
      </div>

      <label v-if="needsShow" class="dlg-field">
        show name
        <input v-model="showName" type="text" placeholder="e.g. Minuit Décousu" />
      </label>
      <label class="dlg-field">
        title <span v-if="needsShow" class="hint">(optional — defaults to the show name)</span>
        <input v-model="title" type="text" :placeholder="needsShow ? 'slot label override' : 'e.g. Maigre — studio live'" />
      </label>

      <div class="dlg-row">
        <label class="dlg-field">
          start
          <input v-model="time" type="time" step="900" />
        </label>
        <label class="dlg-field">
          duration (min)
          <input v-model.number="durationMin" type="number" min="15" max="1440" step="15" />
        </label>
      </div>

      <fieldset class="dlg-recurrence">
        <legend class="hint">recurrence</legend>
        <label class="dlg-radio">
          <input v-model="weekly" type="radio" :value="true" name="recurrence" />
          weekly every {{ weekdayName }}
        </label>
        <label class="dlg-radio">
          <input v-model="weekly" type="radio" :value="false" name="recurrence" />
          one-off on {{ formatDayLabel(props.draft.dayIso) }}
        </label>
      </fieldset>

      <label class="dlg-check">
        <input v-model="bornValidated" type="checkbox" />
        validated (nothing to negotiate)
      </label>

      <footer class="dlg-foot">
        <button type="button" class="btn-ghost" @click="emit('close')">Cancel</button>
        <button type="submit" class="btn-primary" :disabled="!valid || submitting">
          {{ submitting ? "Creating…" : "Create slot" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}

.dialog {
  display: grid;
  gap: var(--space-3);
  width: min(24rem, 94vw);
  padding: var(--space-4);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
}

.dlg-head { display: flex; align-items: baseline; justify-content: space-between; }
.dlg-close {
  padding: 0 var(--space-2);
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-lg);
  cursor: pointer;
}

.kind-row { display: flex; flex-wrap: wrap; gap: var(--space-1); }
.kind-chip {
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
}
.kind-chip.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-text);
}
.kind-glyph { font-family: var(--font-mono); }

.dlg-field { display: grid; gap: 2px; color: var(--color-text-muted); font-size: var(--text-xs); }
.dlg-field input {
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
}
.dlg-field input[type="time"],
.dlg-field input[type="number"] { font-family: var(--font-mono); width: 7rem; }

.dlg-row { display: flex; gap: var(--space-3); }

.dlg-recurrence {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
.dlg-radio,
.dlg-check {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.hint { color: var(--color-text-muted); font-size: var(--text-xs); }

.dlg-foot { display: flex; justify-content: flex-end; gap: var(--space-2); }

.btn-ghost {
  padding: var(--space-1) var(--space-3);
  background: none;
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
}
.btn-primary {
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  color: var(--color-accent);
  font-weight: 600;
  cursor: pointer;
}
.btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

@media (max-width: 720px) {
  .dialog-backdrop { place-items: end stretch; }
  .dialog { width: auto; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
}
</style>
