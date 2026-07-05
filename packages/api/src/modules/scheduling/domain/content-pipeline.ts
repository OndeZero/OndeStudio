import {
  CONTENT_TRANSITIONS,
  type ContentState,
  ContentStateSchema,
} from "@ondestudio/shared";
import { DomainError } from "../../../kernel/domain-error";
import { err, ok, type Result } from "../../../kernel/result";

/**
 * The content pipeline state machine (PD §4.4): `empty → received → ready →
 * aired`, with explicit detach back to `empty`. Orthogonal issue flags live on
 * the occurrence, not here — a slot can be `ready` and still flagged.
 */
export class ContentPipeline {
  private constructor(readonly value: ContentState) {}

  static of(state: ContentState): ContentPipeline {
    return new ContentPipeline(state);
  }

  static parse(raw: string): Result<ContentPipeline, DomainError> {
    const parsed = ContentStateSchema.safeParse(raw);
    if (!parsed.success) return err(DomainError.validation(`unknown content state: ${raw}`));
    return ok(new ContentPipeline(parsed.data));
  }

  transitionTo(next: ContentState): Result<ContentPipeline, DomainError> {
    if (!CONTENT_TRANSITIONS[this.value].includes(next)) {
      return err(
        DomainError.illegalTransition(
          `content ${this.value} → ${next} is not allowed (legal: ${
            CONTENT_TRANSITIONS[this.value].join(", ") || "none"
          })`,
        ),
      );
    }
    return ok(new ContentPipeline(next));
  }

  /** Content that was ready when its occurrence ended has aired (time-driven). */
  effectiveAt(endsAt: Date, now: Date): ContentState {
    if (this.value === "ready" && endsAt.getTime() <= now.getTime()) return "aired";
    return this.value;
  }
}
