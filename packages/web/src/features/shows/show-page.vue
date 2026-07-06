<script setup lang="ts">
import type { Card, Occurrence, Slot } from "@ondestudio/shared";
import { computed, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { addDays, isoDayOf, isoWeekdayOf } from "../../lib/station-time";
import { useBoardStore } from "../board/board-store";
import CreateCardDialog from "../board/create-card-dialog.vue";
import { useGridStore } from "../grid/grid-store";
import { SLOT_KIND_GLYPHS } from "../grid/grid-symbols";
import ShowOccurrenceList from "./show-occurrence-list.vue";
import ShowSettingsForm from "./show-settings-form.vue";
import ShowThreadList from "./show-thread-list.vue";
import { useShowsStore } from "./shows-store";

/**
 * The flagship hub (PD §5.4): identity, settings, slot bindings with their
 * occurrences, and the show's board threads — with one-click links back
 * into every lens (grid, media, board).
 */
const props = defineProps<{ showId: number }>();

const store = useShowsStore();
const boardStore = useBoardStore();
const gridStore = useGridStore();
const router = useRouter();

watch(
  () => props.showId,
  (id) => {
    void store.loadDetail(id);
    // Linked threads filter client-side over the board list (anchor.type
    // "show") — load it once if this page is the entry point.
    if (boardStore.cards.length === 0) void boardStore.loadCards();
  },
  { immediate: true },
);

const detail = computed(() => (store.detail?.id === props.showId ? store.detail : null));

// Inline-editable identity: sync from the server, save on change.
const nameDraft = ref("");
watch(
  detail,
  (d) => {
    nameDraft.value = d?.name ?? "";
  },
  { immediate: true },
);
function saveName(): void {
  const d = detail.value;
  if (!d) return;
  const trimmed = nameDraft.value.trim();
  if (trimmed === "" || trimmed === d.name) {
    nameDraft.value = d.name;
    return;
  }
  void store.updateShow(d.id, { name: trimmed });
}
function blurTarget(event: Event): void {
  (event.target as HTMLElement).blur();
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function recurrencePhrase(slot: Slot): string {
  if (slot.recurrence.type === "weekly") {
    const days = slot.recurrence.weekdays.map((d) => WEEKDAYS[d - 1] ?? "?").join(", ");
    return `every ${days} · ${slot.recurrence.time} · ${slot.durationMin} min`;
  }
  return `once · ${slot.recurrence.startsAtWall.replace("T", " ")}`;
}

/** One click into the time lens: land the grid on the week this plays next. */
function goToWeekOf(startsAt: string | null): void {
  const day = isoDayOf(startsAt ? new Date(startsAt) : new Date(), gridStore.zone);
  void gridStore.setWeek(addDays(day, 1 - isoWeekdayOf(day)));
  void router.push("/");
}
function goToGrid(slot: Slot): void {
  const next = detail.value?.next.find((o) => o.slotId === slot.id);
  goToWeekOf(next?.startsAt ?? null);
}
function openOccurrence(occ: Occurrence): void {
  goToWeekOf(occ.startsAt);
}

const linkedCards = computed(() =>
  boardStore.cards.filter((c) => c.anchor?.type === "show" && c.anchor.id === String(props.showId)),
);

const discussing = ref(false);
function onCardCreated(card: Card): void {
  discussing.value = false;
  void router.push(`/board/${card.id}`);
}
function openCard(id: number): void {
  void router.push(`/board/${id}`);
}
</script>

<template>
  <article v-if="detail" class="show-page">
    <header class="show-head">
      <input
        v-model="nameDraft"
        class="show-name-input"
        type="text"
        aria-label="Show name"
        @change="saveName"
        @keydown.enter="blurTarget"
      />
      <span class="show-slug os-hint">/{{ detail.slug }}</span>
    </header>

    <ShowSettingsForm :detail="detail" />

    <section class="show-section">
      <h3 class="section-title">slot bindings</h3>
      <p v-if="detail.slots.length === 0" class="os-hint">
        No slots bound — draw one on the grid.
      </p>
      <ul class="plain-list">
        <li v-for="slot in detail.slots" :key="slot.id" class="slot-row">
          <span class="kind-glyph" :title="slot.kind">{{ SLOT_KIND_GLYPHS[slot.kind] }}</span>
          <span class="slot-phrase">
            {{ slot.title ?? detail.name }} — {{ recurrencePhrase(slot) }}
          </span>
          <button type="button" class="lens-link" @click="goToGrid(slot)">grid →</button>
        </li>
      </ul>
    </section>

    <div class="show-columns">
      <ShowOccurrenceList
        title="next"
        :occurrences="detail.next"
        empty-text="nothing scheduled"
        @open="openOccurrence"
      />
      <ShowOccurrenceList
        title="past"
        :occurrences="detail.past"
        empty-text="nothing aired yet"
        @open="openOccurrence"
      />
    </div>

    <section class="show-section">
      <header class="section-head">
        <h3 class="section-title">discussions</h3>
        <button type="button" class="lens-link" @click="discussing = true">discuss →</button>
      </header>
      <p v-if="linkedCards.length === 0" class="os-hint">
        No threads anchored to this show yet.
      </p>
      <ShowThreadList :cards="linkedCards" @open="openCard" />
    </section>

    <CreateCardDialog
      v-if="discussing"
      :anchor="{ type: 'show', id: String(detail.id) }"
      :anchor-label="detail.name"
      @close="discussing = false"
      @created="onCardCreated"
    />
  </article>
  <p v-else-if="store.detailLoading" class="os-hint">Loading show…</p>
  <p v-else class="os-hint">Show not found.</p>
</template>

<style scoped>
.show-page {
  display: grid;
  gap: var(--space-4);
  max-width: 46rem;
}

.show-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--space-2);
}

/* The name looks like a heading until touched — inline identity editing. */
.show-name-input {
  flex: 1;
  min-width: 12rem;
  padding: var(--space-1);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-family: inherit;
  font-size: var(--text-xl);
  font-weight: 600;
  transition: border-color var(--transition-fast);
}
.show-name-input:hover,
.show-name-input:focus {
  border-color: var(--color-border);
  background: var(--color-surface);
}

.show-slug {
  font-family: var(--font-mono);
}

.show-section {
  display: grid;
  gap: var(--space-2);
}

.section-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.section-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.plain-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.slot-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  font-size: var(--text-sm);
}

.kind-glyph {
  font-family: var(--font-mono);
}

.slot-phrase {
  flex: 1;
  overflow-wrap: anywhere;
}

.lens-link {
  padding: 0;
  background: none;
  border: none;
  color: var(--color-accent);
  font-size: var(--text-sm);
  white-space: nowrap;
  cursor: pointer;
}
.lens-link:hover {
  text-decoration: underline;
}

.show-columns {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-4);
}
</style>
