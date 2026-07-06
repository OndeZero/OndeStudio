<script setup lang="ts">
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAuthStore } from "../../stores/auth";

/**
 * The session gate: everything except /login and /setup sits behind it (M2
 * decision, docs/2 §12). Errors render inline — a toast would outlive the
 * redirect.
 */
const auth = useAuthStore();
const router = useRouter();
const route = useRoute();

const email = ref("");
const password = ref("");
const error = ref<string | null>(null);
const submitting = ref(false);

/** Only same-origin paths may come out of ?next — a foreign URL is ignored. */
const nextPath = computed(() => {
  const next = route.query.next;
  return typeof next === "string" && next.startsWith("/") && !next.startsWith("//") ? next : "/";
});

async function submit(): Promise<void> {
  if (submitting.value) return;
  submitting.value = true;
  error.value = null;
  try {
    await auth.login(email.value.trim(), password.value);
    await router.push(nextPath.value);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause);
  } finally {
    submitting.value = false;
  }
}
</script>

<template>
  <div class="auth-wrap">
    <form class="os-surface auth-card" @submit.prevent="submit">
      <header class="os-dlg-head">
        <strong>Sign in</strong>
      </header>
      <label class="os-field">
        email
        <input v-model="email" type="email" autocomplete="email" required />
      </label>
      <label class="os-field">
        password
        <input v-model="password" type="password" autocomplete="current-password" required />
      </label>
      <p v-if="error" class="auth-error" role="alert">{{ error }}</p>
      <button
        type="submit"
        class="os-btn os-btn--primary auth-submit"
        :disabled="submitting || email === '' || password === ''"
      >
        {{ submitting ? "Signing in…" : "Sign in" }}
      </button>
      <p class="os-hint">
        Your OndeStudio account uses the email of your AzuraCast account. First time here? Ask an
        admin for a setup link.
      </p>
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
