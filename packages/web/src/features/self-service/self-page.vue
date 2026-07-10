<script setup lang="ts">
import type { Slot } from "@ondestudio/shared";
import { computed, onMounted, ref, watch } from "vue";
import { useSelfStore } from "./self-store";

/**
 * The external-broadcaster self-service surface (PD §5.6), route /self. A realm
 * apart from the team app: this page renders its own minimal chrome (the shell
 * hides the team header/nav for /self), and drives its own session store — a
 * lost session shows the login form here, never a redirect to the team /login.
 *
 * This increment: login → profile → own slots → logout. Propose-times, slot
 * meta and the "broadcast from here" mic section are later increments.
 */
const store = useSelfStore();

const username = ref("");
const password = ref("");

onMounted(() => {
  if (!store.checked) void store.probe();
});

async function onSubmit(): Promise<void> {
  if (store.loading || username.value === "" || password.value === "") return;
  const ok = await store.login(username.value.trim(), password.value);
  // Clear the password on success; keep the form on failure to let them retry.
  if (ok) password.value = "";
}

/** ISO weekday labels, Monday-first (index 0 → weekday 1) — kept local so the
    guest surface stays self-contained (it shares no code with the team app). */
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** A human recurrence phrase, e.g. "every Tue · 22:00 · 60 min" or
    "once · 2026-07-10 21:00 · 60 min". */
function describeRecurrence(slot: Slot): string {
  const { recurrence, durationMin } = slot;
  if (recurrence.type === "weekly") {
    const days = recurrence.weekdays.map((w) => WEEKDAY_LABELS[w - 1] ?? String(w)).join(", ");
    return `every ${days} · ${recurrence.time} · ${durationMin} min`;
  }
  const when = recurrence.startsAtWall.replace("T", " ");
  return `once · ${when} · ${durationMin} min`;
}

/** The label shown for a slot: its own title, else the show, else the kind. */
function slotLabel(slot: Slot): string {
  return slot.title ?? slot.showName ?? slot.kind;
}

// Per-slot now-playing metadata drafts (PD §5.6). Seed each slot's field once
// from the server; after a save the value already matches, so the button
// disables itself again without clobbering another slot's in-progress edit.
const metaDrafts = ref<Record<number, string>>({});
watch(
  () => store.slots,
  (slots) => {
    for (const slot of slots) {
      if (!(slot.id in metaDrafts.value)) metaDrafts.value[slot.id] = slot.meta ?? "";
    }
  },
  { immediate: true },
);

function metaChanged(slot: Slot): boolean {
  return (metaDrafts.value[slot.id] ?? "") !== (slot.meta ?? "");
}
async function saveMeta(slot: Slot): Promise<void> {
  const value = (metaDrafts.value[slot.id] ?? "").trim();
  await store.updateMeta(slot.id, value || null);
}

// Propose a (weekly) live slot. Kept deliberately simple for a phone: pick
// day(s), a start time and a length; one-off proposals can come later.
const proposeTitle = ref("");
const proposeDays = ref<number[]>([]);
const proposeTime = ref("20:00");
const proposeDuration = ref(120);
const proposing = ref(false);
const proposeDone = ref(false);

function toggleDay(weekday: number): void {
  proposeDays.value = proposeDays.value.includes(weekday)
    ? proposeDays.value.filter((d) => d !== weekday)
    : [...proposeDays.value, weekday].sort((a, b) => a - b);
}

const canPropose = computed(
  () =>
    !proposing.value &&
    proposeDays.value.length > 0 &&
    /^\d{2}:\d{2}$/.test(proposeTime.value) &&
    proposeDuration.value >= 5 &&
    proposeDuration.value <= 1440,
);

async function onPropose(): Promise<void> {
  if (!canPropose.value) return;
  proposing.value = true;
  proposeDone.value = false;
  const ok = await store.propose({
    ...(proposeTitle.value.trim() ? { title: proposeTitle.value.trim() } : {}),
    recurrence: { type: "weekly", weekdays: [...proposeDays.value], time: proposeTime.value },
    durationMin: Math.round(proposeDuration.value),
  });
  proposing.value = false;
  if (ok) {
    proposeDone.value = true;
    proposeTitle.value = "";
    proposeDays.value = [];
  }
}
</script>

<template>
  <div class="self-wrap">
    <header class="self-head">
      <h1 class="wordmark">Onde<span class="wordmark-accent">Studio</span></h1>
      <p class="self-tag">broadcaster self-service</p>
    </header>

    <!-- Quiet placeholder while the startup probe decides logged-in vs. out. -->
    <p v-if="!store.checked" class="self-loading">Loading…</p>

    <!-- Not signed in: a centred login card. -->
    <form v-else-if="!store.profile" class="os-surface self-card" @submit.prevent="onSubmit">
      <header class="os-dlg-head">
        <strong>Sign in</strong>
      </header>
      <label class="os-field">
        username
        <input
          v-model="username"
          type="text"
          autocomplete="username"
          autocapitalize="none"
          autocorrect="off"
          spellcheck="false"
          required
        />
      </label>
      <label class="os-field">
        password
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="store.error" class="self-error" role="alert">{{ store.error }}</p>
      <button
        type="submit"
        class="os-btn os-btn--primary self-submit"
        :disabled="store.loading || username === '' || password === ''"
      >
        {{ store.loading ? "Signing in…" : "Sign in" }}
      </button>
      <p class="os-hint">Sign in with your broadcaster (Icecast) username and password.</p>
    </form>

    <!-- Signed in: profile + own slots. -->
    <div v-else class="self-signed">
      <section class="os-surface self-profile">
        <header class="os-dlg-head">
          <strong>{{ store.profile.displayName }}</strong>
          <span class="self-kind" :class="`self-kind--${store.profile.kind}`">
            {{ store.profile.kind }}
          </span>
        </header>
        <p class="os-hint self-username">@{{ store.profile.username }}</p>
      </section>

      <section class="self-slots">
        <h2 class="self-slots-title">your slots</h2>
        <p v-if="store.slots.length === 0" class="os-hint self-empty">
          No slots yet. When the team schedules you, your slots will appear here.
        </p>
        <ul v-else class="self-slot-list">
          <li v-for="slot in store.slots" :key="slot.id" class="os-surface self-slot">
            <span class="self-slot-label">{{ slotLabel(slot) }}</span>
            <span class="os-hint self-slot-when">{{ describeRecurrence(slot) }}</span>
            <div class="self-meta-row">
              <label class="os-field self-meta-field">
                now-playing
                <input
                  v-model="metaDrafts[slot.id]"
                  type="text"
                  maxlength="280"
                  placeholder="what's on, or coming up"
                />
              </label>
              <button
                type="button"
                class="os-btn os-btn--ghost self-meta-save"
                :disabled="!metaChanged(slot)"
                @click="saveMeta(slot)"
              >
                save
              </button>
            </div>
          </li>
        </ul>
        <p v-if="store.zone" class="os-hint self-zone">Times shown in {{ store.zone }}.</p>
      </section>

      <section class="os-surface self-propose">
        <h2 class="self-slots-title">propose a live slot</h2>
        <label class="os-field">
          title <span class="os-hint">(optional)</span>
          <input v-model="proposeTitle" type="text" placeholder="e.g. My live set" />
        </label>
        <div class="self-days" role="group" aria-label="Weekdays">
          <button
            v-for="(label, index) in WEEKDAY_LABELS"
            :key="label"
            type="button"
            class="self-day"
            :class="{ active: proposeDays.includes(index + 1) }"
            :aria-pressed="proposeDays.includes(index + 1)"
            @click="toggleDay(index + 1)"
          >
            {{ label }}
          </button>
        </div>
        <div class="self-propose-row">
          <label class="os-field">
            start
            <input v-model="proposeTime" type="time" step="900" />
          </label>
          <label class="os-field">
            duration (min)
            <input v-model.number="proposeDuration" type="number" min="5" max="1440" step="15" />
          </label>
        </div>
        <p v-if="proposeDone" class="self-propose-ok os-hint">
          {{
            store.profile.kind === "external"
              ? "Sent — the team will review and confirm it."
              : "Added to your grid."
          }}
        </p>
        <button
          type="button"
          class="os-btn os-btn--primary self-submit"
          :disabled="!canPropose"
          @click="onPropose"
        >
          {{ proposing ? "Proposing…" : "Propose slot" }}
        </button>
        <p v-if="store.profile.kind === 'external'" class="os-hint">
          External proposals appear on the team's grid as a hold until they validate them.
        </p>
      </section>

      <button type="button" class="os-btn os-btn--ghost self-logout" @click="store.logout()">
        log out
      </button>
    </div>
  </div>
</template>

<style scoped>
/* Mobile-first: one narrow column, generous tap targets, capped width so the
   surface still reads well on a desktop. The look reuses the os-* primitives
   (ui/forms.css) and theme tokens — no colors are hard-coded here. */
.self-wrap {
  width: min(30rem, 100%);
  margin: 0 auto;
  padding: var(--space-4) var(--space-3);
  display: grid;
  gap: var(--space-4);
}

.self-head {
  display: grid;
  gap: var(--space-1);
  justify-items: center;
  text-align: center;
}

.wordmark {
  margin: 0;
  font-family: var(--font-mono);
  font-size: var(--text-lg);
  font-weight: 600;
  letter-spacing: 0.12em;
}
.wordmark-accent {
  color: var(--color-accent);
  text-shadow: 0 0 14px var(--color-accent-soft);
}
.self-tag {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.self-loading {
  margin: 0;
  text-align: center;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.self-card {
  width: 100%;
}
.self-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}
.self-submit {
  justify-self: start;
}

.self-signed {
  display: grid;
  gap: var(--space-4);
}

.self-kind {
  padding: 1px var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}
.self-kind--external {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.self-username {
  margin: 0;
}

.self-slots {
  display: grid;
  gap: var(--space-2);
}
.self-slots-title {
  margin: 0;
  font-size: var(--text-md);
  font-weight: 600;
}
.self-empty {
  margin: 0;
}
.self-slot-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: var(--space-2);
}
.self-slot {
  display: grid;
  gap: 2px;
}
.self-slot-label {
  font-size: var(--text-sm);
  font-weight: 600;
}
.self-slot-when {
  font-family: var(--font-mono);
}
.self-meta-row {
  display: flex;
  align-items: end;
  gap: var(--space-2);
  margin-top: var(--space-1);
}
.self-meta-field {
  flex: 1;
  min-width: 0;
}
.self-meta-save {
  flex: none;
  font-size: var(--text-xs);
}
.self-zone {
  margin: 0;
}

.self-propose {
  display: grid;
  gap: var(--space-2);
}
.self-days {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-1);
}
.self-day {
  min-width: 2.6rem;
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  color: var(--color-text-muted);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  cursor: pointer;
}
.self-day.active {
  background: var(--color-accent-soft);
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.self-propose-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-2);
}
.self-propose-ok {
  margin: 0;
  color: var(--color-accent);
}

.self-logout {
  justify-self: start;
  font-size: var(--text-xs);
}
</style>
