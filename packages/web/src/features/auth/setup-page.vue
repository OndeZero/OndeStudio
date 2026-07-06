<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";

/**
 * Completing an admin-issued setup link (?token=…): AzuraCast passwords are
 * unreadable, so the first OndeStudio password is set here (shared auth.ts);
 * a successful setup also signs the session in.
 */
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const token = computed(() => (typeof route.query.token === "string" ? route.query.token : ""));
const password = ref("");
const confirm = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);

const mismatch = computed(() => confirm.value !== "" && confirm.value !== password.value);
const ready = computed(
  () => token.value.length >= 16 && password.value.length >= 10 && confirm.value === password.value,
);

async function submit(): Promise<void> {
  if (!ready.value || submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    await auth.setup(token.value, password.value);
    await router.push("/");
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <div v-if="token === ''" class="os-surface auth-card">
      <strong>Missing setup token</strong>
      <p class="os-hint">
        This page only works through the one-time link an admin issued you — the ?token part of
        the URL is required. Ask for a fresh link if yours expired.
      </p>
    </div>
    <form v-else class="os-surface auth-card" @submit.prevent="submit">
      <header class="os-dlg-head">
        <strong>Choose your password</strong>
      </header>
      <label class="os-field">
        password <span class="os-hint">(at least 10 characters)</span>
        <input v-model="password" type="password" autocomplete="new-password" required />
      </label>
      <label class="os-field">
        confirm password
        <input v-model="confirm" type="password" autocomplete="new-password" required />
      </label>
      <p v-if="mismatch" class="auth-error" role="alert">The two passwords differ.</p>
      <p v-else-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button type="submit" class="os-btn os-btn--primary auth-submit" :disabled="!ready || submitting">
        {{ submitting ? "Setting up…" : "Set password & sign in" }}
      </button>
    </form>
  </div>
</template>

<style scoped>
.auth-wrap {
  display: grid;
  flex: 1;
  place-items: center;
  padding: var(--space-4);
}

.auth-card {
  width: min(22rem, 94vw);
}

.auth-error {
  margin: 0;
  color: var(--color-danger);
  font-size: var(--text-sm);
  overflow-wrap: anywhere;
}

.auth-submit {
  justify-self: start;
}
</style>
