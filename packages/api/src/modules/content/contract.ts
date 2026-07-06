import type { MediaEntry } from "@ondestudio/shared";
import type { BrowseEntry } from "./service";

/** Domain → wire contract, the "map out" step (docs/2 §3.2). */
export function browseEntryToContract(entry: BrowseEntry): MediaEntry {
  return {
    path: entry.path,
    name: entry.name,
    kind: entry.kind,
    // The phase-1 upstream subset carries no size — the field waits for the M2+ UI needs.
    sizeBytes: null,
    durationSec: entry.file?.durationSec ?? null,
    title: entry.file?.title ?? null,
    artist: entry.file?.artist ?? null,
    ownerShow: entry.owner ? { id: entry.owner.showId, name: entry.owner.name } : null,
    childCount: entry.childCount,
  };
}
