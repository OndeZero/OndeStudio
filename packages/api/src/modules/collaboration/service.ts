import type {
  CreateCardInput,
  PromoteCardInput,
  UpdateCardInput,
  VoteKind,
} from "@ondestudio/shared";
import type { Clock } from "../../kernel/clock";
import { DomainError } from "../../kernel/domain-error";
import type { EventBus } from "../../kernel/event-bus";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import { Card, type CardAnchor } from "./domain/card";
import { type EnrichedCard, enrichCard, enrichCards, userRef } from "./enrich";
import { Inbox } from "./inbox";
import type { AnchorResolverPort, DirectoryUser, PromotionPort, UserDirectoryPort } from "./ports";
import type { CardFilters, CollaborationRepo, CommentRecord, NotificationRecord } from "./repo";
import "./events";

export interface CommentView {
  record: CommentRecord;
  author: DirectoryUser;
}

/**
 * Board use-cases (docs/2 §11 M2). The viewer's id is always an explicit
 * parameter (the route's session user): enrichment — myVote, unread — is
 * per-person. Every actor mutation seeds the actor's own card_read at the
 * same instant it bumps last_activity_at, which is what makes the unread dot
 * honest (enrich.ts). Votes are ambient: they never bump activity or unread.
 */
export class CollaborationService {
  private readonly inbox: Inbox;

  constructor(
    private readonly deps: {
      repo: CollaborationRepo;
      anchors: AnchorResolverPort;
      promotion: PromotionPort;
      users: UserDirectoryPort;
      bus: EventBus;
      clock: Clock;
      logger: Logger;
    },
  ) {
    this.inbox = new Inbox(deps.repo, deps.bus, deps.clock);
  }

  /** Sorted by lastActivityAt desc; the client re-pivots (group-by switch, PD §5.2). */
  async listCards(
    station: StationId,
    filters: CardFilters,
    forUserId: number,
  ): Promise<EnrichedCard[]> {
    return enrichCards(
      this.deps,
      await this.deps.repo.listCards(station.value, filters),
      forUserId,
    );
  }

  async getCard(
    station: StationId,
    cardId: number,
    forUserId: number,
  ): Promise<Result<EnrichedCard, DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    return ok(await enrichCard(this.deps, card.value, forUserId));
  }

  async createCard(
    station: StationId,
    input: CreateCardInput,
    byUserId: number,
  ): Promise<Result<EnrichedCard, DomainError>> {
    const now = this.now();
    const assigneeIds = [...new Set(input.assigneeIds ?? [])];
    const directory = await this.resolveAssignees(assigneeIds, byUserId);
    if (!directory.ok) return directory;
    const planned = Card.plan({
      stationId: station.value,
      intent: input.intent,
      subject: input.subject,
      body: input.body ?? null,
      anchor: input.anchor ?? null,
      createdBy: byUserId,
      now,
    });
    if (!planned.ok) return planned;
    const card = await this.deps.repo.insertCard(planned.value);
    await this.deps.repo.setAssignees("card", String(card.id), assigneeIds);
    await this.deps.repo.markRead(card.id, byUserId, now);
    await this.inbox.push(
      assigneeIds.filter((id) => id !== byUserId),
      this.assignedMessage(card.subject, userRef(directory.value, byUserId)),
      card,
      now,
    );
    this.cardChanged(station, card.id);
    return ok(await enrichCard(this.deps, card, byUserId));
  }

  async updateCard(
    station: StationId,
    cardId: number,
    input: UpdateCardInput,
    byUserId: number,
  ): Promise<Result<EnrichedCard, DomainError>> {
    const existing = await this.getOwnCard(station, cardId);
    if (!existing.ok) return existing;
    const now = this.now();
    const updated = existing.value.update(input, now);
    if (!updated.ok) return updated;

    // A slot anchor must exist ON THE CARD'S STATION — same check as promote().
    // Slots are the only anchor the API can cheaply authorize today (numeric
    // id + station via PromotionPort); show/occurrence/media anchors stay
    // label-resolved-only, where a dangling one just renders without a label.
    if (input.anchor?.type === "slot") {
      const slotId = Number(input.anchor.id);
      if (!(await this.deps.promotion.slotExists(slotId, existing.value.stationId))) {
        return err(DomainError.notFound("slot"));
      }
    }

    // Validate the assignee replace-set BEFORE any write, so a bad id cannot
    // leave the card half-updated.
    let newAssignees: number[] = [];
    let directory = new Map<number, DirectoryUser>();
    if (input.assigneeIds !== undefined) {
      const next = [...new Set(input.assigneeIds)];
      const resolved = await this.resolveAssignees(next, byUserId);
      if (!resolved.ok) return resolved;
      directory = resolved.value;
      const key = String(cardId);
      const current = (await this.deps.repo.listAssignees("card", [key])).get(key) ?? [];
      newAssignees = next.filter((id) => !current.includes(id) && id !== byUserId);
      await this.deps.repo.setAssignees("card", key, next);
    }
    await this.deps.repo.saveCard(updated.value);
    await this.deps.repo.markRead(cardId, byUserId, now);
    if (newAssignees.length > 0) {
      await this.inbox.push(
        newAssignees,
        this.assignedMessage(updated.value.subject, userRef(directory, byUserId)),
        updated.value,
        now,
      );
    }
    this.cardChanged(station, cardId);
    return ok(await enrichCard(this.deps, updated.value, byUserId));
  }

  async addComment(
    station: StationId,
    cardId: number,
    body: string,
    byUserId: number,
  ): Promise<Result<CommentView, DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    const now = this.now();
    const record = await this.deps.repo.insertComment({
      cardId,
      authorId: byUserId,
      body,
      createdAt: now,
    });
    await this.deps.repo.saveCard(card.value.touchActivity(now));
    await this.deps.repo.markRead(cardId, byUserId, now); // the author has read their own reply
    const key = String(cardId);
    const assignees = (await this.deps.repo.listAssignees("card", [key])).get(key) ?? [];
    const recipients = [...new Set([card.value.createdBy, ...assignees])].filter(
      (id) => id !== byUserId,
    );
    const author = userRef(await this.deps.users.getUsers([byUserId]), byUserId);
    await this.inbox.push(
      recipients,
      { kind: "comment", message: `${author.displayName} replied on «${card.value.subject}»` },
      card.value,
      now,
    );
    this.cardChanged(station, cardId);
    return ok({ record, author });
  }

  async listComments(
    station: StationId,
    cardId: number,
  ): Promise<Result<CommentView[], DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    const records = await this.deps.repo.listComments(cardId);
    const directory = await this.deps.users.getUsers([
      ...new Set(records.map((record) => record.authorId)),
    ]);
    return ok(records.map((record) => ({ record, author: userRef(directory, record.authorId) })));
  }

  /** Upsert, or clear on null (PD §5.2: one changeable vote per person). Ambient: no unread. */
  async setVote(
    station: StationId,
    cardId: number,
    kind: VoteKind | null,
    byUserId: number,
  ): Promise<Result<EnrichedCard, DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    if (kind === null) await this.deps.repo.clearVote(cardId, byUserId);
    else await this.deps.repo.setVote(cardId, byUserId, kind);
    this.cardChanged(station, cardId);
    return ok(await enrichCard(this.deps, card.value, byUserId));
  }

  async markCardRead(
    station: StationId,
    cardId: number,
    userId: number,
  ): Promise<Result<void, DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    await this.deps.repo.markRead(cardId, userId, this.now());
    this.cardChanged(station, cardId);
    return ok(undefined);
  }

  async promote(
    station: StationId,
    cardId: number,
    input: PromoteCardInput,
    byUserId: number,
  ): Promise<Result<EnrichedCard, DomainError>> {
    const card = await this.getOwnCard(station, cardId);
    if (!card.ok) return card;
    const gate = card.value.canPromote();
    if (!gate.ok) return gate; // refuse BEFORE creating anything — no orphan shows

    let anchor: CardAnchor;
    if (input.to === "show") {
      const show = await this.deps.promotion.createShow(input.name);
      if (!show.ok) return show;
      anchor = { type: "show", id: String(show.value.id) };
    } else {
      // Station-scoped: a slot that exists on ANOTHER station answers 404 —
      // cross-station promotion must not silently anchor into a foreign grid.
      if (!(await this.deps.promotion.slotExists(input.slotId, card.value.stationId))) {
        return err(DomainError.notFound("slot"));
      }
      anchor = { type: "slot", id: String(input.slotId) };
    }
    const now = this.now();
    const promoted = card.value.promote(anchor, now);
    if (!promoted.ok) return promoted;
    await this.deps.repo.saveCard(promoted.value);
    await this.deps.repo.markRead(cardId, byUserId, now);
    this.cardChanged(station, cardId);
    return ok(await enrichCard(this.deps, promoted.value, byUserId));
  }

  // Inbox pass-throughs — notifications are user-scoped, not station-scoped (inbox.ts).
  async listNotifications(
    userId: number,
  ): Promise<{ rows: NotificationRecord[]; unreadCount: number }> {
    return this.inbox.list(userId);
  }

  async markNotificationRead(id: number, userId: number): Promise<Result<void, DomainError>> {
    return this.inbox.markRead(id, userId);
  }

  async markAllNotificationsRead(userId: number): Promise<void> {
    return this.inbox.markAllRead(userId);
  }

  /** Assignees must exist in the directory — the schema has no user FK (schema.ts). */
  private async resolveAssignees(
    ids: number[],
    byUserId: number,
  ): Promise<Result<Map<number, DirectoryUser>, DomainError>> {
    const directory = await this.deps.users.getUsers([byUserId, ...ids]);
    const missing = ids.filter((id) => !directory.has(id));
    if (missing.length > 0) {
      return err(DomainError.validation(`unknown assignee: ${missing.join(", ")}`));
    }
    return ok(directory);
  }

  private assignedMessage(subject: string, actor: DirectoryUser) {
    return { kind: "assigned", message: `«${subject}» — assigned to you by ${actor.displayName}` };
  }

  private async getOwnCard(station: StationId, cardId: number): Promise<Result<Card, DomainError>> {
    const card = await this.deps.repo.getCard(cardId);
    // A foreign station's card answers 404, not 403 — same rule as scheduling.
    if (!card || card.stationId !== station.value) return err(DomainError.notFound("card"));
    return ok(card);
  }

  private cardChanged(station: StationId, cardId: number): void {
    this.deps.bus.emit("collaboration.card-changed", { station: station.value, cardId });
  }

  private now(): string {
    return this.deps.clock.now().toISOString();
  }
}
