import type { ContentState, IssueFlag, NegotiationState } from "@ondestudio/shared";
import { DomainError } from "../../../kernel/domain-error";
import { Entity } from "../../../kernel/entity";
import { err, ok, type Result } from "../../../kernel/result";
import { ContentPipeline } from "./content-pipeline";
import { Negotiation } from "./negotiation";

/**
 * Occurrence identity = (slot, original series time) — the RFC-5545-style
 * recurrence key (docs/2 §5.3). It is stable whether or not an exception row
 * exists, so the API can address computed occurrences too.
 */
export interface OccurrenceKey {
  slotId: number;
  originalStartsAtUtc: Date;
}

export const encodeOccurrenceId = (key: OccurrenceKey): string =>
  `${key.slotId}_${key.originalStartsAtUtc.getTime()}`;

export function decodeOccurrenceId(raw: string): Result<OccurrenceKey, DomainError> {
  const match = raw.match(/^(\d+)_(\d+)$/);
  if (!match) return err(DomainError.validation(`invalid occurrence id: ${raw}`));
  return ok({
    slotId: Number(match[1]),
    originalStartsAtUtc: new Date(Number(match[2])),
  });
}

interface OccurrenceProps {
  key: OccurrenceKey;
  startsAtUtc: Date;
  endsAtUtc: Date;
  negotiation: Negotiation;
  content: ContentPipeline;
  issueFlags: readonly IssueFlag[];
  contentDurationMin: number | null;
  /** True when an exception row backs this occurrence in the DB. */
  persisted: boolean;
}

/**
 * One concrete airing (or hold) on the grid. Immutable: every edit returns a
 * new instance, which keeps optimistic flows and change detection simple.
 * Soft boundaries are sacred (PD §4.3): moves and resizes NEVER fail on
 * overlap — the grid shows an overlap indicator instead of blocking.
 */
export class Occurrence extends Entity<string> {
  private constructor(private readonly props: OccurrenceProps) {
    super(encodeOccurrenceId(props.key));
  }

  static fromCandidate(key: OccurrenceKey, endsAtUtc: Date, negotiationDefault: NegotiationState): Occurrence {
    return new Occurrence({
      key,
      startsAtUtc: key.originalStartsAtUtc,
      endsAtUtc,
      negotiation: Negotiation.of(negotiationDefault),
      content: ContentPipeline.of("empty"),
      issueFlags: [],
      contentDurationMin: null,
      persisted: false,
    });
  }

  static rehydrate(props: Omit<OccurrenceProps, "persisted">): Occurrence {
    return new Occurrence({ ...props, persisted: true });
  }

  get key(): OccurrenceKey {
    return this.props.key;
  }
  get startsAtUtc(): Date {
    return this.props.startsAtUtc;
  }
  get endsAtUtc(): Date {
    return this.props.endsAtUtc;
  }
  get negotiation(): Negotiation {
    return this.props.negotiation;
  }
  get content(): ContentPipeline {
    return this.props.content;
  }
  get issueFlags(): readonly IssueFlag[] {
    return this.props.issueFlags;
  }
  get contentDurationMin(): number | null {
    return this.props.contentDurationMin;
  }
  get persisted(): boolean {
    return this.props.persisted;
  }

  get durationMin(): number {
    return Math.round((this.props.endsAtUtc.getTime() - this.props.startsAtUtc.getTime()) / 60_000);
  }

  /** Diverges from the computed series time? Drives the `moved` marker on the grid. */
  get moved(): boolean {
    return this.props.startsAtUtc.getTime() !== this.props.key.originalStartsAtUtc.getTime();
  }

  /** Move and/or resize. Overlaps are legal by design (PD §4.3). */
  moveTo(startsAtUtc: Date, durationMin?: number): Result<Occurrence, DomainError> {
    const minutes = durationMin ?? this.durationMin;
    if (minutes < 5) return err(DomainError.validation("occurrence duration below 5 minutes"));
    return ok(
      new Occurrence({
        ...this.props,
        startsAtUtc,
        endsAtUtc: new Date(startsAtUtc.getTime() + minutes * 60_000),
      }),
    );
  }

  transitionNegotiationTo(next: NegotiationState): Result<Occurrence, DomainError> {
    const transitioned = this.props.negotiation.transitionTo(next);
    if (!transitioned.ok) return transitioned;
    return ok(new Occurrence({ ...this.props, negotiation: transitioned.value }));
  }

  transitionContentTo(next: ContentState): Result<Occurrence, DomainError> {
    const transitioned = this.props.content.transitionTo(next);
    if (!transitioned.ok) return transitioned;
    return ok(new Occurrence({ ...this.props, content: transitioned.value }));
  }

  withIssueFlags(flags: readonly IssueFlag[]): Occurrence {
    const unique = [...new Set(flags)].sort();
    return new Occurrence({ ...this.props, issueFlags: unique });
  }

  withContentDuration(minutes: number | null): Occurrence {
    return new Occurrence({ ...this.props, contentDurationMin: minutes });
  }
}
