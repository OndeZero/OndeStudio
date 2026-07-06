import type { DomainError } from "../../kernel/domain-error";
import type { Result } from "../../kernel/result";
import type { CardAnchor } from "./domain/card";

/**
 * What collaboration requires from outside (docs/2 §3.2). Cards anchor to and
 * promote into objects owned by OTHER modules (scheduling's shows/slots,
 * content's media) and address users owned by people — all reached through
 * these ports, implemented and wired in app.ts. The board itself never
 * imports another module.
 */

/** Display label for an anchor chip (show name, slot title…); null when the object is gone. */
export interface AnchorResolverPort {
  resolveLabel(anchor: CardAnchor): Promise<string | null>;
}

/**
 * Promotion targets (PD §4.14). createShow may reuse an existing show by name
 * (scheduling's find-or-create) — promoting twice to the same name must not
 * fork identities.
 */
export interface PromotionPort {
  createShow(name: string): Promise<Result<{ id: number; name: string }, DomainError>>;
  slotExists(slotId: number): Promise<boolean>;
}

export interface DirectoryUser {
  id: number;
  displayName: string;
}

/**
 * The people directory, read-only: display names for card faces and the
 * validity check behind assignment (no cross-module FK — schema.ts explains).
 * allUserIds serves future broadcast-style triggers (PD §5.12 grows the set).
 */
export interface UserDirectoryPort {
  getUsers(ids: number[]): Promise<Map<number, DirectoryUser>>;
  allUserIds(): Promise<number[]>;
}
