<script setup lang="ts">
import type { Broadcaster, StationPush } from "@ondestudio/shared";

/**
 * One roster row. Split from the page for the 300-line budget, and because a
 * <tr> child must own its own td styling (the page's scoped selectors cannot
 * reach inside a child component).
 */
defineProps<{ broadcaster: Broadcaster; busy: boolean }>();
const emit = defineEmits<{ edit: []; rotate: []; remove: []; syncTest: [] }>();

const PUSH_MARK = { pushed: "✓", linked: "✓", blocked: "⊘", missing: "!" } as const;

function pushTitle(push: StationPush): string {
  switch (push.status) {
    case "pushed":
      return `${push.station}: pushed by OndeStudio (streamer ${push.ref})`;
    case "linked":
      return `${push.station}: linked to existing streamer ${push.ref}`;
    case "blocked":
      return `${push.station}: not written — production writes stay blocked until the per-feature adoption step (docs/2 §7.7)`;
    case "missing":
      return `${push.station}: no streamer there yet`;
  }
}
</script>

<template>
  <tr>
    <td class="col-user">{{ broadcaster.username }}</td>
    <td>{{ broadcaster.displayName }}</td>
    <td>
      <span class="kind-chip" :class="`kind--${broadcaster.kind}`">{{ broadcaster.kind }}</span>
    </td>
    <!-- Main-only semantics: the header cell carries the "main only" title. -->
    <td class="col-center">{{ broadcaster.enforceSchedule ? "✓" : "—" }}</td>
    <td class="col-center">
      {{ broadcaster.replayFlag === "not_specified" ? "—" : broadcaster.replayFlag }}
    </td>
    <td>
      <span class="station-cell">
        <template v-for="push in broadcaster.stations" :key="push.station">
          <span class="push-chip" :class="`push--${push.status}`" :title="pushTitle(push)">
            {{ push.station }} {{ PUSH_MARK[push.status] }}
          </span>
          <!-- sync-test is by definition a test-station repair, hence the literal slug. -->
          <button
            v-if="push.status === 'missing' && push.station === 'wz-test'"
            type="button"
            class="os-btn os-btn--ghost mini-btn"
            :disabled="busy"
            @click="emit('syncTest')"
          >
            create test mirror
          </button>
        </template>
      </span>
    </td>
    <td
      class="col-cred"
      :title="
        broadcaster.hasPassword
          ? 'OndeStudio manages this credential'
          : 'adopted from AzuraCast — rotate to take the credential over'
      "
    >
      {{ broadcaster.hasPassword ? "managed" : "unknown (adopted)" }}
    </td>
    <td class="col-actions">
      <button type="button" class="os-btn os-btn--ghost mini-btn" @click="emit('edit')">
        edit
      </button>
      <button
        type="button"
        class="os-btn os-btn--ghost mini-btn"
        :disabled="busy"
        @click="emit('rotate')"
      >
        rotate password
      </button>
      <button
        type="button"
        class="os-btn os-btn--danger mini-btn"
        :disabled="busy"
        @click="emit('remove')"
      >
        delete
      </button>
    </td>
  </tr>
</template>

<style scoped>
td {
  padding: var(--space-1) var(--space-2);
  border-bottom: 1px solid var(--grid-line-faint);
  vertical-align: baseline;
}

.col-user {
  font-family: var(--font-mono);
}
.col-center {
  text-align: center;
}
.col-cred {
  color: var(--color-text-muted);
  white-space: nowrap;
}
.col-actions {
  white-space: nowrap;
}

.station-cell {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
}

.kind-chip,
.push-chip {
  display: inline-flex;
  padding: 0 var(--space-2);
  border: 1px solid var(--color-border);
  border-radius: 999px;
  font-size: var(--text-xs);
  white-space: nowrap;
}
.kind--team {
  border-color: var(--color-accent);
  color: var(--color-accent);
}
.kind--external {
  color: var(--color-text-muted);
}

/* Push tones: green = it's there, muted = §7.7 holds it, warning = drift. */
.push--pushed,
.push--linked {
  border-color: var(--state-validated);
  color: var(--state-validated);
}
.push--blocked {
  color: var(--color-text-muted);
}
.push--missing {
  border-color: var(--flag-warning);
  color: var(--flag-warning);
}

.mini-btn {
  padding: 0 var(--space-2);
  font-size: var(--text-xs);
}
</style>
