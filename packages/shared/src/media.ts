import { z } from "zod";
import { StationSlugSchema } from "./station";

/**
 * Media browser contract (PD §5.3, phase-1 substrate §4.11): the canonical
 * filetree read through the playout system's files API — browse, identify,
 * link to owners. No writes in phase 1 (intake stays SFTP / AzuraCast UI).
 */
export const MediaEntrySchema = z.object({
  /** Path relative to the station media root; directories end without slash. */
  path: z.string(),
  name: z.string(),
  kind: z.enum(["dir", "file"]),
  /** File-only fields. */
  sizeBytes: z.number().int().nullable(),
  durationSec: z.number().nullable(),
  title: z.string().nullable(),
  artist: z.string().nullable(),
  /** Ownership badge (PD §5.4): the show whose drop folder contains this entry. */
  ownerShow: z.object({ id: z.number().int(), name: z.string() }).nullable(),
  /** Direct children count for directories (files + subdirs). */
  childCount: z.number().int().nullable(),
});
export type MediaEntry = z.infer<typeof MediaEntrySchema>;

export const MediaBrowseResponseSchema = z.object({
  station: StationSlugSchema,
  /** The browsed directory ("" = media root). */
  path: z.string(),
  entries: z.array(MediaEntrySchema),
});
export type MediaBrowseResponse = z.infer<typeof MediaBrowseResponseSchema>;
