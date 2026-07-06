/**
 * Composition-only surface: the concrete repo app.ts (and ops scripts) wire
 * behind the CollaborationRepo interface. NOT part of the module's public
 * API — other modules import ./index.ts.
 */
export { DrizzleCollaborationRepo } from "./repo";
