<script setup lang="ts">
import { CARD_INTENTS, type Card } from "@ondestudio/shared";
import { computed, onUnmounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { addDays, isoDayOf, isoWeekdayOf } from "../../lib/station-time";
import { useStationStore } from "../../stores/station";
import { useGridStore } from "../grid/grid-store";
import { intentVar } from "./board-format";
import type { BoardGroupBy, BoardSortBy } from "./board-pivots";
import { useBoardStore } from "./board-store";
import CardDetail from "./card-detail.vue";
import CardFace from "./card-face.vue";
import CreateCardDialog from "./create-card-dialog.vue";

/**
 * The process lens (PD §5.2): one board, re-pivoted by the group-by switch
 * and sort toggle. The detail drawer is route-driven (/board/{id}) so cards
 * are linkable from the rail, notifications and show pages — closing is one
 * click (or Esc) back to /board.
 */
const store = useBoardStore();
const gridStore = useGridStore();
const stationStore = useStationStore();
const route = useRoute();
const router = useRouter();

const GROUP_MODES: BoardGroupBy[] = ["status", "intent", "assignee"];
const SORT_MODES: BoardSortBy[] = ["activity", "votes"];

watch(
  () => stationStore.current,
  () => {
    void store.loadCards();
    store.connectSse();
  },
  { immediate: true },
);
onUnmounted(() => store.disconnectSse());

/** Lanes the user folded away; archived starts folded (history, not work). */
const collapsed = ref<Set<string>>(new Set(["archived"]));
watch(
  () => store.groupBy,
  (mode) => {
    collapsed.value = new Set(mode === "status" ? ["archived"] : []);
  },
);
function toggleLane(key: string): void {
  const next = new Set(collapsed.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  collapsed.value = next;
}

const creating = ref(false);
const detailId = computed(() => {
  const raw = route.params.id;
  const id = typeof raw === "string" ? Number.parseInt(raw, 10) : Number.NaN;
  return Number.isFinite(id) ? id : null;
});

function openCard(card: Card): void {
  void router.push(`/board/${card.id}`);
}
function closeDetail(): void {
  void router.push("/board");
}
function onCreated(card: Card): void {
  creating.value = false;
  // Land in the fresh thread: the natural next step is writing the brief.
  void router.push(`/board/${card.id}`);
}

/** One click between lenses (PD §5.4): an anchor chip jumps to the object's home surface. */
function goAnchor(card: Card): void {
  const anchor = card.anchor;
  if (!anchor) return;
  if (anchor.type === "show") {
    void router.push(`/shows/${anchor.id}`);
  } else if (anchor.type === "media") {
    void router.push({ path: "/media", query: { path: anchor.id } });
  } else {
    // Slots and occurrences live on the grid; an occurrence id
    // ({slotId}_{startEpochMs}) carries its own week.
    const epochMs = anchor.type === "occurrence" ? Number(anchor.id.split("_")[1]) : Number.NaN;
    if (Number.isFinite(epochMs)) {
      const day = isoDayOf(new Date(epochMs), gridStore.zone);
      void gridStore.setWeek(addDays(day, 1 - isoWeekdayOf(day)));
    }
    void router.push("/");
  }
}
function onDetailAnchor(): void {
  const card = detailId.value !== null ? store.cardById(detailId.value) : null;
  if (card) goAnchor(card);
}
</script>

<template>
  <section class="board-page">
    <div class="board-toolbar">
      <div class="os-row" role="group" aria-label="Group by">
        <span class="os-hint">group</span>
        <button
          v-for="mode in GROUP_MODES"
          :key="mode"
          type="button"
          class="os-chip"
          :class="{ active: store.groupBy === mode }"
          @click="store.groupBy = mode"
        >
          {{ mode }}
        </button>
      </div>
      <div class="os-row" role="group" aria-label="Sort by">
        <span class="os-hint">sort</span>
        <button
          v-for="mode in SORT_MODES"
          :key="mode"
          type="button"
          class="os-chip"
          :class="{ active: store.sortBy === mode }"
          @click="store.sortBy = mode"
        >
          {{ mode }}
        </button>
      </div>
      <div class="os-row" role="group" aria-label="Filter by intent">
        <button
          v-for="intent in CARD_INTENTS"
          :key="intent"
          type="button"
          class="os-chip"
          :class="{ active: store.intentFilter.has(intent) }"
          @click="store.toggleIntentFilter(intent)"
        >
          <span class="intent-dot" :style="{ background: intentVar(intent) }" />{{ intent }}
        </button>
      </div>
      <span v-if="store.loading" class="loading-dot" title="Loading cards…" />
      <button type="button" class="add-btn" @click="creating = true">+ card</button>
    </div>

    <div class="board-lanes">
      <div
        v-for="group in store.groups"
        :key="group.key"
        class="board-lane"
        :class="{ collapsed: collapsed.has(group.key) }"
        :data-key="group.key"
      >
        <button
          type="button"
          class="lane-head"
          :title="collapsed.has(group.key) ? 'Expand lane' : 'Collapse lane'"
          @click="toggleLane(group.key)"
        >
          <span class="lane-label">{{ group.label }}</span>
          <span class="lane-count">{{ group.cards.length }}</span>
        </button>
        <div v-if="!collapsed.has(group.key)" class="lane-cards">
          <CardFace
            v-for="card in group.cards"
            :key="card.id"
            :card="card"
            @open="openCard(card)"
            @vote="store.vote(card.id, $event)"
            @anchor="goAnchor(card)"
          />
          <p v-if="group.cards.length === 0" class="lane-empty os-hint">—</p>
        </div>
      </div>
    </div>

    <CardDetail
      v-if="detailId !== null"
      :card-id="detailId"
      @close="closeDetail"
      @anchor="onDetailAnchor"
    />
    <CreateCardDialog v-if="creating" @close="creating = false" @created="onCreated" />
  </section>
</template>

<style scoped>
.board-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-2) var(--space-3) var(--space-3);
}

.board-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2) var(--space-3);
}

.intent-dot {
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}

.loading-dot {
  width: 0.5rem;
  height: 0.5rem;
  background: var(--color-accent);
  border-radius: 50%;
  animation: pulse 1s ease-in-out infinite;
}
@keyframes pulse {
  50% {
    opacity: 0.2;
  }
}

.add-btn {
  margin-left: auto;
  padding: var(--space-1) var(--space-3);
  background: var(--color-accent-soft);
  color: var(--color-accent);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 600;
  cursor: pointer;
}

.board-lanes {
  display: flex;
  flex: 1;
  gap: var(--space-2);
  min-height: 0;
  overflow-x: auto;
}

.board-lane {
  display: flex;
  flex: none;
  flex-direction: column;
  width: 270px;
  min-height: 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.board-lane.collapsed {
  width: 2.4rem;
}

.lane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-1) var(--space-2);
  background: none;
  border: none;
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  cursor: pointer;
}
.collapsed .lane-head {
  flex-direction: column;
  border-bottom: none;
  writing-mode: vertical-rl;
}

.lane-count {
  font-family: var(--font-mono);
}

.lane-cards {
  display: grid;
  gap: var(--space-2);
  align-content: start;
  padding: var(--space-2);
  overflow-y: auto;
}

.lane-empty {
  margin: 0;
  text-align: center;
}
</style>
