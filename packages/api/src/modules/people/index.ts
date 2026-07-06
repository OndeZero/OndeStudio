/**
 * Public surface of the people module (docs/2 §3.4): identity, sessions and
 * the team directory. The concrete repo lives in ./wiring.ts for the
 * composition root; broadcaster fan-out joins in M4.
 */
export { createBroadcasterRoutes } from "./broadcaster-routes";
export { type BroadcasterMutation, BroadcasterService } from "./broadcaster-service";
export type { UserAccount } from "./domain/user-account";
export type {
  AccountDirectoryPort,
  AccountSeed,
  StreamerDef,
  StreamerDirectoryPort,
  StreamerRecord,
} from "./ports";
export type { PeopleRepo } from "./repo";
export { createPeopleRoutes } from "./routes";
export { type AuthenticatedUser, PeopleService } from "./service";
