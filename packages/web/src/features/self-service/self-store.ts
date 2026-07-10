import {
  ApiErrorSchema,
  type SelfLoginInput,
  type SelfProfile,
  SelfProfileSchema,
  type SelfProposeInput,
  SelfSlotsResponseSchema,
  type Slot,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { ref } from "vue";

/**
 * The external-broadcaster self-service session (PD §5.6) — a realm entirely
 * apart from the team app. It never touches lib/api/client: that layer treats
 * a 401 as an expired *team* session and redirects to /login, which would rip
 * a guest out of /self. So this store speaks to /self/* with a plain fetch,
 * carries its own `os_bc_session` cookie (same-origin, sent automatically),
 * and treats a 401 as "not signed in here" — the page shows the login form.
 * Responses are still validated against the shared Zod schemas.
 */
const API_BASE = "/api/v1";

async function readErrorMessage(res: Response, fallback: string): Promise<string> {
  try {
    const parsed = ApiErrorSchema.safeParse(await res.json());
    if (parsed.success) return parsed.data.error;
  } catch {
    // Non-JSON body (proxy page, empty body…) — fall through to the fallback.
  }
  return res.statusText || fallback;
}

export const useSelfStore = defineStore("self", () => {
  const profile = ref<SelfProfile | null>(null);
  const slots = ref<Slot[]>([]);
  /** IANA zone the slot wall-clock times are read in (from /self/slots). */
  const zone = ref("");
  /** True once the startup /self/me probe has answered (200 or 401). */
  const checked = ref(false);
  const loading = ref(false);
  const error = ref<string | null>(null);

  /**
   * Startup probe. 200 → we have a session (load the slots too); 401 → simply
   * not signed in, leave the profile null. Never throws: the router must not
   * see an exception from an anonymous /self visit.
   */
  async function probe(): Promise<void> {
    try {
      const res = await fetch(`${API_BASE}/self/me`, {
        headers: { Accept: "application/json" },
        credentials: "same-origin",
      });
      if (!res.ok) {
        // 401 is the expected "no guest session" answer; any other failure is
        // likewise handled by showing the login form.
        profile.value = null;
        return;
      }
      const parsed = SelfProfileSchema.safeParse(await res.json());
      profile.value = parsed.success ? parsed.data : null;
      if (parsed.success) await loadSlots();
    } catch {
      // Transport failure reads the same as "not signed in here".
      profile.value = null;
    } finally {
      checked.value = true;
    }
  }

  /**
   * Sign in with the broadcaster's Icecast credentials. 422 is bad creds —
   * surfaced inline to the form. Returns true on success so the caller can
   * clear the password field.
   */
  async function login(username: string, password: string): Promise<boolean> {
    loading.value = true;
    error.value = null;
    try {
      const body: SelfLoginInput = { username, password };
      const res = await fetch(`${API_BASE}/self/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        error.value = await readErrorMessage(
          res,
          res.status === 422 ? "Wrong username or password." : `Sign-in failed (${res.status}).`,
        );
        return false;
      }
      const parsed = SelfProfileSchema.safeParse(await res.json());
      if (!parsed.success) {
        error.value = "Unexpected response from the server.";
        return false;
      }
      profile.value = parsed.data;
      checked.value = true;
      await loadSlots();
      return true;
    } catch {
      error.value = "Could not reach the server. Please try again.";
      return false;
    } finally {
      loading.value = false;
    }
  }

  /** Fetch the broadcaster's own slots + the station zone. */
  async function loadSlots(): Promise<void> {
    const res = await fetch(`${API_BASE}/self/slots`, {
      headers: { Accept: "application/json" },
      credentials: "same-origin",
    });
    if (!res.ok) return;
    const parsed = SelfSlotsResponseSchema.safeParse(await res.json());
    if (parsed.success) {
      slots.value = parsed.data.slots;
      zone.value = parsed.data.zone;
    }
  }

  /**
   * Propose a live slot. The server decides the birth state from the session
   * (team auto-validated, external a hold for the team). On success the slots
   * list refreshes so the new proposal appears.
   */
  async function propose(input: SelfProposeInput): Promise<boolean> {
    error.value = null;
    try {
      const res = await fetch(`${API_BASE}/self/slots/propose`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        error.value = await readErrorMessage(res, "Could not propose that time.");
        return false;
      }
      await loadSlots();
      return true;
    } catch {
      error.value = "Could not reach the server. Please try again.";
      return false;
    }
  }

  /** Provision (or clear) a slot's now-playing metadata, then refresh the list. */
  async function updateMeta(slotId: number, meta: string | null): Promise<boolean> {
    error.value = null;
    try {
      const res = await fetch(`${API_BASE}/self/slots/${slotId}/meta`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ meta }),
      });
      if (!res.ok) {
        error.value = await readErrorMessage(res, "Could not save the metadata.");
        return false;
      }
      await loadSlots();
      return true;
    } catch {
      error.value = "Could not reach the server. Please try again.";
      return false;
    }
  }

  /** End the guest session. Clearing locally is always right, so ignore errors. */
  async function logout(): Promise<void> {
    try {
      await fetch(`${API_BASE}/self/logout`, { method: "POST", credentials: "same-origin" });
    } catch {
      // Cookie may already be dead — local clear below is the source of truth.
    }
    profile.value = null;
    slots.value = [];
    zone.value = "";
    error.value = null;
  }

  return {
    profile,
    slots,
    zone,
    checked,
    loading,
    error,
    probe,
    login,
    loadSlots,
    propose,
    updateMeta,
    logout,
  };
});
