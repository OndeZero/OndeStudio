import { z } from "zod";

/**
 * The locked naming pass (docs/2 §14.1, PD §4.4) — the normative vocabulary of
 * the grid. The transition maps below are the single source of truth for both
 * the domain state machines (api) and the quick-edit UI (web).
 */
export const SLOT_KINDS = ["show", "series", "echo", "live", "rotation"] as const;
export const SlotKindSchema = z.enum(SLOT_KINDS);
export type SlotKind = z.infer<typeof SlotKindSchema>;

export const NEGOTIATION_STATES = [
  "prebooked",
  "dealing",
  "validated",
  "declined",
  "cancelled",
  "aired",
] as const;
export const NegotiationStateSchema = z.enum(NEGOTIATION_STATES);
export type NegotiationState = z.infer<typeof NegotiationStateSchema>;

/**
 * Legal human-driven transitions (PD §4.4). `aired` is time-driven, never a
 * human action — it appears as a target nowhere here; the API computes it.
 * A `prebooked` hold may jump straight to `validated`; it may also die
 * `declined` without ever being negotiated ("never got to yes").
 */
export const NEGOTIATION_TRANSITIONS: Record<NegotiationState, readonly NegotiationState[]> = {
  prebooked: ["dealing", "validated", "declined"],
  dealing: ["validated", "declined"],
  validated: ["cancelled"],
  declined: [],
  cancelled: [],
  aired: [],
};

export const CONTENT_STATES = ["empty", "received", "ready", "aired"] as const;
export const ContentStateSchema = z.enum(CONTENT_STATES);
export type ContentState = z.infer<typeof ContentStateSchema>;

/**
 * The content pipeline (PD §4.4): forward `empty → received → ready`, with
 * explicit detach back to `empty` (content removed/replaced). `aired` is
 * time-driven and terminal.
 */
export const CONTENT_TRANSITIONS: Record<ContentState, readonly ContentState[]> = {
  empty: ["received"],
  received: ["ready", "empty"],
  ready: ["received", "empty"],
  aired: [],
};

export const ISSUE_FLAGS = ["technical", "metadata", "editorial"] as const;
export const IssueFlagSchema = z.enum(ISSUE_FLAGS);
export type IssueFlag = z.infer<typeof IssueFlagSchema>;
