import { createRouter, createWebHistory } from "vue-router";
import { UNAUTHENTICATED_EVENT } from "./lib/api/unauthenticated";
import { useAuthStore } from "./stores/auth";

/**
 * All routes are lazy so a surface only ships when visited (docs/2 §8.6).
 * M2 decision: everything sits behind login except the two auth surfaces —
 * one consistent rule instead of per-page judgement (even /onair, whose
 * occurrence fetches are gated anyway).
 */
const PUBLIC_ROUTES = new Set(["login", "setup"]);

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "grid",
      component: () => import("./features/grid/grid-page.vue"),
    },
    {
      path: "/onair",
      name: "onair",
      component: () => import("./features/onair/on-air-page.vue"),
    },
    {
      // The optional :id opens the card drawer over the board — route-driven
      // so rail notifications and show pages can deep-link a thread.
      path: "/board/:id?",
      name: "board",
      component: () => import("./features/board/board-page.vue"),
    },
    {
      // Master-detail: /shows/:id keeps the show page URL-addressable (PD §5.4).
      path: "/shows/:id?",
      name: "shows",
      component: () => import("./features/shows/shows-page.vue"),
    },
    {
      // Root-level on purpose: a broadcaster IS the main+test pair (PD §5.10),
      // so unlike the other surfaces this page is not station-scoped.
      path: "/broadcasters",
      name: "broadcasters",
      component: () => import("./features/broadcasters/broadcasters-page.vue"),
    },
    {
      // Root-level like broadcasters: the write-back driver spans every write
      // station (docs/2 §7.7), it is not scoped to the active grid station.
      path: "/driver",
      name: "driver",
      component: () => import("./features/driver/driver-page.vue"),
    },
    {
      path: "/media",
      name: "media",
      component: () => import("./features/media/media-page.vue"),
    },
    {
      path: "/login",
      name: "login",
      component: () => import("./features/auth/login-page.vue"),
    },
    {
      path: "/setup",
      name: "setup",
      component: () => import("./features/auth/setup-page.vue"),
    },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuthStore();
  // One startup probe; afterwards the session lives in the store and the
  // 401 event below handles expiry — no per-navigation round trip.
  if (!auth.loaded) await auth.loadMe();
  if (!PUBLIC_ROUTES.has(String(to.name)) && auth.me === null) {
    return { name: "login", query: { next: to.fullPath } };
  }
  if (to.name === "login" && auth.me !== null) return { path: "/" };
  return true;
});

// The HTTP layer announces expired sessions as a window event (lib/ must not
// know the router). Only a *lost* session matters: the startup probe's own
// 401 (me still null) is the guard's business, not a redirect race.
window.addEventListener(UNAUTHENTICATED_EVENT, () => {
  const auth = useAuthStore();
  if (auth.me === null) return;
  auth.clearSession();
  const current = router.currentRoute.value;
  if (PUBLIC_ROUTES.has(String(current.name))) return;
  void router.push({ name: "login", query: { next: current.fullPath } });
});
