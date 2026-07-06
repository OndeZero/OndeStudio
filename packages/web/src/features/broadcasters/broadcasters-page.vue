<script setup lang="ts">
import type {
  Broadcaster,
  BroadcasterImportResult,
  BroadcasterWithSecret,
} from "@ondestudio/shared";
import { computed, onMounted, ref } from "vue";
import BroadcasterDialog from "./broadcaster-dialog.vue";
import BroadcasterRow from "./broadcaster-row.vue";
import { useBroadcastersStore } from "./broadcasters-store";
import SecretBanner from "./secret-banner.vue";

/**
 * Centralized broadcaster accounts (PD §5.10): one table, one dialog — the
 * main+test fan-out happens server-side, so this page replaces editing two
 * AzuraCast admin screens by hand.
 */
const store = useBroadcastersStore();
onMounted(() => void store.load());

const dialogOpen = ref(false);
const editing = ref<Broadcaster | null>(null);
const importing = ref(false);
const importResult = ref<BroadcasterImportResult | null>(null);
/** One-time secret, held until explicitly dismissed — never a toast (it must not expire). */
const secret = ref<{ username: string; password: string; warnings: string[] } | null>(null);
/** Row-level lock so double-clicking rotate/sync/delete cannot double-fire. */
const busyId = ref<number | null>(null);

const reach = computed(() =>
  store.writeStations.length > 0 ? store.writeStations.join(", ") : "none",
);
const ozPending = computed(() => !store.writeStations.includes("oz"));

function keepSecret(res: BroadcasterWithSecret | null): void {
  // Latest wins: a second rotation before dismissal supersedes the first
  // credential anyway, so a single banner slot is honest.
  if (res?.generatedPassword != null) {
    secret.value = {
      username: res.broadcaster.username,
      password: res.generatedPassword,
      warnings: res.warnings,
    };
  }
}

function openCreate(): void {
  editing.value = null;
  dialogOpen.value = true;
}
function openEdit(b: Broadcaster): void {
  editing.value = b;
  dialogOpen.value = true;
}
function onSaved(res: BroadcasterWithSecret): void {
  dialogOpen.value = false;
  keepSecret(res);
}

async function runImport(): Promise<void> {
  importing.value = true;
  const res = await store.importExisting();
  if (res) importResult.value = res;
  importing.value = false;
}

async function createMirror(b: Broadcaster): Promise<void> {
  busyId.value = b.id;
  keepSecret(await store.syncTest(b.id));
  busyId.value = null;
}

async function rotate(b: Broadcaster): Promise<void> {
  const ok = window.confirm(
    `Rotate the password for ${b.username}? The old credential stops working everywhere it was pushed.`,
  );
  if (!ok) return;
  busyId.value = b.id;
  keepSecret(await store.rotate(b.id));
  busyId.value = null;
}

async function removeBroadcaster(b: Broadcaster): Promise<void> {
  const ok = window.confirm(
    `Delete ${b.username}? This also removes the wz-test streamer. ` +
      `(oz stays untouched until production writes open — docs/2 §7.7.)`,
  );
  if (!ok) return;
  busyId.value = b.id;
  await store.remove(b.id);
  busyId.value = null;
}
</script>

<template>
  <section class="bc-page">
    <header class="bc-head os-row">
      <h2 class="bc-title">Broadcasters</h2>
      <span class="os-chip active reach-chip" title="Stations OndeStudio may write to today">
        writes reach: {{ reach }}
      </span>
      <!-- Explicit, not implied: oz silence would read as "done" otherwise. -->
      <span
        v-if="ozPending"
        class="os-chip reach-chip"
        title="Production writes open at the per-feature adoption step, with the dedicated API account (docs/2 §7.7)"
      >
        oz: adoption-pending
      </span>
      <span class="bc-spacer" />
      <button type="button" class="os-btn os-btn--ghost" :disabled="importing" @click="runImport">
        {{ importing ? "Importing…" : "Import from AzuraCast" }}
      </button>
      <button type="button" class="os-btn os-btn--primary" @click="openCreate">
        New broadcaster
      </button>
    </header>
    <p class="bc-note os-hint">
      One definition fans out to both stations: same credentials on main and test, schedule
      enforced on main only.
    </p>

    <SecretBanner
      v-if="secret"
      :username="secret.username"
      :password="secret.password"
      :warnings="secret.warnings"
      @dismiss="secret = null"
    />

    <div v-if="importResult" class="os-surface import-result" role="status">
      <header class="os-dlg-head">
        <strong>Import result</strong>
        <button type="button" class="os-close" title="Dismiss" @click="importResult = null">
          ×
        </button>
      </header>
      <p class="import-line">
        imported <strong>{{ importResult.imported }}</strong> · linked
        <strong>{{ importResult.linked }}</strong>
      </p>
      <p v-if="importResult.missingOnTest.length > 0" class="import-line drift-warn">
        missing on test: {{ importResult.missingOnTest.join(", ") }}
      </p>
      <p v-if="importResult.onlyOnTest.length > 0" class="import-line os-hint">
        only on test (leftovers): {{ importResult.onlyOnTest.join(", ") }}
      </p>
      <p
        v-if="importResult.missingOnTest.length === 0 && importResult.onlyOnTest.length === 0"
        class="import-line os-hint"
      >
        no drift between main and test.
      </p>
    </div>

    <div class="bc-table-wrap">
      <table class="bc-table">
        <thead>
          <tr>
            <th>username</th>
            <th>display name</th>
            <th>kind</th>
            <th title="Applies to the main station only; test always stays unrestricted">
              enforced on main
            </th>
            <th>replay</th>
            <th>stations</th>
            <th>credential</th>
            <th><span class="visually-hidden">actions</span></th>
          </tr>
        </thead>
        <tbody>
          <BroadcasterRow
            v-for="b in store.broadcasters"
            :key="b.id"
            :broadcaster="b"
            :busy="busyId === b.id"
            @edit="openEdit(b)"
            @rotate="rotate(b)"
            @remove="removeBroadcaster(b)"
            @sync-test="createMirror(b)"
          />
          <tr v-if="store.broadcasters.length === 0">
            <td colspan="8" class="empty-cell os-hint">
              {{
                store.loading
                  ? "Loading broadcasters…"
                  : "No broadcasters yet — import the existing AzuraCast streamers, or create the first one."
              }}
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <BroadcasterDialog
      v-if="dialogOpen"
      :broadcaster="editing"
      @close="dialogOpen = false"
      @saved="onSaved"
    />
  </section>
</template>

<style scoped>
.bc-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-2);
  min-height: 0;
  padding: var(--space-3);
}

.bc-title {
  margin: 0;
  font-size: var(--text-lg);
}

/* Status chips are read-only — undo the os-chip hand cursor. */
.reach-chip {
  cursor: default;
}

.bc-spacer {
  flex: 1;
}

.bc-note {
  margin: 0;
}

.import-result {
  max-width: 36rem;
}
.import-line {
  margin: 0;
  font-size: var(--text-sm);
}
.drift-warn {
  color: var(--flag-warning);
}

/* Same table dialect as the media lens. */
.bc-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.bc-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.bc-table th {
  position: sticky;
  top: 0;
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-align: left;
  text-transform: uppercase;
}

.empty-cell {
  padding: var(--space-3);
  text-align: center;
}

.visually-hidden {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip-path: inset(50%);
}
</style>
