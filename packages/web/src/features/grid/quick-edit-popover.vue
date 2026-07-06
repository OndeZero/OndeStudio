<script setup lang="ts">
import {
  ISSUE_FLAGS,
  type IssueFlag,
  NEGOTIATION_TRANSITIONS,
  type NegotiationState,
  type Occurrence,
} from "@ondestudio/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { formatDayLabel, formatHm, isoDayOf } from "../../lib/station-time";
import { useGridStore } from "./grid-store";
import { ISSUE_FLAG_LETTERS, SLOT_KIND_GLYPHS } from "./grid-symbols";

/**
 * The 30-second-fix surface (PD §8.1): move/resize by numbers, negotiate,
 * flag — anchored next to the clicked card; a bottom sheet on small
 * screens. Transitions offer exactly NEGOTIATION_TRANSITIONS[current].
 */
const props = defineProps<{
  occurrence: Occurrence;
  anchor: { x: number; y: number };
}>();

const emit = defineEmits<{ close: [] }>();

const store = useGridStore();
const rootEl = ref<HTMLElement | null>(null);

const occ = computed(() => props.occurrence);
const slot = computed(() => store.slotById.get(occ.value.slotId) ?? null);
const dayIso = computed(() => isoDayOf(new Date(occ.value.startsAt), store.zone));

const startTime = ref("");
const durationMin = ref(0);
watch(
  occ,
  (o) => {
    startTime.value = formatHm(new Date(o.startsAt), store.zone);
    durationMin.value = o.durationMin;
  },
  { immediate: true },
);

const slotTitle = ref("");
watch(
  slot,
  (s) => {
    slotTitle.value = s?.title ?? "";
  },
  { immediate: true },
);

const transitions = computed(() => NEGOTIATION_TRANSITIONS[occ.value.negotiationState]);

/** Terminal states are history (PD §4.4): times stay readable, never editable. */
const locked = computed(() =>
  ["aired", "declined", "cancelled"].includes(occ.value.negotiationState),
);

const CONFIRMS: Partial<Record<NegotiationState, string>> = {
  declined: "Decline this slot? It stays on the grid as a ghost for history.",
  cancelled: "Cancel this validated slot? The public may have seen it announced.",
};

async function transition(target: NegotiationState): Promise<void> {
  const confirmText = CONFIRMS[target];
  if (confirmText && !window.confirm(confirmText)) return;
  // A 409 illegal-transition rolls back and toasts inside the store.
  await store.transitionOccurrence(occ.value.id, target);
}

function applyTime(): void {
  if (locked.value || !/^\d{2}:\d{2}$/.test(startTime.value)) return;
  // Clamp to what PatchOccurrenceInputSchema accepts rather than 422ing.
  const minutes = Math.min(Math.max(Math.round(durationMin.value || 0), 15), 1440);
  durationMin.value = minutes;
  void store.patchOccurrence(occ.value.id, {
    startsAtWall: `${dayIso.value}T${startTime.value}`,
    durationMin: minutes,
  });
}

function toggleFlag(flag: IssueFlag): void {
  const next = new Set(occ.value.issueFlags);
  if (next.has(flag)) next.delete(flag);
  else next.add(flag);
  void store.patchOccurrence(occ.value.id, { issueFlags: [...next] });
}

function saveSlotTitle(): void {
  const s = slot.value;
  if (!s || slotTitle.value.trim() === (s.title ?? "")) return;
  void store.updateSlot(s.id, { title: slotTitle.value.trim() || null });
}

async function removeSlot(): Promise<void> {
  const s = slot.value;
  if (!s) return;
  if (!window.confirm("Delete this series? This deletes every occurrence.")) return;
  if (await store.deleteSlot(s.id)) emit("close");
}

// Clamp the popover into the viewport; CSS turns it into a bottom sheet ≤720px.
const positionVars = computed(() => ({
  "--qe-x": `${Math.max(8, Math.min(props.anchor.x, window.innerWidth - 336))}px`,
  "--qe-y": `${Math.max(8, Math.min(props.anchor.y, window.innerHeight - 400))}px`,
}));

function onDocumentPointerDown(event: PointerEvent): void {
  if (rootEl.value && event.target instanceof Node && !rootEl.value.contains(event.target)) {
    emit("close");
  }
}
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}
onMounted(() => {
  document.addEventListener("pointerdown", onDocumentPointerDown);
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => {
  document.removeEventListener("pointerdown", onDocumentPointerDown);
  document.removeEventListener("keydown", onKeydown);
});
</script>

<template>
  <div ref="rootEl" class="quick-edit os-surface" :style="positionVars" role="dialog" aria-label="Edit occurrence">
    <header class="os-dlg-head">
      <span class="qe-glyph">{{ SLOT_KIND_GLYPHS[occ.kind] }}</span>
      <strong class="qe-title">{{ occ.title }}</strong>
      <button type="button" class="os-close" title="Close" @click="emit('close')">×</button>
    </header>
    <p class="qe-when">
      {{ formatDayLabel(dayIso) }} · {{ formatHm(new Date(occ.startsAt), store.zone) }}–{{
        formatHm(new Date(occ.endsAt), store.zone)
      }}
      <span v-if="occ.moved" title="Moved from its series time">↷ moved</span>
    </p>

    <div class="os-row">
      <label class="os-field">
        start
        <input v-model="startTime" type="time" step="900" :disabled="locked" @change="applyTime" />
      </label>
      <label class="os-field">
        duration (min)
        <input
          v-model.number="durationMin"
          type="number"
          min="15"
          max="1440"
          step="15"
          :disabled="locked"
          @change="applyTime"
        />
      </label>
    </div>

    <div class="os-row os-row--nowrap">
      <span class="state-chip" :style="{ borderColor: `var(--state-${occ.negotiationState})` }">
        {{ occ.negotiationState }}
      </span>
      <template v-if="transitions.length > 0">
        <span class="os-hint">→</span>
        <button
          v-for="target in transitions"
          :key="target"
          type="button"
          class="os-chip"
          :style="{ borderColor: `var(--state-${target})`, color: `var(--state-${target})` }"
          @click="transition(target)"
        >
          {{ target }}
        </button>
      </template>
    </div>

    <div class="os-row">
      <button
        v-for="flag in ISSUE_FLAGS"
        :key="flag"
        type="button"
        class="os-chip flag-chip"
        :class="{ active: occ.issueFlags.includes(flag) }"
        @click="toggleFlag(flag)"
      >
        ⚑{{ ISSUE_FLAG_LETTERS[flag] }} {{ flag }}
      </button>
    </div>

    <p v-if="occ.contentDurationMin !== null" class="qe-content os-hint">
      content: {{ occ.contentDurationMin }} min ({{ occ.contentState }})
    </p>
    <p v-else class="qe-content os-hint">content: {{ occ.contentState }}</p>

    <div v-if="slot" class="qe-series">
      <p class="qe-series-head">series →</p>
      <label class="os-field qe-series-title">
        title
        <input v-model="slotTitle" type="text" :placeholder="slot.showName ?? 'series title'" @change="saveSlotTitle" />
      </label>
      <button type="button" class="os-btn os-btn--danger" @click="removeSlot">
        delete slot (deletes every occurrence)
      </button>
    </div>
  </div>
</template>

<style scoped>
/* The look lives in ui/forms.css (os-*); only what is truly popover-specific
   stays scoped: anchoring, the bottom sheet, and the per-state pills. */
.quick-edit {
  position: fixed;
  top: var(--qe-y);
  left: var(--qe-x);
  z-index: 60;
  width: 20.5rem;
}

.qe-glyph { font-family: var(--font-mono); }
.qe-title { flex: 1; overflow-wrap: anywhere; }
.qe-when { margin: 0; color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--text-xs); }
.qe-content { margin: 0; }

/* The current negotiation state: a read-only pill, border colored inline. */
.state-chip {
  padding: 1px var(--space-2);
  border: 2px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  font-weight: 600;
  white-space: nowrap;
}

/* Active issue flags stay warning-yellow — never the accent (docs/2 §8.4). */
.flag-chip.active {
  background: color-mix(in srgb, var(--flag-warning) 12%, transparent);
  border-color: var(--flag-warning);
  color: var(--flag-warning);
}

.qe-series {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}
.qe-series-head {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.qe-series-title input { width: 100%; }
.qe-series > .os-btn { justify-self: start; }

@media (max-width: 720px) {
  .quick-edit {
    top: auto;
    right: 0;
    bottom: 0;
    left: 0;
    width: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
</style>
