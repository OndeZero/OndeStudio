import type { CardIntent, CardStatus, VoteKind } from "@ondestudio/shared";

/**
 * The board's shared display vocabulary (PD §5.2): the fixed emoji vote set
 * with its defined meanings, intent theming and the compact time/name
 * formatting card faces use. One module so faces, detail and hub pages
 * never drift apart.
 */

export const VOTE_EMOJI: Record<VoteKind, string> = {
  want_on_air: "👍",
  love: "🔥",
  needs_discussion: "🤔",
  no: "👎",
};

export const VOTE_TITLES: Record<VoteKind, string> = {
  want_on_air: "want on air",
  love: "love",
  needs_discussion: "needs discussion",
  no: "no",
};

/** Lane/badge label: statuses read as PD §4.14 writes them ("in progress"). */
export function statusLabel(status: CardStatus): string {
  return status.replace("_", " ");
}

/** The theme token carrying this intent's hue (declared in ui/theme.css). */
export function intentVar(intent: CardIntent): string {
  return `var(--intent-${intent})`;
}

/** "TW" from "Thomas Wilde" — assignee initials on card faces. */
export function initialsOf(displayName: string): string {
  const parts = displayName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.charAt(0) ?? "";
  const last = parts.length > 1 ? (parts[parts.length - 1]?.charAt(0) ?? "") : "";
  return (first + last).toUpperCase() || "?";
}

/** Compact relative time for activity indicators: "now", "5m", "3h", "2d", then the date. */
export function relativeTime(iso: string, nowMs = Date.now()): string {
  const minutes = Math.round(Math.max(0, nowMs - Date.parse(iso)) / 60_000);
  if (minutes < 1) return "now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.round(hours / 24);
  if (days < 14) return `${days}d`;
  return iso.slice(0, 10);
}
