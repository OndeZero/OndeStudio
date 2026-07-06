import {
  type Anchor,
  CARD_INTENTS,
  CARD_STATUSES,
  type CardIntent,
  type CardStatus,
} from "@ondestudio/shared";
import { DomainError } from "../../../kernel/domain-error";
import { Entity } from "../../../kernel/entity";
import { err, ok, type Result } from "../../../kernel/result";

/** A card's anchor minus the display label — labels are resolved at read time (ports.ts). */
export type CardAnchor = Pick<Anchor, "type" | "id">;

export interface CardProps {
  id: number;
  stationId: string;
  intent: CardIntent;
  status: CardStatus;
  subject: string;
  body: string | null;
  anchor: CardAnchor | null;
  outcome: string | null;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
}

export interface UpdateCardFields {
  subject?: string;
  body?: string | null;
  intent?: CardIntent;
  status?: CardStatus;
  outcome?: string | null;
  anchor?: CardAnchor | null;
}

/**
 * A discussion thread with an intent, a status lane, votes and assignees
 * (PD §4.14). Status/intent transitions are deliberately free — a 4–6 person
 * trusted team needs no workflow ceremony (PD §8.1) — but values are still
 * validated as enum members so programmatic callers can't corrupt rows.
 * Immutable: every edit returns a new instance (same idiom as Occurrence).
 */
export class Card extends Entity<number> {
  private constructor(private readonly props: CardProps) {
    super(props.id);
  }

  /** New-card props, id-less — the repo assigns identity on insert. */
  static plan(fields: {
    stationId: string;
    intent: CardIntent;
    subject: string;
    body: string | null;
    anchor: CardAnchor | null;
    createdBy: number;
    now: string;
  }): Result<Omit<CardProps, "id">, DomainError> {
    if (!CARD_INTENTS.includes(fields.intent)) {
      return err(DomainError.validation(`unknown intent: ${fields.intent}`));
    }
    if (fields.subject.trim().length === 0) {
      return err(DomainError.validation("subject must not be empty"));
    }
    return ok({
      stationId: fields.stationId,
      intent: fields.intent,
      status: "open",
      subject: fields.subject,
      body: fields.body,
      anchor: fields.anchor,
      outcome: null,
      createdBy: fields.createdBy,
      createdAt: fields.now,
      updatedAt: fields.now,
      lastActivityAt: fields.now,
    });
  }

  static rehydrate(props: CardProps): Card {
    return new Card(props);
  }

  get stationId(): string {
    return this.props.stationId;
  }
  get intent(): CardIntent {
    return this.props.intent;
  }
  get status(): CardStatus {
    return this.props.status;
  }
  get subject(): string {
    return this.props.subject;
  }
  get body(): string | null {
    return this.props.body;
  }
  get anchor(): CardAnchor | null {
    return this.props.anchor;
  }
  get outcome(): string | null {
    return this.props.outcome;
  }
  get createdBy(): number {
    return this.props.createdBy;
  }
  get createdAt(): string {
    return this.props.createdAt;
  }
  get updatedAt(): string {
    return this.props.updatedAt;
  }
  get lastActivityAt(): string {
    return this.props.lastActivityAt;
  }

  /** Replace-set semantics: `undefined` keeps a field, `null` clears it. */
  update(fields: UpdateCardFields, now: string): Result<Card, DomainError> {
    if (fields.intent !== undefined && !CARD_INTENTS.includes(fields.intent)) {
      return err(DomainError.validation(`unknown intent: ${fields.intent}`));
    }
    if (fields.status !== undefined && !CARD_STATUSES.includes(fields.status)) {
      return err(DomainError.validation(`unknown status: ${fields.status}`));
    }
    if (fields.subject !== undefined && fields.subject.trim().length === 0) {
      return err(DomainError.validation("subject must not be empty"));
    }
    let next = new Card({
      ...this.props,
      ...(fields.subject !== undefined ? { subject: fields.subject } : {}),
      ...(fields.body !== undefined ? { body: fields.body } : {}),
      ...(fields.intent !== undefined ? { intent: fields.intent } : {}),
      ...(fields.status !== undefined ? { status: fields.status } : {}),
      ...(fields.anchor !== undefined ? { anchor: fields.anchor } : {}),
      updatedAt: now,
      lastActivityAt: now, // touching anything counts as activity (task/board semantics)
    });
    if (fields.outcome !== undefined) next = next.recordOutcome(fields.outcome, now);
    return ok(next);
  }

  /** The explicit conclusion of a thread — never buried in the comments (PD §4.14). */
  recordOutcome(outcome: string | null, now: string): Card {
    return new Card({ ...this.props, outcome, updatedAt: now, lastActivityAt: now });
  }

  /** A new comment (or promotion) makes the thread "hot" without editing the card fields. */
  touchActivity(now: string): Card {
    return new Card({ ...this.props, lastActivityAt: now });
  }

  /**
   * Promotion gate (PD §4.14): only an `idea` or `prospect` that has not yet
   * become anything real may promote. Exposed separately from promote() so the
   * service can refuse BEFORE creating the target object — no orphan shows.
   */
  canPromote(): Result<void, DomainError> {
    if (this.props.intent !== "idea" && this.props.intent !== "prospect") {
      return err(
        DomainError.illegalTransition(`only idea/prospect cards promote, not ${this.props.intent}`),
      );
    }
    if (this.props.anchor !== null) {
      return err(DomainError.illegalTransition("card is already anchored to an object"));
    }
    return ok(undefined);
  }

  /** Re-anchor to the freshly created/linked object; the whole thread travels with it. */
  promote(anchor: CardAnchor, now: string): Result<Card, DomainError> {
    const gate = this.canPromote();
    if (!gate.ok) return gate;
    return ok(new Card({ ...this.props, anchor, updatedAt: now, lastActivityAt: now }));
  }

  toProps(): CardProps {
    return { ...this.props, anchor: this.props.anchor ? { ...this.props.anchor } : null };
  }
}
