<script setup lang="ts">
import { type Card, VOTE_KINDS, type VoteKind } from "@ondestudio/shared";
import { initialsOf, intentVar, relativeTime, VOTE_EMOJI, VOTE_TITLES } from "./board-format";

/**
 * At-a-glance card (PD §5.2): subject, intent badge, anchor chip, vote
 * tally, assignees and the discussion-state indicator — the conversation is
 * graspable without opening it. Purely presentational: routing and store
 * writes stay with the parent so the face tests standalone.
 */
const props = defineProps<{ card: Card }>();
const emit = defineEmits<{ open: []; vote: [kind: VoteKind]; anchor: [] }>();

function voteCount(kind: VoteKind): number {
  return props.card.votes[kind] ?? 0;
}
</script>

<template>
  <article
    class="card-face"
    role="button"
    tabindex="0"
    @click="emit('open')"
    @keydown.enter="emit('open')"
  >
    <header class="face-top">
      <span
        class="intent-badge"
        :style="{ borderColor: intentVar(card.intent), color: intentVar(card.intent) }"
      >
        {{ card.intent }}
      </span>
      <span v-if="card.unread" class="unread-dot" title="New activity" />
    </header>

    <h3 class="face-subject">{{ card.subject }}</h3>

    <button
      v-if="card.anchor"
      type="button"
      class="os-chip anchor-chip"
      :title="`open this ${card.anchor.type}`"
      @click.stop="emit('anchor')"
    >
      ⤴ {{ card.anchor.label ?? `${card.anchor.type} ${card.anchor.id}` }}
    </button>

    <div class="vote-row" role="group" aria-label="Votes">
      <button
        v-for="kind in VOTE_KINDS"
        :key="kind"
        type="button"
        class="vote-btn"
        :class="{ mine: card.myVote === kind }"
        :title="VOTE_TITLES[kind]"
        :aria-label="`vote ${kind}`"
        @click.stop="emit('vote', kind)"
      >
        <span class="vote-emoji">{{ VOTE_EMOJI[kind] }}</span>
        <span v-if="voteCount(kind) > 0" class="vote-count">{{ voteCount(kind) }}</span>
      </button>
    </div>

    <footer class="face-foot">
      <span class="face-assignees">
        <span
          v-for="a in card.assignees"
          :key="a.id"
          class="assignee-initials"
          :title="a.displayName"
        >
          {{ initialsOf(a.displayName) }}
        </span>
      </span>
      <span class="face-activity">
        {{ card.commentCount }} {{ card.commentCount === 1 ? "reply" : "replies" }} ·
        {{ relativeTime(card.lastActivityAt) }}
      </span>
    </footer>

    <p v-if="card.lastComment" class="face-snippet">
      {{ card.lastComment.author }}: {{ card.lastComment.snippet }}
    </p>
  </article>
</template>

<style scoped>
.card-face {
  display: grid;
  gap: var(--space-1);
  padding: var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.card-face:hover {
  border-color: var(--color-accent);
}

.face-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.intent-badge {
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  white-space: nowrap;
}

.unread-dot {
  flex: none;
  width: 0.5rem;
  height: 0.5rem;
  background: var(--color-accent);
  border-radius: 50%;
}

.face-subject {
  margin: 0;
  font-size: var(--text-sm);
  font-weight: 600;
  line-height: 1.3;
  overflow-wrap: anywhere;
}

.anchor-chip {
  justify-self: start;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vote-row {
  display: flex;
  gap: var(--space-1);
}

.vote-btn {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 var(--space-1);
  background: none;
  border: 1px solid transparent;
  border-radius: var(--radius-sm);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.vote-btn:hover {
  border-color: var(--color-border);
}
.vote-btn.mine {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
}
.vote-count {
  color: var(--color-text);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.face-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
}

.face-assignees {
  display: flex;
  gap: 2px;
}

.assignee-initials {
  padding: 0 3px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.65rem;
}

.face-activity {
  color: var(--color-text-muted);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  white-space: nowrap;
}

.face-snippet {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
</style>
