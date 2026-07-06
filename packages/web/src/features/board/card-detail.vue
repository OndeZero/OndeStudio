<script setup lang="ts">
import { CARD_INTENTS, CARD_STATUSES, type CardIntent, type CardStatus } from "@ondestudio/shared";
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import { useAuthStore } from "../../stores/auth";
import { pushToast } from "../grid/toast";
import { intentVar, relativeTime, statusLabel } from "./board-format";
import { useBoardStore } from "./board-store";
import CommentThread from "./comment-thread.vue";
import PromoteForm from "./promote-form.vue";

/**
 * The full thread (PD §5.2): workflow controls (status lane, intent,
 * assignees, outcome), promotion for unanchored ideas/prospects, body and
 * comments. A right drawer over the board — Esc or one click back.
 */
const props = defineProps<{ cardId: number }>();
const emit = defineEmits<{ close: []; anchor: [] }>();

const store = useBoardStore();
const auth = useAuthStore();

const card = computed(() => store.cardById(props.cardId));

watch(
  () => props.cardId,
  (id) => {
    // Entering the thread consumes the unread marker (PD §5.2). Sequenced
    // after ensureCard so a deep-linked card's dot clears once it arrives.
    void store.ensureCard(id).then(() => store.markCardRead(id));
  },
  { immediate: true },
);

onMounted(() => {
  auth.loadUsers().catch(() => {
    pushToast("error", "Could not load the team list for assignment.");
  });
  document.addEventListener("keydown", onKeydown);
});
onUnmounted(() => document.removeEventListener("keydown", onKeydown));
function onKeydown(event: KeyboardEvent): void {
  if (event.key === "Escape") emit("close");
}

const outcomeDraft = ref("");
const outcomeEl = ref<HTMLTextAreaElement | null>(null);
/** The server `outcome` the draft was last synced from, and for which card. */
let syncedOutcome = "";
let syncedCardId: number | null = null;

// Why the guards: SSE refetches replace every card OBJECT ~300ms after any
// board action (including our own), so `card` fires constantly with an
// unchanged `outcome`. Resync only on a real signal — another card, or the
// server VALUE moved — and never over in-progress typing (focused) or an
// unsaved local edit (dirty vs the last-synced server value).
watch(
  card,
  (c) => {
    const id = c?.id ?? null;
    const serverOutcome = c?.outcome ?? "";
    if (id !== syncedCardId) {
      // A different thread: the old draft belongs to the previous card.
      syncedCardId = id;
      syncedOutcome = serverOutcome;
      outcomeDraft.value = serverOutcome;
      return;
    }
    if (serverOutcome === syncedOutcome) return; // reference churn only
    const focused = outcomeEl.value !== null && document.activeElement === outcomeEl.value;
    if (focused || outcomeDraft.value.trim() !== syncedOutcome) {
      // Our own save echoing back? Mark it synced so `dirty` can clear.
      if (serverOutcome === outcomeDraft.value.trim()) syncedOutcome = serverOutcome;
      return;
    }
    syncedOutcome = serverOutcome;
    outcomeDraft.value = serverOutcome;
  },
  { immediate: true },
);

function setStatus(status: CardStatus): void {
  if (!card.value || card.value.status === status) return;
  void store.updateCard(card.value.id, { status });
}
function setIntent(intent: CardIntent): void {
  if (!card.value || card.value.intent === intent) return;
  void store.updateCard(card.value.id, { intent });
}
function toggleAssignee(userId: number): void {
  if (!card.value) return;
  const ids = card.value.assignees.map((a) => a.id);
  const next = ids.includes(userId) ? ids.filter((x) => x !== userId) : [...ids, userId];
  void store.updateCard(card.value.id, { assigneeIds: next });
}
function saveOutcome(): void {
  if (!card.value) return;
  const trimmed = outcomeDraft.value.trim();
  if ((card.value.outcome ?? "") === trimmed) return;
  void store.updateCard(card.value.id, { outcome: trimmed === "" ? null : trimmed });
}

const promotable = computed(
  () =>
    card.value !== null &&
    card.value.anchor === null &&
    (card.value.intent === "idea" || card.value.intent === "prospect"),
);
/** The outcome field appears when a card concludes — record it, don't bury it (PD §4.14). */
const showOutcome = computed(
  () => card.value?.status === "done" || (card.value?.outcome ?? null) !== null,
);
</script>

<template>
  <div class="detail-backdrop" @click.self="emit('close')">
    <aside class="card-detail" role="dialog" :aria-label="card?.subject ?? 'Card'">
      <template v-if="card">
        <header class="os-dlg-head detail-head">
          <span
            class="intent-badge"
            :style="{ borderColor: intentVar(card.intent), color: intentVar(card.intent) }"
          >
            {{ card.intent }}
          </span>
          <h2 class="detail-subject">{{ card.subject }}</h2>
          <button type="button" class="os-close" title="Close" @click="emit('close')">×</button>
        </header>

        <p class="detail-meta os-hint">
          opened by {{ card.createdBy.displayName }} · {{ relativeTime(card.createdAt) }}
          <button v-if="card.anchor" type="button" class="os-chip" @click="emit('anchor')">
            ⤴ {{ card.anchor.label ?? `${card.anchor.type} ${card.anchor.id}` }}
          </button>
        </p>

        <div class="os-row" role="group" aria-label="Status">
          <span class="os-hint">status</span>
          <button
            v-for="status in CARD_STATUSES"
            :key="status"
            type="button"
            class="os-chip"
            :class="{ active: card.status === status }"
            @click="setStatus(status)"
          >
            {{ statusLabel(status) }}
          </button>
        </div>

        <div class="os-row" role="group" aria-label="Intent">
          <span class="os-hint">intent</span>
          <button
            v-for="intent in CARD_INTENTS"
            :key="intent"
            type="button"
            class="os-chip"
            :class="{ active: card.intent === intent }"
            @click="setIntent(intent)"
          >
            {{ intent }}
          </button>
        </div>

        <div class="os-row" role="group" aria-label="Assignees">
          <span class="os-hint">assign</span>
          <button
            v-for="user in auth.users"
            :key="user.id"
            type="button"
            class="os-chip"
            :class="{ active: card.assignees.some((a) => a.id === user.id) }"
            @click="toggleAssignee(user.id)"
          >
            {{ user.displayName }}
          </button>
          <span v-if="auth.users.length === 0" class="os-hint">no team list</span>
        </div>

        <label v-if="showOutcome" class="os-field">
          outcome — the recorded conclusion
          <textarea
            ref="outcomeEl"
            v-model="outcomeDraft"
            rows="2"
            placeholder="what was decided?"
            @change="saveOutcome"
          />
        </label>

        <PromoteForm v-if="promotable" :card-id="card.id" />

        <p v-if="card.body" class="detail-body">{{ card.body }}</p>

        <CommentThread :card-id="card.id" />
      </template>
      <p v-else class="detail-loading os-hint">Loading card…</p>
    </aside>
  </div>
</template>

<style scoped>
.detail-backdrop {
  position: fixed;
  inset: 0;
  z-index: 65;
  display: flex;
  background: rgba(0, 0, 0, 0.35);
}

.card-detail {
  display: grid;
  gap: var(--space-3);
  align-content: start;
  width: min(30rem, 96vw);
  height: 100%;
  margin-left: auto;
  padding: var(--space-4);
  overflow-y: auto;
  background: var(--color-surface-raised);
  border-left: 1px solid var(--color-border);
  font-size: var(--text-sm);
}

.detail-head {
  align-items: center;
}

.intent-badge {
  flex: none;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  white-space: nowrap;
}

.detail-subject {
  flex: 1;
  margin: 0;
  font-size: var(--text-md);
  overflow-wrap: anywhere;
}

.detail-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
  margin: 0;
}

.os-field textarea {
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  font: inherit;
  font-size: var(--text-sm);
  resize: vertical;
}

.detail-body {
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.detail-loading {
  margin: 0;
}
</style>
