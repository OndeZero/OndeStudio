<script setup lang="ts">
import type { PromoteCardInput } from "@ondestudio/shared";
import { computed, ref } from "vue";
import { useBoardStore } from "./board-store";

/**
 * Promotion (PD §4.14): the idea/prospect becomes a real object and the
 * thread re-anchors to it. First cut mirrors the API exactly: create a show
 * by name, or anchor to an existing slot by numeric id (see README for why
 * that is rough on purpose).
 */
const props = defineProps<{ cardId: number }>();
const store = useBoardStore();

const open = ref(false);
const to = ref<"show" | "slot">("show");
const name = ref("");
// number | "" because an emptied number input models as "".
const slotId = ref<number | "">("");
const submitting = ref(false);

const valid = computed(() =>
  to.value === "show"
    ? name.value.trim().length > 0
    : typeof slotId.value === "number" && slotId.value > 0,
);

async function submit(): Promise<void> {
  if (!valid.value || submitting.value) return;
  const input: PromoteCardInput =
    to.value === "show"
      ? { to: "show", name: name.value.trim() }
      : { to: "slot", slotId: Math.round(typeof slotId.value === "number" ? slotId.value : 0) };
  submitting.value = true;
  const promoted = await store.promoteCard(props.cardId, input);
  submitting.value = false;
  if (promoted) open.value = false;
}
</script>

<template>
  <div class="promote">
    <button v-if="!open" type="button" class="os-btn os-btn--ghost" @click="open = true">
      promote → real object
    </button>
    <form v-else class="promote-form" @submit.prevent="submit">
      <div class="os-row" role="radiogroup" aria-label="Promote to">
        <button
          type="button"
          class="os-chip"
          :class="{ active: to === 'show' }"
          role="radio"
          :aria-checked="to === 'show'"
          @click="to = 'show'"
        >
          to show
        </button>
        <button
          type="button"
          class="os-chip"
          :class="{ active: to === 'slot' }"
          role="radio"
          :aria-checked="to === 'slot'"
          @click="to = 'slot'"
        >
          to slot
        </button>
      </div>
      <label v-if="to === 'show'" class="os-field">
        show name
        <input v-model="name" type="text" placeholder="e.g. Ambient Cartographies" />
      </label>
      <label v-else class="os-field">
        slot id <span class="os-hint">(numeric — rough first cut, see board README)</span>
        <input v-model.number="slotId" type="number" min="1" step="1" />
      </label>
      <div class="os-row">
        <button type="button" class="os-btn os-btn--ghost" @click="open = false">cancel</button>
        <button type="submit" class="os-btn os-btn--primary" :disabled="!valid || submitting">
          {{ submitting ? "Promoting…" : "Promote" }}
        </button>
      </div>
    </form>
  </div>
</template>

<style scoped>
.promote {
  display: grid;
  justify-items: start;
}

.promote-form {
  display: grid;
  gap: var(--space-2);
  width: 100%;
  padding: var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
}
</style>
