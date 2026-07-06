<script setup lang="ts">
import type { Card } from "@ondestudio/shared";
import { intentVar } from "../board/board-format";

/**
 * The hub's linked board threads (PD §5.4): intent dot, subject, reply
 * count, unread dot — each row one click into the board card.
 */
defineProps<{ cards: Card[] }>();
const emit = defineEmits<{ open: [cardId: number] }>();
</script>

<template>
  <ul class="plain-list">
    <li v-for="card in cards" :key="card.id">
      <button type="button" class="card-row" @click="emit('open', card.id)">
        <span
          class="intent-dot"
          :style="{ background: intentVar(card.intent) }"
          :title="card.intent"
        />
        <span class="card-subject">{{ card.subject }}</span>
        <span class="reply-count">{{ card.commentCount }} replies</span>
        <span v-if="card.unread" class="unread-dot" title="New activity" />
      </button>
    </li>
  </ul>
</template>

<style scoped>
.plain-list {
  display: grid;
  gap: var(--space-1);
  margin: 0;
  padding: 0;
  list-style: none;
}

.card-row {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  width: 100%;
  padding: 2px var(--space-1);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-sm);
  text-align: left;
  cursor: pointer;
}
.card-row:hover {
  background: var(--color-accent-soft);
}

.intent-dot {
  flex: none;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}

.card-subject {
  flex: 1;
  overflow-wrap: anywhere;
}

.reply-count {
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.unread-dot {
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  background: var(--color-accent);
  border-radius: 50%;
}
</style>
