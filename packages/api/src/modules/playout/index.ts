/**
 * Public surface of the playout module — the only entry point other modules
 * and app.ts may import (docs/2 §3.4). Everything else in this folder is
 * private.
 */
export { type AdapterHealth, AzuracastClient } from "./adapters/azuracast/client";
export { AzuracastPlayoutStateAdapter } from "./adapters/azuracast/now-adapter";
export { onAirToContract } from "./contract";
export type { OnAirStatus } from "./domain/on-air-status";
export type { OnAirChangedEvent } from "./events";
export type { PlayoutStatePort } from "./ports";
export { DrizzleNowCacheRepo, type NowCacheRepo } from "./repo";
export { createPlayoutRoutes } from "./routes";
export { PlayoutService } from "./service";

import "./events";
