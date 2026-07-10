import { z } from "zod";
import {
  ContentStateSchema,
  IssueFlagSchema,
  NegotiationStateSchema,
  SlotKindSchema,
} from "./scheduling-states";
import { StationSlugSchema } from "./station";

/**
 * Scheduling contract (docs/2 §6.2): slots are recurrence definitions, the
 * grid materializes individually addressable occurrences (docs/2 §5.3).
 * Slot times are wall-clock in the station timezone (docs/2 §5.4).
 */

const WALL_TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const WALL_DATETIME = /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/;

export const RecurrenceSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("weekly"),
    /** ISO weekdays, 1 = Monday … 7 = Sunday. */
    weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
    /** Station-timezone wall time, e.g. "22:00" — stays 22:00 across DST. */
    time: z.string().regex(WALL_TIME),
  }),
  z.object({
    type: z.literal("once"),
    /** Station-timezone wall datetime, e.g. "2026-07-10T21:00". */
    startsAtWall: z.string().regex(WALL_DATETIME),
  }),
]);
export type Recurrence = z.infer<typeof RecurrenceSchema>;

export const SlotSchema = z.object({
  id: z.number().int(),
  station: StationSlugSchema,
  kind: SlotKindSchema,
  /** Display label; falls back to the bound show's name. */
  title: z.string().nullable(),
  showId: z.number().int().nullable(),
  showName: z.string().nullable(),
  recurrence: RecurrenceSchema,
  durationMin: z.number().int().positive(),
  negotiationDefault: NegotiationStateSchema,
  /** The broadcaster who goes live here (PD §5.10); live slots only, else null. */
  broadcasterId: z.number().int().nullable(),
  /** Now-playing metadata the broadcaster provisions for this slot (PD §5.6); null if unset. */
  meta: z.string().nullable(),
});
export type Slot = z.infer<typeof SlotSchema>;

/**
 * Occurrence identity is `{slotId}_{originalStartEpochMs}` — stable whether or
 * not an exception row exists yet (sparse materialization, docs/2 §5.3).
 */
export const OccurrenceIdSchema = z.string().regex(/^\d+_\d+$/);

export const OccurrenceSchema = z.object({
  id: OccurrenceIdSchema,
  slotId: z.number().int(),
  station: StationSlugSchema,
  kind: SlotKindSchema,
  title: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  durationMin: z.number().int().positive(),
  /** The computed series time this occurrence overrides (equals startsAt when unmoved). */
  originalStartsAt: z.iso.datetime(),
  moved: z.boolean(),
  negotiationState: NegotiationStateSchema,
  contentState: ContentStateSchema,
  issueFlags: z.array(IssueFlagSchema),
  /** Actual content length once known — drives the inner fill (docs/2 §8.4). */
  contentDurationMin: z.number().int().positive().nullable(),
  /** Title of the episode airing here (PD §4.5); null when the occurrence is empty. */
  episodeTitle: z.string().nullable(),
  /** The live broadcaster bound to this slot (PD §5.10); null unless a live slot. */
  broadcasterId: z.number().int().nullable(),
});
export type Occurrence = z.infer<typeof OccurrenceSchema>;

export const OccurrencesResponseSchema = z.object({
  station: StationSlugSchema,
  /** IANA zone all wall-clock inputs are interpreted in (server-referenced, PD §8.1). */
  zone: z.string(),
  occurrences: z.array(OccurrenceSchema),
});
export type OccurrencesResponse = z.infer<typeof OccurrencesResponseSchema>;

/** Read-only reality mirrored from the playout system (Increment 1, docs/2 §2.5). */
export const MirrorBlockSchema = z.object({
  source: z.enum(["playlist", "streamer"]),
  /** `band` = cadence-window insert rules ([MIXS]-style) rendered as thin overlays (PD §4.8). */
  mode: z.enum(["block", "band"]),
  label: z.string(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
});
export type MirrorBlock = z.infer<typeof MirrorBlockSchema>;

export const MirrorResponseSchema = z.object({
  station: StationSlugSchema,
  zone: z.string(),
  blocks: z.array(MirrorBlockSchema),
});
export type MirrorResponse = z.infer<typeof MirrorResponseSchema>;

export const SlotsResponseSchema = z.object({
  station: StationSlugSchema,
  zone: z.string(),
  slots: z.array(SlotSchema),
});
export type SlotsResponse = z.infer<typeof SlotsResponseSchema>;

export const CreateSlotInputSchema = z.object({
  kind: SlotKindSchema,
  title: z.string().min(1).max(120).optional(),
  /** Binds (creating if needed) a show of this name — show/series/echo kinds. */
  showName: z.string().min(1).max(120).optional(),
  recurrence: RecurrenceSchema,
  durationMin: z.number().int().min(5).max(1440),
  /** Slots with nothing to negotiate are born validated (PD §4.4). */
  bornValidated: z.boolean().default(false),
  /** The live broadcaster to bind (live kind only; ignored otherwise). */
  broadcasterId: z.number().int().positive().optional(),
});
export type CreateSlotInput = z.infer<typeof CreateSlotInputSchema>;

export const UpdateSlotInputSchema = z
  .object({
    title: z.string().min(1).max(120).nullable(),
    recurrence: RecurrenceSchema,
    durationMin: z.number().int().min(5).max(1440),
    /** Bind (positive), unbind (null) or leave (omit) the live broadcaster. */
    broadcasterId: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty update" });
export type UpdateSlotInput = z.infer<typeof UpdateSlotInputSchema>;

export const PatchOccurrenceInputSchema = z
  .object({
    /** Move: new station-timezone wall start, e.g. "2026-07-10T15:30". */
    startsAtWall: z.string().regex(WALL_DATETIME),
    durationMin: z.number().int().min(5).max(1440),
    /** Must be a legal transition from the current state (NEGOTIATION_TRANSITIONS). */
    negotiationState: NegotiationStateSchema,
    /** Full replacement of the flag set. */
    issueFlags: z.array(IssueFlagSchema),
    contentDurationMin: z.number().int().positive().nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: "empty patch" });
export type PatchOccurrenceInput = z.infer<typeof PatchOccurrenceInputSchema>;

/** Payload of the `grid` SSE channel — a hint to refetch the visible window. */
export const GridChangedEventSchema = z.object({
  station: StationSlugSchema,
  /** `show-updated` = a show rename repainted the titles slots fall back to. */
  reason: z.enum([
    "slot-created",
    "slot-updated",
    "slot-deleted",
    "occurrence-patched",
    "show-updated",
  ]),
});
export type GridChangedEvent = z.infer<typeof GridChangedEventSchema>;
