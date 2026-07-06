/**
 * Public surface of the content module — the only entry point other modules
 * may import (docs/2 §3.4). No wiring.ts: the module owns no tables and no
 * concrete adapters yet; app.ts fulfils its ports from playout (files
 * adapter) and scheduling (drop folders).
 */
export { browseEntryToContract } from "./contract";
export type { MediaFileRecord, MediaStorePort, OwnedFolder, ShowOwnershipPort } from "./ports";
export { createContentRoutes } from "./routes";
export { type BrowseEntry, type BrowseResult, ContentService } from "./service";
