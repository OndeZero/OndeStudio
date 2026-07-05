import {
  NEGOTIATION_TRANSITIONS,
  type NegotiationState,
  NegotiationStateSchema,
} from "@ondestudio/shared";
import { DomainError } from "../../../kernel/domain-error";
import { err, ok, type Result } from "../../../kernel/result";

/**
 * The negotiation state machine (PD §4.4) as a value object: it knows its
 * legal transitions; an illegal one is a typed error, never a silent write.
 * The transition map itself lives in `shared` so the quick-edit UI offers
 * exactly what the domain accepts.
 */
export class Negotiation {
  private constructor(readonly value: NegotiationState) {}

  static of(state: NegotiationState): Negotiation {
    return new Negotiation(state);
  }

  static parse(raw: string): Result<Negotiation, DomainError> {
    const parsed = NegotiationStateSchema.safeParse(raw);
    if (!parsed.success) return err(DomainError.validation(`unknown negotiation state: ${raw}`));
    return ok(new Negotiation(parsed.data));
  }

  transitionTo(next: NegotiationState): Result<Negotiation, DomainError> {
    if (!NEGOTIATION_TRANSITIONS[this.value].includes(next)) {
      return err(
        DomainError.illegalTransition(
          `negotiation ${this.value} → ${next} is not allowed (legal: ${
            NEGOTIATION_TRANSITIONS[this.value].join(", ") || "none"
          })`,
        ),
      );
    }
    return ok(new Negotiation(next));
  }

  /**
   * `aired` is time-driven, not a human action (PD §4.4): a validated slot
   * whose end has passed reads as aired. Other states keep their meaning as
   * history (declined/cancelled ghosts).
   */
  effectiveAt(endsAt: Date, now: Date): NegotiationState {
    if (this.value === "validated" && endsAt.getTime() <= now.getTime()) return "aired";
    return this.value;
  }
}
