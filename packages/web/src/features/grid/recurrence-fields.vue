<script setup lang="ts">
import { computed } from "vue";
import { isoWeekdayOf } from "../../lib/station-time";
import { type RecurrenceDraft, WEEKDAY_LABELS } from "./slot-recurrence";

/**
 * The recurrence editor shared by slot creation and the quick-edit popover so
 * both read identically (M1 UX note): a weekly/one-off toggle, ISO weekday
 * chips + a wall time, or a single date + time. `defaultDayIso` seeds the day
 * when switching modes (the drawn day on create, the occurrence's day on edit).
 */
const draft = defineModel<RecurrenceDraft>({ required: true });
const props = defineProps<{ defaultDayIso: string }>();

const defaultWeekday = computed(() => isoWeekdayOf(props.defaultDayIso));

function setWeekly(): void {
  if (draft.value.type === "weekly") return;
  draft.value = { type: "weekly", weekdays: [defaultWeekday.value], time: draft.value.time };
}
function setOnce(): void {
  if (draft.value.type === "once") return;
  draft.value = { type: "once", dayIso: props.defaultDayIso, time: draft.value.time };
}

function toggleWeekday(weekday: number): void {
  if (draft.value.type !== "weekly") return;
  const set = new Set(draft.value.weekdays);
  // Keep at least one day — the last chip can't be turned off.
  if (set.has(weekday)) {
    if (set.size === 1) return;
    set.delete(weekday);
  } else {
    set.add(weekday);
  }
  draft.value = { ...draft.value, weekdays: [...set].sort((a, b) => a - b) };
}

const time = computed({
  get: () => draft.value.time,
  set: (value: string) => {
    draft.value = { ...draft.value, time: value };
  },
});
const dayIso = computed({
  get: () => (draft.value.type === "once" ? draft.value.dayIso : props.defaultDayIso),
  set: (value: string) => {
    if (draft.value.type === "once") draft.value = { ...draft.value, dayIso: value };
  },
});
</script>

<template>
  <div class="recurrence-fields">
    <div class="os-row" role="radiogroup" aria-label="Recurrence">
      <button
        type="button"
        class="os-chip"
        :class="{ active: draft.type === 'weekly' }"
        role="radio"
        :aria-checked="draft.type === 'weekly'"
        @click="setWeekly"
      >
        weekly
      </button>
      <button
        type="button"
        class="os-chip"
        :class="{ active: draft.type === 'once' }"
        role="radio"
        :aria-checked="draft.type === 'once'"
        @click="setOnce"
      >
        one-off
      </button>
    </div>

    <div v-if="draft.type === 'weekly'" class="os-row weekday-row" aria-label="Weekdays">
      <button
        v-for="(label, index) in WEEKDAY_LABELS"
        :key="label"
        type="button"
        class="os-chip weekday-chip"
        :class="{ active: draft.weekdays.includes(index + 1) }"
        :aria-pressed="draft.weekdays.includes(index + 1)"
        @click="toggleWeekday(index + 1)"
      >
        {{ label }}
      </button>
    </div>

    <div class="os-row">
      <label v-if="draft.type === 'once'" class="os-field">
        date
        <input v-model="dayIso" type="date" />
      </label>
      <label class="os-field">
        start
        <input v-model="time" type="time" step="900" />
      </label>
    </div>
  </div>
</template>

<style scoped>
.recurrence-fields {
  display: grid;
  gap: var(--space-2);
}

/* Weekday chips are compact and equal-width so the seven read as one control. */
.weekday-row {
  flex-wrap: wrap;
  gap: var(--space-1);
}
.weekday-chip {
  min-width: 2.6rem;
  justify-content: center;
  font-family: var(--font-mono);
}
</style>
