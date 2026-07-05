import { reactive } from "vue";

/**
 * Minimal toast channel for the grid's instant-edit model (docs/2 §8.4):
 * errors after an optimistic rollback, short confirmations otherwise.
 * Module-level state on purpose — no store ceremony for a message queue.
 */

export interface GridToast {
  id: number;
  kind: "error" | "info";
  message: string;
}

export const toasts = reactive<GridToast[]>([]);

let nextId = 1;

export function pushToast(kind: GridToast["kind"], message: string, ttlMs = 4000): void {
  const id = nextId++;
  toasts.push({ id, kind, message });
  setTimeout(() => dismissToast(id), ttlMs);
}

export function dismissToast(id: number): void {
  const index = toasts.findIndex((toast) => toast.id === id);
  if (index >= 0) toasts.splice(index, 1);
}
