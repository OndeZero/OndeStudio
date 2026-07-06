import {
  type Card,
  type CardIntent,
  CardSchema,
  CardsResponseSchema,
  type Comment,
  CommentSchema,
  CommentsResponseSchema,
  type CreateCardInput,
  type PromoteCardInput,
  type UpdateCardInput,
  type VoteKind,
} from "@ondestudio/shared";
import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { apiGet } from "../../lib/api/client";
import { apiMutate } from "../../lib/api/mutate";
import { subscribeStationSse } from "../../lib/api/sse";
import { useStationStore } from "../../stores/station";
import { pushToast } from "../grid/toast";
import {
  applyVoteLocally,
  type BoardGroup,
  type BoardGroupBy,
  type BoardSortBy,
  groupCards,
  sortCards,
} from "./board-pivots";

export type { BoardGroup, BoardGroupBy, BoardSortBy } from "./board-pivots";

/**
 * One pivotable surface (PD §5.2): the store holds the flat card list; the
 * group-by/sort pivots are pure computeds (board-pivots.ts), so re-pivoting
 * costs no wire round trip. Optimistic voting mirrors the grid's
 * instant-edit stance.
 */
export const useBoardStore = defineStore("board", () => {
  const stationStore = useStationStore();

  const cards = ref<Card[]>([]);
  const loading = ref(false);
  const groupBy = ref<BoardGroupBy>("status");
  const sortBy = ref<BoardSortBy>("activity");
  const intentFilter = ref<ReadonlySet<CardIntent>>(new Set());

  /** Monotonic id per load: a stale response must never paint the board. */
  let epoch = 0;

  async function loadCards(): Promise<void> {
    const myEpoch = ++epoch;
    const station = stationStore.current;
    loading.value = true;
    try {
      const res = await apiGet(`/stations/${station}/cards`, CardsResponseSchema);
      if (myEpoch !== epoch || station !== stationStore.current) return;
      // Own copy: optimistic splices must never mutate the response object.
      cards.value = [...res.cards];
    } catch (cause) {
      if (myEpoch === epoch) pushToast("error", messageOf(cause));
    } finally {
      if (myEpoch === epoch) loading.value = false;
    }
  }

  /** Deep links (rail, show pages) may target a card missing from the list. */
  async function ensureCard(id: number): Promise<void> {
    if (cards.value.some((c) => c.id === id)) return;
    // Same stale-response stance as loadCards: a station switch mid-flight
    // means this card (or its error) belongs to the previous station's board.
    const station = stationStore.current;
    try {
      const card = await apiGet(`/stations/${station}/cards/${id}`, CardSchema);
      if (station !== stationStore.current) return;
      replaceCard(card);
    } catch (cause) {
      if (station === stationStore.current) pushToast("error", messageOf(cause));
    }
  }

  const visibleCards = computed(() => {
    const filtered =
      intentFilter.value.size > 0
        ? cards.value.filter((c) => intentFilter.value.has(c.intent))
        : cards.value;
    return sortCards(filtered, sortBy.value);
  });

  const groups = computed<BoardGroup[]>(() => groupCards(visibleCards.value, groupBy.value));

  function cardById(id: number): Card | null {
    return cards.value.find((c) => c.id === id) ?? null;
  }

  function replaceCard(card: Card): void {
    const index = cards.value.findIndex((c) => c.id === card.id);
    if (index >= 0) cards.value.splice(index, 1, card);
    else cards.value.push(card);
  }

  function toggleIntentFilter(intent: CardIntent): void {
    const next = new Set(intentFilter.value);
    if (next.has(intent)) next.delete(intent);
    else next.add(intent);
    intentFilter.value = next;
  }

  async function createCard(input: CreateCardInput): Promise<Card | null> {
    try {
      const card = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/cards`,
        input,
        CardSchema,
      );
      replaceCard(card);
      return card;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return null;
    }
  }

  async function updateCard(id: number, patch: UpdateCardInput): Promise<boolean> {
    try {
      const card = await apiMutate(
        "PUT",
        `/stations/${stationStore.current}/cards/${id}`,
        patch,
        CardSchema,
      );
      replaceCard(card);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  /**
   * One vote per person, changeable (PD §5.2): clicking my current kind
   * clears it, any other kind switches. Applied optimistically; a failure
   * refetches instead of splicing a snapshot back — the list may hold
   * fresher SSE state than any rollback.
   */
  async function vote(id: number, kind: VoteKind): Promise<void> {
    const index = cards.value.findIndex((c) => c.id === id);
    const before = index >= 0 ? cards.value[index] : undefined;
    if (!before) return;
    const target: VoteKind | null = before.myVote === kind ? null : kind;
    cards.value.splice(index, 1, applyVoteLocally(before, target));
    try {
      const card = await apiMutate(
        "PUT",
        `/stations/${stationStore.current}/cards/${id}/vote`,
        { kind: target },
        CardSchema,
      );
      replaceCard(card);
    } catch (cause) {
      pushToast("error", messageOf(cause));
      await loadCards();
    }
  }

  /** Entering a thread consumes its unread marker instantly. */
  async function markCardRead(id: number): Promise<void> {
    const current = cardById(id);
    if (current?.unread) replaceCard({ ...current, unread: false });
    try {
      await apiMutate("POST", `/stations/${stationStore.current}/cards/${id}/read`);
    } catch {
      // Read-cursor updates are best-effort; the next refetch tells the truth.
    }
  }

  async function fetchComments(id: number): Promise<Comment[]> {
    const res = await apiGet(
      `/stations/${stationStore.current}/cards/${id}/comments`,
      CommentsResponseSchema,
    );
    return res.comments;
  }

  async function addComment(id: number, body: string): Promise<Comment | null> {
    try {
      const comment = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/cards/${id}/comments`,
        { body },
        CommentSchema,
      );
      // Keep the face's discussion-state indicator honest without a refetch.
      const card = cardById(id);
      if (card) {
        replaceCard({
          ...card,
          commentCount: card.commentCount + 1,
          lastActivityAt: comment.createdAt,
          lastComment: {
            author: comment.author.displayName,
            snippet: comment.body.slice(0, 140),
            at: comment.createdAt,
          },
        });
      }
      return comment;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return null;
    }
  }

  /** Promotion (PD §4.14): the thread re-anchors and travels with the new object. */
  async function promoteCard(id: number, input: PromoteCardInput): Promise<boolean> {
    try {
      const card = await apiMutate(
        "POST",
        `/stations/${stationStore.current}/cards/${id}/promote`,
        input,
        CardSchema,
      );
      replaceCard(card);
      pushToast("info", `Promoted — the thread now travels with its ${input.to}.`);
      return true;
    } catch (cause) {
      pushToast("error", messageOf(cause));
      return false;
    }
  }

  // SSE: the same debounce + reconnect-resync pattern as the grid store.
  let closeSse: (() => void) | null = null;
  let refetchTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleRefetch(): void {
    if (refetchTimer !== null) clearTimeout(refetchTimer);
    refetchTimer = setTimeout(() => {
      refetchTimer = null;
      void loadCards();
    }, 300);
  }

  function connectSse(): void {
    disconnectSse();
    closeSse = subscribeStationSse(
      stationStore.current,
      ["board"],
      scheduleRefetch,
      scheduleRefetch,
    );
  }

  function disconnectSse(): void {
    closeSse?.();
    closeSse = null;
    if (refetchTimer !== null) {
      clearTimeout(refetchTimer);
      refetchTimer = null;
    }
  }

  return {
    cards,
    loading,
    groupBy,
    sortBy,
    intentFilter,
    visibleCards,
    groups,
    loadCards,
    ensureCard,
    cardById,
    toggleIntentFilter,
    createCard,
    updateCard,
    vote,
    markCardRead,
    fetchComments,
    addComment,
    promoteCard,
    connectSse,
    disconnectSse,
  };
});

function messageOf(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
