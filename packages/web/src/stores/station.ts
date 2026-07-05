import type { StationSlug } from "@ondestudio/shared";
import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * The station the whole UI is scoped to — every API resource is
 * station-scoped (docs/2 §6). The list is hardcoded for M0 because no
 * `stations` resource exists on the API yet; once it does, `available`
 * becomes API-driven and this store fetches it at startup.
 */
export const useStationStore = defineStore("station", () => {
  const available = ref<StationSlug[]>(["oz", "wz-test"]);
  const current = ref<StationSlug>("oz");
  return { available, current };
});
