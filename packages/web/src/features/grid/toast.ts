import { reactive } from "vue";

/**
 * Minimal toast channel for the grid's instant-edit model (docs/2 §8.4):
 * errors after an optimistic rollback, short confirmations otherwise.
 * Module-level state on purpose — no store ceremony for a message queue.
 */

/**
 * An optional one-click affordance on a toast — the grid's undo window
 * (docs/2 §7.5) rides on this: "Edit applied · Undo". `run` reverts the edit;
 * the toast dismisses itself once it fires.
 */
export interface ToastAction {
  label: string;
  run: () => void;
}

export interface GridToast {
  id: number;
  kind: "error" | "info";
  message: string;
  action?: ToastAction;
}

export const toasts = reactive<GridToast[]>([]);

let nextId = 1;

export function pushToast(
  kind: GridToast["kind"],
  message: string,
  ttlMs = 4000,
  action?: ToastAction,
): void {
  const id = nextId++;
  toasts.push({ id, kind, message, action });
  setTimeout(() => dismissToast(id), ttlMs);
}

/**
 * Fire a toast's action then clear it — the button did its job, so leaving the
 * toast up would invite a confusing second click. Kept here (not in the view)
 * so the action wiring is unit-testable without mounting the shell.
 */
export function runToastAction(id: number): void {
  const toast = toasts.find((t) => t.id === id);
  toast?.action?.run();
  dismissToast(id);
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
