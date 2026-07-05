/**
 * Shared domain primitives every module may depend on (docs/2 §3.3).
 * kernel depends on nothing above it — enforced by dependency-cruiser.
 */
export { type Clock, systemClock } from "./clock";
export { DomainError, type DomainErrorKind } from "./domain-error";
export { Entity } from "./entity";
export { type DomainEventName, type DomainEvents, EventBus } from "./event-bus";
export { asId, type Id } from "./id";
export type { LogFields, Logger } from "./logger";
export { type Err, err, type Ok, ok, type Result, unwrap } from "./result";
export { StationId } from "./station-id";
export { ValueObject } from "./value-object";
