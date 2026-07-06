import { z } from "zod";
import { UserRefSchema } from "./auth";

/**
 * Discussion-board contract (PD §4.14, §5.2): a card is a thread with an
 * intent, a status lane, votes and assignees — anchored to a domain object or
 * standalone, promotable into a real object without losing its thread.
 */
export const CARD_INTENTS = ["discussion", "idea", "prospect", "task"] as const;
export const CardIntentSchema = z.enum(CARD_INTENTS);
export type CardIntent = z.infer<typeof CardIntentSchema>;

export const CARD_STATUSES = ["open", "in_progress", "done", "archived"] as const;
export const CardStatusSchema = z.enum(CARD_STATUSES);
export type CardStatus = z.infer<typeof CardStatusSchema>;

/** The fixed voting set (PD §5.2) — rendering: 👍 want-on-air · 🔥 love · 🤔 needs-discussion · 👎 no. */
export const VOTE_KINDS = ["want_on_air", "love", "needs_discussion", "no"] as const;
export const VoteKindSchema = z.enum(VOTE_KINDS);
export type VoteKind = z.infer<typeof VoteKindSchema>;

/** Polymorphic anchor (docs/2 §5.5); ids are strings so occurrence keys fit too. */
export const AnchorSchema = z.object({
  type: z.enum(["show", "slot", "occurrence", "media"]),
  id: z.string().min(1),
  /** Display label resolved server-side (show name, slot title…). */
  label: z.string().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const CommentSchema = z.object({
  id: z.number().int(),
  cardId: z.number().int(),
  author: UserRefSchema,
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CardSchema = z.object({
  id: z.number().int(),
  intent: CardIntentSchema,
  status: CardStatusSchema,
  subject: z.string(),
  body: z.string().nullable(),
  anchor: AnchorSchema.nullable(),
  createdBy: UserRefSchema,
  createdAt: z.iso.datetime(),
  assignees: z.array(UserRefSchema),
  /** Tally per vote kind (zero counts omitted) and the caller's own vote. */
  votes: z.record(VoteKindSchema, z.number().int()),
  myVote: VoteKindSchema.nullable(),
  commentCount: z.number().int(),
  lastActivityAt: z.iso.datetime(),
  /** Discussion-state indicator (PD §5.2): latest reply, and whether the caller has unread activity. */
  lastComment: z
    .object({ author: z.string(), snippet: z.string(), at: z.iso.datetime() })
    .nullable(),
  unread: z.boolean(),
  /** Recorded conclusion — explicit, never buried in the thread (PD §4.14). */
  outcome: z.string().nullable(),
});
export type Card = z.infer<typeof CardSchema>;

export const CardsResponseSchema = z.object({ cards: z.array(CardSchema) });
export type CardsResponse = z.infer<typeof CardsResponseSchema>;

export const CommentsResponseSchema = z.object({ comments: z.array(CommentSchema) });
export type CommentsResponse = z.infer<typeof CommentsResponseSchema>;

export const CreateCardInputSchema = z.object({
  intent: CardIntentSchema,
  subject: z.string().min(1).max(200),
  body: z.string().max(10_000).optional(),
  anchor: AnchorSchema.omit({ label: true }).optional(),
  assigneeIds: z.array(z.number().int()).max(10).optional(),
});
export type CreateCardInput = z.infer<typeof CreateCardInputSchema>;

export const UpdateCardInputSchema = z
  .object({
    subject: z.string().min(1).max(200),
    body: z.string().max(10_000).nullable(),
    intent: CardIntentSchema,
    status: CardStatusSchema,
    outcome: z.string().max(2_000).nullable(),
    assigneeIds: z.array(z.number().int()).max(10),
    anchor: AnchorSchema.omit({ label: true }).nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: "empty update" });
export type UpdateCardInput = z.infer<typeof UpdateCardInputSchema>;

export const CreateCommentInputSchema = z.object({ body: z.string().min(1).max(10_000) });
export type CreateCommentInput = z.infer<typeof CreateCommentInputSchema>;

/** One vote per person per card, changeable; null clears (PD §5.2). */
export const VoteInputSchema = z.object({ kind: VoteKindSchema.nullable() });
export type VoteInput = z.infer<typeof VoteInputSchema>;

/**
 * Promotion (PD §4.14): an idea/prospect becomes a real object; the thread
 * re-anchors and travels with it. First cut: create a show, or anchor to an
 * existing slot.
 */
export const PromoteCardInputSchema = z.discriminatedUnion("to", [
  z.object({ to: z.literal("show"), name: z.string().min(1).max(120) }),
  z.object({ to: z.literal("slot"), slotId: z.number().int() }),
]);
export type PromoteCardInput = z.infer<typeof PromoteCardInputSchema>;

export const NotificationSchema = z.object({
  id: z.number().int(),
  kind: z.string(),
  message: z.string(),
  anchor: AnchorSchema.nullable(),
  cardId: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
  readAt: z.iso.datetime().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationsResponseSchema = z.object({
  notifications: z.array(NotificationSchema),
  unreadCount: z.number().int(),
});
export type NotificationsResponse = z.infer<typeof NotificationsResponseSchema>;
