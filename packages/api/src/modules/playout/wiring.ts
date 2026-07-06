/**
 * Composition-only surface: the concrete adapters and repos app.ts wires
 * behind the ports (docs/2 §3.5). NOT part of the module's public API — other
 * modules import ./index.ts; the module-privacy dependency rule keeps them off
 * this file, so nothing outside the composition root can couple to AzuraCast.
 */
export { type AdapterHealth, AzuracastClient } from "./adapters/azuracast/client";
export { AzuracastDirectoryAdapter } from "./adapters/azuracast/directory-adapter";
export { AzuracastFilesAdapter } from "./adapters/azuracast/files-adapter";
export { AzuracastPlayoutStateAdapter } from "./adapters/azuracast/now-adapter";
export { AzuracastStreamerAdapter } from "./adapters/azuracast/streamer-adapter";
export { AzuracastMirrorScheduleAdapter } from "./adapters/azuracast/schedule-adapter";
export { DrizzleNowCacheRepo } from "./repo";
