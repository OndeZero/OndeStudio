/**
 * Expected outcomes are values, not exceptions (docs/2 §4.3): a use-case's
 * signature lists every failure it can return, so there is no hidden control
 * flow. Exceptions stay reserved for the truly exceptional — bugs and
 * infrastructure failure.
 */
export type Result<T, E> = Ok<T> | Err<E>;

export interface Ok<T> {
  readonly ok: true;
  readonly value: T;
}

export interface Err<E> {
  readonly ok: false;
  readonly error: E;
}

export const ok = <T>(value: T): Ok<T> => ({ ok: true, value });

export const err = <E>(error: E): Err<E> => ({ ok: false, error });

/**
 * Returns the value or throws. For tests and boot-time code where a failure is
 * a bug — never a way to skip error handling on a request path.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (!result.ok) throw new Error(`unwrap() called on Err: ${String(result.error)}`);
  return result.value;
}
