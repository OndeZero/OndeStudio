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
import { useBroadcastersStore } from "../broadcasters/broadcasters-store";
import { useGridStore } from "./grid-store";
import { ISSUE_FLAG_LETTERS, SLOT_KIND_GLYPHS } from "./grid-symbols";
import RecurrenceFields from "./recurrence-fields.vue";
import { draftToRecurrence, type RecurrenceDraft, recurrenceToDraft } from "./slot-recurrence";

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
const broadcasters = useBroadcastersStore();
onMounted(() => {
  if (broadcasters.broadcasters.length === 0) void broadcasters.load();
});
const rootEl = ref<HTMLElement | null>(null);

const occ = computed(() => props.occurrence);
const slot = computed(() => store.slotById.get(occ.value.slotId) ?? null);
const isLive = computed(() => slot.value?.kind === "live");
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

// Series-level edits (whole slot): title, recurrence and duration. Seeded from
// the slot and saved together, so editing a slot mirrors drawing one (M1 UX).
const slotTitle = ref("");
const seriesRecurrence = ref<RecurrenceDraft>({ type: "weekly", weekdays: [1], time: "00:00" });
const seriesDuration = ref(0);
const seriesBroadcasterId = ref<number | null>(null);
// The series editor stays tucked away — the popover is the 30-second-fix
// surface first (move/resize/negotiate); editing the whole series is opt-in.
const seriesOpen = ref(false);
watch(
  slot,
  (s) => {
    slotTitle.value = s?.title ?? "";
    if (s) {
      seriesRecurrence.value = recurrenceToDraft(s.recurrence);
      seriesDuration.value = s.durationMin;
      seriesBroadcasterId.value = s.broadcasterId;
    }
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

function clampDuration(minutes: number): number {
  return Math.min(Math.max(Math.round(minutes || 0), 15), 1440);
}

/** True once the series title, recurrence, duration or broadcaster diverges. */
const seriesDirty = computed(() => {
  const s = slot.value;
  const rule = draftToRecurrence(seriesRecurrence.value);
  if (!s || !rule) return false;
  return (
    (slotTitle.value.trim() || null) !== (s.title ?? null) ||
    clampDuration(seriesDuration.value) !== s.durationMin ||
    JSON.stringify(rule) !== JSON.stringify(s.recurrence) ||
    (isLive.value && seriesBroadcasterId.value !== s.broadcasterId)
  );
});

/** Apply the series edits in one write (re-materializes the whole series). */
async function saveSeries(): Promise<void> {
  const s = slot.value;
  const rule = draftToRecurrence(seriesRecurrence.value);
  if (!s || !rule || !seriesDirty.value) return;
  await store.updateSlot(s.id, {
    title: slotTitle.value.trim() || null,
    recurrence: rule,
    durationMin: clampDuration(seriesDuration.value),
    ...(isLive.value ? { broadcasterId: seriesBroadcasterId.value } : {}),
  });
}

async function removeSlot(): Promise<void> {
  const s = slot.value;
  if (!s) return;
  if (!window.confirm("Delete this series? This deletes every occurrence.")) return;
  if (await store.deleteSlot(s.id)) emit("close");
}

// Clamp the popover into the viewport; CSS turns it into a bottom sheet ≤720px.
// The expanded series editor is much taller, so reserve room for it (and lift
// the popover if the click was low on the grid) — it scrolls within if needed.
const estHeight = computed(() =>
  seriesOpen.value ? Math.min(window.innerHeight * 0.8, 640) : 360,
);
const positionVars = computed(() => ({
  "--qe-x": `${Math.max(8, Math.min(props.anchor.x, window.innerWidth - 336))}px`,
  "--qe-y": `${Math.max(8, Math.min(props.anchor.y, window.innerHeight - estHeight.value - 8))}px`,
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

    <!-- Both states on one line — negotiation pill + content pill (M1 UX note). -->
    <div class="os-row qe-status">
      <span class="state-chip" :style="{ borderColor: `var(--state-${occ.negotiationState})` }">
        {{ occ.negotiationState }}
      </span>
      <span class="state-chip" :style="{ borderColor: `var(--content-${occ.contentState})` }">
        {{ occ.contentState
        }}<template v-if="occ.contentDurationMin !== null"> · {{ occ.contentDurationMin }} min</template>
      </span>
    </div>
    <div v-if="transitions.length > 0 && !locked" class="os-row qe-transitions">
      <span class="os-hint">change →</span>
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
    </div>

    <section class="qe-block">
      <p class="qe-block-head">this occurrence</p>
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
    </section>

    <section v-if="slot" class="qe-block">
      <button
        type="button"
        class="qe-disclosure"
        :aria-expanded="seriesOpen"
        @click="seriesOpen = !seriesOpen"
      >
        <span class="qe-caret" aria-hidden="true">{{ seriesOpen ? "▾" : "▸" }}</span>
        whole series
      </button>
      <template v-if="seriesOpen">
        <label class="os-field">
          title
          <input v-model="slotTitle" type="text" :placeholder="slot.showName ?? 'series title'" />
        </label>
        <RecurrenceFields v-model="seriesRecurrence" :default-day-iso="dayIso" />
        <label class="os-field">
          duration (min)
          <input v-model.number="seriesDuration" type="number" min="15" max="1440" step="15" />
        </label>
        <label v-if="isLive" class="os-field">
          broadcaster
          <select v-model="seriesBroadcasterId">
            <option :value="null">— none —</option>
            <option v-for="b in broadcasters.broadcasters" :key="b.id" :value="b.id">
              {{ b.displayName }}
            </option>
          </select>
        </label>
        <div class="qe-series-actions">
          <button
            type="button"
            class="os-btn os-btn--primary"
            :disabled="!seriesDirty"
            @click="saveSeries"
          >
            save series
          </button>
          <button type="button" class="os-btn os-btn--danger" @click="removeSlot">
            delete
          </button>
        </div>
      </template>
    </section>
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
  /* A slot's series editor can make the popover tall — let it scroll in place. */
  max-height: min(80vh, 40rem);
  overflow-y: auto;
}

.qe-glyph { font-family: var(--font-mono); }
.qe-title { flex: 1; overflow-wrap: anywhere; }
.qe-when { margin: 0; color: var(--color-text-muted); font-family: var(--font-mono); font-size: var(--text-xs); }

/* Read-only state pills: negotiation and content, both border-colored inline. */
.qe-status { align-items: center; }

/* Reversible states give up to four targets — let them wrap, never clip. */
.qe-transitions { align-items: center; }
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

/* Grouped edits ("this occurrence" / "whole series"), each under a quiet label. */
.qe-block {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}
.qe-block-head {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

/* The series disclosure looks like a block label but toggles the editor. */
.qe-disclosure {
  display: flex;
  gap: var(--space-1);
  align-items: center;
  padding: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font: inherit;
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.qe-disclosure:hover {
  color: var(--color-text);
}
.qe-caret {
  font-size: 0.7em;
}
.qe-series-actions {
  display: flex;
  gap: var(--space-2);
  justify-content: space-between;
}

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
