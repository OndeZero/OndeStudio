import type {
  Anchor,
  Card as CardDto,
  Comment as CommentDto,
  Notification as NotificationDto,
} from "@ondestudio/shared";
import type { EnrichedCard } from "./enrich";
import type { NotificationRecord } from "./repo";
import type { CommentView } from "./service";

/** Domain → wire contract, the "map out" step (docs/2 §3.2). */
export function cardToContract(enriched: EnrichedCard): CardDto {
  const { card } = enriched;
  return {
    id: card.id,
    intent: card.intent,
    status: card.status,
    subject: card.subject,
    body: card.body,
    anchor: card.anchor
      ? {
          ...card.anchor,
          ...(enriched.anchorLabel !== null ? { label: enriched.anchorLabel } : {}),
        }
      : null,
    createdBy: enriched.createdBy,
    createdAt: card.createdAt,
    assignees: enriched.assignees,
    votes: enriched.votes,
    myVote: enriched.myVote,
    commentCount: enriched.commentCount,
    lastActivityAt: card.lastActivityAt,
    lastComment: enriched.lastComment,
    unread: enriched.unread,
    outcome: card.outcome,
  };
}

export function commentToContract(view: CommentView): CommentDto {
  return {
    id: view.record.id,
    cardId: view.record.cardId,
    author: view.author,
    body: view.record.body,
    createdAt: view.record.createdAt,
  };
}

export function notificationToContract(record: NotificationRecord): NotificationDto {
  return {
    id: record.id,
    kind: record.kind,
    message: record.message,
    // Only the service writes these columns, from typed anchors — see repo.ts.
    anchor:
      record.anchorType && record.anchorId
        ? { type: record.anchorType as Anchor["type"], id: record.anchorId }
        : null,
    cardId: record.cardId,
    createdAt: record.createdAt,
    readAt: record.readAt,
  };
}
