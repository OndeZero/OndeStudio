import { describe, expect, test } from "bun:test";
import { DomainError } from "../../kernel/domain-error";
import { err, ok, type Result, unwrap } from "../../kernel/result";
import { StationId } from "../../kernel/station-id";
import type { MediaFileRecord, MediaStorePort, OwnedFolder, ShowOwnershipPort } from "./ports";
import { ContentService } from "./service";

const oz = unwrap(StationId.parse("oz"));

const file = (path: string, meta: Partial<MediaFileRecord> = {}): MediaFileRecord => ({
  azFileId: path, // any stable value — identity is not under test here
  path,
  durationSec: null,
  title: null,
  artist: null,
  ...meta,
});

/** The real tree's shape in miniature (docs/3 §2): zones, nesting, accents. */
const TREE: MediaFileRecord[] = [
  file("[SHOWS]/Minuit Décousu/ep-01.mp3", { durationSec: 3600, title: "Ep 01" }),
  file("[SHOWS]/Minuit Décousu/parts/part-1.mp3"),
  file("[SHOWS]/Minuit Décousu/parts/part-2.mp3"),
  file("[SHOWS]/Autre Nuit/intro.mp3"),
  file("[TRACKS]/track-a.mp3", { artist: "A" }),
  file("00 - PODCASTS/La Flânerie/ep-01.mp3"),
];

/** A zone-wide folder AND a deeper show folder — the deepest badge must win. */
const OWNED: OwnedFolder[] = [
  { showId: 9, name: "Toutes Zones", path: "[SHOWS]" },
  { showId: 1, name: "Minuit Décousu", path: "[SHOWS]/Minuit Décousu" },
];

function build(
  options: { files?: Result<MediaFileRecord[], DomainError>; owned?: OwnedFolder[] } = {},
) {
  const media: MediaStorePort = {
    listFiles: () => Promise.resolve(options.files ?? ok(TREE)),
  };
  const ownership: ShowOwnershipPort = {
    ownedFolders: () => Promise.resolve(options.owned ?? OWNED),
  };
  return new ContentService({ media, ownership });
}

describe("ContentService.browse", () => {
  test("root: zone directories with direct-children counts, badge on the owned zone", async () => {
    const result = unwrap(await build().browse(oz, ""));
    expect(result.path).toBe("");
    expect(result.entries.map((e) => e.name)).toEqual(["00 - PODCASTS", "[SHOWS]", "[TRACKS]"]);
    expect(result.entries.every((e) => e.kind === "dir")).toBe(true);
    // Direct children only: [SHOWS] holds 2 show folders, not 4 files.
    expect(result.entries.map((e) => e.childCount)).toEqual([1, 2, 1]);
    expect(result.entries[1]?.owner).toEqual({
      showId: 9,
      name: "Toutes Zones",
      path: "[SHOWS]",
    });
    expect(result.entries[2]?.owner).toBeNull();
  });

  test("nested dir: dirs before files regardless of name order, deepest badge wins", async () => {
    const result = unwrap(await build().browse(oz, "[SHOWS]/Minuit Décousu"));
    // "ep-01.mp3" < "parts" by name, but directories come first.
    expect(result.entries.map((e) => `${e.kind}:${e.name}`)).toEqual([
      "dir:parts",
      "file:ep-01.mp3",
    ]);
    const [parts, episode] = result.entries;
    expect(parts?.path).toBe("[SHOWS]/Minuit Décousu/parts");
    expect(parts?.childCount).toBe(2);
    expect(parts?.owner?.showId).toBe(1); // not the shallower [SHOWS] badge
    expect(episode?.file?.durationSec).toBe(3600);
    expect(episode?.file?.title).toBe("Ep 01");
    expect(episode?.owner?.showId).toBe(1);
  });

  test("a sibling outside the drop folder falls back to the shallower badge", async () => {
    const result = unwrap(await build().browse(oz, "[SHOWS]/Autre Nuit"));
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]?.owner?.showId).toBe(9);
  });

  test("stray slashes are forgiven and the normalized path is echoed", async () => {
    const result = unwrap(await build().browse(oz, "/[SHOWS]//Minuit Décousu/"));
    expect(result.path).toBe("[SHOWS]/Minuit Décousu");
    expect(result.entries).toHaveLength(2);
  });

  test("traversal is a validation error", async () => {
    for (const raw of ["../secrets", "[SHOWS]/../[TRACKS]", "[SHOWS]/./x"]) {
      const result = await build().browse(oz, raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("validation");
    }
  });

  test("the root of an empty station exists and is empty", async () => {
    const result = unwrap(await build({ files: ok([]) }).browse(oz, ""));
    expect(result.entries).toEqual([]);
  });

  test("unknown paths — including a FILE path — are not-found", async () => {
    for (const raw of ["nope/nope", "[TRACKS]/track-a.mp3"]) {
      const result = await build().browse(oz, raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe("not-found");
    }
  });

  test("an upstream failure propagates unchanged", async () => {
    const failure = DomainError.upstreamUnavailable("azuracast unreachable: boom");
    const result = await build({ files: err(failure) }).browse(oz, "[SHOWS]");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe(failure);
  });
});
