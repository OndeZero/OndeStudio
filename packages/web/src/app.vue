<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { railOpen } from "./features/grid/rail-state";
import { dismissToast, runToastAction, toasts } from "./features/grid/toast";
import QuickOpen from "./features/quick-open/quick-open.vue";
import { quickOpenOpen } from "./features/quick-open/quick-open-state";
import { useAuthStore } from "./stores/auth";
import { useNotificationsStore } from "./stores/notifications";
import { useStationStore } from "./stores/station";

/**
 * The shell: wordmark, main nav, notifications bell, station switcher and
 * session controls — plus the app-wide toast stack (moved out of the grid
 * at M2: board, shows and media reuse the same channel).
 */
const stationStore = useStationStore();
const auth = useAuthStore();
const notifications = useNotificationsStore();
const router = useRouter();
const route = useRoute();

/**
 * /self is the external-broadcaster realm (PD §5.6): a separate session in the
 * same SPA. It must never see team chrome — no wordmark-nav, no station
 * switcher, no team logout. So for /self we render *only* the router-view and
 * let the self-service page supply its own minimal header.
 */
const isSelf = computed(() => route.path.startsWith("/self"));

// Active-state matching is manual: /board/:id? style records make
// router-link-active unreliable for the bare link targets.
const NAV = [
  { to: "/", label: "Grid", match: /^\/$/ },
  { to: "/board", label: "Board", match: /^\/board/ },
  { to: "/shows", label: "Shows", match: /^\/shows/ },
  { to: "/broadcasters", label: "Broadcasters", match: /^\/broadcasters/ },
  { to: "/driver", label: "Driver", match: /^\/driver/ },
  { to: "/media", label: "Media", match: /^\/media/ },
  { to: "/onair", label: "On air", match: /^\/onair/ },
];

// The inbox lives while a session does; a station switch re-subscribes the
// board SSE stream to the new station.
watch(
  [() => auth.me?.id ?? null, () => stationStore.current],
  ([userId]) => {
    if (userId !== null) notifications.start();
    else notifications.stop();
  },
  { immediate: true },
);

// Cmd/Ctrl-K opens the quick-open palette from anywhere in the app (once
// signed in). The palette itself owns Escape/selection.
function onGlobalKeydown(event: KeyboardEvent): void {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    if (!auth.me) return;
    event.preventDefault();
    quickOpenOpen.value = !quickOpenOpen.value;
  }
}
onMounted(() => window.addEventListener("keydown", onGlobalKeydown));
onUnmounted(() => window.removeEventListener("keydown", onGlobalKeydown));

/** Bell: on the grid the rail IS the inbox — toggle it; elsewhere, go there. */
function onBellClick(): void {
  if (route.name === "grid") {
    railOpen.value = !railOpen.value;
  } else {
    railOpen.value = true;
    void router.push("/");
  }
}

async function onLogout(): Promise<void> {
  try {
    await auth.logout();
  } catch {
    // The cookie may already be dead — leaving locally is always right.
    auth.clearSession();
  }
  void router.push({ name: "login" });
}
</script>

<template>
  <!-- The external-broadcaster realm renders with none of the team shell. -->
  <router-view v-if="isSelf" />
  <div v-else class="shell">
    <header class="shell-header">
      <!-- Kept as one text run so the accessible name is exactly "OndeStudio". -->
      <h1 class="wordmark">Onde<span class="wordmark-accent">Studio</span></h1>
      <template v-if="auth.me">
        <nav class="shell-nav" aria-label="Main">
          <RouterLink
            v-for="item in NAV"
            :key="item.to"
            :to="item.to"
            :class="{ active: item.match.test(route.path) }"
          >
            {{ item.label }}
          </RouterLink>
        </nav>
        <div class="shell-side">
          <button
            type="button"
            class="quick-open-btn"
            title="Quick open (Cmd/Ctrl + K)"
            aria-label="Quick open"
            @click="quickOpenOpen = true"
          >
            <span class="qo-glyph">⌕</span>
            <kbd class="qo-kbd">⌘K</kbd>
          </button>
          <button
            type="button"
            class="bell"
            title="Notifications"
            aria-label="Notifications"
            @click="onBellClick"
          >
            ◉<span v-if="notifications.unreadCount > 0" class="bell-count">{{
              notifications.unreadCount
            }}</span>
          </button>
          <label class="station-switcher">
            <span class="station-switcher-label">station</span>
            <select v-model="stationStore.current" aria-label="Active station">
              <option v-for="slug in stationStore.available" :key="slug" :value="slug">
                {{ slug }}
              </option>
            </select>
          </label>
          <span class="whoami" :title="auth.me.email">{{ auth.me.displayName }}</span>
          <button type="button" class="os-btn os-btn--ghost logout-btn" @click="onLogout">
            log out
          </button>
        </div>
      </template>
    </header>
    <main class="shell-main">
      <router-view />
    </main>

    <div class="toast-stack" aria-live="polite">
      <div v-for="toast in toasts" :key="toast.id" class="toast" :class="`toast-${toast.kind}`">
        <span class="toast-message">{{ toast.message }}</span>
        <!-- Inline affordance, e.g. the grid's undo window (docs/2 §7.5). -->
        <button
          v-if="toast.action"
          type="button"
          class="toast-action"
          @click="runToastAction(toast.id)"
        >
          {{ toast.action.label }}
        </button>
        <button type="button" class="toast-dismiss" title="Dismiss" @click="dismissToast(toast.id)">
          ×
        </button>
      </div>
    </div>

    <QuickOpen v-if="auth.me" />
  </div>
</template>

<style scoped>
.shell-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2) var(--space-3);
  padding: var(--space-3) var(--space-4);
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
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
  /* The whole retrofuturist glow budget: one soft halo on the wordmark. */
  text-shadow: 0 0 14px var(--color-accent-soft);
}

.shell-nav {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-3);
}

.shell-nav a {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  text-decoration: none;
  transition: color var(--transition-fast);
}

.shell-nav a:hover {
  color: var(--color-text);
}

.shell-nav a.active {
  color: var(--color-accent);
}

.shell-side {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-2);
}

/* Quick-open trigger: a search glyph plus the shortcut hint (⌘K). */
.quick-open-btn {
  display: inline-flex;
  align-items: center;
  gap: var(--space-1);
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-muted);
  cursor: pointer;
  transition: border-color var(--transition-fast);
}
.quick-open-btn:hover {
  border-color: var(--color-accent);
  color: var(--color-text);
}
.qo-glyph {
  font-size: var(--text-md);
  line-height: 1;
}
.qo-kbd {
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.bell {
  position: relative;
  padding: var(--space-1) var(--space-2);
  background: none;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-md);
  cursor: pointer;
  transition: color var(--transition-fast);
}
.bell:hover {
  color: var(--color-text);
}
.bell-count {
  position: absolute;
  top: -2px;
  right: -4px;
  min-width: 1.1rem;
  padding: 0 3px;
  background: var(--color-accent);
  /* bg token doubles as contrast color, same trick as the LIVE badge. */
  color: var(--color-bg);
  border-radius: 999px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  font-weight: 700;
  text-align: center;
  line-height: 1.4;
}

.station-switcher {
  display: flex;
  align-items: center;
  gap: var(--space-2);
}

.station-switcher-label {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.station-switcher select {
  padding: var(--space-1) var(--space-2);
  background: var(--color-surface-raised);
  color: var(--color-text);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  transition: border-color var(--transition-fast);
}

.station-switcher select:hover {
  border-color: var(--color-accent);
}

.whoami {
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.logout-btn {
  font-size: var(--text-xs);
}

/* The shell owns the viewport; pages decide their own scrolling. The grid
   needs full width and an internal scroll container (docs/2 §8.4), so the
   old max-width moved into the pages that want a narrow column. */
.shell {
  display: flex;
  flex-direction: column;
  height: 100dvh;
}

.shell-main {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  overflow: auto;
}

/* App-wide toast channel (features/grid/toast.ts) — errors after optimistic
   rollbacks, short confirmations otherwise. */
.toast-stack {
  position: fixed;
  bottom: var(--space-4);
  left: 50%;
  z-index: 80;
  display: grid;
  gap: var(--space-2);
  transform: translateX(-50%);
  width: min(28rem, 92vw);
}

.toast {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-2);
  padding: var(--space-2) var(--space-3);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.35);
  font-size: var(--text-sm);
}
.toast-error {
  border-left: 3px solid var(--color-danger);
}
.toast-info {
  border-left: 3px solid var(--color-accent);
}
.toast-message {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
/* Small inline action (Undo): accent-bordered, distinct from the × dismiss. */
.toast-action {
  flex: none;
  padding: 1px var(--space-2);
  background: var(--color-accent-soft);
  border: 1px solid var(--color-accent);
  border-radius: var(--radius-sm);
  color: var(--color-accent);
  font-size: var(--text-xs);
  font-weight: 600;
  cursor: pointer;
}
.toast-dismiss {
  padding: 0 var(--space-1);
  background: none;
  border: none;
  color: inherit;
  font-size: var(--text-md);
  cursor: pointer;
}
</style>
