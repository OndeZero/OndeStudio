import { createRouter, createWebHistory } from "vue-router";

/**
 * All routes are lazy so a surface only ships when visited (docs/2 §8.6).
 * The M1 week grid is the home surface (PD §5.1); the M0 on-air panel
 * keeps its own page.
 */
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
  ],
});
