<script setup lang="ts">
import { computed, nextTick, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { useBoardStore } from "../board/board-store";
import { useShowsStore } from "../shows/shows-store";
import { buildQuickItems, type QuickItemType, quickOpenOpen } from "./quick-open-state";

/**
 * The quick-open palette (Cmd/Ctrl-K): a keyboard jump to any page, show or
 * board card. Mounted once in the shell; visibility rides the shared
 * `quickOpenOpen` ref so the shell keydown just flips it.
 */
const PAGES = [
  { label: "Grid", to: "/" },
  { label: "Board", to: "/board" },
  { label: "Shows", to: "/shows" },
  { label: "Broadcasters", to: "/broadcasters" },
  { label: "Driver", to: "/driver" },
  { label: "Media", to: "/media" },
  { label: "On air", to: "/onair" },
];
const GROUP_LABELS: Record<QuickItemType, string> = {
  page: "Go to",
  show: "Shows",
  card: "Board cards",
};

const router = useRouter();
const shows = useShowsStore();
const board = useBoardStore();

const query = ref("");
const selected = ref(0);
const inputEl = ref<HTMLInputElement | null>(null);

const items = computed(() => buildQuickItems(query.value, PAGES, shows.shows, board.cards));
watch(items, () => {
  selected.value = 0;
});

watch(quickOpenOpen, async (open) => {
  if (!open) return;
  query.value = "";
  selected.value = 0;
  // Load the searchable sets once — they are station-scoped and lazy elsewhere.
  if (shows.shows.length === 0) void shows.loadShows();
  if (board.cards.length === 0) void board.loadCards();
  await nextTick();
  inputEl.value?.focus();
});

function close(): void {
  quickOpenOpen.value = false;
}

function choose(index: number): void {
  const item = items.value[index];
  if (!item) return;
  close();
  void router.push(item.to);
}

function move(delta: number): void {
  const count = items.value.length;
  if (count === 0) return;
  selected.value = (selected.value + delta + count) % count;
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === "ArrowDown") {
    event.preventDefault();
    move(1);
  } else if (event.key === "ArrowUp") {
    event.preventDefault();
    move(-1);
  } else if (event.key === "Enter") {
    event.preventDefault();
    choose(selected.value);
  } else if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

/** A group header renders before the first item of each type. */
function groupLabelAt(index: number): string | null {
  const type = items.value[index]?.type;
  if (!type) return null;
  if (index > 0 && items.value[index - 1]?.type === type) return null;
  return GROUP_LABELS[type];
}
</script>

<template>
  <div v-if="quickOpenOpen" class="qo-backdrop" @click.self="close">
    <div class="qo-panel os-surface" role="dialog" aria-label="Quick open">
      <input
        ref="inputEl"
        v-model="query"
        class="qo-input"
        type="text"
        placeholder="Jump to a page, show or card…"
        aria-label="Quick open search"
        @keydown="onKeydown"
      />
      <ul v-if="items.length > 0" class="qo-list">
        <template v-for="(item, index) in items" :key="`${item.type}:${item.to}`">
          <li v-if="groupLabelAt(index)" class="qo-group" aria-hidden="true">
            {{ groupLabelAt(index) }}
          </li>
          <li>
            <button
              type="button"
              class="qo-item"
              :class="{ selected: index === selected }"
              @click="choose(index)"
              @mousemove="selected = index"
            >
              <span class="qo-item-label">{{ item.label }}</span>
              <span v-if="item.sub" class="qo-item-sub">{{ item.sub }}</span>
            </button>
          </li>
        </template>
      </ul>
      <p v-else class="qo-empty os-hint">No matches.</p>
    </div>
  </div>
</template>

<style scoped>
.qo-backdrop {
  position: fixed;
  inset: 0;
  z-index: 90;
  display: grid;
  justify-items: center;
  align-content: start;
  padding-top: 12vh;
  background: rgba(0, 0, 0, 0.5);
}

.qo-panel {
  width: min(34rem, 92vw);
  padding: var(--space-2);
  box-shadow: 0 12px 40px rgba(0, 0, 0, 0.45);
}

.qo-input {
  width: 100%;
  padding: var(--space-2);
  background: var(--color-surface-raised);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: inherit;
  font-size: var(--text-md);
}
.qo-input:focus {
  outline: none;
  border-color: var(--color-accent);
}

.qo-list {
  display: grid;
  gap: 1px;
  max-height: 60vh;
  margin: var(--space-2) 0 0;
  padding: 0;
  overflow-y: auto;
  list-style: none;
}

.qo-group {
  padding: var(--space-1) var(--space-2) 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.qo-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-1) var(--space-2);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.qo-item.selected {
  background: var(--color-accent-soft);
  color: var(--color-accent);
}

.qo-item-label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.qo-item-sub {
  flex: none;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.qo-empty {
  margin: var(--space-2);
}
</style>
