import { z } from "zod";
import { StationSlugSchema } from "./station";

/** One playing (or upcoming) item as the public API exposes it. */
export const OnAirTrackSchema = z.object({
  title: z.string(),
  artist: z.string().nullable(),
  playlist: z.string().nullable(),
  startedAt: z.iso.datetime().nullable(),
  durationSec: z.number().int().nonnegative().nullable(),
});

export type OnAirTrack = z.infer<typeof OnAirTrackSchema>;

/**
 * The `GET /stations/{station}/now` contract — part of the stable public read
 * surface the galaxy satellites will consume (docs/2 §6.4). Exposes
 * OndeStudio's model only; AzuraCast shapes never leak here.
 */
export const OnAirSchema = z.object({
  station: StationSlugSchema,
  live: z.object({
    isLive: z.boolean(),
    streamerName: z.string().nullable(),
  }),
  current: OnAirTrackSchema.nullable(),
  next: OnAirTrackSchema.nullable(),
  /** When the playout system produced this observation (UTC ISO). */
  observedAt: z.iso.datetime(),
  /** True when served from the last-known cache because playout was unreachable. */
  stale: z.boolean(),
});

export type OnAir = z.infer<typeof OnAirSchema>;
