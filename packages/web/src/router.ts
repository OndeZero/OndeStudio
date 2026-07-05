import { createRouter, createWebHistory } from "vue-router";

/**
 * All routes are lazy so a surface only ships when visited (docs/2 §8.6).
 * "/" lands on the on-air panel as a placeholder home until the M1 week grid
 * arrives — the grid becomes the real home surface then (docs/2 §8.2, §11).
 */
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: "/",
      name: "onair",
      component: () => import("./features/onair/on-air-page.vue"),
    },
  ],
});
