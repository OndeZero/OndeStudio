import type { DomainError } from "../../../../kernel/domain-error";
import { ok, type Result } from "../../../../kernel/result";
// Cross-module import through people's public index only (docs/2 §3.4); type-only.
import type { AccountDirectoryPort, AccountSeed } from "../../../people";
import type { AzuracastClient } from "./client";

/** Subset of /api/admin/users this adapter reads. */
interface AzAdminUser {
  id: number;
  email: string;
  name: string | null;
}

/**
 * Phase-1 AccountDirectoryPort over AzuraCast's admin users API (read-only —
 * passwords are neither readable nor verifiable there, hence the local
 * setup-link flow, docs/2 §12). Lives in playout like every AzuraCast
 * adapter: the upstream never leaks past this module (invariant 2).
 */
export class AzuracastDirectoryAdapter implements AccountDirectoryPort {
  constructor(private readonly client: AzuracastClient) {}

  async fetchAccounts(): Promise<Result<AccountSeed[], DomainError>> {
    const response = await this.client.getJson<AzAdminUser[]>("/api/admin/users");
    if (!response.ok) return response;
    return ok(
      response.value
        .filter((user) => Boolean(user.email))
        .map((user) => ({
          ref: String(user.id),
          email: user.email,
          displayName: user.name?.trim() || user.email,
        })),
    );
  }
}
