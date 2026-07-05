import { z } from "zod";

/**
 * Station shortcode as used in URLs (`oz`, `wz-test`) — every resource is
 * station-scoped from day 1 as phase-3 multi-station insurance (PD §7.2).
 */
export const StationSlugSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]*$/, "station must be a lowercase shortcode like `oz`")
  .meta({ id: "StationSlug", example: "oz" });

export type StationSlug = z.infer<typeof StationSlugSchema>;
