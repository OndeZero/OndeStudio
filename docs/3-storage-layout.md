# OndeStudio — Media Storage Layout

> **Status:** **draft proposal — v1.1, 2026-07-05 (audit fixes) — pending team validation.**
> Output of the storage-layout design session (PD §10 step 3; resolves the design work
> of open question PD §9.6). The PD requires **explicit team validation** of the concrete
> layout: this document is the proposal the 4–6-person team ratifies before it becomes
> binding. Until then, docs/2 keeps treating the layout as settled-in-principle but
> not-yet-frozen.
>
> **Relationship.** Subordinate to [`docs/1-project_description.md`](1-project_description.md)
> §4.11 (the settled "filetree-first + active conventions" architecture — *not* re-opened
> here) and feeding [`docs/2-implementation_plan.md`](2-implementation_plan.md) §5
> (`media` model, `episode`), §3.5 (MediaStore port) and §8.5 (media browser). `PD §x` →
> project description; `§x` → this document.
>
> **Scope (important).** This designs the **target** layout — what OndeStudio enforces
> once it owns the filetree (phase 2). **Phase 1 does not reorganize the live tree**: it
> reads today's tree as-is and overlays identity/state (file *move/upload* were
> deliberately left untested by the write audit — phase-2 capabilities). The tree **converges** toward this target as
> OndeStudio acts (§6).

---

## 1. Settled principles (from PD §4.11 — fixed, not re-litigated)

- The **filetree is canonical and human-editable** (SFTP / file-manager safe).
- **Identity = audio fingerprint** (tag-independent hash of the audio stream, docs/2
  §5.5) — survives manual moves/renames *and* tag edits.
- Disk mirrors **content typology + object ownership only** — *what a file is, which
  object owns it* — **never** the scheduling/editorial layer (slots, times, states,
  discussions stay DB-only).
- A real **staging zone** exists.
- **Duplicates** are surfaced as warnings, never blocked.

Three operating rules adopted this session make those work in practice:

1. **One physical file lives in exactly one home folder.** Pool/playlist membership is
   **logical** (DB, projected to AzuraCast), never a physical copy — this kills today's
   per-item-playlist proliferation (§3).
2. **No editorial metadata on disk.** All metadata lives in the DB, keyed by fingerprint;
   a manually-moved file is re-identified by its hash. No sidecar files.
3. **A pool/owner folder owns all media recursively beneath it**, down to the next
   designated pool/owner boundary — so custom sub-organization and bulk import "just
   work".

---

## 2. Current state — live survey (2026-06-29, station `oz`, 2712 files / ~470h)

Grounding reality (via the AzuraCast files API, read-only). The current tree is
**inspiration, not a guide** (PD §4.11) — but its shape drove the decisions below.

| Zone today | files | hours | Role | → target (§4) |
|---|--:|--:|---|---|
| `[TRACKS]` | 2259 | 148 | rotation fallback (a dump: 4 importer folders hold ~88%) | `rotation/default/` then split |
| `00 - PODCASTS/<p>` | 182 | 199 | replays (per-podcast → `[PODCAST]` playlists) | `shows/<p>/replays/` |
| `00 - ARCHIVES` | 58 | 43 | retired (mirrors categories; all orphaned) | `archive/…` |
| `[VOCALS]` | 53 | 2 | spoken-word inserts | `inserts/vocals/` |
| `[JINGLES]` | 44 | 0.2 | jingles | `inserts/jingles/` |
| `[MIXS]` | 33 | 30 | night mixes | `rotation/mixs/` (long pool) |
| `[1SHOT]/<session>` | 31 | 13 | one-shots (drop-fed `YYYY-MM-DD HH-MM - <name> (#id)/`) | `oneshots/<slug>/` |
| `[SHOWS]/<show>` | 25 | 23 | shows (mixed internals; some multi-part episodes) | `shows/<show>/` |
| `00 - STOCK` | 18 | 0.1 | staging (PD's "never adopted" zone) | `staging/<drop>/` |
| `[INTERCEPTION]` | 5 | — | interception shorts | `inserts/interception/` |
| `00 - Lives GZ` | 4 | 3.6 | live recordings (orphaned) | `broadcasters/<b>/replays/` |

**What the survey forced into the design:** dates/drop-ids are encoded in folder names
today (→ must move to DB, §4); episodes can be multiple files (→ folder-episodes, §3);
`[TRACKS]` is an unorganized dump (→ pools, gradual split, §6); every show/one-shot folder
is its own AzuraCast playlist (→ logical membership, §1).

---

## 3. Decisions of record (this session)

| # | Decision |
|---|---|
| D1 | **Episode = one file by default**; an **ordered folder-episode** (`media[]`) for genuine multi-part content (airs as one continuous occurrence). |
| D2 | **Rotation = one `rotation/` home** holding short *and* long pools; **mixes are a long pool** (not an insert). Pool `length` (short\|long) + play strategy (shuffle/sequential/recency, cadence) live in the **DB**, not the disk. |
| D3 | **Naming:** lowercase, ASCII-folded, hyphen-slugged; **no `[brackets]`, no `00-` prefixes**; **no dates in paths** (DB holds dates); the drop-id is kept as **provenance metadata**, not in the path. Display names live in the DB. |
| D4 | **Placement-eligibility is OndeStudio-owned** (config/DB, exposed via the API for the drop tool) — *not* encoded in folder names. |
| D5 | **Archive = a folder** (`archive/`) mirroring the active tree; archived = physically moved out, so the recursive pool scan auto-excludes it. |
| D6 | **One-shots get a dedicated `oneshots/` zone.** |
| D7 | **Replays nest under their owner** (`shows/<show>/replays/`, `oneshots/<x>/replays/`, `broadcasters/<b>/replays/`) — **no global `replays/` zone**; event grouping is via tags (PD §4.10). |
| D8 | **Staging groups per drop-session** (`staging/<contributor-or-dropid>/`); pipeline state is DB-only. |
| D9 | **Rollout = gradual convergence + an optional phase-2 assisted bulk-reorg tool** (§6). No big-bang. |

---

## 4. Target layout

```
<media root>/                    (AzuraCast media root for the station)
├─ staging/                      intake; grouped per drop-session; state in DB
│   └─ <contributor-or-dropid>/
├─ shows/                        recurring shows (one folder = one show object)
│   └─ <show-slug>/
│       ├─ <episode>.<ext>           single-file episode
│       ├─ <episode-slug>/           …or an ordered folder-episode (parts)
│       └─ replays/                  this show's processed replays
├─ oneshots/                     ad-hoc single airings
│   └─ <slug>/
├─ broadcasters/                 content owned by a broadcaster, not a show
│   └─ <broadcaster-slug>/
│       └─ replays/                  lives not attributed to a show (e.g. OndePi sets)
├─ rotation/                     fallback pools (recursive scan; pool type in DB)
│   └─ <pool-slug>/                  default/ · mixs/ · <themes>… (short & long)
├─ inserts/                      interstitials
│   ├─ jingles/
│   ├─ vocals/
│   └─ interception/
└─ archive/                      retired content; mirrors the active tree
    └─ <shows|rotation|oneshots|…>/

(outside the media root — sibling path)
recordings/                      NON-LIBRARY — raw live fragments, pre-processing
                                 (processing input for PD §5.8 replays; never aired)
```

**Raw recordings live *outside* the media root** (v1.1 audit fix): everything under the
root is indexed by the media scanner (AzuraCast's today, OndeStudio's later), and raw
fragments would flood the library with never-aired files. They stay where the recording
chain writes them today; replay processing consumes them as input only.

**Eligibility (D4).** Placement targets OndeStudio offers: `staging/`, `shows/<show>/`,
`oneshots/<x>/`, `broadcasters/<b>/`, `rotation/<pool>/`, `inserts/<pool>/`. Never a
target: `archive/`, the out-of-root `recordings/` area, and any `replays/` subfolder
(system-managed). The
rule set is OndeStudio config, exposed via the API so the drop tool can ask "where can
this go?".

**Slugs.** `Minuit Décousu` → `minuit-decousu`, `Habibi Funk Records` →
`habibi-funk-records`. Lowercase, accents folded, spaces→`-`. The human-readable name and
all dates live in the DB.

---

## 5. Conventions summary (what OndeStudio enforces when it acts)

- **Place** a validated contribution → move the file into its eligible home folder (D3/D4
  naming), record fingerprint + identity in the DB.
- **Pool membership** = a DB relation (projected to an AzuraCast playlist in phase 1),
  never a copy. A pool's content = recursive scan of its folder (D2/§1.3).
- **Folder-episode** = an ordered set under one folder; the DB holds the order (D1).
- **Archive** = move to `archive/<mirror>/` (D5) — removes it from any pool automatically.
- **Retire a duplicate?** Never auto-delete; flag by fingerprint, let a human decide.
- **No dates, states, or slugs-with-meaning encoded on disk** beyond content typology and
  ownership (PD §4.11 bounded legibility).

---

## 6. Rollout — gradual convergence (D9)

- **Phase 1:** OndeStudio reads the *current* tree as-is via the MediaStore port (AzuraCast
  files API + scanner). It overlays fingerprint identity and content state; it assigns
  **playlist membership** (write-audit-confirmed) but **moves no files**. The messy tree
  keeps working.
- **Phase 2:** once native file-write lands, every OndeStudio placement/creation applies
  the §4–§5 conventions — the tree **converges to order as the app acts** (PD §4.11).
- **Optional phase-2 reorg assistant:** for the big legacy zones (notably the 2259-file
  `[TRACKS]` dump), a tool proposes batched moves into pools/owners for **team approval** —
  never an unattended big-bang.

---

## 7. Impact on docs/2 (applied alongside this doc)

- **`episode` model (§5.2):** single-file via `media_id`; multi-part via an ordered
  `episode_media(episode_id, media_id, ord)` join (D1).
- **`rotation_pool` (§5.2):** gains `length` (short\|long); strategy/recency/cadence in
  `rules_json` (D2).
- **`media.path` + MediaStore port (§3.5):** anticipate the target layout; phase-1
  implementation maps onto the current tree (§6).
- **Media browser (§8.5):** ownership badges and convention hints follow §4.
- **Open question §14.2** → resolved-as-proposal (this doc), pending team validation.

---

## 8. Deferred / open

1. **Night-mixes: pool vs insert rule.** Storing mixes as a long *rotation pool* (D2)
   refines PD §4.8, which modeled them as an *insert rule*. The **playback mechanism**
   (continuous fill with a cadence strategy vs. a cadenced injection over programming) is
   **not** settled here → the rotation / insert-rules **domain pass** (and a possible PD
   §4.7/§4.8 update). Storage is unaffected either way: mix content lives in
   `rotation/mixs/`.
2. **Team validation** of this whole proposal (PD §9.6) — the gating step before it
   freezes.
3. **Slug collisions / non-Latin titles** — confirm the folding rule on real edge cases
   during M-storage implementation.
