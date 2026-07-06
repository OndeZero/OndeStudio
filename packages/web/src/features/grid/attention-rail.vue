<script setup lang="ts">
import { type Notification, type Occurrence, OccurrencesResponseSchema } from "@ondestudio/shared";
import { onMounted, onUnmounted, ref, watch } from "vue";
import { useRouter } from "vue-router";
import { apiGet } from "../../lib/api/client";
import { addDays, formatDayLabel, formatHm, isoDayOf, isoWeekdayOf } from "../../lib/station-time";
import { useNotificationsStore } from "../../stores/notifications";
import { useStationStore } from "../../stores/station";
import { useDriverStore } from "../driver/driver-store";
import { useGridStore } from "./grid-store";
import { ISSUE_FLAG_LETTERS } from "./grid-symbols";
import RailOnairLine from "./rail-onair-line.vue";
import { railOpen } from "./rail-state";

/**
 * PD §5.1 first cut: the grid docks a slim collapsible rail so the home
 * surface answers "what needs me" next to "what's the week" — unread
 * notifications, problem slots from the rail's own 7-day lookahead, one
 * on-air line.
 */
const notifications = useNotificationsStore();
const grid = useGridStore();
const stationStore = useStationStore();
const router = useRouter();

// The driver's open reconciliations belong on the "what needs me" surface: an
// unresolved AzuraCast edit blocks write-back (RFC 0001). The store polls and
// follows the grid SSE channel while the rail is mounted.
const driver = useDriverStore();
onMounted(() => {
  void driver.load();
  driver.start();
});
onUnmounted(() => driver.stop());

const DAY_MS = 86_400_000;

/** Validated-but-empty within 7 days, or flagged — from the rail's own window. */
const problems = ref<Occurrence[]>([]);
/** First fetch not landed yet — an honest placeholder instead of "all clear". */
const problemsLoaded = ref(false);
/** Monotonic id per fetch: a stale response must never paint the rail. */
let problemsEpoch = 0;

/*
 * "What needs me" must not depend on which week or toolbar filters the grid
 * currently shows, so the rail fetches its own unfiltered now..now+7d window
 * instead of deriving from grid.occurrences. Degraded tolerance: a failed
 * fetch keeps the last list; the next refresh signal retries.
 */
async function loadProblems(): Promise<void> {
  const myEpoch = ++problemsEpoch;
  const station = stationStore.current;
  const nowMs = Date.now();
  const horizonMs = nowMs + 7 * DAY_MS;
  const query = new URLSearchParams({
    from: new Date(nowMs).toISOString(),
    to: new Date(horizonMs).toISOString(),
  });
  try {
    const res = await apiGet(
      `/stations/${station}/occurrences?${query}`,
      OccurrencesResponseSchema,
    );
    if (myEpoch !== problemsEpoch || station !== stationStore.current) return;
    problems.value = res.occurrences
      .filter((o) => {
        const start = Date.parse(o.startsAt);
        const emptySoon =
          o.negotiationState === "validated" &&
          o.contentState === "empty" &&
          start >= nowMs &&
          start <= horizonMs;
        return emptySoon || o.issueFlags.length > 0;
      })
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    problemsLoaded.value = true;
  } catch {
    // Rail chrome is best-effort: keep the last list, never toast over the grid.
  }
}

// Refresh on mount, on station switch, and whenever the grid store lands new
// data — its SSE-driven refetch replaces the `occurrences` array, so watching
// the reference is a cheap "something on the schedule changed" signal without
// inheriting the grid's week or filters.
watch([() => stationStore.current, () => grid.occurrences], () => void loadProblems(), {
  immediate: true,
});

function problemWhen(o: Occurrence): string {
  const start = new Date(o.startsAt);
  return `${formatDayLabel(isoDayOf(start, grid.zone))} ${formatHm(start, grid.zone)}`;
}
function problemKind(o: Occurrence): string {
  if (o.issueFlags.length > 0)
    return o.issueFlags.map((flag) => `⚑${ISSUE_FLAG_LETTERS[flag]}`).join(" ");
  return "empty";
}

/** Jump the grid to that week — quick-edit needs an on-screen card position, so navigation is the honest first cut. */
function goToProblem(o: Occurrence): void {
  const day = isoDayOf(new Date(o.startsAt), grid.zone);
  void grid.setWeek(addDays(day, 1 - isoWeekdayOf(day)));
}

function openNotification(n: Notification): void {
  void notifications.markRead(n.id);
  // The inbox is global but every page is station-scoped: a cross-station
  // notification must retarget the app before its deep link resolves.
  if (n.station !== null && n.station !== stationStore.current) {
    stationStore.current = n.station;
  }
  if (n.cardId !== null) {
    void router.push(`/board/${n.cardId}`);
  } else if (n.anchor?.type === "show") {
    void router.push(`/shows/${n.anchor.id}`);
  } else {
    void router.push("/board");
  }
}
</script>

<template>
  <aside class="rail" :class="{ open: railOpen }" aria-label="Attention rail">
    <button
      type="button"
      class="rail-tab"
      :title="railOpen ? 'Collapse the attention rail' : 'Expand the attention rail'"
      @click="railOpen = !railOpen"
    >
      <span class="rail-tab-arrow">{{ railOpen ? "›" : "‹" }}</span>
      <span v-if="!railOpen && notifications.unreadCount > 0" class="rail-tab-count">
        {{ notifications.unreadCount }}
      </span>
    </button>

    <div v-if="railOpen" class="rail-body">
      <!-- Write-back conflicts lead: they block the driver until a human picks a side. -->
      <section v-if="driver.openReconciliationCount > 0" class="rail-section">
        <h3 class="rail-title">write-back</h3>
        <RouterLink to="/driver" class="rail-conflict">
          {{ driver.openReconciliationCount }} schedule
          conflict{{ driver.openReconciliationCount === 1 ? "" : "s" }}
          {{ driver.openReconciliationCount === 1 ? "needs" : "need" }} a decision →
        </RouterLink>
      </section>

      <section class="rail-section">
        <header class="rail-head">
          <h3 class="rail-title">needs you</h3>
          <button
            v-if="notifications.unread.length > 0"
            type="button"
            class="rail-clear"
            @click="notifications.markAllRead()"
          >
            clear all
          </button>
        </header>
        <p v-if="notifications.unread.length === 0" class="rail-empty">nothing waiting</p>
        <button
          v-for="n in notifications.unread"
          :key="n.id"
          type="button"
          class="rail-item"
          @click="openNotification(n)"
        >
          <span class="unread-dot" />
          <span class="rail-item-text">{{ n.message }}</span>
        </button>
      </section>

      <section class="rail-section">
        <h3 class="rail-title">problem slots</h3>
        <p v-if="!problemsLoaded" class="rail-empty">checking the next 7 days…</p>
        <p v-else-if="problems.length === 0" class="rail-empty">all clear for the next 7 days</p>
        <button
          v-for="o in problems"
          :key="o.id"
          type="button"
          class="rail-item"
          @click="goToProblem(o)"
        >
          <span class="problem-kind" :class="{ flagged: o.issueFlags.length > 0 }">
            {{ problemKind(o) }}
          </span>
          <span class="rail-item-text">{{ problemWhen(o) }} · {{ o.title }}</span>
        </button>
      </section>

      <section class="rail-section">
        <h3 class="rail-title">on air</h3>
        <RailOnairLine />
      </section>
    </div>
  </aside>
</template>

<style scoped>
.rail {
  display: flex;
  flex: none;
  min-height: 0;
}

/* The always-visible toggle: a thin vertical tab hugging the rail. */
.rail-tab {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-1);
  width: 1.1rem;
  padding: var(--space-2) 0;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: color var(--transition-fast);
}
.rail-tab:hover {
  color: var(--color-accent);
}
.rail-tab-count {
  padding: 0 1px;
  background: var(--color-accent);
  color: var(--color-bg);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.6rem;
  font-weight: 700;
}

.rail-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-3);
  width: 260px;
  padding: var(--space-2);
  overflow-y: auto;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-left: none;
  border-radius: 0 var(--radius-md) var(--radius-md) 0;
}

.rail-section {
  display: grid;
  gap: var(--space-1);
}

.rail-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.rail-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.rail-clear {
  padding: 0;
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  text-decoration: underline;
  cursor: pointer;
}

.rail-empty {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
}

/* Warning-toned, matching the grid's mirror notice — never the accent. */
.rail-conflict {
  display: block;
  padding: var(--space-1) var(--space-2);
  background: color-mix(in srgb, var(--flag-warning) 12%, transparent);
  border-left: 3px solid var(--flag-warning);
  border-radius: var(--radius-sm);
  color: var(--flag-warning);
  font-size: var(--text-xs);
  text-decoration: none;
}
.rail-conflict:hover {
  background: color-mix(in srgb, var(--flag-warning) 22%, transparent);
}

.rail-item {
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
  padding: var(--space-1);
  background: none;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
}
.rail-item:hover {
  background: var(--color-accent-soft);
}
.rail-item-text {
  overflow-wrap: anywhere;
}

.unread-dot {
  flex: none;
  width: 0.45rem;
  height: 0.45rem;
  background: var(--color-accent);
  border-radius: 50%;
}

.problem-kind {
  flex: none;
  color: var(--color-text-muted);
  font-family: var(--font-mono);
}
/* Flag badges stay warning-yellow — never the accent (docs/2 §8.4). */
.problem-kind.flagged {
  color: var(--flag-warning);
}

/* Small screens: the open rail overlays the grid instead of squeezing it. */
@media (max-width: 720px) {
  .rail.open .rail-body {
    position: fixed;
    top: 0;
    right: 0;
    bottom: 0;
    z-index: 55;
    width: min(280px, 85vw);
    border-radius: 0;
    box-shadow: 0 0 40px rgba(0, 0, 0, 0.45);
  }
}
</style>
