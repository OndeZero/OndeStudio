import { z } from "zod";
import { RecurrenceSchema, SlotSchema } from "./scheduling";
import { StationSlugSchema } from "./station";

/**
 * External broadcaster self-service (PD §5.6): a broadcaster signs in with its
 * Icecast credentials and manages its own slots — a surface entirely separate
 * from the team app, with its own session.
 */
export const SelfLoginInputSchema = z.object({
  username: z.string().min(1).max(120),
  password: z.string().min(1).max(200),
});
export type SelfLoginInput = z.infer<typeof SelfLoginInputSchema>;

export const SelfProfileSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  displayName: z.string(),
  kind: z.enum(["team", "external"]),
});
export type SelfProfile = z.infer<typeof SelfProfileSchema>;

export const SelfSlotsResponseSchema = z.object({
  station: StationSlugSchema,
  /** IANA zone the slot wall-clock times are read in. */
  zone: z.string(),
  slots: z.array(SlotSchema),
});
export type SelfSlotsResponse = z.infer<typeof SelfSlotsResponseSchema>;

/**
 * A broadcaster proposing a live slot (PD §5.6). External proposals land as a
 * team-validated hold (`prebooked`); a team account's are auto-validated. The
 * server decides that from the session — the input never carries a state.
 */
export const SelfProposeInputSchema = z.object({
  title: z.string().min(1).max(120).optional(),
  recurrence: RecurrenceSchema,
  durationMin: z.number().int().min(5).max(1440),
});
export type SelfProposeInput = z.infer<typeof SelfProposeInputSchema>;
