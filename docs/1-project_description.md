# OndeStudio — Project Description

> **Status:** living document — v1.4, 2026-06-12
> **Nature:** contexts / goals / guidelines. This is *not* an implementation plan;
> implementation planning will be a separate document informed by this one.

---

## 1. Overview & vision

**OndeStudio is a new open-source WebRadio studio interface**: the single place where a
radio team plans its schedule, manages its content, discusses and decides — and where
those decisions actually take effect on air.

The two main open-source platforms today are
[AzuraCast](https://github.com/AzuraCast/AzuraCast) and
[LibreTime](https://github.com/libretime/libretime). Both have strengths and weaknesses;
neither matches our use cases (see [§2.4](#24-why-neither-azuracast-nor-libretime-fits)).
OndeStudio starts as a **supercharged interface on top of AzuraCast** and progressively
replaces it, until it stands as a fully autonomous, installable application.

**Positioning: wavezero-first, generic later.** Design decisions are driven by the real
workflow of one production station, [wavezero.world](https://wavezero.world). Genericity
is welcome whenever it costs little, but never blocks us. The full-replacement phase
(phase 3) is where OndeStudio becomes a properly packaged product usable by any station.

---

## 2. Context

### 2.1 OndeZero & wavezero.world

[OndeZero](https://github.com/OndeZero) runs **wavezero.world**, a public webradio
station. The core team is **4–6 people** — station managers/programmers who are also,
for most of them, broadcasters. Development of OndeStudio is carried by one person with
AI assistance, with no hard deadline: quality and sustainability over speed.

People interacting with the station's production:

| Role | Description | OndeStudio access |
|---|---|---|
| **Managers / programmers** | Full control: grid, content, validation, station settings | Full interface |
| **Team broadcasters** | "Unlimited" accounts — may go live anytime, manage their own shows | Full interface |
| **External broadcasters** | Restricted accounts — live only on their negotiated slots | Lightweight dedicated page (auth via their Icecast credentials) to update their slot/show info; later, a WebDJ-equivalent to broadcast directly from the browser |
| **External contributors** | Send content through the public drop tool; no account | No direct access (see non-goals) |

### 2.2 Current toolchain & infrastructure

Everything runs on a single server (`onde-zero`):

- **AzuraCast** (Docker, `/var/azuracast`, version 0.23.3) — the production playout
  system, at `studio.ondezero.net`. Two stations: **WaveZero** (shortcode `oz`,
  production, frontend port 8000 / DJ port 8005) and **WaveZero-TEST** (`wz-test`,
  8010 / 8015). Icecast frontend + Liquidsoap backend, Europe/Paris. Live recording
  enabled on main (mp3), disabled on test. No AzuraCast webhooks are configured today
  (OndePlayer uses SSE + polling).
  The test station mirrors the main one for broadcaster setup testing: identical
  broadcaster settings (server `wavezero.world`, mountpoint `/input`, same manually
  duplicated credentials), **only the port differs** (8005 main, 8015 test), and
  schedule enforcement is disabled on test. Its public player at
  `test.wavezero.world` looks like the main one with a black-&-white background,
  playing a very short rotation playlist. A broadcaster who validated their setup
  against test goes on air on the main station by just changing the port.
  (Mirror drift observed in the 2026-06 scan: two accounts missing on test, two
  leftover test accounts — see §2.3.)
- **Custom Liquidsoap layer** (in the main station's custom config — playout logic
  that phases 2–3 must understand and replicate):
  - a **second live input** `/input2` with its own auth hook and priority fallback
    (standard input wins) — dormant today, probably intended as failover, never
    really used;
  - a **custom live-recording chain** (320 kbps mp3 fragments per DJ,
    `stream_YYYYMMDD-HHMMSS.mp3`) alongside AzuraCast's native recording — the files
    the replay pipeline consumes;
  - a legacy **"interception" command**: a server trigger that smoothly overlays a
    short from the `[INTERCEPTION]` pool on top of the program — rarely used,
    documented for completeness, no UI planned (§4.11);
  - a full **broadcast mastering chain** (`master_me`: −16 LUFS target, multiband
    compression, limiter, brickwall) on the station output;
  - live metadata forced at Liquidsoap level to `artist="● LIVE"`,
    `title=<DJ display name>` — the display-name hack's implementation.
- **OndePlayer** (`/opt/OndePlayer`, systemd service) — our custom public player and
  site, a Bun-powered multi-station web app. It already implements two mechanisms
  highly relevant to OndeStudio:
  - an **enriched Upcoming schedule builder**: fetches playlists and streamers with
    their `schedule_items` from the AzuraCast API, expands weekly recurrences over
    30 days, merges and deduplicates;
  - **live-meta-sync**: monitors AzuraCast SSE for live-streamer transitions and pushes
    corrected metadata *back* through the API — a working precedent of bidirectional
    AzuraCast integration.
- **wavezero-form** (`drop.wavezero.world`) — public contribution tool (redbean +
  SQLite): anyone can freely share contributions; includes a moderation interface.
- **Auto-record → Replays pipeline** (`/srv/data/stations/oz/podcaster.sh`) —
  AzuraCast auto-records live streams per streamer (fragmented `stream_*.mp3` files);
  a cron-run custom script concatenates each day's fragments, encodes to opus, tags via a
  hardcoded streamer→artist mapping and moves the result into
  `00 - PODCASTS/<Artist>/`, which auto-feeds the `[PODCAST]` playlists; the AzuraCast
  podcast section linked to them powers the **Replays** section of the public player.
- **OndePi** ([github.com/Maigre/OndePi](https://github.com/Maigre/OndePi)) —
  Raspberry-Pi "ready to stream" boxes; two exist (`ondepi-1`, `ondepi-2`),
  registered as unlimited team broadcaster accounts. Used for live music, mobile
  conference recording, street interviews, studio lives… To be integrated into the
  OndeStudio galaxy (see §5.5).
- **Wekan** — trello-like board used for discussion, labeling and status dispatch of
  contributions, todo/done tracking. *Note: the current Wekan workflow is acknowledged
  as clumsy; OndeStudio's board is a fresh design, not a Wekan clone.*
- **A spreadsheet** — the schedule grid, maintained by hand with color codes.

Contribution formats are diverse: individual tracks, collections of mixes, recorded
shows (episodic), vocals, poems, stories…

### 2.3 Pain points

The core problem is **fragmentation**: AzuraCast for production, Wekan for discussion
and status, a spreadsheet for the grid. Processing one item means touching several
tools; they drift out of sync and end up outdated, which confuses team collaboration.

Specific recurring frictions:

- **No schedule grid anywhere.** The calendar view of the station's life — with
  negotiation states and content states — exists only as a hand-maintained spreadsheet
  disconnected from playout reality.
- **Scheduling in AzuraCast is slow and click-intensive.** Anything schedule-related
  takes many unintuitive steps. It needs to be visual, easy and fast to add, edit,
  update and inspect.
- **Stale "Upcoming" metadata.** Recurring shows are announced by generic name; detailed
  episode metadata arrives late ("just in time"). Updating the announcement on episode
  arrival, then reverting to the generic name once the slot (and its echo) has played,
  is manual and usually skipped — the public Upcoming mostly shows generic names.
- **The dummy-playlist hack.** Announcing a team broadcaster's planned live session
  requires creating a fake playlist in AzuraCast just so it appears in the schedule and
  Upcoming. Information must then be updated in multiple places.
- **Broadcaster accounts are duplicated by hand.** Every broadcaster exists twice
  (main + test station, see §2.2) with manually synced credentials; every change is a
  double edit. The 2026-06 API scan found the predictable drift: two accounts missing
  on test, two leftover test accounts — OndeStudio's initial import reconciles such
  divergence, each fix subject to approval (§6).
- **The replay pipeline is crude.** Day-fragments are concatenated blindly (two
  different lives on the same day would merge into one file), the streamer→artist
  mapping is hardcoded in the script, and the current opus encode target makes the
  web player buggy (no duration shown).
- **OndePi metadata juggling.** Announcing lives done with an OndePi box requires a
  dummy playlist per upcoming session *plus* manually updating the Comment field of
  the broadcaster account for the "Now playing" meta. When the same box covers two
  upcoming lives (e.g. Friday then Saturday), that's two dummy playlists and a
  comment swap between the shows — redundant and unhandy.
- **Echo slots are manual.** Rebroadcasting an episode on a second slot, week after
  week, with synced metadata, is unsupported and error-prone.
- **Rotation is a black box.** The `[TRACKS]` fallback playlist runs whenever nothing
  else is eligible, invisible in any schedule, with no lifecycle for what enters or
  leaves it.

### 2.4 Why neither AzuraCast nor LibreTime fits

**AzuraCast** was chosen to run wavezero.world and does a good production job overall
(playout, streaming, broadcaster accounts, API). Two families of shortcomings drive
this project.

First, it lacks the **editorial and collaborative layer**: a calendar/grid-centric
view where shows and live slots carry *negotiation states* (pre-booked, discussion in
progress, validated…) and *content states* (content missing, ready, in error…),
continuous rotation blocks as first-class scheduled objects, and a place for team
discussion and decision attached to the content itself.

Second, several of its mechanisms are **cumbersome or unintuitive** for our use cases:

- the dummy-playlist workarounds described in §2.3;
- schedule editing is unintuitive and click-intensive;
- "everything is a playlist" is too restrictive a model for most of our usages;
- the shuffle rotation algorithm is obscure and feels broken (some songs noticeably
  play much more than others);
- the playlist-vs-media-folder duality can be powerful to some extent (e.g.
  auto-filling a playlist when a file is dropped in a folder) but is sometimes buggy
  (e.g. the known sequential one-episode trigger issue, forcing the team to delete the
  previous episode whenever adding a new one so the right one is picked) and often
  counter-intuitive or many clicks away from an efficient workflow.

That last point raises an important design choice for OndeStudio: **media storage
organization must be intuitive, fit the schedule-grid logic, and avoid duplicates** —
while preserving per-file metadata and playback history even when the team manually
adds/moves/deletes files in the filetree (something AzuraCast handles well). This
aspect needs proper design (see §4.10 and §9).

**LibreTime** was only quickly evaluated: nice UI styling, but the dual-panel
navigation is very unintuitive, and several blockers rule it out:

- **no general rotation fallback** — every slot must be explicitly filled or the
  station falls silent; inserting a show means re-cutting the general rotation slot in
  two pieces, which is not handy;
- **live slots are hard-enforced**: no equivalent of our unlimited team broadcasters
  who can take the air anytime; a broadcaster starting late or finishing early
  produces silence — not workable;
- the same rigidity applies to recorded shows: we often book 1-hour slots while
  programs run shorter or longer, and that must not be an issue (see §4.9);
- file storage seems messy too: no way to properly organize or touch the filetree
  without messing with the app.

These observed failures directly shape OndeStudio requirements: rotation as universal
fallback, soft slot boundaries, broadcaster flexibility, and a storage design that
tolerates manual filetree management.

---

## 3. Goals & non-goals

### 3.1 Goals

1. **One centralized, comprehensive workspace** replacing the
   AzuraCast-UI + Wekan + spreadsheet triad for daily editorial work.
2. **A calendar/grid-centric schedule** where every slot carries a negotiation state
   and a content state, covering shows, live sessions, echo slots and rotation blocks.
3. **A collaborative discussion board**, team-internal, midway between a trello-style
   board and stack-overflow-style discuss-and-vote, attached to contributions, slots
   and decisions.
4. **Real effect on air**: scheduling decisions taken in OndeStudio are applied to the
   playout system (via the AzuraCast API first), not merely tracked.
5. **Hierarchical, right-depth access**: heavyweight flows (schedule a show: grid
   placement, content management, discussion) and lightweight flows (quickly fix the
   metadata of the currently-aired or upcoming item) are both first-class.
6. **Progressive autonomy**: an architecture that starts as an AzuraCast overlay and
   ends as a standalone product (see [§6](#6-architecture-strategy)).

### 3.2 Non-goals

- **Listener-facing interaction.** No public requests, votes or comments. The public
  hears the stream and sees the player; interaction with the station's content is for
  the team (external contributors go through the drop tool's existing flow).
- **Replacing the drop tool in phase 1.** Direct intake from `drop.wavezero.world` into
  OndeStudio is planned for a later phase; the design anticipates it, phase 1 does not
  implement it.

Podcast publishing and listener analytics are not phase-1 concerns but are *not*
excluded long-term: "fully replace AzuraCast" eventually includes its useful peripheral
features. Similarly, **OndePlayer is ultimately meant to be absorbed** by OndeStudio as
its public-facing module (player + site), once the studio core is solid.

---

## 4. Domain concepts

The shared vocabulary of the project. These concepts structure both the UI and the data
model, whatever the implementation.

### 4.1 Schedule grid

The central object: a calendar (week-grid-centric, with other zoom levels) showing
everything that airs or may air. Everything visible on the grid is a **slot** of some
kind, colored/badged by its states. The grid is not a passive visualization: it is the
primary editing surface (create, move, negotiate, validate).

### 4.2 Slot types

- **Recurring show slot** — a weekly (or otherwise recurring) slot bound to a show whose
  episodes arrive just in time. Carries the show's generic identity; gets enriched with
  episode metadata when content arrives; reverts to generic after broadcast.
- **Opportunistic recorded series** — we receive a finite set of episodes (e.g. 4) and
  schedule them on recurring (or ad-hoc) slots for the duration of the set (e.g. one per
  week for 4 weeks). Each occurrence is individually movable. Both this and the
  recurring show slot are fed by the same **episode queue** mechanism (§4.6) — only
  the queue depth differs.
- **Echo slot** — a second broadcast of the same episode (e.g. episode aired Tuesday
  14:00, echoed Saturday 15:00). By default follows the original week after week, but
  each occurrence is individually movable. Metadata stays synced with the original.
  Echoes also cover **recorded live sessions** (not a current practice, anticipated):
  an echo slot can be pre-bound to a *future* live — its content state stays `empty`
  and auto-fills once the live's recording is processed and attributed (§5.7), with
  the per-show fallback policy (§4.6) applying if the recording never materializes;
  alternatively, any past session can be picked from the recordings library.
- **Live slot** — a planned live session. For external broadcasters it is also the
  permission boundary (they can only go live during their slot). For team broadcasters
  ("unlimited") it is an announcement: they can go live anytime, but a planned slot puts
  them in the grid and the public Upcoming — without today's dummy-playlist hack.
- **Rotation block** — continuous rotation as a first-class, visible grid object (see
  §4.5), not invisible background behavior.
- **Night mixes** — schedule-constrained cherry-picking of long mixes during night
  hours: random selection from a dedicated pool by default, with the ability to **pin**
  a specific mix to a specific night. Implemented as an insert rule (§4.11), not a
  slot type.

### 4.3 States

Two orthogonal state families, both visible at a glance on the grid.

**Negotiation state** — human-driven: where the slot stands in the team process.

```
                ┌─→ declined
pre-booked → in discussion → validated → (aired)
                                 └─→ cancelled
```

- `pre-booked` — a hold: the slot is penciled on the grid to reserve the space while
  things get sorted. Team-visible only.
- `in discussion` — actively negotiated, linked to a discussion-board card.
- `validated` — confirmed. **Only validated slots reach the public Upcoming.**
- `declined` — never got to yes; kept as a ghost for history.
- `cancelled` — was validated, then called off (the public may have seen it
  announced — hence distinct from declined).
- `aired` — automatic, time-driven, not a human action.

Slots with nothing to negotiate (e.g. a team member's own show) can be born directly
`validated`.

**Content state** — mostly automatic: whether what should air is actually ready. A
primary pipeline `empty → received → ready → aired`, plus orthogonal **issue flags**
attachable at any point:

| Flag | Examples |
|---|---|
| `technical` | wrong format, bad loudness, corrupt file, duration mismatch vs slot |
| `metadata` | missing title/description; placeholder meta awaiting completion |
| `editorial` | quality doubts, rights/licensing questions, needs team review |

The grid badge combines the primary state color with warning icons for raised flags.

For **live slots**, `ready` has a concrete meaning: the broadcaster's setup has been
verified against the test station (§2.2, §5.8).

A slot can be `validated` (negotiation) and still `empty` (content) — that combination
is precisely what the team needs to see coming. Rotation blocks don't carry per-slot
content states; their health is a pool concern (§4.5).

### 4.4 Contribution pipeline

Contributions of any format follow **one generic pipeline**:
`received → discussed → validated → placed`, where *placement* assigns a
**destination**: a rotation pool, the night pool, a slot/series, etc. The format
(track, mix, recorded show, vocal, poem, story…) is an attribute, not a separate
pipeline. Intake is manual at first; automated intake from the drop tool comes in a
later phase.

### 4.5 Rotation

Rotation graduates from "single fallback playlist" to a managed system:

- **Multiple themed pools** assignable to different dayparts/blocks.
- **Visible in the grid** as explicit filler blocks.
- **Rules and weighting**: weights, artist separation, recency, ratios between
  categories.
- **Pool lifecycle**: what enters (from validated contributions), what leaves, with
  states and history.

### 4.6 Shows, episodes and fallback policies

A **show** is the recurring editorial entity (name, identity, slot bindings); an
**episode** is one deliverable airing on one or more slots (original + echoes). For
recurring shows with just-in-time delivery, each show has a **fallback policy** for the
no-new-episode case — `discard the slot` or `replay previous episode` — set as a
per-show default and overridable for any specific week.

**Episode queue.** A show with recurring slots can be matched to a **drop folder**:
episodes landing there (the initial batch or later arrivals) form a queue, ordered by
arrival and manually reorderable. Upcoming slot occurrences consume the queue
automatically: a new episode fills the **nearest empty occurrence** (including the
current week's if still empty), its content state flips from `empty` to
`received`/`ready` without anyone touching the grid, and echo slots inherit. When the
queue runs dry, the fallback policy applies. A **per-show trust setting** decides
whether auto-fed episodes air directly or are flagged for a quick review before
`ready`. This one mechanism serves both the opportunistic rec'd series (deep, finite
queue) and the just-in-time recurring show (queue depth ~1).

### 4.7 Metadata model

Today the station maintains **title + description** per show/episode. The model must
anticipate (without requiring yet): artwork, credits & links, tags, tracklists.

**Tags double as lightweight event grouping**: slots, recordings and podcasts sharing
a tag (e.g. a multi-day special coverage like the flotilla broadcasts) can be filtered
and browsed together — no dedicated "event" structure beyond that.

### 4.8 Broadcaster types

- **Team ("unlimited")** — may go live anytime; planned slots are announcements.
- **External ("restricted")** — live only during negotiated slots; authenticate against
  their existing Icecast credentials for a lightweight self-service page; later, a
  browser-based WebDJ equivalent.

### 4.9 Soft slot boundaries

Slots are frames, not hard cuts. A 1-hour booking must tolerate content that runs
shorter or longer:

- content or live **ending early** → general rotation takes over (never silence);
- content or live **running late** → it is not cut, *unless* the next scheduled show
  starts;
- live sessions tolerate late starts the same way (rotation plays until the
  broadcaster connects).

Combined with the universal rotation fallback (§4.5), this is the exact inverse of
LibreTime's rigidity (§2.4) and a non-negotiable scheduling semantic.

### 4.10 Media library & storage

The way files are organized must be as intuitive as the grid itself. Settled
architecture — **"filetree-first + active conventions"**:

- The **filetree is canonical and human-editable**: the team keeps adding, moving and
  deleting files by hand (SFTP, file manager) without breaking anything.
- Every file is identified by **audio fingerprint** (content hash), so metadata and
  play history survive manual moves and renames.
- When **OndeStudio itself** performs an action (placing a validated contribution,
  creating a show), it physically applies the folder convention — the tree converges
  toward order every time the app acts, and grid placement and disk placement become
  the same gesture.
- **Duplicates** are detected by fingerprint and surfaced as warnings, not blocked.
- **Episode selection is deterministic**: a slot points at the exact episode that will
  air. (Today's AzuraCast folder→playlist feeding forces the team to delete the
  previous episode when adding a new one to be sure the right one plays.)

The **layout itself will be redesigned from scratch** — the current tree
(`[SHOWS]/[Name]/`, `[1SHOT]`, `[MIXS]`, `[TRACKS]`, `00 -` zones) is inspiration, not
a design guide; the redesign includes a proper **staging zone** (the intended
`00 - STOCK` was never really adopted) and requires explicit team validation (§9).

### 4.11 Insert rules (interstitials)

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
roughly two mixes a night with rotation filling in between). The night rule adds
what AzuraCast cannot do: **pinning** a specific mix to a specific night (§4.2).

On the grid, insert rules appear as a **thin overlay band** on their active windows —
visible but not slot-like; full editing lives in the rotation/inserts panel (§5.6).

A **manual-trigger variant** exists today as the legacy Liquidsoap "interception"
command (§2.2) — rarely used; documented for completeness, no UI planned.

---

## 5. Functional description

What OndeStudio does, area by area. (Feature-level detail belongs to the implementation
plan; this section sets scope and intent.)

### 5.1 Schedule grid

The home of the application. Calendar views (week-grid first) showing all slot types
with their negotiation and content states (color codes / badges — the spreadsheet's
color language, made live). Direct manipulation: create, move (drag), edit, duplicate
into echoes, change states. Filtering by state ("what's validated but content-less next
week?"), by show, by type. The grid both *reads* reality (what AzuraCast will actually
play) and *writes* it (decisions apply to playout). Adding, editing, updating and
inspecting must be visual, easy and fast — the exact opposite of the current
AzuraCast experience. Three zoom levels: **month** (negotiation overview — compact
state badges, spotting holes and pending discussions weeks ahead), **week starting
Monday** (the primary working view — full states, drag & drop, slot creation) and
**3-day rolling** (detail view centered on today, comfortable on mobile and for
last-minute operations).

Slots are directly manipulable — **drag, drop, resize**, quick-edit — and their
rendering carries scheduling truth: the **booked frame** shows the reserved duration,
while an inner **fill shows the actual content length** once populated — an under-run
is a visible gap rotation will cover, an over-run raises an **overlap indicator**
against the next slot (soft-boundary semantics, §4.9). All of this remains editable
on mobile, even where less comfortable than desktop.

### 5.2 Discussion board

Team-internal collaborative board: cards for contributions, slot proposals, ideas and
tasks; labels, comments, votes (stack-overflow-style discuss-and-vote on what deserves
airtime), todo/done tracking. Cards link to the domain objects they discuss (a
contribution, a show, a slot) so the discussion and the decision live next to the
action. Fresh design — explicitly *not* bound by the current Wekan structure.

### 5.3 Content intake & library

The content library tracks every piece of content with its pipeline state and content
state (per §4.3/§4.4). Manual intake first (file + minimal meta), drop-tool integration
later (the design reserves the entry point). Placement assigns content to destinations:
rotation pools, night pool, slots/series. Shows expose their **drop folders** feeding
the episode queue (§4.6) — for episodic content, placing a file *is* the intake.

### 5.4 Upcoming & quick metadata editing

A dedicated lightweight flow — usable on mobile — to edit what the audience sees now and
next: enrich a recurring show's announcement when the episode arrives, fix the
currently-aired metadata, with automatic revert-to-generic after the slot (and echoes)
have played. This feeds OndePlayer's Upcoming display through AzuraCast (phase 1) and
natively later.

### 5.5 Live broadcasting management

Plan live slots for both broadcaster types without dummy playlists; expose external
broadcasters' slots and self-service page (Icecast-credentials auth); anticipate a
WebDJ-equivalent (browser broadcasting) in a later phase. Live transitions keep
metadata correct (today's `live-meta-sync` behavior becomes a built-in concern).

**Live flexibility is central** (§4.9, §8): a team broadcaster may take the antenna
on an unexpected situation; external broadcasters are framed by their slots yet with
flexibility; late starts and early ends fall back to rotation, never to silence.

**OndePi boxes** are first-class live sources: minimal-interface ("3 buttons")
streaming boxes used in the field. Their integration dissolves today's hacks
structurally: planned sessions are ordinary live slots (no dummy playlists — several
planned sessions for the same box coexist naturally in Upcoming), and when a box goes
on air, OndeStudio auto-matches the stream to the box's overlapping slot and pushes
the slot's metadata as now-playing (the slot-aware evolution of today's
`live-meta-sync`).

The human flow goes through a **QR-to-phone session page**: each box carries a
printed QR embedding a box-scoped secret token — no login, field-proof, revocable by
reprinting, permissions strictly limited to that box's sessions. From it the operator
can: edit the current session's meta (an editable main meta per session, **prefilled
from the slot**), optionally push **meta cues during the show** (successive acts at a
concert — a bonus feature, mostly unused, with chapter marks possibly inherited by
the replay), declare an **unplanned session** on the spot (the
broadcaster-flexibility case: box streams with no slot), and edit the meta of this
box's upcoming planned sessions.

Boxes also report a **heartbeat** to OndeStudio (online, streaming state, health) for
pre-show checks — this requires work on the OndePi side as part of its integration
into the galaxy; stream-status alone (live/idle per account via AzuraCast SSE) is
available from phase 1 without touching OndePi.

### 5.6 Rotation management

Manage pools, rules and lifecycle per §4.5; visualize rotation presence in the grid.
The same panel manages **insert rules** (§4.11) — jingles, spoken-word inserts, night
mixes — including pinning a specific mix on a specific night.

### 5.7 Replays & live recordings

Live streams are auto-recorded (as today) and processed **automatically after each
session ends** (replacing the current cron + manual script), with a review step
before publication.

**Session-aware merging.** Recording fragments are grouped into *sessions* by
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

**Encoding** must let the web player display duration and seek (today's opus target
breaks this); first investigate fixing the opus muxing, fall back to mp3 otherwise.

The review step offers a **lightweight start/end trim** (two handles on a waveform —
no full-editor ambitions) before a recording goes to replay or rebroadcast.

Slot-attributed recordings are also the natural source for **echo-of-live**
rebroadcasts (§4.2). This whole pipeline is a candidate for early in-house
transfer in phase 2.

### 5.8 Broadcaster account management

A phase-1 requirement: OndeStudio centralizes broadcaster account management,
replacing today's manual double-edit. One broadcaster definition fans out to **both
AzuraCast stations**: identical settings and credentials on main and test, schedule
enforcement only on main. This preserves the testing workflow: any broadcaster can
validate their setup against the test station without restriction, then go live on
the main station at the scheduled time by changing only the port (8005 instead of
8015).

---

## 6. Architecture strategy

Three phases, explicitly planned from day one — this is the project's defining
architectural constraint.

### Phase 1 — Supercharged overlay

OndeStudio applies all desired behavior **through the AzuraCast API**, in both
directions:

- OndeStudio → AzuraCast: scheduling, playlists, metadata, streamer slots are created
  and updated via API.
- AzuraCast → OndeStudio: changes made directly in AzuraCast (the team may still use
  it) must be reflected back into OndeStudio — via API polling and SSE, as OndePlayer
  already demonstrates.

OndeStudio maintains its own database for everything AzuraCast cannot represent
(negotiation states, discussions, votes, content pipeline, fallback policies…) and
treats AzuraCast as the source of truth for playout reality.

**Ownership model.** Every shared object falls into one of three classes:

1. **OndeStudio-owned** — the editorial layer (states, discussions, votes, pipeline,
   policies): no AzuraCast counterpart, no conflict possible.
2. **Projected** — playout artifacts OndeStudio generates into AzuraCast (playlists,
   schedule items, streamer accounts, metadata pushes): OndeStudio is master,
   AzuraCast holds a projection. Managed objects are visibly **tagged** in AzuraCast
   (marker in description fields), so hand-made objects are recognized and offered
   for import instead of being treated as drift.
3. **AzuraCast-owned** — playout reality (what actually played, live
   connect/disconnect, song history): read-only ingest, never written.

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

**Phase-1 adoption bar** (what makes the team switch): the **grid** replaces the
spreadsheet, the **board** replaces Wekan, and **write-back works** — decisions in
OndeStudio genuinely reach AzuraCast. A partial tool would just be a fourth thing to
keep in sync. Phase 1 also includes **centralized broadcaster account management**
with main/test fan-out (§5.8).

### Phase 2 — Progressive takeover

Features move in-house one by one (media library, scheduling logic, metadata handling…),
until AzuraCast is reduced to a Liquidsoap/Icecast host. This demands **modular
boundaries** from the start: each capability sits behind an interface whose
implementation can switch from "drive AzuraCast" to "do it natively" without rewriting
the layers above.

This phase needs **careful planning beyond OndeStudio itself**: every feature switch
must be coordinated with the satellite components that consume or feed AzuraCast
today — OndePlayer, the drop tool, the OndePi boxes.

### Phase 3 — Autonomous product

OndeStudio manages Liquidsoap/Icecast directly; AzuraCast exits the picture — which
includes owning the custom playout layer that lives today as custom Liquidsoap config
(§2.2): mastering chain, live input handling and priorities, live recording. The
project becomes a packaged, generic, installable application with proper
install/deploy/upgrade scripts and documentation. This is also when **OndePlayer is
absorbed** as OndeStudio's public-facing module, and when genericity (multi-station
diversity beyond wavezero's practices) becomes a first-class requirement.

### Cross-phase implications

- The AzuraCast API is a **boundary, not a foundation**: nothing above the integration
  layer may assume AzuraCast specifics.
- Data ownership migrates over time: every concept must know whether its source of
  truth is AzuraCast or OndeStudio *at the current phase*, and the answer will change.
- Sync conflicts are governed by the ownership model and drift policy above: "who
  wins" is answered per ownership class, never globally.

---

## 7. Technology orientation

Orientations, not final decisions — finalized in the implementation plan.

- **Language: TypeScript** across backend and frontend.
- **Runtime: open question** — Bun (already proven in production with OndePlayer, native
  TS, one runtime to operate) vs Node (most conservative ecosystem choice). To be
  settled at implementation-plan time.
- **Frontend: Vue 3 + Vite (recommended).** Rationale: AzuraCast's own UI is Vue, which
  eases reading and porting its code during phases 2–3 and overlaps with its contributor
  pool; the calendar/drag-and-drop ecosystem is mature; the learning curve fits a small
  team. Presented as a recommendation, not a lock.
- **Database: SQLite first.** Zero-ops, fits a single-server 4–6-user deployment,
  already used by wavezero-form; trivial backups. Revisit only if multi-instance needs
  appear (phase 3 packaging may offer Postgres as an option).
- **License: AGPL-3.0** (as AzuraCast and LibreTime). Network copyleft fits an
  open-source product meant to be operated as a service.
- **Deployment reality**: single server (`onde-zero`), systemd services, alongside the
  AzuraCast Docker stack. Phase 3 brings proper packaging for third parties.
- **Secrets**: real credentials live in the repo-local `.env` (gitignored — never
  committed, never served); `.env.example` documents the expected variables.
- **API identity**: research currently uses the shared "OndeZero API account"
  (global-admin role, also used by OndePlayer). When OndeStudio begins writing to
  AzuraCast, it gets a **dedicated account** — clean audit trail, unambiguous
  ownership of tagged objects.

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
  *with* flexibility. The system frames, it never rigidifies (§4.9).
- **Time is 24-hour, server-referenced, timezone-aware.** All times display in 24-h
  format; the reference clock is server time (Europe/Paris). WaveZero is an
  international radio, so discreet timezone helpers matter: e.g. optionally attach a
  contributor's timezone to a rec'd slot/show or to a broadcaster account, so that
  scheduling conversations show the translated local time alongside the station time.
- **Don't recreate Wekan.** The board serves the radio's objects (contributions, slots,
  shows); it is not a generic kanban.

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
  easy to read, understand and modify by external contributors: good documentation,
  meaningful code commenting, conventional open-source project hygiene.

---

## 9. Open questions

Tracked here so the document stays honest; each gets resolved in later docs/decisions.

1. **Runtime choice**: Bun vs Node.
2. **Drop-tool integration protocol** (push from wavezero-form vs pull from OndeStudio;
   when).
3. **WebDJ-equivalent scope** for external broadcasters (which phase, which tech).
4. **OndePlayer absorption timing** and what "absorbed" means concretely (shared
   schedule/meta backend first, UI merge later?).
5. **Naming**: final vocabulary for slot types and states (this doc's terms are
   proposals).
6. **Media storage layout redesign** (§4.10): architecture is settled
   (filetree-first + conventions + fingerprints); the concrete layout/conventions
   are to be designed from scratch and validated with the team.
7. **Replay encoding**: investigate whether the opus no-duration bug in the web
   player is fixable at muxing level; otherwise switch the pipeline to mp3 (§5.7).

