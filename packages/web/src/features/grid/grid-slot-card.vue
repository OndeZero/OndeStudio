<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { computed } from "vue";
import { formatHm } from "../../lib/station-time";
import type { CardBox } from "./grid-geometry";
import type { DaySegment } from "./grid-segments";
import { ISSUE_FLAG_LETTERS, ISSUE_FLAG_TITLES, SLOT_KIND_GLYPHS } from "./grid-symbols";

/**
 * One occurrence segment, rendered to the docs/2 §8.4 spec: the FRAME
 * (border + header strip) carries the negotiation state, the inner FILL
 * carries the content pipeline, corner badges carry issue flags — three
 * channels that never fight. Data attributes feed grid-interactions.
 */
const props = defineProps<{
  segment: DaySegment<Occurrence>;
  box: CardBox;
  zone: string;
}>();

const emit = defineEmits<{
  open: [payload: { occurrence: Occurrence; anchor: { x: number; y: number } }];
}>();

const occ = computed(() => props.segment.item);
const occStartMs = computed(() => Date.parse(occ.value.startsAt));

const frameClass = computed(() => `frame-${occ.value.negotiationState}`);
const ghosted = computed(
  () => occ.value.negotiationState === "declined" || occ.value.negotiationState === "cancelled",
);
const aired = computed(() => occ.value.negotiationState === "aired");
/**
 * Terminal states are history, not plans (PD §4.4: aired is time-driven,
 * ghosts are kept for the record) — no drag/resize affordances. The class
 * also excludes them from the interact.js selectors.
 */
const locked = computed(() => ghosted.value || aired.value);

/**
 * Fill ratio of the booked frame. No content duration but content present
 * (received/ready before a length is known) fills the whole frame — the
 * pipeline state is the primary signal, the length the refinement.
 */
const fillRatio = computed<number | null>(() => {
  const o = occ.value;
  if (o.contentState === "empty") return null;
  if (o.contentDurationMin === null) return 1;
  return o.contentDurationMin / o.durationMin;
});
/**
 * Fill measured on the OCCURRENCE timeline, clipped to this segment: a
 * midnight-split card shows a full head and an empty tail, never the same
 * fraction twice — the visible gap is where rotation actually covers
 * (docs/2 §8.4).
 */
const fillHeightPct = computed(() => {
  const ratio = fillRatio.value;
  if (ratio === null) return 0;
  const occEndMs = Date.parse(occ.value.endsAt);
  const contentEndMs = occStartMs.value + Math.min(ratio, 1) * (occEndMs - occStartMs.value);
  const covered = Math.min(contentEndMs, props.segment.endMs) - props.segment.startMs;
  return (Math.max(covered, 0) / (props.segment.endMs - props.segment.startMs)) * 100;
});
const overrunMin = computed(() => {
  const o = occ.value;
  return o.contentDurationMin !== null && o.contentDurationMin > o.durationMin
    ? o.contentDurationMin - o.durationMin
    : 0;
});

const glyph = computed(() => SLOT_KIND_GLYPHS[occ.value.kind]);
const timeRange = computed(() => {
  const zone = props.zone;
  return `${formatHm(new Date(occ.value.startsAt), zone)}–${formatHm(new Date(occ.value.endsAt), zone)}`;
});
const flagBadges = computed(() =>
  occ.value.issueFlags.map((flag) => ({
    flag,
    letter: ISSUE_FLAG_LETTERS[flag],
    title: ISSUE_FLAG_TITLES[flag],
  })),
);
/** Resizing pulls the end edge — only where the occurrence actually ends, never on locked cards. */
const resizable = computed(() => !props.segment.continuesAfter && !locked.value);

const style = computed(() => ({
  top: `${props.box.topPx}px`,
  height: `${props.box.heightPx}px`,
  left: `${props.box.leftPct}%`,
  width: `${props.box.widthPct}%`,
}));

function open(event: MouseEvent | KeyboardEvent): void {
  const anchor =
    event instanceof MouseEvent && event.clientX > 0
      ? { x: event.clientX, y: event.clientY }
      : centerOf(event.currentTarget);
  emit("open", { occurrence: occ.value, anchor });
}

function centerOf(target: EventTarget | null): { x: number; y: number } {
  const rect = target instanceof HTMLElement ? target.getBoundingClientRect() : null;
  return rect ? { x: rect.left + rect.width / 2, y: rect.top + 16 } : { x: 0, y: 0 };
}
</script>

<template>
  <article
    class="grid-card"
    :class="[
      frameClass,
      {
        ghosted,
        aired,
        'grid-card--locked': locked,
        'continues-before': segment.continuesBefore,
        'continues-after': segment.continuesAfter,
      },
    ]"
    :style="style"
    :data-occ-id="occ.id"
    :data-day="segment.dayIso"
    :data-occ-start-ms="occStartMs"
    :data-seg-start-ms="segment.startMs"
    :data-duration-min="occ.durationMin"
    :data-kind="occ.kind"
    role="button"
    tabindex="0"
    @click="open"
    @keydown.enter.prevent="open"
  >
    <div
      v-if="fillRatio !== null"
      class="card-fill"
      :class="`fill-${occ.contentState}`"
      :style="{ height: `${fillHeightPct}%` }"
      aria-hidden="true"
    />
    <div v-else class="fill-hint" aria-hidden="true" />

    <header class="card-head">
      <span class="kind-glyph" :class="{ 'kind-live': occ.kind === 'live' }" :title="occ.kind">
        {{ glyph }}
      </span>
      <span class="card-title">{{ occ.title }}</span>
      <span v-if="occ.moved" class="moved-glyph" title="Moved from its series time">↷</span>
    </header>
    <div class="card-time">{{ timeRange }}</div>

    <div v-if="flagBadges.length > 0" class="card-flags">
      <span v-for="badge in flagBadges" :key="badge.flag" class="flag-badge" :title="badge.title">
        ⚑{{ badge.letter }}
      </span>
    </div>

    <!-- Content over-runs at the occurrence's real end — not at a midnight cut. -->
    <template v-if="overrunMin > 0 && !segment.continuesAfter">
      <div class="overrun-edge" aria-hidden="true" />
      <span class="overrun-chip" :title="`Content runs ${overrunMin} min past the booked frame`">
        +{{ overrunMin }} min
      </span>
    </template>

    <div v-if="resizable" class="card-resize" aria-hidden="true" />
  </article>
</template>

<style scoped>
.grid-card {
  position: absolute;
  overflow: hidden;
  padding: 0;
  background: var(--color-surface-raised);
  border: 2px solid var(--frame-color, var(--color-border));
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  line-height: 1.3;
  cursor: grab;
  touch-action: manipulation;
  user-select: none;
  -webkit-user-select: none;
}

/* Added by grid-interactions during a move; the element keeps its scope attr. */
.grid-card.dragging {
  z-index: 30;
  opacity: 0.9;
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.45);
  cursor: grabbing;
}

/* Negotiation state → frame colour, one channel (docs/2 §8.4). */
.frame-prebooked { --frame-color: var(--state-prebooked); }
.frame-dealing { --frame-color: var(--state-dealing); }
.frame-validated { --frame-color: var(--state-validated); }
.frame-declined { --frame-color: var(--state-declined); }
.frame-cancelled { --frame-color: var(--state-cancelled); }
.frame-aired { --frame-color: var(--state-aired); }

/* Ghosts stay on the grid for history (PD §4.4) but clearly out of play. */
.ghosted { opacity: 0.45; }
.ghosted .card-title { text-decoration: line-through; }
.aired { opacity: 0.6; }
.grid-card--locked { cursor: default; }

/* Midnight cuts: square off and dot the edge that continues elsewhere. */
.continues-before { border-top-style: dotted; border-top-left-radius: 0; border-top-right-radius: 0; }
.continues-after { border-bottom-style: dotted; border-bottom-left-radius: 0; border-bottom-right-radius: 0; }

/* Content pipeline → inner fill, anchored top; the gap below is what rotation covers. */
.card-fill {
  position: absolute;
  inset: 0 0 auto 0;
  pointer-events: none;
}
.fill-received {
  background: repeating-linear-gradient(
    45deg,
    color-mix(in srgb, var(--content-received) 45%, transparent) 0 4px,
    color-mix(in srgb, var(--content-received) 12%, transparent) 4px 8px
  );
}
.fill-ready { background: color-mix(in srgb, var(--content-ready) 30%, transparent); }
.fill-aired { background: color-mix(in srgb, var(--content-aired) 35%, transparent); }
.fill-empty { background: none; }

/* Hollow hint: nothing has arrived yet for this frame. */
.fill-hint {
  position: absolute;
  inset: 3px;
  border: 1px dotted color-mix(in srgb, var(--content-empty) 80%, transparent);
  border-radius: var(--radius-sm);
  pointer-events: none;
}

.card-head {
  position: relative;
  display: flex;
  align-items: baseline;
  gap: 0.3em;
  padding: 2px var(--space-1);
  background: color-mix(in srgb, var(--frame-color, var(--color-border)) 22%, transparent);
}

.kind-glyph { flex: none; font-family: var(--font-mono); }
.kind-live { color: var(--color-live); }

.card-title {
  overflow: hidden;
  font-weight: 600;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.moved-glyph { flex: none; color: var(--color-text-muted); }

.card-time {
  position: relative;
  padding: 0 var(--space-1);
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: 0.65rem;
}

.card-flags {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  gap: 2px;
}
.flag-badge {
  padding: 0 3px;
  background: color-mix(in srgb, var(--flag-warning) 25%, var(--color-surface-raised));
  color: var(--flag-warning);
  border-radius: var(--radius-sm);
  font-size: 0.6rem;
  font-weight: 700;
}

/* Over-run: content longer than the frame — soft boundaries made visible (PD §5.1). */
.overrun-edge {
  position: absolute;
  right: -2px;
  bottom: -3px;
  left: -2px;
  height: 4px;
  background: var(--flag-warning);
  box-shadow: 0 0 8px var(--flag-warning);
  pointer-events: none;
}
.overrun-chip {
  position: absolute;
  right: 2px;
  bottom: 3px;
  padding: 0 4px;
  background: var(--flag-warning);
  color: var(--color-bg);
  border-radius: var(--radius-sm);
  font-size: 0.6rem;
  font-weight: 700;
}

.card-resize {
  position: absolute;
  right: 0;
  bottom: -2px;
  left: 0;
  height: 7px;
  cursor: ns-resize;
}
</style>
