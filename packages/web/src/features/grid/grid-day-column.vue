<script setup lang="ts">
import type { Occurrence } from "@ondestudio/shared";
import { computed } from "vue";
import { formatHm } from "../../lib/station-time";
import {
  type CardBox,
  type DayGeometry,
  gapsBetween,
  instantToY,
  packLanes,
  type TimeRange,
} from "./grid-geometry";
import type { CreatePreview } from "./grid-gesture-types";
import GridMirrorLayer from "./grid-mirror-layer.vue";
import GridSlotCard from "./grid-slot-card.vue";
import { useGridStore } from "./grid-store";

/**
 * One day column: line-work, insert bands, derived rotation fillers,
 * mirror blocks and occurrence cards, all absolutely positioned from the
 * day's real geometry (23/25h DST days get taller/shorter columns).
 */
const props = defineProps<{
  dayIso: string;
  geometry: DayGeometry;
  zone: string;
  isToday: boolean;
  nowMs: number;
  createPreview: CreatePreview | null;
}>();

const emit = defineEmits<{
  open: [payload: { occurrence: Occurrence; anchor: { x: number; y: number } }];
}>();

const store = useGridStore();

const segments = computed(() => store.occurrencesByDay.get(props.dayIso) ?? []);
const mirrorSegments = computed(() => store.mirrorBlocksByDay.get(props.dayIso) ?? []);

/**
 * Hour/half-hour rules step REAL instants (30-min increments of the day's
 * actual span), not wall labels: wall iteration would double-draw the
 * spring-forward hour and leave the first pass of the repeated fall-back
 * hour ruleless. A 25h day simply gets 50 rules, a 23h day 46.
 */
const marks = computed(() => {
  const result: { y: number; isHour: boolean }[] = [];
  const step = 30 * 60_000;
  for (let t = props.geometry.startUtcMs + step; t < props.geometry.endUtcMs; t += step) {
    const y = instantToY(props.geometry, t);
    if (y <= 0 || y >= props.geometry.heightPx) continue;
    result.push({ y, isHour: formatHm(new Date(t), props.zone).endsWith(":00") });
  }
  return result;
});

/**
 * OS cards and the AC mirror pack in SEPARATE tracks: the editable plan owns
 * the left of the column, mirror blocks compress into a right-side track.
 * Busy instances carry dozens of duplicated dummy playlists (PD §2.3) —
 * shared lanes would crush the plan into slivers. The layer is also hideable
 * (store.showMirror).
 */
const MIRROR_TRACK_PCT = 30;

const packed = computed(() => {
  const geo = props.geometry;
  const mirrors = store.showMirror ? mirrorSegments.value : [];
  const planWidth = mirrors.length > 0 ? 100 - MIRROR_TRACK_PCT : 100;

  const asRange = (s: { startMs: number; endMs: number }): TimeRange => ({
    startMs: s.startMs,
    endMs: s.endMs,
  });
  const planLanes = packLanes(segments.value.map(asRange));
  const mirrorLanes = packLanes(mirrors.map(asRange));

  const boxFor = (
    lane: { lane: number; lanes: number },
    seg: TimeRange,
    trackLeftPct: number,
    trackWidthPct: number,
  ): CardBox => {
    const top = instantToY(geo, seg.startMs);
    return {
      topPx: top,
      heightPx: Math.max(instantToY(geo, seg.endMs) - top, 12),
      leftPct: trackLeftPct + (lane.lane / lane.lanes) * trackWidthPct,
      widthPct: trackWidthPct / lane.lanes,
    };
  };

  return {
    cards: segments.value.map((seg, i) => ({
      seg,
      box: boxFor(planLanes[i] ?? { lane: 0, lanes: 1 }, seg, 0, planWidth),
    })),
    mirrors: mirrors.map((seg, i) => {
      const box = boxFor(
        mirrorLanes[i] ?? { lane: 0, lanes: 1 },
        seg,
        100 - MIRROR_TRACK_PCT,
        MIRROR_TRACK_PCT,
      );
      const from = formatHm(new Date(seg.item.startsAt), props.zone);
      const to = formatHm(new Date(seg.item.endsAt), props.zone);
      return {
        ...box,
        label: seg.item.label,
        title: `AzuraCast ${seg.item.source}: ${seg.item.label} (${from}–${to})`,
      };
    }),
  };
});

const bands = computed(() =>
  (store.showMirror ? (store.mirrorBandsByDay.get(props.dayIso) ?? []) : []).map((seg) => ({
    topPx: instantToY(props.geometry, seg.startMs),
    heightPx: instantToY(props.geometry, seg.endMs) - instantToY(props.geometry, seg.startMs),
    label: seg.item.label,
  })),
);

/**
 * Phase-1 rotation is derived: the gaps ≥30 min between everything
 * scheduled (docs/2 §8.4). Declined/cancelled ghosts do not occupy air,
 * so rotation shows through them. Mirror ranges count even when the layer
 * is hidden — hiding a layer does not change what actually airs.
 */
const fillers = computed(() => {
  const occupied: TimeRange[] = [
    ...segments.value
      .filter(
        (s) => s.item.negotiationState !== "declined" && s.item.negotiationState !== "cancelled",
      )
      .map((s) => ({ startMs: s.startMs, endMs: s.endMs })),
    ...mirrorSegments.value.map((s) => ({ startMs: s.startMs, endMs: s.endMs })),
  ];
  return gapsBetween(occupied, props.geometry.startUtcMs, props.geometry.endUtcMs, 30 * 60_000).map(
    (gap) => ({
      topPx: instantToY(props.geometry, gap.startMs),
      heightPx: instantToY(props.geometry, gap.endMs) - instantToY(props.geometry, gap.startMs),
    }),
  );
});

const nowY = computed(() => {
  if (!props.isToday) return null;
  if (props.nowMs < props.geometry.startUtcMs || props.nowMs >= props.geometry.endUtcMs)
    return null;
  return instantToY(props.geometry, props.nowMs);
});
const nowLabel = computed(() => formatHm(new Date(props.nowMs), props.zone));
</script>

<template>
  <div
    class="day-col"
    :class="{ today: isToday }"
    :style="{ height: `${geometry.heightPx}px` }"
    data-day-col
    :data-day="dayIso"
  >
    <div
      v-for="(mark, i) in marks"
      :key="i"
      class="rule"
      :class="mark.isHour ? 'rule-hour' : 'rule-half'"
      :style="{ top: `${mark.y}px` }"
    />

    <div
      v-for="(filler, i) in fillers"
      :key="`filler-${i}`"
      class="rotation-ghost"
      :style="{ top: `${filler.topPx}px`, height: `${filler.heightPx}px` }"
    >
      <span v-if="filler.heightPx > 30" class="ghost-label">rotation</span>
    </div>

    <GridMirrorLayer :bands="bands" :mirrors="packed.mirrors" />

    <GridSlotCard
      v-for="card in packed.cards"
      :key="`${card.seg.item.id}:${card.seg.dayIso}`"
      :segment="card.seg"
      :box="card.box"
      :zone="zone"
      @open="emit('open', $event)"
    />

    <div v-if="nowY !== null" class="now-line" :style="{ top: `${nowY}px` }">
      <span class="now-chip">{{ nowLabel }}</span>
    </div>

    <div
      v-if="createPreview"
      class="create-ghost"
      :style="{ top: `${createPreview.topPx}px`, height: `${createPreview.heightPx}px` }"
    >
      <span class="create-label">{{ createPreview.label }}</span>
    </div>
  </div>
</template>

<style scoped>
.day-col {
  position: relative;
  border-left: 1px solid var(--grid-line);
  /* Let panning/scrolling win on touch; drags need the 300ms hold. */
  touch-action: pan-x pan-y;
}

.rule {
  position: absolute;
  right: 0;
  left: 0;
  border-top: 1px solid;
  pointer-events: none;
}
.rule-hour { border-color: var(--grid-line); }
.rule-half { border-color: var(--grid-line-faint); }

.rotation-ghost {
  position: absolute;
  right: 2px;
  left: 2px;
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: hidden;
  background: repeating-linear-gradient(45deg, var(--grid-ghost) 0 6px, transparent 6px 12px);
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.ghost-label {
  color: var(--color-text-muted);
  font-size: 0.6rem;
  letter-spacing: 0.14em;
  opacity: 0.7;
  text-transform: uppercase;
}

:deep(.grid-card) { z-index: 3; }

.now-line {
  position: absolute;
  right: 0;
  left: 0;
  z-index: 4;
  border-top: 2px solid var(--color-accent);
  pointer-events: none;
}
.now-chip {
  position: absolute;
  top: -0.6rem;
  left: 2px;
  padding: 0 4px;
  background: var(--color-accent);
  color: var(--color-bg);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
}

.create-ghost {
  position: absolute;
  right: 1px;
  left: 1px;
  z-index: 5;
  display: flex;
  align-items: flex-start;
  justify-content: center;
  background: var(--color-accent-soft);
  border: 1px dashed var(--color-accent);
  border-radius: var(--radius-sm);
  pointer-events: none;
}
.create-label {
  color: var(--color-accent);
  font-family: var(--font-mono);
  font-size: 0.65rem;
}
</style>
