import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result } from "../../kernel/result";
import type { StationId } from "../../kernel/station-id";
import type { MediaFileRecord, MediaStorePort, OwnedFolder, ShowOwnershipPort } from "./ports";

/** One direct child of the browsed directory, ownership badge attached. */
export interface BrowseEntry {
  kind: "dir" | "file";
  /** Path relative to the media root. */
  path: string;
  name: string;
  /** Directories: direct children count (files + subdirs). */
  childCount: number | null;
  /** Files: the underlying record. */
  file: MediaFileRecord | null;
  /** The deepest drop folder containing this entry (PD §5.4 ownership badge). */
  owner: OwnedFolder | null;
}

export interface BrowseResult {
  /** The normalized browsed path ("" = media root). */
  path: string;
  entries: BrowseEntry[];
}

/**
 * Media-browse use-cases (PD §5.3, docs/2 §11 M2): the upstream's flat file
 * index becomes one directory's listing on read — no tables, no tree cache
 * (docs/2 §2.4; the port stays the substrate until fingerprints land).
 */
export class ContentService {
  constructor(
    private readonly deps: {
      media: MediaStorePort;
      ownership: ShowOwnershipPort;
    },
  ) {}

  async browse(station: StationId, rawPath: string): Promise<Result<BrowseResult, DomainError>> {
    const path = normalizeBrowsePath(rawPath);
    if (!path.ok) return path;

    const files = await this.deps.media.listFiles(station);
    if (!files.ok) return files; // upstream failure propagates unchanged (503 at the edge)

    // Canonicalize index paths too: the live tree mixes NFC/NFD (SFTP intake).
    const canonicalFiles = files.value.map((file) => ({
      ...file,
      path: file.path.normalize("NFC"),
    }));
    const children = deriveChildren(canonicalFiles, path.value);
    if (children === null) return err(DomainError.notFound(`media path "${path.value}"`));

    const owned = [...(await this.deps.ownership.ownedFolders(station))].sort(
      (a, b) => b.path.length - a.path.length, // deepest (longest) drop folder wins
    );
    const entries = children.map((child) => ({ ...child, owner: ownerOf(child.path, owned) }));
    // Dirs first, then name — plain codepoint order: deterministic across
    // locales, and the target naming is ASCII slugs anyway (docs/3 D3).
    entries.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
      return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
    });
    return ok({ path: path.value, entries });
  }
}

type ChildEntry = Omit<BrowseEntry, "owner">;

/**
 * Direct children of `dir` derived from the flat index. Returns null when the
 * directory does not exist — a flat file list cannot represent empty
 * directories, so "nothing underneath" and "unknown path" coincide (the root
 * always exists; a path naming a file is not a directory).
 */
function deriveChildren(files: MediaFileRecord[], dir: string): ChildEntry[] | null {
  const prefix = dir === "" ? "" : `${dir}/`;
  const subdirs = new Map<string, Set<string>>();
  const found: ChildEntry[] = [];
  for (const file of files) {
    if (!file.path.startsWith(prefix)) continue;
    const rest = file.path.slice(prefix.length);
    if (rest === "") continue; // `dir` names this very file
    const slash = rest.indexOf("/");
    if (slash === -1) {
      found.push({ kind: "file", path: file.path, name: rest, childCount: null, file });
      continue;
    }
    const name = rest.slice(0, slash);
    const children = subdirs.get(name) ?? new Set<string>();
    // The subdirectory's own direct child: the first segment after it.
    const inner = rest.slice(slash + 1);
    const innerSlash = inner.indexOf("/");
    children.add(innerSlash === -1 ? inner : inner.slice(0, innerSlash));
    subdirs.set(name, children);
  }
  if (dir !== "" && found.length === 0 && subdirs.size === 0) return null;
  for (const [name, children] of subdirs) {
    found.push({
      kind: "dir",
      path: `${prefix}${name}`,
      name,
      childCount: children.size,
      file: null,
    });
  }
  return found;
}

/** The deepest configured drop folder containing the path (`owned` is pre-sorted deepest-first). */
function ownerOf(path: string, owned: OwnedFolder[]): OwnedFolder | null {
  return (
    owned.find((folder) => {
      const prefix = folder.path.normalize("NFC"); // legacy rows may predate NFC writes
      return path === prefix || path.startsWith(`${prefix}/`);
    }) ?? null
  );
}

/**
 * Browse paths are relative to the station media root: leading/trailing and
 * doubled slashes are forgiven, traversal is not; "" is the root.
 */
function normalizeBrowsePath(raw: string): Result<string, DomainError> {
  // NFC first: macOS SFTP clients write NFD, the AzuraCast index may hold
  // either — ownership prefixes must compare on one canonical form.
  const cleaned = raw
    .normalize("NFC")
    .trim()
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "");
  if (cleaned.split("/").some((segment) => segment === "." || segment === "..")) {
    return err(DomainError.validation(`invalid media path: ${raw}`));
  }
  return ok(cleaned);
}
