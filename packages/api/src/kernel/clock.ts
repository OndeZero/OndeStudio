/**
 * Injectable time source so domain rules and services never reach for
 * `new Date()` directly — time-dependent logic stays unit-testable.
 */
export interface Clock {
  now(): Date;
}

export const systemClock: Clock = { now: () => new Date() };
