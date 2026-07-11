import { z } from "zod";
import { SlotKindSchema } from "./scheduling-states";
import { StationSlugSchema } from "./station";

/**
 * One publicly-announceable item on the read seam (RFC 0003; docs/2 §6.4). It
 * carries OndeStudio's OS-native view — the slot kind, the generic title, the
 * episode announcement, and (for live slots) the broadcaster on air — but never
 * negotiation state, `prebooked` holds, or any team-only internals.
 */
export const PublicScheduleItemSchema = z.object({
  /** Stable occurrence id (`<slotId>_<originalStartMs>`), so a consumer can dedupe. */
  id: z.string(),
  kind: SlotKindSchema,
  /** The generic show/slot title — always safe to announce. */
  title: z.string(),
  /**
   * The episode-specific announcement (PD §5.5); null when the occurrence is
   * empty OR has already aired — reverted to the generic title server-side.
   */
  episodeTitle: z.string().nullable(),
  /** The live broadcaster on air (PD §5.10); null unless this is a live slot. */
  live: z.object({ streamerName: z.string().nullable() }).nullable(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  durationMin: z.number().int().positive(),
});
export type PublicScheduleItem = z.infer<typeof PublicScheduleItemSchema>;

/**
 * `GET /stations/{station}/schedule` — the public read seam OndePlayer's
 * Upcoming panel reads (RFC 0003, M5). Only announceable occurrences appear:
 * `validated` (with episode enrichment) and past-`aired` (reverted to generic).
 * The AzuraCast shapes and the team negotiation model never leak here (§6.4).
 */
export const PublicScheduleSchema = z.object({
  station: StationSlugSchema,
  /** When the server produced this view (UTC ISO). */
  generatedAt: z.iso.datetime(),
  items: z.array(PublicScheduleItemSchema),
});
export type PublicSchedule = z.infer<typeof PublicScheduleSchema>;
