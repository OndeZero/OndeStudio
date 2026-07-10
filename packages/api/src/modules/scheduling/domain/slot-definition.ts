import type { NegotiationState, SlotKind } from "@ondestudio/shared";
import { DomainError } from "../../../kernel/domain-error";
import { Entity } from "../../../kernel/entity";
import { err, ok, type Result } from "../../../kernel/result";
import type { RecurrenceRule } from "./recurrence-rule";

export interface SlotProps {
  id: number;
  stationId: string;
  kind: SlotKind;
  title: string | null;
  showId: number | null;
  rule: RecurrenceRule;
  durationMin: number;
  negotiationDefault: NegotiationState;
  /** The live broadcaster bound to this slot (PD §5.10); live kind only. */
  broadcasterId: number | null;
}

/** A computed series instance, enriched with what the grid needs from its slot. */
export interface CandidateOccurrence {
  slotId: number;
  originalStartsAtUtc: Date;
  endsAtUtc: Date;
}

/**
 * A slot is the recurrence *definition* (PD §7.2): a rule bound to a show,
 * live or rotation block. The grid materializes its occurrences on read;
 * only diverging occurrences ever hit the database (docs/2 §5.3).
 */
export class SlotDefinition extends Entity<number> {
  private constructor(private readonly props: SlotProps) {
    super(props.id);
  }

  static rehydrate(props: SlotProps): SlotDefinition {
    return new SlotDefinition(props);
  }

  /**
   * Invariants for a new slot: content-bearing kinds need an identity (a show
   * binding or a title); a slot may be born `validated` when there is nothing
   * to negotiate (PD §4.4), otherwise it starts as a `prebooked` hold.
   */
  static plan(
    input: Omit<SlotProps, "id" | "negotiationDefault" | "broadcasterId"> & {
      bornValidated: boolean;
      broadcasterId?: number | null;
    },
  ): Result<Omit<SlotProps, "id">, DomainError> {
    if (
      (input.kind === "show" || input.kind === "series") &&
      input.showId === null &&
      !input.title
    ) {
      return err(DomainError.validation(`a ${input.kind} slot needs a show or a title`));
    }
    if (input.durationMin < 5) return err(DomainError.validation("slot duration below 5 minutes"));
    return ok({
      stationId: input.stationId,
      kind: input.kind,
      title: input.title,
      showId: input.showId,
      rule: input.rule,
      durationMin: input.durationMin,
      negotiationDefault: input.bornValidated ? "validated" : "prebooked",
      // A broadcaster binding only means something on a live slot.
      broadcasterId: input.kind === "live" ? (input.broadcasterId ?? null) : null,
    });
  }

  get stationId(): string {
    return this.props.stationId;
  }
  get kind(): SlotKind {
    return this.props.kind;
  }
  get title(): string | null {
    return this.props.title;
  }
  get showId(): number | null {
    return this.props.showId;
  }
  get rule(): RecurrenceRule {
    return this.props.rule;
  }
  get durationMin(): number {
    return this.props.durationMin;
  }
  get negotiationDefault(): NegotiationState {
    return this.props.negotiationDefault;
  }
  get broadcasterId(): number | null {
    return this.props.broadcasterId;
  }

  /** Display label: explicit title, else the bound show's name, else the kind. */
  displayTitle(showName: string | null): string {
    return this.props.title ?? showName ?? this.props.kind;
  }

  materialize(windowFromUtc: Date, windowToUtc: Date, zone: string): CandidateOccurrence[] {
    return this.props.rule
      .occurrencesBetween(this.props.durationMin, windowFromUtc, windowToUtc, zone)
      .map((computed) => ({
        slotId: this.id,
        originalStartsAtUtc: computed.originalStartsAtUtc,
        endsAtUtc: computed.endsAtUtc,
      }));
  }
}
