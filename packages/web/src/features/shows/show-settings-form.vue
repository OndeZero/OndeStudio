<script setup lang="ts">
import {
  FALLBACK_POLICIES,
  REPLAY_FLAGS,
  type ShowDetail,
  type UpdateShowInput,
} from "@ondestudio/shared";
import { computed, ref, watch } from "vue";
import { formatHm } from "../../lib/station-time";
import { useShowsStore } from "./shows-store";

/**
 * Per-show settings (PD §4.5): every control saves on change — the
 * 30-second-fix stance, same as quick-edit. Drafts sync from the server
 * response, so a failed save snaps back to the truth (the store reloads).
 */
const props = defineProps<{ detail: ShowDetail }>();
const store = useShowsStore();

const fallbackPolicy = ref(props.detail.fallbackPolicy);
const trustAutoAir = ref(props.detail.trustAutoAir);
const replayFlag = ref(props.detail.replayFlag);
const contributorTz = ref(props.detail.contributorTz ?? "");
const dropFolderPath = ref(props.detail.dropFolderPath ?? "");

watch(
  () => props.detail,
  (d) => {
    fallbackPolicy.value = d.fallbackPolicy;
    trustAutoAir.value = d.trustAutoAir;
    replayFlag.value = d.replayFlag;
    contributorTz.value = d.contributorTz ?? "";
    dropFolderPath.value = d.dropFolderPath ?? "";
  },
);

function save(patch: UpdateShowInput): void {
  void store.updateShow(props.detail.id, patch);
}

function saveTz(): void {
  const zone = contributorTz.value.trim();
  save({ contributorTz: zone === "" ? null : zone });
}
function saveDropFolder(): void {
  const path = dropFolderPath.value.trim();
  save({ dropFolderPath: path === "" ? null : path });
}

/** PD §8.1 timezone helper: the contributor's current wall time, when the zone is valid. */
const contributorNow = computed(() => {
  const zone = contributorTz.value.trim();
  if (zone === "") return null;
  try {
    return formatHm(new Date(), zone);
  } catch {
    return null; // not (yet) a valid IANA zone — the hint just stays generic
  }
});
</script>

<template>
  <section class="settings">
    <h3 class="section-title">settings</h3>
    <div class="settings-grid">
      <label class="os-field">
        fallback policy
        <select v-model="fallbackPolicy" @change="save({ fallbackPolicy })">
          <option v-for="policy in FALLBACK_POLICIES" :key="policy" :value="policy">
            {{ policy.replace("_", " ") }}
          </option>
        </select>
      </label>

      <label class="os-field">
        replay flag
        <select v-model="replayFlag" @change="save({ replayFlag })">
          <option v-for="flag in REPLAY_FLAGS" :key="flag" :value="flag">
            {{ flag.replace("_", " ") }}
          </option>
        </select>
      </label>

      <label class="os-check trust-check">
        <input v-model="trustAutoAir" type="checkbox" @change="save({ trustAutoAir })" />
        trust auto-air
        <span class="os-hint">(received content airs without review)</span>
      </label>

      <label class="os-field">
        contributor timezone
        <input
          v-model="contributorTz"
          type="text"
          placeholder="e.g. America/Santiago"
          @change="saveTz"
        />
        <span class="os-hint">
          IANA zone for translated-time helpers{{
            contributorNow ? ` — ${contributorNow} there right now` : ""
          }}
        </span>
      </label>

      <label class="os-field drop-field">
        drop folder
        <input
          v-model="dropFolderPath"
          type="text"
          placeholder="e.g. shows/minuit-decousu"
          @change="saveDropFolder"
        />
        <RouterLink
          v-if="detail.dropFolderPath"
          class="lens-link"
          :to="{ path: '/media', query: { path: detail.dropFolderPath } }"
        >
          open in media browser →
        </RouterLink>
      </label>
    </div>
  </section>
</template>

<style scoped>
.settings {
  display: grid;
  gap: var(--space-2);
}

.section-title {
  margin: 0;
  color: var(--color-text-muted);
  font-size: var(--text-xs);
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(14rem, 1fr));
  gap: var(--space-3);
  padding: var(--space-3);
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
}

.trust-check {
  align-self: end;
  flex-wrap: wrap;
}

.drop-field {
  grid-column: 1 / -1;
}

.lens-link {
  justify-self: start;
  color: var(--color-accent);
  font-size: var(--text-xs);
  text-decoration: none;
}
.lens-link:hover {
  text-decoration: underline;
}
</style>
