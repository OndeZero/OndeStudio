import type {
  Broadcaster,
  BroadcasterImportResult,
  CreateBroadcasterInput,
  StationPush,
  UpdateBroadcasterInput,
} from "@ondestudio/shared";
import { DomainError } from "../../kernel/domain-error";
import type { Logger } from "../../kernel/logger";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import type { BroadcasterRepo, BroadcasterRow } from "./broadcaster-repo";
import type { StreamerDef, StreamerDirectoryPort } from "./ports";

export interface BroadcasterMutation {
  broadcaster: Broadcaster;
  generatedPassword: string | null;
  warnings: string[];
}

/**
 * The main/test fan-out (PD §5.10, docs/2 §11 M4): one definition, both
 * stations, schedule enforcement on main only. Writes reach only the
 * configured write stations (docs/2 §7.7) — everything else is reported as
 * `blocked`, never silently attempted. The `[ondestudio:broadcaster:<id>]`
 * marker (docs/2 §3.7) tags every object we own upstream.
 */
export class BroadcasterService {
  constructor(
    private readonly deps: {
      repo: BroadcasterRepo;
      streamers: StreamerDirectoryPort;
      mainStation: StationId;
      testStation: StationId;
      writeStations: StationId[];
      logger: Logger;
    },
  ) {}

  private canWrite(station: StationId): boolean {
    return this.deps.writeStations.some((allowed) => allowed.equals(station));
  }

  private fanoutStations(): { station: StationId; isMain: boolean }[] {
    return [
      { station: this.deps.mainStation, isMain: true },
      { station: this.deps.testStation, isMain: false },
    ];
  }

  async list(): Promise<Broadcaster[]> {
    return (await this.deps.repo.list()).map((row) => this.toView(row));
  }

  async create(input: CreateBroadcasterInput): Promise<Result<BroadcasterMutation, DomainError>> {
    if (await this.deps.repo.findByUsername(input.username)) {
      return err(DomainError.conflict(`broadcaster "${input.username}" already exists`));
    }
    const password = input.password ?? generatePassword();
    const row = await this.deps.repo.insert({
      username: input.username,
      displayName: input.displayName,
      kind: input.kind,
      commentMeta: input.commentMeta ?? null,
      enforceSchedule: input.enforceSchedule,
      replayFlag: input.replayFlag,
      passwordHash: await Bun.password.hash(password),
    });

    const warnings = await this.pushAll(row, { password });
    const fresh = (await this.deps.repo.get(row.id)) ?? row;
    return ok({
      broadcaster: this.toView(fresh),
      generatedPassword: input.password ? null : password,
      warnings,
    });
  }

  async update(
    id: number,
    input: UpdateBroadcasterInput,
  ): Promise<Result<BroadcasterMutation, DomainError>> {
    const row = await this.deps.repo.get(id);
    if (!row) return err(DomainError.notFound("broadcaster"));
    await this.deps.repo.update(id, input);
    const updated = (await this.deps.repo.get(id)) ?? row;

    const warnings = await this.pushAll(updated, {});
    return ok({ broadcaster: this.toView(updated), generatedPassword: null, warnings });
  }

  /** New credential everywhere we may write; blocked stations keep the old one — reported. */
  async rotatePassword(id: number): Promise<Result<BroadcasterMutation, DomainError>> {
    const row = await this.deps.repo.get(id);
    if (!row) return err(DomainError.notFound("broadcaster"));
    const password = generatePassword();
    await this.deps.repo.update(id, { passwordHash: await Bun.password.hash(password) });
    const fresh = (await this.deps.repo.get(id)) ?? row;

    const warnings = await this.pushAll(fresh, { password });
    return ok({ broadcaster: this.toView(fresh), generatedPassword: password, warnings });
  }

  async remove(id: number): Promise<Result<string[], DomainError>> {
    const row = await this.deps.repo.get(id);
    if (!row) return err(DomainError.notFound("broadcaster"));
    const warnings: string[] = [];
    for (const { station, isMain } of this.fanoutStations()) {
      const ref = isMain ? row.mainStreamerRef : row.testStreamerRef;
      if (!ref) continue;
      if (!this.canWrite(station)) {
        warnings.push(
          `streamer left in place on ${station.value} (writes blocked, docs/2 §7.7) — remove it there manually if needed`,
        );
        continue;
      }
      const removed = await this.deps.streamers.remove(station, ref);
      if (!removed.ok) warnings.push(`${station.value}: delete failed — ${removed.error.message}`);
    }
    await this.deps.repo.remove(id);
    return ok(warnings);
  }

  /**
   * Adopt the streamers AzuraCast already has (docs/2 §7.6): main is the
   * source of truth, test mirrors are linked by username; drift is reported,
   * never auto-fixed. Adopted credentials are unknown (unreadable upstream) —
   * `hasPassword: false` until a rotate.
   */
  async importExisting(): Promise<Result<BroadcasterImportResult, DomainError>> {
    const main = await this.deps.streamers.list(this.deps.mainStation);
    if (!main.ok) return main;
    const test = await this.deps.streamers.list(this.deps.testStation);
    if (!test.ok) return test;

    const testByUsername = new Map(test.value.map((s) => [s.username, s]));
    let imported = 0;
    let linked = 0;
    for (const streamer of main.value) {
      const mirror = testByUsername.get(streamer.username);
      const existing = await this.deps.repo.findByUsername(streamer.username);
      if (existing) {
        // Refresh links only — local fields (kind, replay flag…) are ours.
        await this.deps.repo.update(existing.id, {
          mainStreamerRef: streamer.ref,
          testStreamerRef: mirror?.ref ?? existing.testStreamerRef,
        });
        linked += 1;
        continue;
      }
      await this.deps.repo.insert({
        username: streamer.username,
        displayName: streamer.displayName,
        kind: "external",
        commentMeta: stripMarker(streamer.comments) || null,
        enforceSchedule: streamer.enforceSchedule,
        replayFlag: "not_specified",
        passwordHash: null,
        mainStreamerRef: streamer.ref,
        testStreamerRef: mirror?.ref ?? null,
      });
      imported += 1;
    }

    const mainUsernames = new Set(main.value.map((s) => s.username));
    return ok({
      imported,
      linked,
      missingOnTest: main.value
        .filter((s) => !testByUsername.has(s.username))
        .map((s) => s.username),
      onlyOnTest: test.value.filter((s) => !mainUsernames.has(s.username)).map((s) => s.username),
    });
  }

  /**
   * Create the missing test mirror (PD §2.3 drift fix). Existing credentials
   * are unreadable, so the mirror gets a fresh one — main keeps the old
   * password until production writes are enabled (warned, shown once).
   */
  async syncTestMirror(id: number): Promise<Result<BroadcasterMutation, DomainError>> {
    const row = await this.deps.repo.get(id);
    if (!row) return err(DomainError.notFound("broadcaster"));
    if (row.testStreamerRef) {
      return err(DomainError.conflict("test mirror already linked"));
    }
    const password = generatePassword();
    const created = await this.deps.streamers.create(this.deps.testStation, {
      ...this.defFor(row, false),
      password,
    });
    if (!created.ok) return created;
    await this.deps.repo.update(id, {
      testStreamerRef: created.value.ref,
      passwordHash: await Bun.password.hash(password),
    });
    const fresh = (await this.deps.repo.get(id)) ?? row;
    return ok({
      broadcaster: this.toView(fresh),
      generatedPassword: password,
      warnings: row.mainStreamerRef
        ? [
            `main still has the previous password — align it once production writes are enabled (docs/2 §7.7) or via the AzuraCast UI`,
          ]
        : [],
    });
  }

  /** Push the definition to every fan-out station we may write to; collect honest warnings. */
  private async pushAll(row: BroadcasterRow, secrets: { password?: string }): Promise<string[]> {
    const warnings: string[] = [];
    for (const { station, isMain } of this.fanoutStations()) {
      const ref = isMain ? row.mainStreamerRef : row.testStreamerRef;
      if (!this.canWrite(station)) {
        if (ref || secrets.password) {
          warnings.push(`${station.value}: not pushed (writes blocked, docs/2 §7.7)`);
        }
        continue;
      }
      const def = { ...this.defFor(row, isMain), ...secrets };
      const result = ref
        ? await this.deps.streamers.update(station, ref, def)
        : await this.deps.streamers.create(station, def);
      if (!result.ok) {
        warnings.push(`${station.value}: push failed — ${result.error.message}`);
        continue;
      }
      if (!ref && "ref" in (result.value ?? {})) {
        const created = result.value as { ref: string };
        await this.deps.repo.update(
          row.id,
          isMain ? { mainStreamerRef: created.ref } : { testStreamerRef: created.ref },
        );
      }
    }
    return warnings;
  }

  private defFor(row: BroadcasterRow, isMain: boolean): StreamerDef {
    const marker = `[ondestudio:broadcaster:${row.id}]`;
    return {
      username: row.username,
      displayName: row.displayName,
      comments: row.commentMeta ? `${marker} ${row.commentMeta}` : marker,
      isActive: true,
      // The whole point of the mirror: test never enforces (PD §2.2, §5.10).
      enforceSchedule: isMain ? row.enforceSchedule : false,
    };
  }

  private toView(row: BroadcasterRow): Broadcaster {
    const push = (station: StationId, ref: string | null): StationPush => ({
      station: station.value,
      ref,
      status: ref ? "linked" : this.canWrite(station) ? "missing" : "blocked",
    });
    return {
      id: row.id,
      username: row.username,
      displayName: row.displayName,
      kind: row.kind,
      commentMeta: row.commentMeta,
      enforceSchedule: row.enforceSchedule,
      replayFlag: row.replayFlag,
      hasPassword: row.hasPassword,
      stations: [
        push(this.deps.mainStation, row.mainStreamerRef),
        push(this.deps.testStation, row.testStreamerRef),
      ],
    };
  }
}

/** 16 chars from an unambiguous alphabet — typed into Icecast clients by hand. */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function stripMarker(comments: string): string {
  return comments.replace(/\[ondestudio:[^\]]*\]/g, "").trim();
}
