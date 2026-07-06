import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";

/**
 * What people requires from outside (docs/2 §3.5 IdentityPort, M2 subset):
 * account seeding from the playout system's user directory. Broadcaster
 * credential verification (verifyBroadcaster) joins in M4.
 */
export interface AccountSeed {
  /** Stable upstream id, kept as the az_account_ref. */
  ref: string;
  email: string;
  displayName: string;
}

export interface AccountDirectoryPort {
  fetchAccounts(): Promise<Result<AccountSeed[], DomainError>>;
}
