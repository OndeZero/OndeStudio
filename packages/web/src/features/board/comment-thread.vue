<script setup lang="ts">
import type { Comment } from "@ondestudio/shared";
import { ref, watch } from "vue";
import { relativeTime } from "./board-format";
import { useBoardStore } from "./board-store";

/**
 * The thread itself: replies oldest-first, composer below — replying is the
 * frequent operation (PD §8.1), so it never scrolls out of a long thread's
 * way. Comment state lives here, not in the store: one open thread at a time.
 */
const props = defineProps<{ cardId: number }>();
const store = useBoardStore();

const comments = ref<Comment[]>([]);
const loading = ref(true);
const failed = ref(false);
const draft = ref("");
const sending = ref(false);

watch(
  () => props.cardId,
  async (id) => {
    loading.value = true;
    failed.value = false;
    comments.value = [];
    try {
      const list = await store.fetchComments(id);
      // A slow response for a previously opened card must never win.
      if (id === props.cardId) comments.value = list;
    } catch {
      if (id === props.cardId) failed.value = true;
    } finally {
      if (id === props.cardId) loading.value = false;
    }
  },
  { immediate: true },
);

// Why: there is no comments SSE channel, but the board refetch bumps the
// card's `commentCount` whenever a reply lands — refetching on that signal
// keeps an open drawer's thread live. A failed refresh keeps the current
// list (degraded, not blank); the next bump retries.
watch(
  () => [props.cardId, store.cardById(props.cardId)?.commentCount] as const,
  async ([id, count], [prevId, prevCount]) => {
    if (id !== prevId) return; // card switch — the loader watch above owns that
    if (count === undefined || prevCount === undefined || count === prevCount) return;
    try {
      const list = await store.fetchComments(id);
      // A slow response for a previously opened card must never win.
      if (id === props.cardId) comments.value = list;
    } catch {
      // Keep what we have.
    }
  },
);

async function send(): Promise<void> {
  const body = draft.value.trim();
  if (body === "" || sending.value) return;
  sending.value = true;
  const comment = await store.addComment(props.cardId, body);
  sending.value = false;
  if (comment) {
    comments.value.push(comment);
    draft.value = "";
  }
}
</script>

<template>
  <section class="thread">
    <h3 class="thread-title">discussion</h3>
    <p v-if="loading" class="os-hint">Loading thread…</p>
    <p v-else-if="failed" class="thread-error">Could not load the thread.</p>
    <p v-else-if="comments.length === 0" class="os-hint">No replies yet.</p>
    <ol v-else class="thread-list">
      <li v-for="comment in comments" :key="comment.id" class="thread-item">
        <span class="thread-author">{{ comment.author.displayName }}</span>
        <span class="thread-when">{{ relativeTime(comment.createdAt) }}</span>
        <p class="thread-body">{{ comment.body }}</p>
      </li>
    </ol>
    <form class="thread-composer" @submit.prevent="send">
      <textarea
        v-model="draft"
        rows="2"
        placeholder="Write a reply…"
        @keydown.ctrl.enter="send"
      />
      <button
        type="submit"
        class="os-btn os-btn--primary"
        :disabled="draft.trim() === '' || sending"
      >
        {{ sending ? "Sending…" : "Send" }}
      </button>
    </form>
  </section>
</template>

<style scoped>
.thread {
  display: grid;
  gap: var(--space-2);
  padding-top: var(--space-2);
  border-top: 1px solid var(--color-border);
}

.thread-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.thread-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
}

.thread-list {
  display: grid;
  gap: var(--space-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.thread-item {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0 var(--space-2);
}

.thread-author {
  font-size: var(--text-xs);
  font-weight: 600;
}

.thread-when {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.thread-body {
  grid-column: 1 / -1;
  margin: 0;
  font-size: var(--text-sm);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.thread-composer {
  display: grid;
  gap: var(--space-2);
  justify-items: end;
}

.thread-composer textarea {
  width: 100%;
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  resize: vertical;
}
</style>
