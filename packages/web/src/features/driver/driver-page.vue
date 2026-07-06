<script setup lang="ts">
import type { ProjectionView, ReconciliationItem } from "@ondestudio/shared";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useStationStore } from "../../stores/station";
import DriverReconCard from "./driver-recon-card.vue";
import { useDriverStore } from "./driver-store";

/**
 * The write-back surface (RFC 0001, docs/2 §11 M3): where OndeStudio's
 * decisions reach AzuraCast. Header answers "is it driving, and healthy?"; the
 * inbox is the one place a manual AzuraCast edit is reconciled (PD §6); the
 * table shows what has projected.
 */
const store = useDriverStore();
const stationStore = useStationStore();

/** Row lock: resolving is a POST + double refetch — a double click must not double-fire. */
const busyId = ref<number | null>(null);

// Not station-scoped (the driver spans every write station), but its SSE
// trigger follows the active station — reload on switch, like the grid page.
watch(
  () => stationStore.current,
  () => {
    void store.load();
    void store.loadReconciliations();
  },
  { immediate: true },
);
onMounted(() => store.start());
onUnmounted(() => store.stop());

/** Compact "time since" for last-run / last-synced stamps (board-format idiom, kept local). */
function since(iso: string | null): string {
  if (iso === null) return "never";
  const minutes = Math.round(Math.max(0, Date.now() - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d ago`;
  return iso.slice(0, 10);
}

const STATE_CHIP: Record<ProjectionView["state"], { label: string; cls: string }> = {
  synced: { label: "synced", cls: "st-synced" },
  pending: { label: "creating…", cls: "st-pending" },
  drifted: { label: "needs a decision", cls: "st-drifted" },
};

async function onResolve(
  item: ReconciliationItem,
  resolution: "keep-ondestudio" | "keep-azuracast",
): Promise<void> {
  // keep-azuracast rewrites the OndeStudio slot to match the manual edit (PD §6) — confirm it.
  if (resolution === "keep-azuracast") {
    const ok = window.confirm(
      `Pull "${item.azuracast}" from AzuraCast into the "${item.title}" slot? ` +
        `This changes OndeStudio's schedule to match the manual edit.`,
    );
    if (!ok) return;
  }
  busyId.value = item.id;
  await store.resolve(item.id, resolution);
  busyId.value = null;
}
</script>

<template>
  <section class="dv-page">
    <header class="dv-head os-row">
      <h2 class="dv-title">Write-back</h2>
      <span
        v-for="s in store.status?.writeStations ?? []"
        :key="s"
        class="os-chip active dv-chip"
        title="OndeStudio is driving this station (docs/2 §7.7)"
      >
        driving → {{ s }}
      </span>
      <span class="dv-spacer" />
      <span
        class="dv-health"
        :class="store.status?.adapterHealthy ? 'ok' : 'bad'"
        :title="store.status?.adapterHealthy ? 'AzuraCast link healthy' : 'AzuraCast link degraded'"
      >
        <span class="dv-dot" aria-hidden="true" />
        {{ store.status?.adapterHealthy ? "AzuraCast link ok" : "AzuraCast link degraded" }}
      </span>
      <span class="os-hint dv-lastrun">last run {{ since(store.status?.lastRunAt ?? null) }}</span>
    </header>

    <!-- driving=false ⇒ no writable station yet; say so instead of an empty header. -->
    <p v-if="store.status && !store.status.driving" class="os-hint dv-note">
      No station is writable yet — production writes open at the §7.7 adoption step (docs/2 §7.7).
    </p>

    <!-- The inbox leads: a manual edit is the one thing that needs a human. -->
    <section v-if="store.reconciliations.length > 0" class="dv-inbox">
      <h3 class="dv-section-title">Needs a decision</h3>
      <DriverReconCard
        v-for="item in store.reconciliations"
        :key="item.id"
        :item="item"
        :busy="busyId === item.id"
        @resolve="(r) => onResolve(item, r)"
      />
    </section>

    <section class="dv-projections">
      <h3 class="dv-section-title">Projections</h3>
      <div class="dv-table-wrap">
        <table class="dv-table">
          <thead>
            <tr>
              <th>title</th>
              <th>station</th>
              <th>state</th>
              <th>kind</th>
              <th>last synced</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="p in store.status?.projections ?? []" :key="p.slotId">
              <td>{{ p.title }}</td>
              <td class="dv-mono">{{ p.station }}</td>
              <td>
                <span class="dv-state" :class="STATE_CHIP[p.state].cls">
                  {{ STATE_CHIP[p.state].label }}
                </span>
              </td>
              <td class="dv-mono">{{ p.azKind }}</td>
              <td class="os-hint">{{ since(p.lastSyncedAt) }}</td>
            </tr>
            <tr v-if="(store.status?.projections.length ?? 0) === 0">
              <td colspan="5" class="dv-empty os-hint">
                Nothing projected yet — validated weekly shows on a write station appear here.
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  </section>
</template>

<style scoped>
.dv-page {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: var(--space-3);
  min-height: 0;
  padding: var(--space-3);
}
.dv-title {
  margin: 0;
  font-size: var(--text-lg);
}
/* Read-only status chips — undo the os-chip hand cursor. */
.dv-chip {
  cursor: default;
}
.dv-spacer {
  flex: 1;
}
/* Health dot: green when the write link is up, danger when degraded. */
.dv-health {
  display: inline-flex;
  align-items: center;
  gap: 0.4em;
  font-size: var(--text-xs);
}
.dv-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  background: var(--state-validated);
}
.dv-health.bad {
  color: var(--color-danger);
}
.dv-health.bad .dv-dot {
  background: var(--color-danger);
}
.dv-lastrun,
.dv-note {
  margin: 0;
}
.dv-section-title {
  margin: 0 0 var(--space-2);
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}
.dv-inbox {
  display: grid;
  gap: var(--space-2);
}
/* Projections table — same dialect as the broadcasters/media tables. */
.dv-projections {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.dv-table-wrap {
  flex: 1;
  min-height: 0;
  overflow: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}
.dv-table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--text-sm);
}
.dv-table th {
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
.dv-table td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--grid-line);
}
.dv-mono {
  font-family: var(--font-mono);
}
/* State reads through color: green synced, muted pending, warning drifted. */
.dv-state {
  font-size: var(--text-xs);
}
.st-synced {
  color: var(--state-validated);
}
.st-pending {
  color: var(--color-text-muted);
}
.st-drifted {
  color: var(--flag-warning);
}
.dv-empty {
  padding: var(--space-3);
  text-align: center;
}
</style>
