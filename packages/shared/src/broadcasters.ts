import { z } from "zod";
import { StationSlugSchema } from "./station";

/**
 * Broadcaster contract (PD §5.10, docs/2 §11 M4): ONE definition fans out to
 * both AzuraCast stations — identical credentials, schedule enforcement on
 * main only — replacing today's manual double-edit. Writes obey docs/2 §7.7:
 * only the configured write stations are pushed; the rest report `blocked`
 * until the per-feature adoption step (and the dedicated API account) enables
 * them.
 */
export const BROADCASTER_KINDS = ["team", "external"] as const;
export const BroadcasterKindSchema = z.enum(BROADCASTER_KINDS);
export type BroadcasterKind = z.infer<typeof BroadcasterKindSchema>;

/** Per-station push state of the fan-out. */
export const StationPushSchema = z.object({
  station: StationSlugSchema,
  /** AzuraCast streamer id once linked/pushed; null = nothing there yet. */
  ref: z.string().nullable(),
  status: z.enum(["pushed", "linked", "blocked", "missing"]),
});
export type StationPush = z.infer<typeof StationPushSchema>;

export const BroadcasterSchema = z.object({
  id: z.number().int(),
  username: z.string(),
  displayName: z.string(),
  kind: BroadcasterKindSchema,
  /** The "Now playing" comment metadata (PD §2.3's juggling, now a field). */
  commentMeta: z.string().nullable(),
  /** Applied on the MAIN station only; test always stays unrestricted (PD §2.2). */
  enforceSchedule: z.boolean(),
  replayFlag: z.enum(["yes", "no", "not_specified"]),
  /** OndeStudio owns the credential going forward (docs/2 §12). */
  hasPassword: z.boolean(),
  stations: z.array(StationPushSchema),
});
export type Broadcaster = z.infer<typeof BroadcasterSchema>;

export const BroadcastersResponseSchema = z.object({
  broadcasters: z.array(BroadcasterSchema),
  /** Stations OndeStudio may currently write to (docs/2 §7.7). */
  writeStations: z.array(StationSlugSchema),
});
export type BroadcastersResponse = z.infer<typeof BroadcastersResponseSchema>;

const USERNAME = /^[A-Za-z0-9_-]{2,64}$/;

export const CreateBroadcasterInputSchema = z.object({
  username: z.string().regex(USERNAME, "letters, digits, _ and - only"),
  displayName: z.string().min(1).max(200),
  kind: BroadcasterKindSchema,
  commentMeta: z.string().max(500).nullable().optional(),
  enforceSchedule: z.boolean().default(false),
  replayFlag: z.enum(["yes", "no", "not_specified"]).default("not_specified"),
  /** Omit to have one generated and returned once. */
  password: z.string().min(10).max(100).optional(),
});
export type CreateBroadcasterInput = z.infer<typeof CreateBroadcasterInputSchema>;

export const UpdateBroadcasterInputSchema = z
  .object({
    displayName: z.string().min(1).max(200),
    kind: BroadcasterKindSchema,
    commentMeta: z.string().max(500).nullable(),
    enforceSchedule: z.boolean(),
    replayFlag: z.enum(["yes", "no", "not_specified"]),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });
export type UpdateBroadcasterInput = z.infer<typeof UpdateBroadcasterInputSchema>;

/** Create/rotate/sync responses may carry a generated secret — shown exactly once. */
export const BroadcasterWithSecretSchema = z.object({
  broadcaster: BroadcasterSchema,
  /** Give this to the broadcaster; OndeStudio stores only a hash. */
  generatedPassword: z.string().nullable(),
  /** Human-readable caveats (e.g. main mirror untouched — production writes blocked). */
  warnings: z.array(z.string()),
});
export type BroadcasterWithSecret = z.infer<typeof BroadcasterWithSecretSchema>;

/** Result of adopting the existing AzuraCast streamers (docs/2 §7.6). */
export const BroadcasterImportResultSchema = z.object({
  imported: z.number().int(),
  linked: z.number().int(),
  /** Usernames present on main with no test mirror (PD §2.3 drift). */
  missingOnTest: z.array(z.string()),
  /** Usernames present only on test (leftovers). */
  onlyOnTest: z.array(z.string()),
});
export type BroadcasterImportResult = z.infer<typeof BroadcasterImportResultSchema>;
