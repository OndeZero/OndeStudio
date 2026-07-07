import { z } from "zod";

/**
 * Episode queue contract (PD §4.5, ADR-0013): files dropped in a show's folder
 * form a queue that auto-fills the show's upcoming empty occurrences. Phase-1
 * identity is the AzuraCast file id; the concrete media/fingerprint layer is
 * deferred until OndeStudio runs beside AzuraCast.
 */
export const EpisodeSchema = z.object({
  id: z.number().int(),
  azFileId: z.string(),
  path: z.string(),
  title: z.string(),
  artist: z.string().nullable(),
  durationSec: z.number().nullable(),
  arrivedAt: z.iso.datetime(),
  /** The occurrence this episode fills, if any (its `{slotId}_{epochMs}` id). */
  filledOccurrenceId: z.string().nullable(),
  /** When that occurrence airs (or aired) — for the queue's "→ Fri 6 Jul" hint. */
  filledOccurrenceAt: z.iso.datetime().nullable(),
});
export type Episode = z.infer<typeof EpisodeSchema>;

export const EpisodeQueueResponseSchema = z.object({
  showId: z.number().int(),
  dropFolderPath: z.string().nullable(),
  /** In queue order (arrival, manually reorderable). */
  episodes: z.array(EpisodeSchema),
});
export type EpisodeQueueResponse = z.infer<typeof EpisodeQueueResponseSchema>;

export const ReorderEpisodesInputSchema = z.object({
  orderedIds: z.array(z.number().int()).min(1),
});
export type ReorderEpisodesInput = z.infer<typeof ReorderEpisodesInputSchema>;

/** Result of rescanning a show's drop folder and filling occurrences. */
export const RescanResultSchema = z.object({
  scanned: z.number().int(),
  added: z.number().int(),
  removed: z.number().int(),
  filled: z.number().int(),
});
export type RescanResult = z.infer<typeof RescanResultSchema>;
