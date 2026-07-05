/**
 * Public surface of the playout module — the only entry point other modules
 * may import (docs/2 §3.4): ports, service, routes, contracts. Concrete
 * adapters/repos live in ./wiring.ts for the composition root only — keeping
 * them off this surface is what stops another module from coupling to
 * AzuraCast "legally" (invariant 2).
 */
export { onAirToContract } from "./contract";
export type { OnAirStatus } from "./domain/on-air-status";
export type { OnAirChangedEvent } from "./events";
export type { PlayoutStatePort } from "./ports";
export type { NowCacheRepo } from "./repo";
export { createPlayoutRoutes } from "./routes";
export { PlayoutService } from "./service";

import "./events";
