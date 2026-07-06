import { VOTE_KINDS, type VoteKind } from "@ondestudio/shared";
import type { Card, CardAnchor } from "./domain/card";
import type { AnchorResolverPort, DirectoryUser, UserDirectoryPort } from "./ports";
import type { CollaborationRepo, CommentRecord } from "./repo";

/** A card plus everything its board face shows (PD §5.2), for ONE viewer. */
export interface EnrichedCard {
  card: Card;
  createdBy: DirectoryUser;
  assignees: DirectoryUser[];
  votes: Record<VoteKind, number>;
  myVote: VoteKind | null;
  commentCount: number;
  lastComment: { author: string; snippet: string; at: string } | null;
  unread: boolean;
  anchorLabel: string | null;
}

export interface EnrichDeps {
  repo: CollaborationRepo;
  users: UserDirectoryPort;
  anchors: AnchorResolverPort;
}

const SNIPPET_MAX = 120;

/**
 * The read-side assembly behind every card the API returns: one pass of
 * batched lookups for a whole listing (comments, votes, reads, assignees,
 * directory names, anchor labels) — never row-by-row queries. Separate from
 * service.ts only to keep both files small; this is module-internal.
 */
export async function enrichCards(
  deps: EnrichDeps,
  cardList: Card[],
  forUserId: number,
): Promise<EnrichedCard[]> {
  if (cardList.length === 0) return [];
  const ids = cardList.map((card) => card.id);
  const [commentRows, voteRows, reads, assigneesByKey] = await Promise.all([
    deps.repo.listCommentsForCards(ids),
    deps.repo.listVotes(ids),
    deps.repo.listReads(ids, forUserId),
    deps.repo.listAssignees("card", ids.map(String)),
  ]);

  const stats = new Map<number, { count: number; last: CommentRecord }>();
  for (const row of commentRows) {
    const entry = stats.get(row.cardId);
    if (entry) {
      entry.count += 1;
      entry.last = row; // rows arrive createdAt-ordered, so the last one wins
    } else stats.set(row.cardId, { count: 1, last: row });
  }

  const tallies = new Map<number, Record<VoteKind, number>>();
  const myVotes = new Map<number, VoteKind>();
  for (const vote of voteRows) {
    const tally = tallies.get(vote.cardId) ?? emptyTally();
    tally[vote.kind] += 1;
    tallies.set(vote.cardId, tally);
    if (vote.userId === forUserId) myVotes.set(vote.cardId, vote.kind);
  }

  const userIds = new Set<number>(cardList.map((card) => card.createdBy));
  for (const list of assigneesByKey.values()) for (const id of list) userIds.add(id);
  for (const stat of stats.values()) userIds.add(stat.last.authorId);
  const directory = await deps.users.getUsers([...userIds]);

  const uniqueAnchors = new Map<string, CardAnchor>();
  for (const card of cardList) {
    if (card.anchor) uniqueAnchors.set(anchorKey(card.anchor), card.anchor);
  }
  const labels = new Map<string, string | null>();
  await Promise.all(
    [...uniqueAnchors].map(async ([key, anchor]) => {
      labels.set(key, await deps.anchors.resolveLabel(anchor));
    }),
  );

  return cardList.map((card) => {
    const stat = stats.get(card.id);
    const seenAt = reads.get(card.id);
    return {
      card,
      createdBy: userRef(directory, card.createdBy),
      assignees: (assigneesByKey.get(String(card.id)) ?? []).map((id) => userRef(directory, id)),
      votes: tallies.get(card.id) ?? emptyTally(),
      myVote: myVotes.get(card.id) ?? null,
      commentCount: stat?.count ?? 0,
      lastComment: stat
        ? {
            author: userRef(directory, stat.last.authorId).displayName,
            snippet: snippet(stat.last.body),
            at: stat.last.createdAt,
          }
        : null,
      // Actors seed their own card_read whenever they mutate (service.ts), so
      // "no read row" or "activity after last look" both honestly mean someone
      // else acted — the PD §5.2 unread dot, including for the card's creator.
      // ISO-UTC strings compare lexicographically = chronologically.
      unread: seenAt === undefined ? true : card.lastActivityAt > seenAt,
      anchorLabel: card.anchor ? (labels.get(anchorKey(card.anchor)) ?? null) : null,
    };
  });
}

export async function enrichCard(
  deps: EnrichDeps,
  card: Card,
  forUserId: number,
): Promise<EnrichedCard> {
  const [enriched] = await enrichCards(deps, [card], forUserId);
  if (!enriched) throw new Error("enrichment lost a card"); // structurally impossible
  return enriched;
}

/** The directory may lag (seed pending, account gone) — degrade, don't explode. */
export function userRef(directory: Map<number, DirectoryUser>, id: number): DirectoryUser {
  return directory.get(id) ?? { id, displayName: `user #${id}` };
}

function anchorKey(anchor: CardAnchor): string {
  return `${anchor.type}:${anchor.id}`;
}

function emptyTally(): Record<VoteKind, number> {
  // Full tally, zeros included: the shared CardSchema's votes record is
  // enum-keyed, and Zod 4 enum-keyed records are exhaustive — omitted zero
  // counts would fail contract parsing.
  return Object.fromEntries(VOTE_KINDS.map((kind) => [kind, 0])) as Record<VoteKind, number>;
}

function snippet(body: string): string {
  return body.length <= SNIPPET_MAX ? body : `${body.slice(0, SNIPPET_MAX - 1)}…`;
}
