/**
 * Public surface of the scheduling module — the only entry point other
 * modules may import (docs/2 §3.4). The concrete repo lives in ./wiring.ts
 * for the composition root only.
 */
export {
  occurrenceToContract,
  showDetailToContract,
  showSummaryToContract,
  slotToContract,
} from "./contract";
export { decodeOccurrenceId, encodeOccurrenceId, Occurrence } from "./domain/occurrence";
export { RecurrenceRule } from "./domain/recurrence-rule";
export { SlotDefinition } from "./domain/slot-definition";
export type { GridChangedDomainEvent } from "./events";
export type { MirrorBlock, MirrorSchedulePort } from "./ports";
export type { SchedulingRepo, ShowRecord, SlotRecord, UpdateShowFields } from "./repo";
export { createSchedulingRoutes } from "./routes";
export { type EnrichedOccurrence, type GridFilters, SchedulingService } from "./service";
export { createShowRoutes } from "./show-routes";
export { type ShowDetailData, ShowService, type ShowSummaryData } from "./show-service";

import "./events";
