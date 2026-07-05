import { z } from "zod";

/** Uniform error envelope for every non-2xx response (docs/2 §6.1). */
export const ApiErrorSchema = z.object({
  error: z.string(),
  /** Domain failure kind (`not-found`, `conflict`…) when the error is an expected one. */
  kind: z.string().optional(),
  /** Present on 422 validation failures: one entry per offending field. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
});

export type ApiError = z.infer<typeof ApiErrorSchema>;
