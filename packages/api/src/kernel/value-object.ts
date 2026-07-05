/**
 * Base for immutable concepts compared by value (docs/2 §4.1). They make
 * illegal states unrepresentable and move validation off the edges into the
 * type. The default equality compares canonical JSON — override it where
 * serialization isn't canonical.
 */
export abstract class ValueObject {
  equals(other: this): boolean {
    return other.constructor === this.constructor && JSON.stringify(other) === JSON.stringify(this);
  }
}
