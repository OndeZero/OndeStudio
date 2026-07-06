import { z } from "zod";
import { OccurrenceSchema, SlotSchema } from "./scheduling";
import { StationSlugSchema } from "./station";

/**
 * Show hub contract (PD §5.4): the canonical page every lens links into.
 * Settings per PD §4.5 / docs/2 §5.2.
 */
export const FALLBACK_POLICIES = ["discard", "replay_previous"] as const;
export const FallbackPolicySchema = z.enum(FALLBACK_POLICIES);
export type FallbackPolicy = z.infer<typeof FallbackPolicySchema>;

export const REPLAY_FLAGS = ["yes", "no", "not_specified"] as const;
export const ReplayFlagSchema = z.enum(REPLAY_FLAGS);
export type ReplayFlag = z.infer<typeof ReplayFlagSchema>;

export const ShowSummarySchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  slotCount: z.number().int(),
  nextOccurrenceAt: z.iso.datetime().nullable(),
  dropFolderPath: z.string().nullable(),
});
export type ShowSummary = z.infer<typeof ShowSummarySchema>;

export const ShowsResponseSchema = z.object({
  station: StationSlugSchema,
  shows: z.array(ShowSummarySchema),
});
export type ShowsResponse = z.infer<typeof ShowsResponseSchema>;

export const ShowDetailSchema = z.object({
  id: z.number().int(),
  name: z.string(),
  slug: z.string(),
  fallbackPolicy: FallbackPolicySchema,
  trustAutoAir: z.boolean(),
  replayFlag: ReplayFlagSchema,
  /** IANA zone of the contributor, for translated-time helpers (PD §8.1). */
  contributorTz: z.string().nullable(),
  /** Media path feeding this show's episode queue (PD §4.5); browsable in the media lens. */
  dropFolderPath: z.string().nullable(),
  slots: z.array(SlotSchema),
  next: z.array(OccurrenceSchema),
  past: z.array(OccurrenceSchema),
});
export type ShowDetail = z.infer<typeof ShowDetailSchema>;

export const UpdateShowInputSchema = z
  .object({
    name: z.string().min(1).max(120),
    fallbackPolicy: FallbackPolicySchema,
    trustAutoAir: z.boolean(),
    replayFlag: ReplayFlagSchema,
    contributorTz: z.string().nullable(),
    dropFolderPath: z.string().max(500).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });
export type UpdateShowInput = z.infer<typeof UpdateShowInputSchema>;
