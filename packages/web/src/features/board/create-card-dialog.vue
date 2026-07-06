<script setup lang="ts">
import {
  type Anchor,
  CARD_INTENTS,
  type Card,
  type CardIntent,
  type CreateCardInput,
} from "@ondestudio/shared";
import { onMounted, ref } from "vue";
import { useAuthStore } from "../../stores/auth";
import { pushToast } from "../grid/toast";
import { intentVar } from "./board-format";
import { useBoardStore } from "./board-store";

/**
 * New card: intent + subject are the only requirements — a thread must be
 * cheap to open (PD §5.2). The optional preset anchor lets object pages
 * ("discuss →") start threads already attached to themselves.
 */
const props = defineProps<{
  anchor?: Pick<Anchor, "type" | "id">;
  anchorLabel?: string;
}>();
const emit = defineEmits<{ close: []; created: [card: Card] }>();

const store = useBoardStore();
const auth = useAuthStore();

const intent = ref<CardIntent>("discussion");
const subject = ref("");
const body = ref("");
const assigneeIds = ref<ReadonlySet<number>>(new Set());
const submitting = ref(false);

onMounted(() => {
  auth.loadUsers().catch(() => {
    pushToast("error", "Could not load the team list for assignment.");
  });
});

function toggleAssignee(id: number): void {
  const next = new Set(assigneeIds.value);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  assigneeIds.value = next;
}

async function submit(): Promise<void> {
  const trimmed = subject.value.trim();
  if (trimmed === "" || submitting.value) return;
  const input: CreateCardInput = { intent: intent.value, subject: trimmed };
  if (body.value.trim() !== "") input.body = body.value.trim();
  if (props.anchor) input.anchor = { type: props.anchor.type, id: props.anchor.id };
  if (assigneeIds.value.size > 0) input.assigneeIds = [...assigneeIds.value];
  submitting.value = true;
  const card = await store.createCard(input);
  submitting.value = false;
  if (card) emit("created", card);
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <form class="dialog os-surface" role="dialog" aria-label="New card" @submit.prevent="submit">
      <header class="os-dlg-head">
        <strong>New card</strong>
        <button type="button" class="os-close" title="Close" @click="emit('close')">×</button>
      </header>

      <div class="os-row" role="radiogroup" aria-label="Intent">
        <button
          v-for="i in CARD_INTENTS"
          :key="i"
          type="button"
          class="os-chip"
          :class="{ active: intent === i }"
          role="radio"
          :aria-checked="intent === i"
          @click="intent = i"
        >
          <span class="intent-dot" :style="{ background: intentVar(i) }" />{{ i }}
        </button>
      </div>

      <p v-if="anchor" class="os-hint">
        anchored to {{ anchorLabel ?? `${anchor.type} ${anchor.id}` }}
      </p>

      <label class="os-field">
        subject
        <input v-model="subject" type="text" maxlength="200" placeholder="what is this about?" />
      </label>

      <label class="os-field">
        body <span class="os-hint">(optional)</span>
        <textarea v-model="body" rows="4" placeholder="context, links, the pitch…" />
      </label>

      <div class="os-row" role="group" aria-label="Assign">
        <span class="os-hint">assign</span>
        <button
          v-for="user in auth.users"
          :key="user.id"
          type="button"
          class="os-chip"
          :class="{ active: assigneeIds.has(user.id) }"
          @click="toggleAssignee(user.id)"
        >
          {{ user.displayName }}
        </button>
      </div>

      <footer class="dlg-foot">
        <button type="button" class="os-btn os-btn--ghost" @click="emit('close')">Cancel</button>
        <button
          type="submit"
          class="os-btn os-btn--primary"
          :disabled="subject.trim() === '' || submitting"
        >
          {{ submitting ? "Creating…" : "Create card" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
/* The look lives in ui/forms.css (os-*); only backdrop and sizing are local
   — the same shape as the grid's create-slot dialog on purpose. */
.dialog-backdrop {
  position: fixed;
  inset: 0;
  z-index: 70;
  display: grid;
  place-items: center;
  background: rgba(0, 0, 0, 0.5);
}

.dialog {
  width: min(26rem, 94vw);
}

.dialog textarea {
  resize: vertical;
}

.intent-dot {
  display: inline-block;
  width: 0.55em;
  height: 0.55em;
  border-radius: 50%;
}

.dlg-foot {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
}

@media (max-width: 720px) {
  .dialog-backdrop {
    place-items: end stretch;
  }
  .dialog {
    width: auto;
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
  }
}
</style>
