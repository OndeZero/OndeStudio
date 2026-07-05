/**
 * The closed set of expected failure kinds. Platform maps each kind to an HTTP
 * status exactly once (docs/2 §6.1) — modules never think about status codes.
 */
export type DomainErrorKind =
  | "not-found"
  | "validation"
  | "conflict"
  | "illegal-transition"
  | "upstream-unavailable";

export class DomainError extends Error {
  constructor(
    readonly kind: DomainErrorKind,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }

  static notFound(what: string): DomainError {
    return new DomainError("not-found", `${what} not found`);
  }

  static validation(message: string, details?: unknown): DomainError {
    return new DomainError("validation", message, details);
  }

  static conflict(message: string): DomainError {
    return new DomainError("conflict", message);
  }

  static illegalTransition(message: string): DomainError {
    return new DomainError("illegal-transition", message);
  }

  /** The AzuraCast link (or any upstream) is down — the overlay degrades, air does not (invariant 1). */
  static upstreamUnavailable(message: string, details?: unknown): DomainError {
    return new DomainError("upstream-unavailable", message, details);
  }
}
