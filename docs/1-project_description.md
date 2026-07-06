# OndeStudio — Project Description

> **Status:** living document — v2.13, 2026-07-05 (final pre-build audit applied)
> **Nature:** contexts / goals / guidelines — the bridge between the team's ideas and
> needs on one side, and implementation decisions on the other. This is *not* an
> implementation plan; that will be a separate document (`docs/2-…`) informed by this
> one.
>
> **How to read.** §2 describes the world as it is today. §3 states what OndeStudio
> must and must not be. §4 defines the domain vocabulary — these concepts are
> normative: the implementation must honor them. §5 walks through the functional
> areas. §6 sets the three-phase architecture strategy, its synchronization rules and
> the MVP boundary. §7 gives technology and API orientations; §8 the design/development
> guidelines. §9 lists what is intentionally still open; §10 the concrete next steps.

---

## 1. Overview & vision

**OndeStudio is a new open-source WebRadio studio interface**: the single place where
a radio team plans its schedule, manages its content, discusses and decides — and
where those decisions actually take effect on air.

The two main open-source platforms today are
[AzuraCast](https://github.com/AzuraCast/AzuraCast) and
[LibreTime](https://github.com/libretime/libretime). Both have strengths and
weaknesses; neither matches our use cases (§2.4). OndeStudio therefore starts as a
**supercharged interface on top of AzuraCast** and progressively replaces it, until
it stands as a fully autonomous, installable application (§6).

OndeStudio is also the future center of a small **galaxy** of components already in
production around the station: the public player (OndePlayer), the contribution tool
(drop), and the field streaming boxes (OndePi). The galaxy integrates progressively;
one satellite (OndePlayer) is ultimately absorbed (§3.2, §6).

**Positioning: wavezero-first, generic later.** Design decisions are driven by the
real workflow of one production station, [wavezero.world](https://wavezero.world).
Genericity is welcome whenever it costs little, but never blocks us. The
full-replacement phase (phase 3) is where OndeStudio becomes a properly packaged
product usable by any station.

---

## 2. Context

### 2.1 OndeZero & wavezero.world

[OndeZero](https://github.com/OndeZero) runs **wavezero.world**, a public,
international webradio station. The core team is **4–6 people** — station
managers/programmers who are also, for most of them, broadcasters. Development of
OndeStudio is carried by one person with AI assistance, with no hard deadline:
quality and sustainability over speed.

People interacting with the station's production:

| Role | Description | OndeStudio access |
|---|---|---|
| **Managers / programmers** | Full control: grid, content, validation, station settings | Full interface |
| **Team broadcasters** | "Unlimited" accounts — may go live anytime, manage their own shows | Full interface |
| **External broadcasters** | Restricted accounts — live only on their negotiated slots | Lightweight dedicated page (auth via their Icecast credentials) to update their slot/show info; later, a WebDJ-equivalent to broadcast from the browser |
| **External contributors** | Send content through the public drop tool; no account | No direct access (§3.2) |

### 2.2 Current toolchain & infrastructure

Everything runs on a single server, `onde-zero`. This inventory combines the original
draft, server exploration and a full API scan (2026-06).

**The playout core — AzuraCast 0.23.3** (Docker, `/var/azuracast`), at
`studio.ondezero.net`. Two stations, Icecast frontend + Liquidsoap backend,
Europe/Paris timezone:

| | **WaveZero** (main) | **WaveZero-TEST** |
|---|---|---|
| Shortcode | `oz` | `wz-test` |
| Frontend / DJ port | 8000 / **8005** | 8010 / **8015** |
| Live recording | on (mp3) | off |
| Schedule enforcement | per account | always off |
| Public player | wavezero.world | test.wavezero.world (b&w background, short rotation) |

The media library holds ~2 700 files / ~470 h of audio (2026-06-29 survey — see
[`docs/3-storage-layout.md`](3-storage-layout.md) §2). No AzuraCast webhooks are
configured (OndePlayer relies on SSE + polling).

**The test station is a deliberate mirror.** Every broadcaster account exists on both
stations with identical settings (server `wavezero.world`, mountpoint `/input`, same
credentials — duplicated by hand today), **only the port differs**. The goal: any
broadcaster can test their setup against the test station without restriction, then
go on air on the main station at the scheduled time by changing nothing but the port.
(The 2026-06 scan found the predictable manual-mirroring drift: two accounts missing
on test, two leftover test accounts — see §2.3.)

**A custom Liquidsoap layer** lives in the main station's custom config — playout
logic that phases 2–3 must understand and eventually own (§6):

- a **second live input** `/input2` with its own auth hook and priority fallback
  (standard input wins) — dormant today, probably intended as failover, never really
  used;
- a **custom live-recording chain** (320 kbps mp3 fragments per DJ,
  `stream_YYYYMMDD-HHMMSS.mp3`) alongside AzuraCast's native recording — these are
  the files the replay pipeline consumes;
- a legacy **"interception" command**: a server trigger that smoothly overlays a
  short from the `[INTERCEPTION]` pool on top of the program — rarely used,
  documented for completeness, no UI planned (§4.8);
- a full **broadcast mastering chain** (`master_me`: −16 LUFS target, multiband
  compression, limiter, brickwall) on the station output;
- live metadata forced at Liquidsoap level to `artist="● LIVE"`,
  `title=<DJ display name>` — the implementation of the display-name workaround.

**The replay pipeline** (`/srv/data/stations/oz/podcaster.sh`, cron-run): AzuraCast
auto-records live streams per streamer as fragmented `stream_*.mp3` files; the script
concatenates each day's fragments, encodes to opus, tags via a hardcoded
streamer→artist mapping, and moves the result into `00 - PODCASTS/<Artist>/`. That
folder auto-feeds the `[PODCAST]` playlists, which back the AzuraCast podcast section
(six podcasts today) powering the **Replays** section of the public player.

**The satellites** — components OndeStudio must coexist with, then integrate:

- **OndePlayer** (`/opt/OndePlayer`, systemd, Bun-powered multi-station web app) —
  the public player and site. Already implements two mechanisms directly relevant
  here: an **enriched Upcoming builder** (fetches playlists and streamers with their
  `schedule_items` from the AzuraCast API, expands weekly recurrences over 30 days,
  merges and deduplicates) and **live-meta-sync** (watches AzuraCast SSE for
  live transitions and pushes corrected metadata *back* through the API — a working
  precedent of bidirectional integration).
- **wavezero-form** (`drop.wavezero.world`, redbean + SQLite) — public contribution
  tool with a moderation interface; anyone can freely share contributions.
- **OndePi** ([github.com/Maigre/OndePi](https://github.com/Maigre/OndePi)) —
  Raspberry-Pi "ready to stream" boxes; two exist (`ondepi-1`, `ondepi-2`),
  registered as unlimited team broadcaster accounts. Used for live music, mobile
  conference recording, street interviews, studio lives… (§5.7).

**The editorial tools OndeStudio replaces:**

- **Wekan** — trello-like board for discussion, labeling and status dispatch of
  contributions, todo/done tracking. *The current Wekan workflow is acknowledged as
  clumsy; OndeStudio's board is a fresh design, not a Wekan clone.*
- **A spreadsheet** — the schedule grid, maintained by hand with color codes.

Contribution formats are diverse: individual tracks, collections of mixes, recorded
shows (episodic), vocals, poems, stories…

### 2.3 Pain points

The core problem is **fragmentation**: AzuraCast for production, Wekan for discussion
and status, a spreadsheet for the grid. Processing one item means touching several
tools; they drift out of sync and end up outdated, which confuses team collaboration.
The recurring frictions group into four themes:

**No real schedule grid.**

- The calendar view of the station's life — with negotiation states and content
  states — exists only as a hand-maintained spreadsheet disconnected from playout
  reality.
- Scheduling in AzuraCast is slow and click-intensive: anything schedule-related
  takes many unintuitive steps. It needs to be visual, easy and fast to add, edit,
  update and inspect.

**Announcing things requires hacks.**

- *Stale "Upcoming" metadata*: recurring shows are announced by generic name;
  detailed episode metadata arrives late ("just in time"). Updating the announcement
  on episode arrival, then reverting to the generic name once the slot (and its echo)
  has played, is manual and usually skipped — the public Upcoming mostly shows
  generic names.
- *The dummy-playlist hack*: announcing a team broadcaster's planned live session
  requires creating a fake playlist in AzuraCast just so it appears in the schedule
  and Upcoming — then information must be updated in multiple places.
- *OndePi metadata juggling*: a live done with an OndePi box needs a dummy playlist
  per upcoming session **plus** manual edits of the broadcaster account's Comment
  field for the "Now playing" meta. Two upcoming lives on the same box (e.g. Friday
  then Saturday) mean two dummy playlists and a comment swap between the shows.

**Manual duplication, predictable drift.**

- Every broadcaster account exists twice (main + test station, §2.2) with manually
  synced credentials; every change is a double edit. The 2026-06 scan found the
  resulting drift: two accounts missing on test, two leftovers. (OndeStudio's initial
  import reconciles this, each fix subject to approval — §6.)
- Echo slots are manual: rebroadcasting an episode on a second slot, week after week,
  with synced metadata, is unsupported and error-prone.

**Opaque or crude automation.**

- Rotation is a black box: the `[TRACKS]` fallback playlist runs whenever nothing
  else is eligible, invisible in any schedule, with no lifecycle for what enters or
  leaves it — and its shuffle feels broken (§2.4).
- The replay pipeline is crude: day-fragments are concatenated blindly (two different
  lives on the same day would merge into one file), the streamer→artist mapping is
  hardcoded in the script, and the opus encode target breaks the web player (no
  duration shown).

### 2.4 Why neither AzuraCast nor LibreTime fits

**AzuraCast** was chosen to run wavezero.world and does a good production job overall
(playout, streaming, broadcaster accounts, API). Two families of shortcomings drive
this project.

First, it lacks the **editorial and collaborative layer**: a calendar/grid-centric
view where shows and live slots carry *negotiation states* (pre-booked, discussion in
progress, validated…) and *content states* (content missing, ready, in error…),
continuous rotation blocks as first-class scheduled objects, and a place for team
discussion and decision attached to the content itself.

Second, several of its mechanisms are **cumbersome or unintuitive** for our use
cases:

- the dummy-playlist workarounds described in §2.3;
- schedule editing is unintuitive and click-intensive;
- "everything is a playlist" is too restrictive a model for most of our usages;
- the shuffle rotation algorithm is obscure and feels broken (some songs noticeably
  play much more than others);
- the playlist-vs-media-folder duality can be powerful to some extent (e.g.
  auto-filling a playlist when a file is dropped in a folder) but is sometimes buggy
  (e.g. the known sequential one-episode trigger issue, forcing the team to delete
  the previous episode whenever adding a new one so the right one is picked) and
  often counter-intuitive or many clicks away from an efficient workflow.

That last point raises an important design choice for OndeStudio: **media storage
organization must be intuitive, fit the schedule-grid logic, and avoid duplicates** —
while preserving per-file metadata and playback history even when the team manually
adds/moves/deletes files in the filetree (something AzuraCast handles well). This is
settled architecturally in §4.11; the concrete layout remains open (§9).

**LibreTime** was only quickly evaluated: nice UI styling, but the dual-panel
navigation is very unintuitive, and several blockers rule it out:

- **no general rotation fallback** — every slot must be explicitly filled or the
  station falls silent; inserting a show means re-cutting the general rotation slot
  in two pieces, which is not handy;
- **live slots are hard-enforced**: no equivalent of our unlimited team broadcasters
  who can take the air anytime; a broadcaster starting late or finishing early
  produces silence — not workable;
- the same rigidity applies to recorded shows: we often book 1-hour slots while
  programs run shorter or longer, and that must not be an issue (§4.3);
- file storage seems messy too: no way to properly organize or touch the filetree
  without messing with the app.

These observed failures directly shape OndeStudio requirements: rotation as universal
fallback (§4.7), soft slot boundaries (§4.3), broadcaster flexibility (§8.1), and a
storage design that tolerates manual filetree management (§4.11).

---

## 3. Goals & non-goals

### 3.1 Goals

1. **One centralized, comprehensive workspace** replacing the
   AzuraCast-UI + Wekan + spreadsheet triad for daily editorial work — including
   broadcaster account management with its main/test fan-out (§5).
2. **A calendar/grid-centric schedule** where every slot carries a negotiation state
   and a content state, covering shows, live sessions, echo slots and rotation
   blocks (§4, §5.1).
3. **A collaborative discussion board**, team-internal, midway between a trello-style
   board and stack-overflow-style discuss-and-vote, attached to contributions, slots
   and decisions (§5.2).
4. **Real effect on air**: scheduling decisions taken in OndeStudio are applied to
   the playout system (via the AzuraCast API first), not merely tracked (§6).
5. **Hierarchical, right-depth access**: heavyweight flows (schedule a show: grid
   placement, content management, discussion) and lightweight flows (quickly fix the
   metadata of the currently-aired or upcoming item) are both first-class (§5.5,
   §8.1).
6. **Progressive autonomy**: an architecture that starts as an AzuraCast overlay and
   ends as a standalone product (§6).
7. **Welcoming to contributors — human and AI**: the codebase stays modular and
   low-cognitive-load by design, so external peers and AI agents can grasp and extend
   it without hitting a complexity wall. This is a first-class requirement, not a
   nicety (§8.2).

### 3.2 Non-goals

- **Listener-facing interaction.** No public requests, votes or comments. The public
  hears the stream and sees the player; interaction with the station's content is for
  the team (external contributors go through the drop tool's existing flow).
- **Replacing the drop tool in phase 1.** Direct intake from `drop.wavezero.world`
  into OndeStudio is planned for a later phase; the design anticipates it, phase 1
  does not implement it.

Podcast publishing and listener analytics are not phase-1 concerns but are *not*
excluded long-term: "fully replace AzuraCast" eventually includes its useful
peripheral features. Similarly, **OndePlayer is ultimately meant to be absorbed** by
OndeStudio as its public-facing module (player + site), once the studio core is
solid.

---

## 4. Domain concepts

The shared vocabulary of the project. These concepts are **normative**: they
structure the UI, the data model and the API, whatever the implementation. Index:

| Concept | In one line | § |
|---|---|---|
| Slot | anything occupying grid time: show occurrence, series, echo, live, rotation block | 4.2 |
| Soft boundaries | slots frame content, they never cut it; rotation fills the gaps | 4.3 |
| Negotiation state | the human decision process of a slot | 4.4 |
| Content state | whether what should air is actually ready | 4.4 |
| Show / episode | recurring editorial entity / one deliverable airing on slots | 4.5 |
| Episode queue | drop folder feeding a show's occurrences automatically | 4.5 |
| Fallback policy | per-show behavior when no episode is available | 4.5 |
| Contribution | submitted content; one generic pipeline, per-item destination | 4.6 |
| Rotation pool | themed fallback pools with rules and lifecycle | 4.7 |
| Insert rule | pool + cadence + window + placement policy (jingles, night mixes…) | 4.8 |
| Pinning | forcing a specific item on a specific occurrence (night mixes) | 4.8 |
| Broadcaster / session | live source (team or external) / one actual continuous live | 4.9 |
| Tags | shared labels; double as lightweight event grouping | 4.10 |
| Fingerprint | audio content hash; identity that survives manual file operations | 4.11 |
| Access & identity | team (full) vs external (own slots, Icecast creds); reuse AzuraCast auth | 4.12 |
| Assignment | one or more responsible members per object; basis for notifications | 4.13 |
| Discussion card | thread anchored to an object or standalone; intent + votes + outcome | 4.14 |

### 4.1 Schedule grid

The central object: a calendar (week-grid-centric, with other zoom levels) showing
everything that airs or may air. Everything visible on the grid is a **slot** of some
kind, colored/badged by its states. The grid is not a passive visualization: it is
the primary editing surface (create, move, negotiate, validate).

### 4.2 Slot types

- **Recurring show slot** — a weekly (or otherwise recurring) slot bound to a show
  whose episodes arrive just in time. Carries the show's generic identity; gets
  enriched with episode metadata when content arrives; reverts to generic after
  broadcast.
- **Opportunistic recorded series** — we receive a finite set of episodes (e.g. 4)
  and schedule them on recurring (or ad-hoc) slots for the duration of the set (e.g.
  one per week for 4 weeks). Each occurrence is individually movable. Both this and
  the recurring show slot are fed by the same **episode queue** mechanism (§4.5) —
  only the queue depth differs.
- **Echo slot** — a second broadcast of the same episode (e.g. episode aired Tuesday
  14:00, echoed Saturday 15:00). By default follows the original week after week, but
  each occurrence is individually movable. Metadata stays synced with the original.
  Echoes also cover **recorded live sessions** (not a current practice, anticipated):
  an echo slot can be pre-bound to a *future* live — its content state stays `empty`
  and auto-fills once the live's recording is processed and attributed (§5.8), with
  the per-show fallback policy (§4.5) applying if the recording never materializes;
  alternatively, any past session can be picked from the recordings library.
- **Live slot** — a planned live session. For external broadcasters it is also the
  permission boundary (they can only go live during their slot). For team
  broadcasters ("unlimited") it is an announcement: they can go live anytime, but a
  planned slot puts them in the grid and the public Upcoming — without today's
  dummy-playlist hack.
- **Rotation block** — continuous rotation as a first-class, visible grid object
  (§4.7), not invisible background behavior.
- **Night mixes** — schedule-constrained cherry-picking of long mixes during night
  hours: random selection from a dedicated pool by default, with the ability to
  **pin** a specific mix to a specific night. Implemented as an insert rule (§4.8),
  not a slot type.

### 4.3 Soft slot boundaries

Slots are frames, not hard cuts. A 1-hour booking must tolerate content that runs
shorter or longer:

- content or live **ending early** → general rotation takes over (never silence);
- content or live **running late** → it is not cut, *unless* the next scheduled show
  starts;
- live sessions tolerate late starts the same way (rotation plays until the
  broadcaster connects).

Combined with the universal rotation fallback (§4.7), this is the exact inverse of
LibreTime's rigidity (§2.4) and a **non-negotiable scheduling semantic**. In phase 1
this behavior is whatever AzuraCast's scheduling + rotation fallback already provides
(the team lives with it today); OndeStudio gains full control over it only when it
takes over scheduling in phase 2 (§6).

### 4.4 States

Two orthogonal state families, both visible at a glance on the grid.

**Negotiation state** — human-driven: where the slot stands in the team process.

```
              ┌─→ declined
pre-booked → dealing → validated → (aired)
                       └─→ cancelled
```

- `pre-booked` — a hold: the slot is penciled on the grid to reserve the space while
  things get sorted. Team-visible only.
- `dealing` — actively negotiated, linked to a discussion-board card.
- `validated` — confirmed. **Only validated slots reach the public Upcoming.**
- `declined` — never got to yes; kept as a ghost for history.
- `cancelled` — was validated, then called off (the public may have seen it
  announced — hence distinct from declined).
- `aired` — automatic, time-driven, not a human action.

**Reversibility (decided 2026-07-07):** the human states are freely reversible —
a `cancelled` slot may end up `validated` again, a `declined` ghost can be
revived, a `validated` slot can reopen as `dealing`. The diagram shows the
*typical* forward path, not a constraint; only `aired` is one-way (time-driven).

Slots with nothing to negotiate (e.g. a team member's own show) can be born directly
`validated`; likewise a `pre-booked` hold may jump straight to `validated` without
passing through `dealing`.

**Content state** — mostly automatic: whether what should air is actually ready. A
primary pipeline `empty → received → ready → aired`, plus orthogonal **issue flags**
attachable at any point:

| Flag | Examples |
|---|---|
| `technical` | wrong format, bad loudness, corrupt file, duration mismatch vs slot |
| `metadata` | missing title/description; placeholder meta awaiting completion |
| `editorial` | quality doubts, rights/licensing questions, needs team review |

On the grid the two families render on separate visual channels — the slot frame
carries the negotiation state, the inner fill carries the content pipeline, warning
icons carry raised flags (rendering spec: implementation plan §8.4).

For **live slots**, `ready` has a concrete meaning: the broadcaster's setup has been
verified against the test station (§2.2, §5.10).

A slot can be `validated` (negotiation) and still `empty` (content) — that
combination is precisely what the team needs to see coming. Rotation blocks don't
carry per-slot content states; their health is a pool concern (§4.7).

### 4.5 Shows, episodes, queues and fallback

A **show** is the recurring editorial entity (name, identity, slot bindings); an
**episode** is one deliverable airing on one or more slots (original + echoes).

**Episode queue.** A show with recurring slots can be matched to a **drop folder**:
episodes landing there (the initial batch or later arrivals) form a queue, ordered by
arrival and manually reorderable. Upcoming slot occurrences consume the queue
automatically: a new episode fills the **nearest empty occurrence** (including the
current week's if still empty), its content state flips from `empty` to
`received`/`ready` without anyone touching the grid, and echo slots inherit. This one
mechanism serves both the opportunistic rec'd series (deep, finite queue) and the
just-in-time recurring show (queue depth ~1).

**Fallback policy.** When the queue runs dry for an occurrence, the show's policy
applies — `discard the slot` (rotation covers it) or `replay previous episode` — set
as a per-show default and overridable for any specific week.

**Trust setting.** A per-show setting decides whether auto-fed episodes air directly
or are flagged for a quick review before reaching `ready`.

### 4.6 Contribution pipeline

Contributions of any format follow **one generic pipeline**:
`received → discussed → validated → placed`, where *placement* assigns a
**destination**: a rotation pool, the night pool, a slot/series, etc. The format
(track, mix, recorded show, vocal, poem, story…) is an attribute, not a separate
pipeline. Intake is manual at first; automated intake from the drop tool comes in a
later phase (§3.2).

### 4.7 Rotation pools

Rotation graduates from "single fallback playlist" to a managed system:

- **Multiple themed pools** assignable to different dayparts/blocks.
- **Visible in the grid** as explicit filler blocks.
- **Rules and weighting**: weights, artist separation, recency, ratios between
  categories — replacing AzuraCast's opaque shuffle (§2.4).
- **Pool lifecycle**: what enters (from validated contributions), what leaves, with
  states and history.

### 4.8 Insert rules (interstitials)

Periodic injections over the base programming — a concept distinct from slots. An
**insert rule** = a content **pool** + a **cadence** (every X minutes or every N
tracks) + an **active window** (always, or time ranges) + a **placement policy**
stating where insertion is allowed (e.g. over rotation only, between shows, never
inside lives) — the policy is defined per rule.

One concept unifies three mechanisms that exist today as AzuraCast
`once_per_x_minutes` playlists: **jingles** (every 30 min around the clock),
**spoken-word inserts** (`[VOCALS]`: every 2 h in a morning window, sequential —
currently disabled), and the **night-mix mechanism** (`[MIXS]`: shuffle from the
pool, at most one insertion every 6 h within the 22:00–09:00 window, no repeats —
roughly two mixes a night with rotation filling in between). The night rule adds what
AzuraCast cannot do: **pinning** a specific mix to a specific night (§4.2).

On the grid, insert rules appear as a **thin overlay band** on their active windows —
visible but not slot-like; full editing lives in the rotation/inserts panel (§5.9).

A **manual-trigger variant** exists today as the legacy Liquidsoap "interception"
command (§2.2) — rarely used; documented for completeness, no UI planned.

### 4.9 Broadcasters and sessions

- **Team ("unlimited")** — may go live anytime; planned slots are announcements.
- **External ("restricted")** — live only during negotiated slots; authenticate
  against their existing Icecast credentials for a lightweight self-service page;
  later, a browser-based WebDJ equivalent.

A **session** is one actual continuous live performance as it happened on air —
distinct from the slot that announced it. Sessions are reconstructed from recording
fragments and attributed to slots (§5.8); slots are estimates, sessions are reality.

### 4.10 Metadata model

Today the station maintains **title + description** per show/episode. The model must
anticipate (without requiring yet): artwork, credits & links, tags, tracklists.

**Tags double as lightweight event grouping**: slots, recordings and podcasts sharing
a tag (e.g. a multi-day special coverage like the flotilla broadcasts) can be
filtered and browsed together — no dedicated "event" structure beyond that.

### 4.11 Media library & storage

The way files are organized must be as intuitive as the grid itself. Settled
architecture — **"filetree-first + active conventions"**:

- The **filetree is canonical and human-editable**: the team keeps adding, moving and
  deleting files by hand (SFTP, file manager) without breaking anything.
- Every file is identified by **audio fingerprint** — a tag-independent content hash
  of the audio stream — so metadata and play history survive manual moves, renames
  *and* metadata retagging (tag edits must never change identity).
- When **OndeStudio itself** performs an action (placing a validated contribution,
  creating a show), it physically applies the folder convention — the tree converges
  toward order every time the app acts, and grid placement and disk placement become
  the same gesture.
- **Duplicates** are detected by fingerprint and surfaced as warnings, not blocked.
- **Episode selection is deterministic**: a slot points at the exact episode that
  will air. (Today's AzuraCast folder→playlist feeding forces the team to delete the
  previous episode when adding a new one to be sure the right one plays.)

**App ↔ disk legibility — bounded.** The physical tree must mirror the app's
**content typology and object organization** — shows, pools, content categories:
what a file *is* and which object owns it — so that someone who mostly works in
OndeStudio and occasionally accesses the same tree over **bare SFTP** finds their way
immediately, with the same grouping and naming logic as the app's library and pages.
It deliberately does **not** mirror the scheduling and editorial layer: slots, times,
states and discussions live in the database only, and no over-complex nested
architecture should be invented to encode them on disk. The disk reflects *what
content is*; the app orchestrates *when and how it airs*. Within that boundary, the
disk layout is a first-class user interface and a hard constraint on the layout
redesign below.

The **layout itself will be redesigned from scratch** — the current tree
(`[SHOWS]/[Name]/`, `[1SHOT]`, `[MIXS]`, `[TRACKS]`, `00 -` zones) is inspiration,
not a design guide; the redesign includes a proper **staging zone** (the intended
`00 - STOCK` was never really adopted) and requires explicit team validation (§9). The
concrete layout proposal is now drafted in [`docs/3-storage-layout.md`](3-storage-layout.md),
pending that validation.

**Phase-1 substrate.** In phase 1 the media layer *is* AzuraCast's: OndeStudio uses
its files API and scanner (list, assign files to playlists, index manual SFTP edits —
confirmed in the write audit; upload stays out of the MVP, intake continues over
SFTP / the AzuraCast UI) and overlays its own identity and state (fingerprints —
computed by reading the media filesystem read-only, OndeStudio running on `onde-zero`
beside AzuraCast — and content states) keyed to those files. OndeStudio takes over the
filetree natively in phase 2 (§6). The filetree-first principles above are the target
model; phase 1 honors them through AzuraCast's already-capable media management.

In the app, the filetree is browsed and manipulated through the **media browser**
(§5.3), a major UI surface alongside the grid.

### 4.12 Access & identity

OndeStudio **owns its own user/session store**, provisioned and synced from AzuraCast
accounts (decided 2026-06-16; §7.1) — so the team keeps one identity while OndeStudio
stays decoupled from AzuraCast and ready for phase 3 (when AzuraCast disappears but
auth must remain). Two access levels for now:

- **Team** — full access to the whole interface (grid, content, board, settings). The
  4–6 core members; every team member is fully trusted.
- **External broadcaster** — restricted: authenticates with their existing Icecast
  credentials, reaches only their own slots and show metadata through the
  self-service page (§4.9, §5.6).

A finer split *inside* the team level — separating general/technical settings from
day-to-day operation — is anticipated but deliberately deferred (§8.1).

### 4.13 Assignment & ownership

Any object — a contribution, show, slot, episode or board card — can carry one or
more **assignees**: team members responsible for it. Assignment is the backbone of
awareness (§5.12): it turns impersonal state ("slot validated but empty") into
directed attention ("*your* slot needs content"). The model starts minimal (an
assignee field on the core objects) but is designed in from the start, so every
object has someone a notification can address.

### 4.14 Discussion cards

A **card** is a discussion thread carrying a status, votes and assignees — the unit of
the board (§5.2). The board is not a parallel universe of items (the Wekan trap): a
card is either

- **anchored** to a domain object — a show, slot or contribution — in which case the
  same thread also appears on that object's hub page (§5.4); or
- **standalone** — no object yet.

Every card has an **intent**: `discussion`, `idea`, `prospect` (an artist to dig
into, a person to contact…), or `task`. Intent is orthogonal to anchoring — a "general
discussion" is simply an unanchored `discussion`.

A card moves through one **status** lane that serves both talk and tasks:
`open → in progress → done → archived`. When a discussion concludes, its
**outcome** is recorded explicitly — rather than buried in the thread — and the
outcome can spawn an action (create the slot, assign someone).

**Promotion** is the continuity mechanism: an `idea` or `prospect` card can be
**promoted** into a real object (slot, show, contribution), re-anchoring the card to
it and carrying the whole thread along — so the conversation that led to booking an
artist stays attached to the slot it produced. Cards feed assignment (§4.13) and
notifications (§5.12).

---

## 5. Functional description

What OndeStudio does, area by area. Feature-level detail belongs to the
implementation plan; this section sets scope and intent.

### 5.1 Schedule grid

The home of the application. Calendar views showing all slot types with their
negotiation and content states (color codes / badges — the spreadsheet's color
language, made live). Direct manipulation: create, move (drag), edit, duplicate into
echoes, change states. Filtering by state ("what's validated but content-less next
week?"), by show, by type. The grid both *reads* reality (what AzuraCast will
actually play) and *writes* it (decisions apply to playout). Adding, editing,
updating and inspecting must be visual, easy and fast — the exact opposite of the
current AzuraCast experience.

Three zoom levels:

- **month** — negotiation overview: compact state badges, spotting holes and pending
  discussions weeks ahead;
- **week (starting Monday)** — the primary working view: full states, drag & drop,
  slot creation;
- **3-day rolling** — detail view centered on today, comfortable on mobile and for
  last-minute operations.

Slots are directly manipulable — **drag, drop, resize**, quick-edit — and their
rendering carries scheduling truth: the **booked frame** shows the reserved duration,
while an inner **fill shows the actual content length** once populated — an under-run
is a visible gap rotation will cover, an over-run raises an **overlap indicator**
against the next slot (soft-boundary semantics, §4.3). All of this remains editable
on mobile, even where less comfortable than desktop.

Two grid-home decisions (2026-07-05): edits apply **instantly, with an undo window** —
no staged "pending sync" state (write mechanics: implementation plan §7.5, §8.4); and
the grid docks a slim, collapsible **attention rail** — the user's notifications,
problem slots, a one-line on-air status — so the home surface answers both "what's the
week" and "what needs me" (§5.11, §5.12).

### 5.2 Discussion board

The board is the **process lens** (§5.4) over discussion cards (§4.14): one surface
where every thread — anchored to a show/slot/content or standalone — surfaces, gets
triaged, voted and tracked. Fresh design, explicitly *not* a Wekan clone; team-internal
(§3.2).

**One board, pivotable.** Rather than fixed columns or a flat feed, the board groups
by workflow status by default, with a single **group-by switch** (status / intent /
assignee) and a **sort toggle** — by votes ("what does the team most want on air?") or
by recent activity ("what's hot, what's gone stale"). One surface, re-pivoted, in the
spirit of few views and few clicks.

**At-a-glance cards.** Each card face shows its subject, an intent badge and (when
anchored) a chip to its object, the vote tally, assignee(s), status, and a
**discussion-state indicator** — last-reply time, reply count, an unread dot, and a
one-line snippet of the latest reply — so the state of a conversation is graspable
without opening it. A click expands the full thread and history.

**Voting** uses a small fixed emoji set with defined meanings — proposed 👍 want-on-air
/ 🔥 love / 🤔 needs-discussion / 👎 no, tunable in build — one vote per person per
card, changeable; the tally optionally drives the sort.

Because cards are anchored to real objects and can be **promoted** from idea or
prospect into a booked slot (§4.14), the board never drifts away from the schedule
it discusses — the failure mode of the current Wekan workflow.

### 5.3 Content intake, library & media browser

The content library tracks every piece of content with its pipeline state and content
state (§4.4, §4.6). Manual intake first (file + minimal meta), drop-tool integration
later (the design reserves the entry point). Placement assigns content to
destinations: rotation pools, night pool, slots/series. Shows expose their **drop
folders** feeding the episode queue (§4.5) — for episodic content, placing a file
*is* the intake.

**Media browser.** Since media storage is a primary entry point (§4.11), OndeStudio
ships a **file/media browser alongside the grid** as a major UI surface: browse the
canonical filetree and manipulate files easily — upload, move, rename, delete,
organize — like AzuraCast's media manager, but with a better, more ergonomic UX. The
browser surfaces the §4.11 mechanics (fingerprint identity, duplicate warnings,
convention hints when a file sits outside its expected place) and links each file to
its domain objects (show, episode, pool, slot). Its detailed UX design is deferred to
the implementation phase.

### 5.4 Object pages & show library

The grid (§5.1), the board (§5.2) and the media browser (§5.3) are **lenses** — the
same reality seen by *time*, by *process* and by *disk*. None of them is where a show
"lives": every domain object has one canonical **page**, the hub the lenses link
into.

The **show page** is the flagship: identity and metadata, slot bindings with next and
past occurrences (a mini-schedule), the **episode queue with its files** (a scoped
media browser of the show's own folder — possible because conventions bind
folder ↔ show, §4.11), per-show settings (fallback policy, trust, replay flag,
contributor timezone), linked board cards, and the show's recordings/replays. It is
the "meta view" that groups files, meta and features without drowning in the global
filetree.

The **show library** is the index of those pages: a master-detail surface — shows
list (sortable, filterable, with state summaries) on one side, the show page as the
detail pane on the other; the same page is also URL-addressable full-screen.

**One navigation rule keeps clicks low**: any object in any lens is one click from
its page, and the page links back into each lens — jump to the grid at the next
occurrence, open the folder in the browser, open the board card. In the media
browser, an **ownership badge** on folders/files tells what each one *is* and links
to its page. The familiarity works both ways: because the disk conventions mirror
the app's content typology (§4.11), a team member used to OndeStudio still finds
their way instantly when accessing the same tree over bare SFTP.

Shows come first; **broadcasters, rotation pools, recordings/sessions and
contributions** get the same hub treatment over time.

### 5.5 Upcoming & quick metadata editing

A dedicated lightweight flow — usable on mobile — to edit what the audience sees now
and next: enrich a recurring show's announcement when the episode arrives, fix the
currently-aired metadata, with automatic revert-to-generic after the slot (and
echoes) have played. This feeds OndePlayer's Upcoming display — through AzuraCast at
first, then directly from OndeStudio's API once phase-1 write-back lands (§6).

### 5.6 Live broadcasting management

Plan live slots for both broadcaster types without dummy playlists; expose external
broadcasters' slots and self-service page (Icecast-credentials auth); anticipate a
WebDJ-equivalent (browser broadcasting) in a later phase. Live transitions keep
metadata correct — today's `live-meta-sync` behavior becomes a built-in, slot-aware
concern: when an account goes on air, OndeStudio matches the stream to the
overlapping planned slot and pushes that slot's metadata as now-playing.

**Live flexibility is central** (§4.3, §8.1): a team broadcaster may take the antenna
on an unexpected situation; external broadcasters are framed by their slots yet with
flexibility; late starts and early ends fall back to rotation, never to silence.

### 5.7 OndePi boxes

OndePi boxes are first-class live sources: minimal-interface ("3 buttons") streaming
boxes used in the field. Their integration dissolves today's hacks structurally:
planned sessions are ordinary live slots (no dummy playlists — several planned
sessions for the same box coexist naturally in Upcoming), and the slot-aware
metadata matching of §5.6 replaces the Comment-field juggling.

The human flow goes through a **QR-to-phone session page**: each box carries a
printed QR embedding a box-scoped secret token — no login, field-proof, revocable by
reprinting, permissions strictly limited to that box's sessions. From it the operator
can:

- edit the current session's meta (one editable main meta per session, **prefilled
  from the slot**);
- optionally push **meta cues during the show** (successive acts at a concert — a
  bonus feature, mostly unused, with chapter marks possibly inherited by the replay);
- declare an **unplanned session** on the spot (the broadcaster-flexibility case: box
  streams with no slot);
- edit the meta of this box's upcoming planned sessions.

Boxes also report a **heartbeat** to OndeStudio (online, streaming state, health) for
pre-show checks — this requires work on the OndePi side as part of its integration
into the galaxy; stream-status alone (live/idle per account via AzuraCast SSE) is
available from phase 1 without touching OndePi.

### 5.8 Replays & live recordings

Live streams are auto-recorded (as today) and processed **automatically after each
session ends** (replacing the current cron + manual script), with a review step
before publication.

**Session-aware merging.** Recording fragments are grouped into *sessions* (§4.9) by
streamer and continuity (gap threshold), then attributed to the live slot they
overlap. The slot is an **anchor, not a clipper**: lives often start and end loosely
compared to the announced schedule (typical of Grrrnd Zero concerts via OndePi
boxes — slots are estimates, the boxes have unrestricted access), so a session
running past its slot keeps consolidating subsequent fragments. Sessions with no
matching slot (unplanned team lives) land in an **unattributed-recordings queue** for
two-click attribution. Attributed recordings inherit their metadata (show, title,
date) from the slot — replacing today's hardcoded streamer→artist mapping and blind
by-day concatenation.

**Replay decision cascade.** Whether a recorded session becomes a public replay is a
three-state flag (`yes` / `no` / `not-specified`, default `not-specified`) resolved
in cascade: per-show flag → per-broadcaster flag → manual pick from the recordings
inbox.

**Review & trim.** The review step offers a **lightweight start/end trim** (two
handles on a waveform — no full-editor ambitions) before a recording goes to replay
or rebroadcast.

**Encoding** must let the web player display duration and seek (today's opus target
breaks this); first investigate fixing the opus muxing, fall back to mp3 otherwise
(§9).

Slot-attributed recordings are also the natural source for **echo-of-live**
rebroadcasts (§4.2). This whole pipeline is a candidate for early in-house transfer
in phase 2.

### 5.9 Rotation & inserts management

Manage pools, rules and lifecycle per §4.7; visualize rotation presence in the grid.
The same panel manages **insert rules** (§4.8) — jingles, spoken-word inserts, night
mixes — including pinning a specific mix on a specific night.

### 5.10 Broadcaster account management

A phase-1 requirement: OndeStudio centralizes broadcaster account management,
replacing today's manual double-edit. One broadcaster definition fans out to **both
AzuraCast stations**: identical settings and credentials on main and test, schedule
enforcement only on main. This preserves the testing workflow: any broadcaster can
validate their setup against the test station without restriction, then go live on
the main station at the scheduled time by changing only the port (8005 instead of
8015).

### 5.11 Operational / on-air view

A view distinct from the planning grid, answering "**what is happening on air right
now?**": the current track or show, what comes next, whether a live source is
connected, and any problem demanding immediate attention (a validated slot about to
air empty, a live that hasn't connected, a flagged file in the next hour). Where the
grid is for planning and negotiation, this is the live-ops dashboard for whoever is on
duty — lightweight and glanceable, mobile included. The grid home's attention rail
(§5.1) is its always-visible one-line cousin.

### 5.12 Notifications & awareness

For a small, asynchronous team, the system surfaces what needs attention instead of
relying on people to notice. Notifications are driven by **assignment** (§4.13) and
**state** (§4.4): a validated slot still empty as its air date nears, content that
arrived but isn't processed, an object moved or edited by someone else, a mention or a
new assignment. The first cut is intentionally small — a handful of high-value
triggers and an in-app inbox — but every object is built assignment- and state-aware
so the trigger set can grow without retrofitting.

---

## 6. Architecture strategy

Three phases, explicitly planned from day one — this is the project's defining
architectural constraint.

### Phase 1 — Supercharged overlay

OndeStudio applies all desired behavior **through the AzuraCast API**, in both
directions:

- OndeStudio → AzuraCast: scheduling, playlists, metadata, streamer accounts are
  created and updated via API.
- AzuraCast → OndeStudio: changes made directly in AzuraCast (the team may still use
  it) must be reflected back into OndeStudio — via API polling and SSE, as OndePlayer
  already demonstrates.

OndeStudio maintains its own database for everything AzuraCast cannot represent
(negotiation states, discussions, votes, content pipeline, fallback policies…) and
treats AzuraCast as the source of truth for playout reality.

**Air keeps running without OndeStudio.** Because phase 1 is an overlay, OndeStudio is
never in the playout hot path: if it is down, AzuraCast (Liquidsoap + Icecast) keeps
the station on air exactly as before. OndeStudio drives and mirrors AzuraCast; it does
not host the stream. This decoupling is a deliberate safety property of phases 1–2 and
only changes in phase 3, when OndeStudio takes over playout and must itself meet that
availability bar.

**Ownership model.** Every shared object falls into one of three classes:

| Class | Examples | Master | A direct AzuraCast edit is… |
|---|---|---|---|
| **OndeStudio-owned** | states, discussions, votes, pipeline, policies | OndeStudio | impossible — no AzuraCast counterpart |
| **Projected** | playlists, schedule items, streamer accounts, metadata pushes | OndeStudio | drift — absorbed or reconciled (below) |
| **AzuraCast-owned** | play history, live connect/disconnect | AzuraCast | reality — read-only ingest, never written |

Projected objects are visibly **tagged** in AzuraCast (marker in description fields),
so hand-made objects are recognized and offered for import instead of being treated
as drift.

**Drift policy — absorb + reconciliation queue.** When a projected object is edited
directly in AzuraCast, unambiguous diffs (time change, meta edit, enable/disable) are
absorbed into OndeStudio automatically; ambiguous ones land in a small reconciliation
inbox where the team picks a side in one click. OndeStudio never silently overwrites
a manual AzuraCast edit, and never fights an emergency fix.

**Freshness — near-realtime.** Live and now-playing state arrives by SSE (seconds);
structural state by polling (≤ 30 s). The grid must be trustable as "what is true
right now". AzuraCast webhooks — currently unused on the instance — may complement
SSE/polling as a push channel.

**Adoption is per-feature.** Each workflow (grid, board, broadcaster management,
metadata…) switches from the AzuraCast UI to OndeStudio individually, once its
OndeStudio version is trusted — no big-bang cutover.

**Initial state & migration — fresh start.** OndeStudio's initial grid and objects
are seeded by importing what AzuraCast already knows (playlists, schedule items,
streamers — imported as untagged candidates to adopt progressively). The import also
**reconciles main/test mirror drift** (missing mirrored accounts, leftover test
accounts), proposing each fix for approval. The spreadsheet is retired without
migrating its history; the Wekan board is archived read-only, with only active cards
manually recreated during adoption. No migration tooling is built.

**Phase-1 exit bar** (what makes the team switch): the **grid** replaces the
spreadsheet, the **board** replaces Wekan, **write-back works** — decisions in
OndeStudio genuinely reach AzuraCast — and **broadcaster account management** is
centralized with its main/test fan-out (§5.10). A partial tool would just be a fourth
thing to keep in sync.

#### Phase 1 — first cut (the MVP)

The MVP is the first usable slice of the overlay, drawn on one line: **OndeStudio
overlays the layer humans touch daily — plan, announce, discuss, assign — and leaves
everything AzuraCast *automates* (rotation internals, insert rules, recording/replays,
OndePi flows) running untouched until each gets its own phase-2 takeover.** Those
automated layers still appear in the grid, as **read-only** blocks and overlay bands:
the team sees the whole day but edits only the human layer.

**Two increments, front-first.** Increment 1 makes OndeStudio a *mirror* — the grid
reads AzuraCast and overlays OndeStudio's own states, the board and assignment work,
but the AzuraCast UI still performs the writes. This validates the grid's ergonomics
(the product's core risk, §8.2) cheaply, with air untouched. Increment 2 turns the
mirror into a *driver*: write-back, so decisions in OndeStudio reach AzuraCast — the
ownership and drift rules above apply from here on.

**In the MVP:**

- team authentication via AzuraCast (§4.12);
- the **week grid** with negotiation and content states (§4.4, §5.1);
- **live slots** (retiring the dummy-playlist hack) and **recurring-show slots with
  the episode queue** (§4.2, §4.5) — the drop-folder auto-fill that kills
  stale-Upcoming is in the first cut;
- the **show page** (hub) and a **basic media browser** (§5.3, §5.4);
- **quick meta / Upcoming editing** (§5.5);
- **broadcaster account management** with main/test fan-out (§5.10) — self-contained,
  shippable early;
- a **thin discussion board** with assignment and a handful of notification triggers
  (§5.2, §4.13, §5.12).

**Phase-1 fast-follow** (still overlay, after the MVP): month and 3-day grid zooms;
echo slots; the operational/on-air view (§5.11); the external-broadcaster self-service
page (§5.6, once broadcaster management has landed); a global quick-open/search (any
object one keystroke from its page); a fuller board and more notification triggers;
drift-reconciliation polish.

**Deferred to phase 2** (left running in AzuraCast meanwhile): rotation pool
management, insert-rule editing and night-mix pinning, the replays/recordings
overhaul, the OndePi QR page and heartbeat, echo-of-live, and drop-tool intake.

**Upcoming feed.** When write-back lands, lives and shows reach the public Upcoming by
**OndePlayer switching its schedule source to OndeStudio's API** — rather than
perpetuating the announce-artifact inside AzuraCast. This is the first concrete step
of OndePlayer's eventual absorption (§9) and the galaxy's first satellite
coordination: small and contained, but real phase-1 work on OndePlayer.

### Phase 2 — Progressive takeover

Features move in-house one by one (media library, scheduling logic, metadata
handling, the replay pipeline…), until AzuraCast is reduced to a Liquidsoap/Icecast
host. This demands **modular boundaries** from the start: each capability sits behind
an interface whose implementation can switch from "drive AzuraCast" to "do it
natively" without rewriting the layers above.

This phase needs **careful planning beyond OndeStudio itself**: every feature switch
must be coordinated with the satellite components that consume or feed AzuraCast
today — OndePlayer, the drop tool, the OndePi boxes.

**Phase-2 exit bar**: AzuraCast serves only as Liquidsoap/Icecast host; the
satellites consume OndeStudio's API instead of AzuraCast's.

### Phase 3 — Autonomous product

OndeStudio manages Liquidsoap/Icecast directly; AzuraCast exits the picture — which
includes owning the custom playout layer that lives today as custom Liquidsoap config
(§2.2): mastering chain, live input handling and priorities, live recording. The
project becomes a packaged, generic, installable application with proper
install/deploy/upgrade scripts and documentation. This is also when **OndePlayer is
absorbed** as OndeStudio's public-facing module, and when genericity (multi-station
diversity beyond wavezero's practices) becomes a first-class requirement.

**Phase-3 exit bar**: a third party can install and run OndeStudio as their station's
studio + playout + public player, without AzuraCast and without wavezero-specific
assumptions.

### Cross-phase implications

- The AzuraCast API is a **boundary, not a foundation**: nothing above the
  integration layer may assume AzuraCast specifics.
- Data ownership migrates over time: every concept must know whether its source of
  truth is AzuraCast or OndeStudio *at the current phase*, and the answer will
  change.
- Sync conflicts are governed by the ownership model and drift policy above: "who
  wins" is answered per ownership class, never globally.

---

## 7. Technology & API orientation

The stack is now **locked** (decided 2026-06-16); remaining open items are flagged.

### 7.1 Stack & deployment

- **Language: TypeScript** across backend and frontend.
- **Runtime: Bun.** Already proven in production on `onde-zero` (OndePlayer runs on
  Bun), native TS, one runtime to operate; the conservative Node path was weighed and
  set aside.
- **Frontend: Vue 3 + Vite.** AzuraCast's own UI is Vue — which eases reading and
  porting its code during phases 2–3 and overlaps with its contributor pool; the
  calendar/drag-and-drop ecosystem is mature; the learning curve fits a small team.
- **Database: SQLite first.** Zero-ops, fits a single-server 4–6-user deployment,
  already used by wavezero-form; trivial backups. Revisit only if multi-instance
  needs appear (phase 3 packaging may offer Postgres as an option).
- **License: AGPL-3.0** (as AzuraCast and LibreTime). Network copyleft fits an
  open-source product meant to be operated as a service.
- **Deployment reality**: single server (`onde-zero`), systemd services, alongside
  the AzuraCast Docker stack. Phase 3 brings proper packaging for third parties.
- **Secrets**: real credentials live in the repo-local `.env` (gitignored — never
  committed, never served); `.env.example` documents the expected variables.
- **API identity**: research currently uses the shared "OndeZero API account"
  (global-admin role, also used by OndePlayer). When OndeStudio begins writing to
  AzuraCast, it gets a **dedicated account** — clean audit trail, unambiguous
  ownership of tagged objects.
- **Authentication**: **OndeStudio owns its own user/session store**, provisioned and
  synced from AzuraCast accounts (not a live proxy) — decoupled, robust, and
  phase-3-ready: auth survives when AzuraCast goes away. External broadcasters are
  verified via their Icecast streamer credentials, which OndeStudio already manages
  (§4.12).

### 7.2 API resource model (sketch)

API-first (§8.2): the contract is designed *with* the front, not after it. **REST/JSON
over HTTP**, versioned (`/api/v1`), **OpenAPI-documented**; **SSE** for realtime (grid,
board, on-air); auth via the AzuraCast-backed identity (§4.12). The API exposes
**OndeStudio's own model only** — AzuraCast sits behind it as an internal integration
detail (§6), never leaked to consumers — which is precisely what lets OndePlayer move
off AzuraCast's API onto this one. Resources are **station-scoped** from day 1 (e.g.
`/stations/{id}/…`) as cheap phase-3 multi-station insurance (today: `oz`, with
`wz-test` as its test mirror). Resource names below are provisional, pending the naming
pass (§9).

Top-level resources, grouped:

- **Scheduling** — `shows`, `episodes`, `slots`, `rotation-pools`, `insert-rules`.
- **Content** — `media` (fingerprinted files + filetree), `contributions`, `sessions`
  (live recordings → replays).
- **Collaboration** — `cards` (with nested `comments` and `votes`), `notifications`.
- **People & access** — `users`, `broadcasters` (the main/test fan-out accounts),
  `tags`.
- **Devices** — `boxes` (OndePi heartbeat and QR session tokens).
- **Operational & public read** — `schedule` (the computed grid over a date range) and
  `now` (on-air state).

**Recurrence — definition + occurrences.** A recurring `slot` is a **definition** (a
recurrence rule bound to a show, live, echo…); the grid materializes individually
addressable **occurrences**. Editing one occurrence (move an echo, shift a week, attach
an episode) records a per-instance **exception** without breaking the series — the
calendar-app model. Occurrences carry per-instance content state (§4.4) and are what
the episode queue fills (§4.5); an echo is an occurrence linked to an origin occurrence
with synced metadata.

**Key relationships.** A `show` owns its `episodes`, its slot `definition`(s) and a
`media` drop-folder; an `episode` airs on one origin occurrence plus echo occurrences;
a `contribution` resolves to `media` and is placed onto a `rotation-pool`, the night
pool, or a `slot`; a `session` is reconstructed from recordings, attributed to a live
occurrence, and may become a replay; a `card` anchors to any of these (or stands
alone) and can be promoted into one (§4.14); `assignment` and `notifications` reference
any object by type + id.

**The galaxy seam.** `schedule` and `now` are the **stable public read contract** the
satellites consume: OndePlayer switches its Upcoming / now-playing source here at
write-back (§6), and the drop tool (later) writes `contributions`. Designing these as
first-class public API — not internal front-only routes — is what makes the §8.2
"API-first" principle concrete.

---

## 8. Design & development guidelines

### 8.1 Product & UI

- **Clean, ergonomic, responsive.** Desktop is the primary workplace for heavy
  operations (grid manipulation); quick flows (metadata fixes, state changes,
  discussions) must work well on mobile.
- **Visual identity: dark, retrofuturist, sustainable.** The primary theme is dark,
  blending **retrofuturism** with **sustainable web design** principles (lightweight
  pages, minimal assets, low-energy rendering). The UI is **themable** from the
  start — the primary theme is one theme among future ones, not hardcoded.
- **States visible at a glance.** The grid's first job is to make problems visible:
  validated-but-empty slots, stale metadata, pending negotiations.
- **Right-depth access.** Both the full flow (schedule a show end-to-end) and the
  30-second fix (edit the upcoming title) are first-class paths — neither buried.
- **Frequent operations cost few clicks.** The weekly routine (place episodes, check
  states, move an echo, pin a night mix) drives the ergonomics.
- **Small-team pragmatism.** Built for 4–6 trusted people: light roles, no enterprise
  permission matrices, no workflow ceremony beyond what the states require.
- **Broadcaster flexibility is sacred.** Things change at the last minute: a team
  broadcaster may take the antenna unexpectedly; external broadcasters need framing
  *with* flexibility. The system frames, it never rigidifies (§4.3).
- **Time is 24-hour, server-referenced, timezone-aware.** All times display in 24-h
  format; the reference clock is server time (Europe/Paris). WaveZero is an
  international radio, so discreet timezone helpers matter: e.g. optionally attach a
  contributor's timezone to a rec'd slot/show or to a broadcaster account, so that
  scheduling conversations show the translated local time alongside the station time.
- **Don't recreate Wekan.** The board serves the radio's objects (contributions,
  slots, shows); it is not a generic kanban.

### 8.2 Development

- **Prototype the front first.** Design, layout, workflow and ergonomics are
  validated through front-office prototypes before investing heavily in the
  back/server machinery — the grid's feel is the product's core risk, not the
  database.
- **API-first, alongside the front office.** A complete, documented API is built
  together with the front (which consumes it), so that interaction from external
  scripts and applications is designed into the architecture rather than bolted on
  afterwards. OndePlayer, the drop tool and OndePi are the first external consumers.
- **FOSS standards and spirit.** The architecture is modular and properly layered,
  easy to read, understand and modify by external contributors — human peers and AI
  agents alike — following the spirit of projects like ZeroMQ (C4 / Social
  Architecture): good documentation, meaningful code commenting, conventional
  open-source project hygiene. **Low complexity is a hard constraint**: the overhaul
  developer must never hit a complexity wall.

---

## 9. Open questions

Tracked here so the document stays honest; each names where it gets resolved.

1. **Runtime choice** — ✅ resolved 2026-06-16: **Bun** (§7.1).
2. **Drop-tool integration protocol** (push from wavezero-form vs pull from
   OndeStudio; when) → planning of the drop-integration phase.
3. **WebDJ-equivalent scope** for external broadcasters (which phase, which tech) →
   later-phase planning.
4. **OndePlayer absorption** — the first step is decided (its Upcoming reads
   OndeStudio's API once phase-1 write-back lands, §6); still open: full timing and
   whether absorption ends in a UI merge → phase-3 planning.
5. **Naming pass** — ✅ resolved 2026-06-17: slot model `slot`/`occurrence`; slot kinds
   `show`/`series`/`echo`/`live`/`rotation`; negotiation `pre-booked → dealing →
   validated` (+ `declined`/`cancelled`/`aired`); content `empty → received → ready →
   aired`; card intent includes `prospect`; card status `open → in progress → done →
   archived`; live `session` (auth store uses `user_session`). Frozen in the
   implementation plan (docs/2 §5–§6).
6. **Media storage layout redesign** (§4.11) — design session ✅ done 2026-06-29; the
   concrete layout/conventions proposal is in [`docs/3-storage-layout.md`](3-storage-layout.md),
   **pending the team validation** this question requires.
7. **Replay encoding** — investigate whether the opus no-duration bug in the web
   player is fixable at muxing level; otherwise switch the pipeline to mp3 (§5.8) →
   technical investigation (§10).

---

## 10. Next steps

The path from this document to running software:

1. **AzuraCast write-capability audit.** ✅ Done 2026-06-16 (`wz-test` only) —
   playlist and streamer create/update/delete, `schedule_items`, and
   description/comments tagging all confirmed working; phase-1 write-back is viable.
   Findings: [`docs/azuracast-write-audit.md`](azuracast-write-audit.md).
2. **`docs/2-implementation_plan.md`.** ✅ Drafted (v0.6, audited). Built around the MVP boundary (§6): the
   two-increment front-first plan (grid ergonomics are the core risk), media-browser
   and object-pages UX design (§5.3, §5.4), API design (from the §7.2 resource sketch),
   module boundaries honoring the phase-2 takeover, and the data model from §4. (Stack
   is locked in §7.1: Bun, Vue 3 + Vite, SQLite; auth = OndeStudio-owned store synced
   from AzuraCast; phase-1 media via AzuraCast's API + scanner.)
3. **Media storage layout design session.** ✅ Done 2026-06-29 — proposal in
   [`docs/3-storage-layout.md`](3-storage-layout.md); the team validation it requires
   is still pending (open question 6).
4. **Replay encoding investigation.** Opus muxing fix vs mp3 switch (open
   question 7).
