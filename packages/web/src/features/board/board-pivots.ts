import { CARD_INTENTS, CARD_STATUSES, type Card, type VoteKind } from "@ondestudio/shared";
import { statusLabel } from "./board-format";

/**
 * Pure board math: the group-by/sort pivots (PD §5.2 — one surface,
 * re-pivoted) and the optimistic vote arithmetic. No IO, no store — kept
 * apart so board-store stays orchestration only.
 */

export type BoardGroupBy = "status" | "intent" | "assignee";
export type BoardSortBy = "activity" | "votes";

export interface BoardGroup {
  key: string;
  label: string;
  cards: Card[];
}

export function sortCards(cards: readonly Card[], by: BoardSortBy): Card[] {
  return [...cards].sort(by === "votes" ? byVotesDesc : byActivityDesc);
}

export function groupCards(cards: Card[], by: BoardGroupBy): BoardGroup[] {
  if (by === "status") {
    // Fixed lane order (PD §4.14): open → in progress → done → archived.
    return CARD_STATUSES.map((status) => ({
      key: status,
      label: statusLabel(status),
      cards: cards.filter((c) => c.status === status),
    }));
  }
  if (by === "intent") {
    return CARD_INTENTS.map((intent) => ({
      key: intent,
      label: intent,
      cards: cards.filter((c) => c.intent === intent),
    }));
  }
  // assignee: one lane per person seen; a multi-assignee card appears in
  // each of its lanes (my lane shows everything that is mine); unassigned
  // cards close the row.
  const lanes = new Map<string, BoardGroup>();
  const unassigned: BoardGroup = { key: "unassigned", label: "unassigned", cards: [] };
  for (const card of cards) {
    if (card.assignees.length === 0) unassigned.cards.push(card);
    for (const assignee of card.assignees) {
      const key = `user-${assignee.id}`;
      let lane = lanes.get(key);
      if (!lane) {
        lane = { key, label: assignee.displayName, cards: [] };
        lanes.set(key, lane);
      }
      lane.cards.push(card);
    }
  }
  const sorted = [...lanes.values()].sort((a, b) => a.label.localeCompare(b.label));
  if (unassigned.cards.length > 0) sorted.push(unassigned);
  return sorted;
}

/** One changeable vote per person: the local echo of PUT …/vote. */
export function applyVoteLocally(card: Card, target: VoteKind | null): Card {
  const votes: Card["votes"] = { ...card.votes };
  // Decrement to zero instead of deleting: zero counts render as no tally.
  if (card.myVote !== null) votes[card.myVote] = Math.max(0, (votes[card.myVote] ?? 1) - 1);
  if (target !== null) votes[target] = (votes[target] ?? 0) + 1;
  return { ...card, votes, myVote: target };
}

function totalVotes(card: Card): number {
  return Object.values(card.votes).reduce((sum: number, count) => sum + (count ?? 0), 0);
}

function byVotesDesc(a: Card, b: Card): number {
  return totalVotes(b) - totalVotes(a) || byActivityDesc(a, b);
}

function byActivityDesc(a: Card, b: Card): number {
  return Date.parse(b.lastActivityAt) - Date.parse(a.lastActivityAt);
}
