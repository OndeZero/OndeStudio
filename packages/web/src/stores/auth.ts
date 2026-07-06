import {
  type LoginInput,
  type Me,
  MeSchema,
  type SetupInput,
  UsersResponseSchema,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { apiGet } from "../lib/api/client";
import { apiMutate } from "../lib/api/mutate";

/**
 * The session (docs/2 §12): cookie-based, so the only client state is "who
 * am I" — probed once at startup, updated by login/setup/logout. The
 * mutations rethrow on failure on purpose: the auth pages show the reason
 * inline instead of a toast.
 */
export const useAuthStore = defineStore("auth", () => {
  const me = ref<Me | null>(null);
  /** True once the startup probe answered — the router guard awaits this. */
  const loaded = ref(false);
  /** Team roster for assignee pickers (GET /users) — fetched on demand, once. */
  const users = ref<Me[]>([]);

  async function loadMe(): Promise<void> {
    try {
      me.value = await apiGet("/auth/me", MeSchema);
    } catch {
      // A 401 (no session) and a transport failure both mean "not signed in
      // here": the login page is the recovery path either way.
      me.value = null;
    } finally {
      loaded.value = true;
    }
  }

  async function login(email: string, password: string): Promise<void> {
    const input: LoginInput = { email, password };
    me.value = await apiMutate("POST", "/auth/login", input, MeSchema);
    loaded.value = true;
  }

  /** Completing an admin-issued setup link — also signs the session in. */
  async function setup(token: string, password: string): Promise<void> {
    const input: SetupInput = { token, password };
    me.value = await apiMutate("POST", "/auth/setup", input, MeSchema);
    loaded.value = true;
  }

  async function logout(): Promise<void> {
    await apiMutate("POST", "/auth/logout");
    clearSession();
  }

  /** Also invoked by the shell when any request answers 401 (session expired). */
  function clearSession(): void {
    me.value = null;
    users.value = [];
  }

  async function loadUsers(): Promise<void> {
    if (users.value.length > 0) return;
    users.value = (await apiGet("/users", UsersResponseSchema)).users;
  }

  return { me, loaded, users, loadMe, login, setup, logout, clearSession, loadUsers };
});
