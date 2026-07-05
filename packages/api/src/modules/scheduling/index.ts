/**
 * Public surface of the scheduling module — the only entry point other
 * modules and app.ts may import (docs/2 §3.4).
 */
export { occurrenceToContract, slotToContract } from "./contract";
export { decodeOccurrenceId, encodeOccurrenceId, Occurrence } from "./domain/occurrence";
export { RecurrenceRule } from "./domain/recurrence-rule";
export { SlotDefinition } from "./domain/slot-definition";
export type { GridChangedDomainEvent } from "./events";
export type { MirrorBlock, MirrorSchedulePort } from "./ports";
export { DrizzleSchedulingRepo, type SchedulingRepo, type SlotRecord } from "./repo";
export { createSchedulingRoutes } from "./routes";
export { type EnrichedOccurrence, type GridFilters, SchedulingService } from "./service";
import "./events";
