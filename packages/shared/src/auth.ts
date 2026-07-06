import { z } from "zod";

/**
 * Auth contract (docs/2 §12): OndeStudio owns its user/session store, seeded
 * from AzuraCast accounts. Session-cookie based — no tokens on the wire.
 */
export const LoginInputSchema = z.object({
  /** The email the AzuraCast account uses. */
  email: z.email(),
  password: z.string().min(1),
});
export type LoginInput = z.infer<typeof LoginInputSchema>;

export const UserRefSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
});
export type UserRef = z.infer<typeof UserRefSchema>;

export const MeSchema = z.object({
  id: z.number().int(),
  displayName: z.string(),
  email: z.string(),
  role: z.enum(["team", "external"]),
});
export type Me = z.infer<typeof MeSchema>;

/** Completing an admin-issued one-time setup link (AzuraCast passwords are unreadable). */
export const SetupInputSchema = z.object({
  token: z.string().min(16),
  password: z.string().min(10, "at least 10 characters"),
});
export type SetupInput = z.infer<typeof SetupInputSchema>;

export const UsersResponseSchema = z.object({
  users: z.array(MeSchema),
});
export type UsersResponse = z.infer<typeof UsersResponseSchema>;
