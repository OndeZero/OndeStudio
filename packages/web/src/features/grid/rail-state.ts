import { ref } from "vue";

/**
 * The attention rail's open/collapsed state — module-level like toast.ts so
 * the header bell (app.vue) and the grid page share it without store
 * ceremony. Starts collapsed on narrow screens (PD §5.1: slim, collapsible;
 * the grid keeps its full width where space is scarce).
 */
export const railOpen = ref(typeof window !== "undefined" && window.innerWidth > 1000);
