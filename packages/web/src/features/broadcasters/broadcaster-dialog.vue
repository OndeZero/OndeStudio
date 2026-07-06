<script setup lang="ts">
import {
  BROADCASTER_KINDS,
  type Broadcaster,
  type BroadcasterKind,
  type BroadcasterWithSecret,
  type CreateBroadcasterInput,
} from "@ondestudio/shared";
import { computed, ref } from "vue";
import { useBroadcastersStore } from "./broadcasters-store";

/**
 * Create/edit one broadcaster (PD §5.10). The username is identity — locked
 * after creation because it is the login BOTH stations already know; renaming
 * would strand the AzuraCast streamers it fans out to.
 */
const props = defineProps<{ broadcaster: Broadcaster | null }>();
const emit = defineEmits<{ close: []; saved: [res: BroadcasterWithSecret] }>();

const store = useBroadcastersStore();
const isEdit = props.broadcaster !== null;

const username = ref(props.broadcaster?.username ?? "");
const displayName = ref(props.broadcaster?.displayName ?? "");
const kind = ref<BroadcasterKind>(props.broadcaster?.kind ?? "external");
const commentMeta = ref(props.broadcaster?.commentMeta ?? "");
const enforceSchedule = ref(props.broadcaster?.enforceSchedule ?? false);
const replayFlag = ref<Broadcaster["replayFlag"]>(props.broadcaster?.replayFlag ?? "not_specified");
const password = ref("");
const submitting = ref(false);

// Mirrors the shared Zod schema so the obvious mistakes never reach the wire.
const USERNAME = /^[A-Za-z0-9_-]{2,64}$/;
const valid = computed(
  () =>
    displayName.value.trim() !== "" &&
    (isEdit || USERNAME.test(username.value)) &&
    (password.value === "" || (password.value.length >= 10 && password.value.length <= 100)),
);

async function submit(): Promise<void> {
  if (!valid.value || submitting.value) return;
  submitting.value = true;
  const meta = commentMeta.value.trim();
  const res = props.broadcaster
    ? await store.update(props.broadcaster.id, {
        displayName: displayName.value.trim(),
        kind: kind.value,
        commentMeta: meta === "" ? null : meta,
        enforceSchedule: enforceSchedule.value,
        replayFlag: replayFlag.value,
      })
    : await store.create(buildCreate(meta));
  submitting.value = false;
  // On failure (e.g. 409 duplicate username) the store toasted the reason;
  // staying open lets the user fix the field instead of retyping everything.
  if (res) emit("saved", res);
}

function buildCreate(meta: string): CreateBroadcasterInput {
  const input: CreateBroadcasterInput = {
    username: username.value,
    displayName: displayName.value.trim(),
    kind: kind.value,
    enforceSchedule: enforceSchedule.value,
    replayFlag: replayFlag.value,
  };
  if (meta !== "") input.commentMeta = meta;
  if (password.value !== "") input.password = password.value;
  return input;
}
</script>

<template>
  <div class="dialog-backdrop" @click.self="emit('close')">
    <form
      class="dialog os-surface"
      role="dialog"
      :aria-label="isEdit ? 'Edit broadcaster' : 'New broadcaster'"
      @submit.prevent="submit"
    >
      <header class="os-dlg-head">
        <strong>{{ isEdit ? `Edit ${broadcaster?.username}` : "New broadcaster" }}</strong>
        <button type="button" class="os-close" title="Close" @click="emit('close')">×</button>
      </header>

      <label class="os-field">
        username
        <input
          v-model="username"
          type="text"
          :disabled="isEdit"
          maxlength="64"
          placeholder="letters, digits, _ and - only"
          spellcheck="false"
        />
        <span v-if="isEdit" class="os-hint">permanent — the login both stations know</span>
      </label>

      <label class="os-field">
        display name
        <input v-model="displayName" type="text" maxlength="200" />
      </label>

      <div class="os-row" role="radiogroup" aria-label="Kind">
        <span class="os-hint">kind</span>
        <button
          v-for="k in BROADCASTER_KINDS"
          :key="k"
          type="button"
          class="os-chip"
          :class="{ active: kind === k }"
          role="radio"
          :aria-checked="kind === k"
          @click="kind = k"
        >
          {{ k }}
        </button>
      </div>

      <label class="os-field">
        comment meta <span class="os-hint">(feeds the Now-playing metadata)</span>
        <textarea v-model="commentMeta" rows="2" maxlength="500" />
      </label>

      <label class="os-check">
        <input v-model="enforceSchedule" type="checkbox" />
        enforce schedule on main
      </label>
      <p class="check-hint os-hint">
        applies to the main station only — test always stays unrestricted (PD §2.2)
      </p>

      <label class="os-field">
        replay
        <select v-model="replayFlag">
          <option value="not_specified">not specified</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </label>

      <label v-if="!isEdit" class="os-field">
        password <span class="os-hint">(optional, 10–100 chars)</span>
        <input v-model="password" type="password" maxlength="100" autocomplete="new-password" />
        <span class="os-hint">leave empty to generate one — it will be shown exactly once</span>
      </label>

      <footer class="dlg-foot">
        <button type="button" class="os-btn os-btn--ghost" @click="emit('close')">Cancel</button>
        <button type="submit" class="os-btn os-btn--primary" :disabled="!valid || submitting">
          {{ submitting ? "Saving…" : isEdit ? "Save" : "Create broadcaster" }}
        </button>
      </footer>
    </form>
  </div>
</template>

<style scoped>
/* The look lives in ui/forms.css (os-*); only backdrop and sizing are local
   — the same shape as the board's create-card dialog on purpose. */
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

.check-hint {
  margin: 0;
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
