import { DomainError } from "./domain-error";
import { err, ok, type Result } from "./result";
import { ValueObject } from "./value-object";

/**
 * A station shortcode (`oz`, `wz-test`) as a validated value object.
 * Every resource is station-scoped from day 1 (PD §7.2) — cheap phase-3
 * multi-station insurance.
 */
export class StationId extends ValueObject {
  private constructor(readonly value: string) {
    super();
  }

  static parse(raw: string): Result<StationId, DomainError> {
    const slug = raw.trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return err(DomainError.validation(`invalid station shortcode: "${raw}"`));
    }
    return ok(new StationId(slug));
  }

  override equals(other: this): boolean {
    return this.value === other.value;
  }

  toString(): string {
    return this.value;
  }
}
