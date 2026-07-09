<script setup lang="ts">
import type { CreateSlotInput, SlotKind } from "@ondestudio/shared";
import { SLOT_KINDS } from "@ondestudio/shared";
import { computed, ref } from "vue";
import { isoWeekdayOf } from "../../lib/station-time";
import { useGridStore } from "./grid-store";
import { SLOT_KIND_GLYPHS } from "./grid-symbols";
import RecurrenceFields from "./recurrence-fields.vue";
import { draftToRecurrence, isRecurrenceValid, type RecurrenceDraft } from "./slot-recurrence";

/**
 * Slot creation straight from a drag on empty grid space (or the "+ slot"
 * button): the drag gives day, start and duration; this dialog only asks
 * what cannot be drawn — kind, name, recurrence, born-validated (PD §4.4).
 * Recurrence is the same control the quick-edit popover uses, so drawing a
 * slot and editing one later look alike (M1 UX note).
 */
const props = defineProps<{
  draft: { dayIso: string; time: string; durationMin: number };
}>();

const emit = defineEmits<{ close: [] }>();

const store = useGridStore();

const kind = ref<SlotKind>("show");
const title = ref("");
const showName = ref("");
const recurrence = ref<RecurrenceDraft>({
  type: "weekly",
  weekdays: [isoWeekdayOf(props.draft.dayIso)],
  time: props.draft.time,
});
const durationMin = ref(props.draft.durationMin);
const bornValidated = ref(false);
const submitting = ref(false);

const needsShow = computed(
  () => kind.value === "show" || kind.value === "series" || kind.value === "echo",
);
const valid = computed(() => {
  if (durationMin.value < 15 || !isRecurrenceValid(recurrence.value)) return false;
  // Show-bound kinds need an identity; live/rotation need at least a label.
  return needsShow.value
    ? showName.value.trim().length > 0 || title.value.trim().length > 0
    : title.value.trim().length > 0;
});

async function submit(): Promise<void> {
  const rule = draftToRecurrence(recurrence.value);
  if (!valid.value || !rule || submitting.value) return;
  submitting.value = true;
  const input: CreateSlotInput = {
    kind: kind.value,
    recurrence: rule,
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
    <form class="dialog os-surface" @submit.prevent="submit">
      <header class="os-dlg-head">
        <strong>New slot</strong>
        <button type="button" class="os-close" title="Close" @click="emit('close')">×</button>
      </header>

      <div class="os-row" role="radiogroup" aria-label="Slot kind">
        <button
          v-for="k in SLOT_KINDS"
          :key="k"
          type="button"
          class="os-chip"
          :class="{ active: kind === k }"
          role="radio"
          :aria-checked="kind === k"
          @click="kind = k"
        >
          <span class="kind-glyph">{{ SLOT_KIND_GLYPHS[k] }}</span>{{ k }}
        </button>
      </div>

      <label v-if="needsShow" class="os-field">
        show name
        <input v-model="showName" type="text" placeholder="e.g. Minuit Décousu" />
      </label>
      <label class="os-field">
        title <span v-if="needsShow" class="os-hint">(optional — defaults to the show name)</span>
        <input v-model="title" type="text" :placeholder="needsShow ? 'slot label override' : 'e.g. Maigre — studio live'" />
      </label>

      <fieldset class="dlg-recurrence">
        <legend class="os-hint">recurrence</legend>
        <RecurrenceFields v-model="recurrence" :default-day-iso="props.draft.dayIso" />
        <label class="os-field">
          duration (min)
          <input v-model.number="durationMin" type="number" min="15" max="1440" step="15" />
        </label>
      </fieldset>

      <label class="os-check">
        <input v-model="bornValidated" type="checkbox" />
        validated (nothing to negotiate)
      </label>

      <footer class="dlg-foot">
        <button type="button" class="os-btn os-btn--ghost" @click="emit('close')">Cancel</button>
        <button type="submit" class="os-btn os-btn--primary" :disabled="!valid || submitting">
          {{ submitting ? "Creating…" : "Create slot" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
/* The look lives in ui/forms.css (os-*); only the backdrop, sizing and the
   recurrence fieldset are dialog-specific. */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}

.dialog { width: min(24rem, 94vw); }

.kind-glyph { font-family: var(--font-mono); }

.dlg-recurrence {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}

.dlg-foot { display: flex; justify-content: flex-end; gap: var(--space-2); }

@media (max-width: 720px) {
  .dialog-backdrop { place-items: end stretch; }
  .dialog { width: auto; border-radius: var(--radius-lg) var(--radius-lg) 0 0; }
}
</style>
