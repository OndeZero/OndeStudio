import {
  type Broadcaster,
  type BroadcasterImportResult,
  BroadcasterImportResultSchema,
  BroadcastersResponseSchema,
  type BroadcasterWithSecret,
  BroadcasterWithSecretSchema,
  type CreateBroadcasterInput,
  type StationSlug,
  type UpdateBroadcasterInput,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { ref } from "vue";
import { z } from "zod";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { pushToast } from "../grid/toast";

/** DELETE answers with nothing but its caveats — no shared schema exists for it. */
const DeleteResultSchema = z.object({ warnings: z.array(z.string()) });

/**
 * Centralized broadcaster accounts (PD §5.10, docs/2 §11 M4): ONE definition
 * fans out to both AzuraCast stations, replacing the manual main/test
 * double-edit. Root-level on purpose — a broadcaster IS the main+test pair,
 * so unlike every other store nothing here is station-scoped and the station
 * switcher never triggers a reload.
 */
export const useBroadcastersStore = defineStore("broadcasters", () => {
  const broadcasters = ref<Broadcaster[]>([]);
  /** Stations OndeStudio may push to today — wz-test only until the §7.7 adoption step. */
  const writeStations = ref<StationSlug[]>([]);
  const loading = ref(false);

  /** Monotonic id per fetch: a stale response must never paint the page. */
  let epoch = 0;

  async function load(): Promise<void> {
    const myEpoch = ++epoch;
    loading.value = true;
    try {
      const res = await apiGet("/broadcasters", BroadcastersResponseSchema);
      if (myEpoch !== epoch) return;
      // Own copies: later splices must never mutate the response object.
      broadcasters.value = [...res.broadcasters];
      writeStations.value = [...res.writeStations];
    } catch (cause) {
      if (myEpoch === epoch) pushToast("error", messageOf(cause));
    } finally {
      if (myEpoch === epoch) loading.value = false;
    }
  }

  function replaceBroadcaster(next: Broadcaster): void {
    const index = broadcasters.value.findIndex((b) => b.id === next.id);
    if (index >= 0) broadcasters.value.splice(index, 1, next);
    else broadcasters.value.push(next);
  }

  /**
   * Warnings are partial-success caveats ("oz: not pushed — writes blocked,
   * docs/2 §7.7"), not failures: info toasts, held longer than a plain
   * confirmation because they are the only sign the fan-out was incomplete.
   * When a secret banner is up it lists them too; the toast covers the
   * mutations that return no secret.
   */
  function surfaceWarnings(warnings: string[]): void {
    for (const warning of warnings) pushToast("info", warning, 8000);
  }

  /**
   * Every single-broadcaster write shares one response shape: the updated
   * broadcaster, its caveats, and possibly a ONE-TIME secret. The full result
   * is returned (not just a boolean) so the page can hold the secret in a
   * banner that outlives any toast.
   */
  async function mutateOne(
    method: "POST" | "PUT",
    path: string,
    body?: unknown,
  ): Promise<BroadcasterWithSecret | null> {
    try {
      const res = await apiMutate(method, path, body, BroadcasterWithSecretSchema);
      replaceBroadcaster(res.broadcaster);
      surfaceWarnings(res.warnings);
      return res;
    } catch (cause) {
      // Expected 409s arrive here too (duplicate username on create, already
      // linked on sync-test) — the envelope message names the conflict.
      pushToast("error", messageOf(cause));
      return null;
    }
  }

  function create(input: CreateBroadcasterInput): Promise<BroadcasterWithSecret | null> {
    return mutateOne("POST", "/broadcasters", input);
  }

  function update(
    id: number,
    patch: UpdateBroadcasterInput,
  ): Promise<BroadcasterWithSecret | null> {
    return mutateOne("PUT", `/broadcasters/${id}`, patch);
  }

  /** Push the missing wz-test mirror for one adopted/drifted broadcaster. */
  function syncTest(id: number): Promise<BroadcasterWithSecret | null> {
    return mutateOne("POST", `/broadcasters/${id}/sync-test`);
  }

  /** New generated password on every linked station; the old one dies with it. */
  function rotate(id: number): Promise<BroadcasterWithSecret | null> {
    return mutateOne("POST", `/broadcasters/${id}/rotate-password`);
  }

  async function remove(id: number): Promise<boolean> {
    try {
      const res = await apiMutate("DELETE", `/broadcasters/${id}`, undefined, DeleteResultSchema);
      broadcasters.value = broadcasters.value.filter((b) => b.id !== id);
      surfaceWarnings(res.warnings);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  /**
   * Adopt the existing AzuraCast streamers (docs/2 §7.6). The result is
   * returned for the page to show the main/test drift inline; the roster is
   * refetched because import changes the whole set server-side.
   */
  async function importExisting(): Promise<BroadcasterImportResult | null> {
    try {
      const res = await apiMutate(
        "POST",
        "/broadcasters/import",
        undefined,
        BroadcasterImportResultSchema,
      );
      await load();
      return res;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return null;
    }
  }

  return {
    broadcasters,
    writeStations,
    loading,
    load,
    create,
    update,
    remove,
    importExisting,
    syncTest,
    rotate,
  };
});

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
