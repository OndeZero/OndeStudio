# OndeStudio — Implementation Plan

> **Status:** living document — v0.3, 2026-06-17 (modularity & contribution pass)
> **Nature:** the implementation plan — the bridge from the project description
> (contexts / goals / guidelines) to running software. Where the project description
> says *what OndeStudio must be and why*, this document says *how we build it, in what
> order, with which concrete structures and technologies, and under which engineering
> and contribution discipline*.
>
> **Relationship to the project description.** This plan is **informed by and
> subordinate to** [`docs/1-project_description.md`](1-project_description.md) (the
> "PD"). The PD's domain concepts (PD §4) are normative. The PD's architecture strategy
> (PD §6) and locked stack (PD §7.1) are the ground this plan stands on. When this plan
> and the PD disagree, the PD wins until the PD is updated.
>
> **Reference convention.** `PD §x` → project description; bare `§x` → this document;
> `[AUDIT]` → [`docs/azuracast-write-audit.md`](azuracast-write-audit.md). External
> influences are cited inline and collected in Appendix E.
>
> **How to read.** §1 frames scope and the non-negotiable invariants. §2 the build
> method. §3 the architecture — layering, the **feature-module** decomposition, the
> dependency rules, the ports, the stack. §4 the **domain design** stance (the "OO"
> conventions). §5 data model · §6 API · §7 AzuraCast integration · §8 front office.
> **§9 engineering conventions and §10 the contribution model** are the heart of the
> "welcoming, low-complexity, contributor-first" goal. §11 milestones (with the
> walking-skeleton first build) · §12 auth · §13 cross-cutting · §14 open questions ·
> §15 next steps. Appendices: A vocabulary map · B extension recipes · C a worked
> vertical slice · D companion files to create · E influences.
>
> **A newcomer (human or AI) should be able to read §3–§4 and §9–§10, open any one
> feature module, and know how to add the next feature.** That property is a design goal
> of both the codebase and this document.
>
> **Maturity legend:** 🟢 drafted & committed · 🟡 drafted, awaiting a spike or team
> session · 🔴 scaffold only.

---

## 1. Purpose & scope 🟢

This plan builds the **phase-1 overlay** of OndeStudio (PD §6): a TypeScript/Bun
application overlaying AzuraCast through its API — a real schedule grid, a discussion
board, broadcaster-account management and quick metadata editing — that writes decisions
back to AzuraCast while the station keeps airing through AzuraCast untouched.

**In scope:** the phase-1 **MVP** and **fast-follow** (PD §6); the architecture, module
boundaries, data model, API, front-office plan, **engineering conventions and contribution
model** needed to ship it *and* to make the phase-2 takeover a swap behind stable
interfaces (PD §6, §8.2); the build sequence (§11).

**Deferred (named, not planned here):** phase-2/3 detailed planning (only their
*boundaries* are guaranteed here, §3.5); everything PD §6 lists as phase-2 — rotation-pool
management, insert-rule editing, night-mix pinning, the replays overhaul, the OndePi QR
page/heartbeat, echo-of-live, drop-tool intake. These render as **read-only** grid
blocks/bands in phase 1, so the model must *represent* them without *editing* them.

**Phase-1 exit bar** (PD §6): grid replaces the spreadsheet, board replaces Wekan,
write-back reaches AzuraCast, broadcaster management is centralized with main/test fan-out.

**Invariants — every choice below is held against these:**

1. **Air is never in OndeStudio's hot path** (phase 1–2; PD §6). Down ⇒ AzuraCast keeps airing.
2. **The AzuraCast API is a boundary, not a foundation** (PD §6). Nothing above the adapter assumes AzuraCast.
3. **Soft slot boundaries & broadcaster flexibility are sacred** (PD §4.3, §8.1). Frame, never rigidify.
4. **States visible at a glance** is the grid's first job (PD §8.1).
5. **Few views, few clicks; right-depth access** (PD §8.1).
6. **Low cognitive load is an architectural requirement, not a nicety.** The codebase
   must stay graspable and welcoming to external human *and* AI contributors (PD §3.1
   goal 7, PD §8.2). Modularity, uniformity and clear contracts (§3, §4, §9, §10)
   exist to keep the next contributor — overhaul developer included — off the
   "complexity noodle wall". This invariant outranks cleverness everywhere.

---

## 2. Build method 🟢

From PD §8.2, turned into a way of working, with three borrowed disciplines (Appendix E):

**2.1 Front-first.** The grid's *feel* is the product's core risk, not the database
(PD §8.2). The first real artifact is a **week-grid front prototype** on seed data,
validated for ergonomics before server machinery is built out (§7.3, §8).

**2.2 API-first, alongside the front.** A **shared package** of Zod schemas (§3.3) is the
single contract source — it generates the OpenAPI document, validates server I/O, and
types the client. The front talks the real API shape from day one (stub data behind it).

**2.3 Walking skeleton before features** (Cockburn). M0 builds *one trivial request end
to end through every layer* (route → service → domain → repo → DB, plus CI gates) so the
architecture is proven runnable before any feature lands (§11, M0). New features then
copy a known-good path, not invent one.

**2.4 Simplest thing that could possibly work** (Beck) + **problem-oriented change**
(ZeroMQ/C4). Each change solves *one clearly-stated problem* with the minimal correct
solution; we grow by accretion of small, reversible steps, not big speculative designs.
"Could we need it later?" is not a reason to build it now (invariant 6).

**2.5 Two increments, front-first** (PD §6):

| | **Increment 1 — Mirror** | **Increment 2 — Driver** |
|---|---|---|
| Direction | AzuraCast → OndeStudio (read) | + OndeStudio → AzuraCast (write) |
| Grid | reads AC, overlays OS states | edits write back to AC |
| Risk retired | grid ergonomics (core risk) | write-back ([AUDIT]-de-risked) |
| Air | untouched | still never in the hot path |
| Ownership/drift rules | dormant | engaged |

**2.6 What "done" means.** Each milestone is judged against the PD exit bars (§11), not a
locally-invented checklist.

---

## 3. Architecture 🟢

### 3.1 Layering — hexagonal (ports & adapters)

The defining constraint (invariant 2): the AzuraCast API is a **boundary**. Ports &
adapters (Cockburn) let a capability's implementation flip from "drive AzuraCast" to "do
it natively" in phase 2 without the layers above noticing.

```
   Front (Vue 3 + Vite SPA)  ── REST/JSON + SSE ──┐  shared Zod types
   ─────────────────────────────────────────────  │
   API (Hono routes) — OndeStudio's model only     │  §6
   ─────────────────────────────────────────────  │
   Application services (use-cases)                │  §4
   Domain (rich objects, state machines, rules)    │  §4   ← pure, no IO
   ─────────────────────────────────────────────  │
   Ports (Playout · MediaStore · PlayoutState ·    │  §3.5
          Identity · repositories · event bus)     │
   ───────────────┬─────────────────────────────  │
     phase 1 ▼    │ drive AzuraCast        phase 2 ▼ native
   AzuraCast adapter · SSE/poll ingest · drift      §7
   ─────────────────────────────────────────────
   AzuraCast (Liquidsoap · Icecast · media · API)
```

The **OndeStudio DB is the source of truth for everything AzuraCast cannot represent**
(states, discussions, pipeline, policies); AzuraCast is the source of truth for playout
reality (PD §6; §3.7).

### 3.2 Feature-module decomposition — a modular monolith 🟢

Phase 1 ships as **one Bun process** (invariant 1 says it must be operationally simple),
but the code is a **modular monolith** organized **by feature / bounded context**, not by
technical layer. Folder names are *domain nouns* — "screaming architecture" (Martin): a
newcomer reads the tree and sees the radio, not the framework. The modules map 1:1 to the
PD §4 / PD §7.2 concept groups:

| Module | Owns (PD) | Phase-1 reach |
|---|---|---|
| `scheduling` | shows, episodes, slot definitions, occurrences, recurrence, fallback (PD §4.2–4.5) | full (MVP core) |
| `content` | media, fingerprints, contributions, rotation pools, insert rules (PD §4.6–4.8, §4.11) | media + contributions full; pools/inserts read-only |
| `collaboration` | cards, comments, votes, notifications, assignment (PD §4.13, §4.14, §5.12) | thin board + assignment |
| `people` | users, broadcasters (main/test fan-out), tags, sessions/replays (PD §4.9, §4.10, §4.12, §5.8, §5.10) | users + broadcasters full; sessions read-only |
| `devices` | OndePi boxes, QR tokens, heartbeat (PD §5.7) | schema only (phase-2 behavior) |
| `playout` | the AzuraCast integration: ports + adapter + sync/drift (PD §6) | full |

**Every module has the same internal shape** — *learn one, know them all*:

```
modules/<feature>/
  domain/         # entities (classes), value objects, state machines — pure TS, no IO
  service.ts      # application services = use-cases; orchestrate domain + ports
  ports.ts        # interfaces THIS module requires from outside (e.g. PlayoutPort)
  repo.ts         # repository interface + Drizzle impl + row↔object mapper
  schema.ts       # Drizzle table definitions owned by this module
  routes.ts       # thin Hono routes: validate (shared Zod) → call service → map out
  events.ts       # domain events this module emits / subscribes to (§3.4)
  index.ts        # the module's PUBLIC surface — the ONLY thing other modules import
  README.md       # what this module is, its invariants, how to extend it
  *.test.ts       # colocated tests (the contract, §9.5)
```

A new contributor adding a feature touches *one* module, following the shape it already
has. A reviewer checks the same six files. An AI agent can load a whole module into
context and reason about it in isolation (§10.4).

### 3.3 Monorepo tree 🟢

A **Bun workspace** monorepo; the `shared` package is what makes API-first concrete (§2.2).

```
ondestudio/
├─ packages/
│  ├─ shared/          # Zod schemas + inferred types = the API/domain contract.
│  │                   #   no dependency on api or web. Imported by both.
│  ├─ api/
│  │  └─ src/
│  │     ├─ modules/<feature>/   # the six modules above (§3.2)
│  │     ├─ kernel/              # shared domain primitives — depended on by all modules:
│  │     │                       #   ids, Result, Clock, StationId, the event bus,
│  │     │                       #   base Entity/ValueObject, error types (§4)
│  │     ├─ platform/            # framework glue: Hono app, db connection, config,
│  │     │                       #   logging, OpenAPI, SSE. The only place IO is wired.
│  │     └─ app.ts               # composition root: wire modules + adapters + bus
│  └─ web/
│     └─ src/
│        ├─ features/<surface>/  # grid, board, media, shows, quick-edit, onair (§8)
│        ├─ ui/                  # themed primitives (the theme system, PD §8.1)
│        ├─ lib/api/             # typed client generated from `shared`
│        └─ stores/              # Pinia
├─ docs/  · docs/adr/  · docs/rfc/        # §10.3
├─ CONTRIBUTING.md · ARCHITECTURE.md · AGENTS.md · CODE_OF_CONDUCT.md   # §10, App. D
└─ package.json                            # workspaces, scripts
```

### 3.4 Inter-module communication — public surfaces + an event bus 🟢

Two and only two ways modules interact, both keeping coupling low (the ZeroMQ instinct:
*decouple via messages*):

1. **Direct call through `index.ts`** when a module needs another's data synchronously
   (e.g. `scheduling` reads a `Broadcaster` via `people`'s public surface). Never reach
   past `index.ts` into another module's internals.
2. **Domain events on a typed in-process bus** (in `kernel`) for *reactions*, so the
   emitter does not know its consumers. Example: `scheduling` emits
   `EpisodeAttached{occurrenceId}`; `collaboration` subscribes to raise a notification;
   `playout` subscribes to push the meta to AzuraCast. Synchronous, typed, in-process —
   no broker, no async infra (invariant 6: simplest thing that works). The bus is the
   seam where cross-cutting reactions live without tangling the modules that cause them.

### 3.5 Ports — the phase-2 seam 🟢

Each capability the PD moves in-house in phase 2 sits behind a TypeScript interface with a
phase-1 AzuraCast-backed implementation in `modules/playout/adapters/azuracast`:

```ts
interface PlayoutPort {                      // phase-1: AC playlists/streamers + schedule_items
  pushScheduleBlock(b: ScheduleBlock): Promise<ProjectionRef>
  removeScheduleBlock(ref: ProjectionRef): Promise<void>
  assignMediaToBlock(mediaRef: string, blockRef: ProjectionRef): Promise<void>
  pushNowPlayingMeta(stationId: StationId, meta: NowMeta): Promise<void>
}
interface MediaStorePort {                   // phase-1: AC files API + scanner (PD §4.11)
  list(stationId: StationId, path?: string): Promise<MediaFile[]>
  get(mediaRef: string): Promise<MediaFile>
  setPlaylistMembership(mediaRef: string, blockRefs: ProjectionRef[]): Promise<void>
}
interface PlayoutStatePort {                 // read-only, AzuraCast-owned (PD §6)
  subscribeLive(stationId: StationId, cb: (e: LiveEvent) => void): Unsubscribe
  pollStructural(stationId: StationId): Promise<Snapshot>
}
interface IdentityPort {                     // thin: OndeStudio owns its store (PD §7.1)
  importAccounts(stationId: StationId): Promise<AccountSeed[]>
  verifyBroadcaster(username: string, password: string): Promise<BroadcasterIdentity | null>
}
```

`ProjectionRef` carries the AzuraCast id + object kind opaquely (§3.7). Repositories and
the event bus are ports too — the domain depends on interfaces, the `platform`/adapter
layers provide implementations, wired once in `app.ts`.

### 3.6 Dependency rules — enforced, not aspirational 🟢

The single most important guard against the complexity wall (invariant 6) is an
**acyclic, one-directional import graph** (the Acyclic & Stable Dependencies principles,
Martin), checked in **CI** so it cannot rot:

```
web ─▶ shared ◀─ api
                  ├─ modules/* ─▶ kernel
                  ├─ modules/A ─▶ modules/B   ONLY via modules/B/index.ts
                  ├─ modules/*/domain ─▶ (kernel only)   ✗ no Hono, Drizzle, fetch, AC
                  ├─ modules/*/{routes,repo,adapters} ─▶ platform/ports   (the IO edge)
                  └─ app.ts ─▶ everything (composition root only)
```

- `domain/` is **pure**: no HTTP, no DB, no AzuraCast, no `platform`. Business rules are
  testable with zero IO.
- A module imports another **only through its `index.ts`**; **no import cycles** between
  modules (events break would-be cycles, §3.4).
- IO touches reality only in `routes.ts`, `repo.ts`, `adapters/`, `platform/`.
- **Enforced by `dependency-cruiser`** rules + Biome in CI (§9.2). A violating PR fails —
  the architecture defends itself without relying on reviewer vigilance.

### 3.7 Ownership model in practice 🟢

Every shared object carries its **ownership class** (PD §6 table), which drives sync
direction and conflict policy:

| Class | Examples | Master | DB representation |
|---|---|---|---|
| `os-owned` | states, discussions, votes, pipeline, policies | OndeStudio | own tables only |
| `projected` | playlists, schedule items, streamers, meta pushes | OndeStudio | own table + `projection` row |
| `ac-owned` | play history, live connect/disconnect | AzuraCast | read-only ingest cache |

Projected objects carry the tag marker `[ondestudio:<kind>:<id>]` in AzuraCast's
`description`/`comments` free text (writable — [AUDIT]); the `projection` row holds the
last-pushed payload **and** last-seen AzuraCast snapshot — their divergence is what the
drift engine (§7.5) acts on. Untagged AzuraCast objects are import candidates, never drift.

### 3.8 Concrete stack choices 🟢

Locked by PD §7.1: **Bun · TypeScript · Vue 3 + Vite · SQLite · AGPL-3.0**. This plan
commits the rest (all deps MIT/Apache/LGPL → AGPL-compatible, satisfying CLAUDE.md):

| Concern | Choice | One-line rationale |
|---|---|---|
| HTTP server | **Hono** | tiny, fast, runtime-agnostic (honors invariant 2), first-class OpenAPI via Zod, built-in SSE. *Alt: Elysia (more Bun lock-in).* |
| Validation / contract | **Zod** (in `shared`) | one schema → validation + OpenAPI + client types (§2.2). |
| OpenAPI | **@hono/zod-openapi** | documented contract straight from the Zod routes. |
| DB driver | **`bun:sqlite`** | native, fast, zero-dep (PD §7.1). |
| ORM / migrations | **Drizzle + drizzle-kit** | SQL-close, readable, typed, `bun:sqlite` support, versioned migrations. |
| Password hashing | **`Bun.password` (argon2id)** | built-in, no dep (§12). |
| Time / timezone | **Luxon** | DST-correct Europe/Paris wall-clock math (§5.3). |
| Lint + format | **Biome** | one fast tool replaces ESLint+Prettier; less config to grasp (invariant 6). |
| Dependency rules | **dependency-cruiser** | enforces the §3.6 import graph in CI. |
| Git hooks | **Lefthook** | fast pre-commit: format, lint, typecheck, boundary-check. |
| Versioning / changelog | **Changesets + SemVer** | per-PR changelog entries; honest releases. |
| Tests | **`bun test`** (api) · **Vitest + Playwright** (web) | built-in unit/integration; component + one grid e2e. |
| Front state / routing | **Pinia · vue-router** | the Vue 3 standards. |
| Grid rendering | **custom CSS-grid + interact.js** 🟡 | PD §5.1 rendering is non-standard; off-the-shelf calendars fight it. Final call after the M1 spike (§7.2). |

---

## 4. Domain design — the OO conventions 🟢

How "object-oriented, clean" is made concrete. Tactical patterns from Domain-Driven
Design (Evans), kept lightweight (invariant 6). This is the layer external contributors
extend most, so its patterns are few and uniform.

### 4.1 Building blocks

- **Entity** — has identity and a lifecycle; a class with behavior and invariants
  (`Show`, `SlotDefinition`, `Occurrence`, `Card`, `Broadcaster`). Mutations go through
  methods that protect invariants — never bare field writes.
- **Value object** — immutable, equality by value; encodes a concept and its rules
  (`Fingerprint`, `WallClockTime`, `StationId`, `NegotiationState`, `IssueFlags`,
  `RecurrenceRule`). They make illegal states unrepresentable and move validation off the
  edges into the type.
- **Aggregate** — a consistency boundary with one root entity: `Show` roots its
  `Episode`s and slot bindings; `SlotDefinition` roots its `Occurrence`s/exceptions; a
  repository loads/saves whole aggregates.
- **Application service** (`service.ts`) — one method per use-case; loads aggregates via
  repositories, calls domain methods, persists, emits events. No business rules of its own.
- **Repository** (`repo.ts`) — an interface in the module's domain terms; the Drizzle
  implementation + a **mapper** translate rows ↔ objects. The domain never sees a row.

### 4.2 Rich, persistence-ignorant domain

Behavior lives **in the objects**, not in anemic services around dumb structs.
`occurrence.attachEpisode(ep)` enforces "an echo inherits its origin's metadata"; the
service just orchestrates. The domain layer imports nothing from Drizzle/Hono/AzuraCast
(§3.6), so its rules are unit-tested with no IO — the cheapest, clearest tests in the
codebase (§9.5).

### 4.3 Errors — `Result`, not surprise exceptions

Expected outcomes use a `Result<T, DomainError>` value (in `kernel`); *exceptions are for
the truly exceptional* (bugs, infra failure). A reader of `service.ts` sees every failure
a use-case can return in its signature — no hidden control flow. HTTP error mapping lives
once, in `platform` (§6.1).

### 4.4 State machines as objects

The two PD §4.4 state families are explicit machines, not loose enums: a
`NegotiationState` value object knows its legal transitions
(`pre-booked → in_discussion → validated → aired`, `→ declined`,
`validated → cancelled`); `ContentState` knows `empty → received → ready → aired` with
orthogonal `IssueFlags`. Illegal transitions are a typed error, not a silent write. The
machines are pure and exhaustively unit-tested — they are the rules the whole product
turns on.

---

## 5. Data model 🟢

The SQLite schema realizing PD §4 and PD §7.2, owned per-module via each module's
`schema.ts` (§3.2). Column-level detail is **first-draft** — it must not freeze ahead of
the **naming pass** (PD §9.5, §14.1) or the front prototype (§2.1); the *shape* and the
hard decisions below are committed. The domain (§4) is the real model; these tables are
its persistence, reached only through repositories.

### 5.1 Entity overview

```
[scheduling]  show ─< slot_definition ─< occurrence >─ episode
                                 occurrence ─ occurrence (echo: origin_occurrence_id)
[content]     media (fingerprint) ─< membership >─ rotation_pool | occurrence
              contribution → media ; rotation_pool ─< insert_rule
[people]      user ; broadcaster (main+test refs) ; tag/taggable ;
              session ─< recording_fragment ; session → occurrence
[collab]      card ─(anchor type+id)─ any ; comment >─ card ; vote >─ card ;
              assignment (type+id→user) ; notification (type+id→user)
[devices]     box → broadcaster
[playout]     projection (os object → AC id + tag + snapshots)
```

### 5.2 Core tables (key columns)

```sql
show(id, name, slug, identity_json, drop_folder_path,
     fallback_policy ENUM('discard','replay_previous') DEFAULT 'discard',  -- PD §4.5
     trust_auto_air BOOL DEFAULT 0, replay_flag ENUM('yes','no','not_specified'),
     contributor_tz TEXT NULL, created_at, updated_at)
slot_definition(id, show_id NULL, kind ENUM('recurring_show','rec_series','live','rotation_block'),
     broadcaster_id NULL, rrule TEXT, start_wall TEXT, duration_min INT,
     negotiation_default ENUM(...) DEFAULT 'pre-booked')
occurrence(id, slot_definition_id, starts_at_utc, ends_at_utc, origin_occurrence_id NULL,
     episode_id NULL, negotiation_state ENUM(...), content_state ENUM('empty','received','ready','aired'),
     issue_flags JSON, content_duration_min INT NULL, overrides_json,
     UNIQUE(slot_definition_id, starts_at_utc))            -- sparse (§5.3)
episode(id, show_id, title, description, meta_json, queue_order INT, arrived_at,
     source ENUM('drop','manual','contribution'), media_id NULL)
media(id, fingerprint TEXT UNIQUE, az_file_id TEXT NULL, path, duration_sec INT,
     title, artist, meta_json, is_duplicate_of NULL)       -- PD §4.11
rotation_pool(id, name, rules_json) ; insert_rule(id, name, pool_id, cadence_json, window_json, placement_json)
contribution(id, media_id NULL, format, state ENUM('received','discussed','validated','placed'), destination_json)
user(id, az_account_ref, display_name, role ENUM('team','external'), password_hash)
broadcaster(id, display_name, kind ENUM('team','external'), comment_meta,
     main_streamer_ref, test_streamer_ref, enforce_schedule BOOL)   -- PD §5.10
session(id, broadcaster_id, started_at, ended_at, occurrence_id NULL,
     replay_state ENUM('yes','no','not_specified')) ; recording_fragment(id, session_id NULL, path, started_at, duration_sec)
card(id, intent ENUM('discussion','idea','prospection','task'),
     status ENUM('open','in_progress','decided_done','archived'),
     anchor_type TEXT NULL, anchor_id INT NULL, subject, outcome_json NULL, created_by)
comment(id, card_id, author_id, body, created_at) ; vote(id, card_id, user_id, kind, UNIQUE(card_id,user_id))
tag(id, label) ; taggable(tag_id, object_type, object_id)
assignment(id, object_type, object_id, user_id) ; notification(id, user_id, object_type, object_id, kind, read_at NULL)
box(id, name, broadcaster_id, token_hash, last_heartbeat)
projection(id, os_object_type, os_object_id, station_id, az_kind, az_id,
     tag_marker, last_pushed_json, last_seen_json, last_synced_at)     -- §3.7
```

### 5.3 Recurrence — sparse materialization 🟢

The calendar-app model (PD §7.2). A future occurrence is **computed on read** from
`slot_definition.rrule` over a rolling horizon; an `occurrence` row is **persisted only
when it diverges** — carries state, an episode/echo binding, an exception, or has aired.
Small table; "edit one occurrence" = one exception row; matches RFC-5545
`RECURRENCE-ID`/`EXDATE`. Weekly is the dominant case; `rrule` is stored for
forward-compat but phase 1 emits/parses only the weekly subset.

### 5.4 Time model 🟢

Slot times are **wall-clock in the station tz** (`Europe/Paris`) — a 14:00 show stays
14:00 across DST (invariant 3, PD §8.1). Absolute `starts_at_utc`/`ends_at_utc` are
derived via Luxon at materialization. Event timestamps (comments, sessions, history) are
UTC. AzuraCast `schedule_items` are DST-naive `HHMM`+`days`; the one DST mapping lives in
the adapter (§7.8, §14.5).

### 5.5 Identity, ownership, anchoring 🟢

- **Fingerprint** = SHA-256 of file bytes (survives move/rename — the stated PD §4.11
  need; exact-duplicate detection free, surfaced not blocked). Acoustic fingerprint
  (Chromaprint) is a phase-2 upgrade. `media.az_file_id` ties to AzuraCast but the row is
  keyed by fingerprint, so phase 2 can re-home files without losing history.
- **Ownership/sync** realized by the `projection` table (§3.7), not columns scattered
  across entities.
- **Polymorphic anchoring**: `assignment`/`card`/`notification` reference any object by
  `(object_type, object_id)`; card **promotion** (PD §4.14) re-anchors atomically.

### 5.6 Migrations 🟢

`drizzle-kit` generates versioned SQL migrations, applied idempotently at startup. **No
spreadsheet/Wekan data migration** (PD §6 "fresh start"); the seed import (§7.6) populates
from AzuraCast.

---

## 6. API design 🟢

REST/JSON, versioned `/api/v1`, **OpenAPI-documented** (generated from `shared` Zod),
**SSE** for realtime, resources **station-scoped** (`/stations/{station}/…`, shortcode or
id — [AUDIT]). Exposes **OndeStudio's own model only** — AzuraCast never leaked
(PD §6, §7.2). Names provisional pending PD §9.5 (§14.1).

### 6.1 Conventions 🟢

- **Validation:** every request/response checked by the shared Zod schema → 422 with
  `{error, issues[]}`.
- **Errors:** `Result` domain errors (§4.3) map to HTTP **once**, in `platform`; 4xx
  client, 5xx adapter/AzuraCast (which must never take air down — invariant 1; the API
  degrades, the stream does not).
- **Filtering/pagination:** cursor pagination; the grid filter set (state, show, type —
  PD §5.1) is first-class on `occurrences`/`schedule`.
- **Idempotency:** write-back keyed on the OndeStudio object id so retries don't duplicate.

### 6.2 Resource surface 🟢

| Resource | Endpoints (under `/stations/{station}`) | Module · note |
|---|---|---|
| `shows` | `GET/POST /shows`, `GET/PUT/DELETE /shows/{id}` | scheduling · hub (PD §5.4) |
| `episodes` | `GET/POST /shows/{id}/episodes`, `PUT/DELETE …`, `POST …/reorder` | scheduling · queue (PD §4.5) |
| `slots` | `GET/POST /slots`, `GET/PUT/DELETE /slots/{id}` | scheduling · definitions |
| `occurrences` | `GET /occurrences?from&to&filter`, `PATCH /occurrences/{id}` | scheduling · PATCH = exception (§5.3) |
| `rotation-pools`, `insert-rules` | `GET …` (read-only phase 1) | content · phase-2 edit (PD §6) |
| `media` | `GET /media?path`, `GET /media/{id}`, `PUT /media/{id}/membership` | content · [AUDIT] |
| `contributions` | `GET/POST …`, `PUT …/{id}` | content · manual intake (PD §4.6) |
| `sessions` | `GET …` (read-only phase 1) | people · replay = phase 2 |
| `cards` | `GET/POST /cards`, `PUT /cards/{id}`, `POST /cards/{id}/promote` | collaboration |
| `…/comments`, `…/votes` | `GET/POST`, `PUT /votes` (upsert) | collaboration |
| `notifications` | `GET …`, `POST /{id}/read` | collaboration (PD §5.12) |
| `users`, `broadcasters`, `tags` | CRUD (broadcasters = fan-out, PD §5.10) | people |
| `boxes` | `GET …` (phase-2 write) | devices (PD §5.7) |
| `schedule`, `now` | `GET /schedule?from&to`, `GET /now` | **public read — the galaxy seam (§6.4)** |

### 6.3 Realtime (SSE) 🟢

Hono `streamSSE`. Channels: `grid` · `board` · `onair`. Live/now-playing in seconds;
structural ≤ 30 s (PD §6 "Freshness"). The front subscribes per active surface.

### 6.4 The public read contract — the galaxy seam 🟢

`schedule` and `now` are **first-class public API**, not front-only routes (PD §7.2). This
is what lets **OndePlayer switch its Upcoming/now-playing source onto OndeStudio** at
write-back (M5, §11; PD §6). `schedule` returns only `validated` occurrences with
(episode-enriched) public metadata, computing the **revert-to-generic after slot + echoes
play** server-side (PD §5.5). Designing these properly *is* "API-first" made concrete.

### 6.5 Auth on the API 🟢

Session-cookie auth (§12); `team` → full surface, `external` → only their own broadcaster's
slots/metadata (PD §4.12). Public read auth decided with the M5 OndePlayer switch.

---

## 7. AzuraCast integration layer 🟢

The `playout` module's adapter behind the ports (§3.5). The [AUDIT] confirms every write
phase 1 needs.

### 7.1 Capability → AzuraCast mapping 🟢

| OndeStudio capability | AzuraCast mechanism | Status |
|---|---|---|
| Grid slot ↔ schedule block | playlist/streamer + `schedule_items` (`HHMM`, `days[]`) | confirmed [AUDIT] |
| Episode → occurrence | `PUT /file/{id}` `{playlists:[…]}` | confirmed [AUDIT] |
| Broadcaster main/test fan-out | streamer create/update both stations; `enforce_schedule` main only | confirmed [AUDIT] |
| Projected-object tagging | `description`/`comments` marker `[ondestudio:…]` | confirmed [AUDIT] |
| Now-playing meta push | live-meta-sync via API | proven in prod (OndePlayer, PD §2.2) |
| Play history / live connect | read-only ingest (SSE + poll) | AzuraCast-owned (PD §6) |

### 7.2 The adapter 🟢

Typed AzuraCast client (fetch + `.env` key) with per-station addressing, bounded
**retry/backoff** and a **circuit breaker** — a flaky AzuraCast degrades the overlay, never
air (invariant 1). AzuraCast-shaped types stay inside this module; nothing escapes past the
ports (§3.6).

### 7.3 Ingest 🟢

SSE listener (now-playing/live up-down → `onair` + `ac-owned` cache, auto-reconnect);
structural pollers (≤ 30 s) for playlists/`schedule_items`/streamers/media feeding the
drift engine; reuse the **logic** of OndePlayer's enriched-Upcoming builder and
live-meta-sync (PD §2.2) re-implemented behind the ports; AzuraCast webhooks as a later
push complement (PD §6).

### 7.4–7.5 Projection, drift & reconciliation 🟢

Pushing a projected object stamps the `[ondestudio:…]` tag and records the `projection`
row (§3.7). The drift engine (Increment 2) compares `last_seen` vs `last_pushed`:
unambiguous diffs (time/meta/enable) **absorbed** automatically; ambiguous ones to a
one-click **reconciliation inbox**. Never silently overwrite a manual edit; never fight an
emergency fix (PD §6).

### 7.6 Seed import & main/test reconcile 🟢

Import playlists/`schedule_items`/streamers as **untagged candidates** to adopt
progressively; reconcile main/test mirror drift (PD §2.2/§2.3) proposing each fix for
approval. No spreadsheet migration; Wekan archived read-only externally.

### 7.7 API account & write-target progression 🟢

Reads (Inc. 1) use the shared "OndeZero API account". **Before any production (`oz`) write,
provision the dedicated API account** (PD §7, [AUDIT]). Inc. 2 writes target **`wz-test`
first**, then `oz` once trusted (per-feature adoption, PD §6).

### 7.8 DST / `schedule_items` 🟡

Mapping tz-aware wall-clock occurrences (§5.4) to DST-naive `HHMM`+`days`, and the
spring-forward/fall-back edge behavior, is an **open item to confirm in implementation**
(§14.5). The wall-clock model confines the DST question to this one mapping.

---

## 8. Front office 🟢

Vue 3 + Vite, Pinia, vue-router (PD §7.1). Dark, retrofuturist, **sustainable** (light
pages, minimal assets), **themable from the start** (PD §8.1). Desktop-primary for heavy
ops; mobile first-class for quick flows (PD §8.1, invariant 5).

**8.1 Front modularity.** Mirrors the back (§3.2): `features/<surface>/` (grid, board,
media, shows, quick-edit, onair) each self-contained (components + store + api bindings +
tests); shared themed primitives in `ui/`; the typed client in `lib/api`. Same "learn one,
know all" property.

**8.2 Build order** (front-first, §2.1): the **week grid** prototype first — the
ergonomics gate (M1). Then show page + basic media browser; quick meta/Upcoming editing;
the thin board + assignment.

**8.3 Grid library decision 🟡.** The grid renders what no off-the-shelf calendar does
cleanly (PD §5.1): a **booked frame** + inner **content-length fill**, an **overlap
indicator** (soft boundaries, §4.4), **state colour + flag badges**, drag/drop/resize on
desktop *and* mobile, across three zoom levels. FullCalendar's resource/timeline views are
commercially licensed (an AGPL/cost problem) and resist the booked-vs-fill model.
**Decision (confirm in the M1 spike):** a **custom CSS-grid week component + interact.js**
(MIT) rather than bend a calendar lib; evaluate `@schedule-x`/`vue-cal` (MIT) only for the
month overview. The spike confirms or overturns this cheaply — the core risk (PD §8.2).

**8.4 Grid rendering spec.** Slot card height ∝ booked duration; inner fill ∝
`content_duration_min`; under-run shows the gap rotation covers, over-run raises the
overlap indicator (PD §5.1). Colour = negotiation state; badges = issue flags; they
compose (PD §4.4). Week first; month + 3-day in fast-follow. Read-only phase-2 layers
(rotation blocks, insert **overlay bands**) render without edit affordances (PD §4.8, §6).

**8.5 Other surfaces.** Media browser with fingerprint identity, duplicate warnings,
convention hints, ownership badges (PD §5.3, §5.4); object pages / show library — the
flagship hub, one click from each lens and back (PD §5.4); board — one pivotable surface,
group-by + sort, emoji votes, *not a Wekan clone* (PD §5.2, §8.1); quick meta/Upcoming
editing (PD §5.5); on-air view in fast-follow (PD §5.11).

**8.6 Theming/sustainability.** CSS custom properties drive theming day one (the dark
theme is one theme, not hardcoded — PD §8.1); minimal JS, lazy routes, no heavy bundles.

---

## 9. Engineering conventions 🟢

The rules that keep the codebase uniform and welcoming (invariant 6). Few, enforced
automatically where possible so review is about *correctness*, not style.

**9.1 Language.** TypeScript `strict` everywhere — no `any`, `noUncheckedIndexedAccess`,
no implicit returns. Types are documentation; the compiler is the first reviewer.

**9.2 Format, lint, boundaries.** **Biome** formats and lints with one shared config;
**dependency-cruiser** enforces the §3.6 import graph; both run in **Lefthook** pre-commit
and in CI. Style is never debated in review — the tools decide.

**9.3 Naming & files.** Files kebab-case; classes/types PascalCase; functions/vars
camelCase. **One primary export per file**, named for the file. Folder names are domain
nouns (§3.2). Soft size budget ~200–300 lines/file, small functions — when a file grows
past that, it is usually two concepts (split it). Smaller units = a unit an AI agent or a
newcomer holds in working memory at once (invariant 6).

**9.4 Comments.** Explain **why**, not what (PD §8.2). Each module's `README.md` states
its purpose, invariants and extension points; public surfaces (`index.ts`, ports) carry
doc comments. Non-obvious decisions point to their ADR (§10.3).

**9.5 Tests are the contract** (ZeroMQ/C4 spirit). Colocated `*.test.ts`. Domain logic
(state machines, recurrence/DST, drift) is unit-tested with no IO — the highest-value,
cheapest tests. Adapters test against **recorded AzuraCast fixtures, never live `oz`**.
**Every behavioral change ships with a test; master is always green** (§10.2). One
Playwright e2e guards the grid happy-path.

**9.6 Commits & PRs.** Conventional Commits; small, problem-oriented PRs (one stated
problem each, §2.4); squash-merge; a Changeset per user-visible change drives SemVer and
the changelog. PR template asks: *which problem, which test, which ADR if a decision.*

---

## 10. Contribution model & governance 🟢

OndeStudio is open source and means it: the goal is to be **easy and rewarding to
contribute to**, for external human peers *and* AI agents, from day one (invariant 6;
PD §8.2). The model is adapted from the most successful small-FOSS playbook in this
lineage — ZeroMQ's **C4** (Collective Code Construction Contract, RFC 42) and Pieter
Hintjens' *Social Architecture* (Appendix E) — taken in spirit, sized for a 4–6-person
project that wants to grow contributors.

**10.1 Optimize for the contributor, not the maintainer.** The barrier to a good first
patch is kept low: a runnable repo in one command (`bun install && bun dev`), green
checks locally in seconds, a uniform module shape to copy (§3.2), recipes for common
additions (Appendix B), and "good first issue" labels.

**10.2 Problem first, then minimal solution.** Work starts from a **clearly-stated
problem** (an issue), not a speculative solution. A patch is the *simplest correct* change
that solves exactly that problem (§2.4). **master is always buildable and releasable** —
CI (typecheck · Biome · dependency-cruiser · `bun test`) gates every merge; a red build is
the only thing that blocks a contributor, and fixing it is everyone's first priority.

**10.3 Decisions are recorded — ADRs & RFCs.** Every non-trivial decision gets a short
**ADR** (MADR format, `docs/adr/NNNN-*.md`): context, decision, consequences. The choices
in *this* document (Hono, Drizzle, modular monolith, event bus, Result types, the grid-lib
lean…) become the **seed ADRs** at M0, so the *why* is never lost. Larger or cross-cutting
changes (a new module, an API-contract break, the phase-2 takeover of a capability) go
through a lightweight **RFC** (`docs/rfc/`) before code — the ZeroMQ habit of speccing the
contract first. This is also how OndePlayer/drop/OndePi coordination (PD §6 phase 2) will
be negotiated in the open.

**10.4 Designed for AI *and* human contributors alike.** A deliberate, concrete property,
not a slogan:

- **Context-sized modules.** A whole feature module (§3.2) fits in an agent's context and
  a person's head — reason about it without loading the world.
- **Uniform shape.** Every module and every front feature looks the same, so "learn one,
  know all" holds for people and pattern-matching models equally.
- **Machine-readable contracts as guardrails.** Strict types, Zod schemas, OpenAPI, the
  enforced dependency graph and the test suite are guardrails an agent (or a hurried human)
  *cannot silently violate* — a wrong change fails a check, fast and locally.
- **Intent is written down.** ADRs/RFCs and module READMEs capture *why*, which is exactly
  what an agent needs to extend code correctly rather than plausibly.
- **`AGENTS.md` (+ the existing `CLAUDE.md`).** A short, living guide pointing any agent at
  the conventions, the module shape, the recipes, and the local check commands — so an AI
  contributor starts from the same on-ramp as a human one.

**10.5 Collective ownership, light process.** No module is one person's fiefdom; anyone may
patch anywhere within the conventions. Review focuses on correctness, scope and convention
adherence (style is automated, §9.2). Full C4 strictness (e.g. merge-then-fix) is the north
star we can formalize as the contributor base grows; phase 1 runs the lightweight subset
above (§14.6). `CODE_OF_CONDUCT.md` sets the welcoming, harassment-free baseline.

---

## 11. Milestone plan 🟢

Each milestone names the PD exit bar it serves. No hard deadline — quality over speed
(PD §2.1). **M0 is the walking skeleton** (§2.3): the architecture proven end-to-end and
the contributor on-ramp in place, *before* features.

**M0 — Foundations & walking skeleton.** Concretely, the first build-from-scratch tasks
(this is what hands a clean start to Opus 4.8 or any contributor):

1. Bun workspace; `shared`, `api`, `web` packages; `app.ts` composition root.
2. `platform`: Hono app, `bun:sqlite` + Drizzle + first migration, Zod-validated config
   from `.env`, structured logging, OpenAPI + SSE wiring.
3. `kernel`: `Result`, ids, `Clock`, `StationId`, base `Entity`/`ValueObject`, the typed
   event bus (§3.4).
4. **One vertical slice end-to-end**: `GET /stations/{station}/now` through
   route → service → domain → `playout` adapter (read) → response — proving every layer and
   the SSE channel run together.
5. Tooling & on-ramp: Biome, dependency-cruiser rules (§3.6), Lefthook, `bun test` + Vitest
   + Playwright skeletons, GitHub Actions CI (all gates green); **`CONTRIBUTING.md`,
   `ARCHITECTURE.md`, `AGENTS.md`, `CODE_OF_CONDUCT.md`, the seed ADRs and an RFC template**
   (§10, Appendix D).

*Bar: a running, documented shell a contributor can clone, run, test and extend in minutes.*

| # | Milestone | Delivers | PD exit bar |
|---|---|---|---|
| **M0** | Foundations & walking skeleton | the on-ramp above | a runnable, extensible shell |
| **M1** | Grid prototype *(Inc. 1 core)* | week grid reading AC + OS state overlay; slot quick-edit; grid-lib spike resolved (§8.3); mobile pass | **grid ergonomics validated — core risk; air untouched** |
| **M2** | Mirror complete *(Inc. 1)* | show page + basic media browser; thin board + assignment + a few notification triggers; quick meta/Upcoming (read) | team plans/discusses/assigns while AC still writes |
| **M3** | Driver *(Inc. 2)* | write-back (slots + episode-queue assignment); ownership/drift engaged; reconciliation inbox; **`wz-test` → `oz`** (dedicated account first, §7.7) | **decisions reach AzuraCast** |
| **M4** | Broadcaster mgmt | main/test fan-out (PD §5.10) — **parallel** with M2–M3 | **centralized account mgmt with fan-out** |
| **M5** | Upcoming switch | OndePlayer reads OS `schedule`/`now` (PD §6, §7.2) — first galaxy coordination | **validated slots reach the public Upcoming via OndeStudio** |

**Sequencing.** M0 → M1 → M2 → M3 → M5; M4 parallel (depends only on M0 + broadcaster
adapter). The four exit-bar items map to M1+M2 / M2 / M3 / M4.

**Fast-follow** (overlay, post-MVP): month + 3-day zooms; echo slots; on-air view; fuller
board + more notification triggers; drift-reconciliation polish.

**Phase-2 watch** (kept possible by §3.5 ports, not built): rotation/insert editing,
night-mix pinning, replay overhaul, OndePi QR + heartbeat, echo-of-live, drop-tool intake.

---

## 12. Auth & identity 🟢

OndeStudio **owns its user/session store**, synced from AzuraCast accounts — not a live
proxy (PD §4.12, §7.1) — so auth survives phase 3. **Signed httpOnly session cookies**
backed by a `session` table (no JWT for a single-server 4–6-user app); passwords hashed
with **`Bun.password` (argon2id)**.

- **Team** (`role=team`): full surface; provisioned at seed (§7.6), sets an OndeStudio
  password on first sign-in (store independent thereafter).
- **External broadcaster** (`role=external`): only their own slots/metadata (PD §4.12);
  verified via `IdentityPort.verifyBroadcaster` against the Icecast streamer credentials
  OndeStudio manages (it sets them in M4's fan-out, so it owns the hash; legacy accounts
  get a first-set/reconcile step).
- Finer intra-team split deferred (PD §4.12, §8.1). **Box-scoped QR tokens** (PD §5.7) are
  phase-2 (`box.token_hash` present, unused in phase 1).

---

## 13. Cross-cutting concerns 🟢

- **Config/secrets:** repo-local `.env` (gitignored), `.env.example` documents it; a Zod
  schema validates config at boot — fail fast (PD §7.1).
- **Deployment:** single server `onde-zero`, **systemd** alongside the AzuraCast Docker
  stack; one Bun process serves the built SPA + the API. Never in the playout hot path
  (invariant 1).
- **Persistence/backups:** one SQLite file; file-copy backups now, litestream-style option
  later.
- **Observability:** structured logs; an **adapter-health surface** so a degraded AzuraCast
  link is visible in-app — never silent (invariant 1).
- **FOSS hygiene:** AGPL-3.0; all deps license-compatible (§3.8, CLAUDE.md); the
  conventions (§9) and contribution model (§10) *are* the hygiene.

---

## 14. Open questions (plan-level) 🟡

1. **Naming pass** (PD §9.5) — slot-type/state vocabulary must land **before** §5 schema
   and §6 resource names freeze. *Resolves: a naming session before M0 schema lock.*
2. **Media storage layout** (PD §9.6) — the from-scratch conventions **team session**;
   shapes `media`/filetree (§5.2) and the browser (§8.5). *Not inventable here;* the
   MediaStore port (§3.5) accepts whatever emerges.
3. **Replay encoding** (PD §9.7) — opus-fix vs mp3; phase-2 pipeline, model precludes
   neither (§5.2). *Resolves: technical investigation (PD §10 step 4).*
4. **Grid rendering library** (§8.3) — custom + interact.js (leaning) vs a lib. *Resolves:
   M1 spike.*
5. **DST mapping** of `schedule_items` (§7.8). *Resolves: M3.*
6. **Governance formalization timing** (§10.5) — when to adopt fuller C4 / split
   maintainers. *Resolves: when external contributors arrive.*
7. **Event-bus scope** (§3.4) — keep purely in-process/synchronous through phase 1? Likely
   yes; revisit only if a reaction needs durability. *Resolves: as reactions accrue.*
8. **Public-read auth** for the galaxy seam (§6.5). *Resolves: M5.*
9. **Occurrence horizon** (§5.3) — how far ahead sparse materialization caches. *Resolves:
   M1, tuned to grid performance.*

---

## 15. Next steps 🟢

This v0.3 is a **complete plan for review** — comprehensive enough to start building.

1. **Review pass together** — confirm the architecture (§3), the domain stance (§4), and
   especially the conventions + contribution model (§9, §10); flag anything off-intent.
2. **Naming session** (PD §9.5, §14.1) — lock vocabulary so §5/§6 names can freeze.
3. **M0** — stand up the walking skeleton and the contributor on-ramp (§11), then the
   **M1 grid spike** (§8.3), the product's core risk.
4. In parallel, PD §10's own next-steps: the **storage-layout design session** (feeds §5.2,
   §14.2) and the **replay-encoding investigation** (§14.3).

> The PD remains the source of truth for *intent*; this plan owns the *how*. Technology and
> process commitments (§3.8, §9, §10) exist to make building possible and pleasant now —
> each is an ADR away from being revisited, and the §14 items stay deliberately open.

---

## Appendix A — PD vocabulary → concrete names (provisional, pending PD §9.5)

| PD concept (§4) | Module | Table (§5.2) | Resource (§6.2) |
|---|---|---|---|
| Slot (definition) / occurrence | scheduling | `slot_definition` / `occurrence` | `slots` / `occurrences` |
| Show / episode / queue | scheduling | `show` / `episode` (`queue_order`) | `shows` / `episodes` |
| Negotiation / content state | scheduling | `occurrence.*_state` | (fields) |
| Contribution / media / fingerprint | content | `contribution` / `media.fingerprint` | `contributions` / `media` |
| Rotation pool / insert rule | content | `rotation_pool` / `insert_rule` | `rotation-pools` / `insert-rules` |
| Broadcaster / session | people | `broadcaster` / `session` | `broadcasters` / `sessions` |
| Tag / assignment | people / collab | `tag`+`taggable` / `assignment` | `tags` / (nested) |
| Discussion card | collaboration | `card`(+`comment`,`vote`) | `cards` |
| Box (OndePi) | devices | `box` | `boxes` |
| Computed grid / on-air | playout (derived) | — | `schedule` / `now` |

## Appendix B — Extension recipes ("how to add a new …") 🟢

Concrete on-ramps; each is a small, copy-the-pattern change (invariant 6).

- **A new API resource:** add the Zod schema to `shared`; in the owning module add the
  route in `routes.ts`, the use-case in `service.ts`, the table in `schema.ts` + a
  migration, the repo method in `repo.ts`; colocate a test. OpenAPI updates itself.
- **A new slot kind:** extend the `slot_definition.kind` value object + its transitions in
  `scheduling/domain`; teach the grid renderer (§8.4) its badge/colour; add an ADR if it
  changes scheduling semantics.
- **A new port adapter (phase 2):** implement the existing port interface (§3.5) in a new
  `adapters/` folder; swap the wiring in `app.ts`. Nothing above the port changes — the
  whole point of the seam.
- **A cross-module reaction (e.g. a new notification):** subscribe to the relevant domain
  event in `collaboration/events.ts` (§3.4); no change to the emitting module.

## Appendix C — A worked vertical slice 🟢

*"Attach an arriving episode to the nearest empty occurrence"* (PD §4.5) — the canonical
path to copy:

1. **Contract** — `shared` defines `AttachEpisodeInput` (Zod).
2. **Route** — `scheduling/routes.ts` validates input, calls the service.
3. **Service** — `scheduling/service.ts` loads the `Show` aggregate + its queue via the
   repo, calls `show.fillNearestEmptyOccurrence(episode)`.
4. **Domain** — the `Show`/`Occurrence` objects enforce the rules (nearest empty incl. this
   week; echoes inherit; content state `empty → received`), returning a `Result`.
5. **Persist** — the repo saves the aggregate (mapper → Drizzle rows).
6. **Event** — service emits `EpisodeAttached`; `collaboration` raises a notification,
   `playout` (Inc. 2) pushes the media→occurrence assignment to AzuraCast (§7.1).
7. **Realtime** — the `grid` SSE channel emits; the front updates the occurrence's fill.
8. **Test** — a domain unit test for the fill rule (no IO) + a service/integration test.

Every feature is a variation on these eight steps. That repetition is the point.

## Appendix D — Companion files to create at M0 🟢

Specified here, created as living repo files at M0 (§11): `CONTRIBUTING.md` (the §10
process), `ARCHITECTURE.md` (§3–§4 distilled, the map a newcomer reads first), `AGENTS.md`
(§10.4 on-ramp for AI contributors), `CODE_OF_CONDUCT.md`, `docs/adr/` (MADR template +
seed ADRs for §3.8/§4/§10 decisions), `docs/rfc/` (template), GitHub issue/PR templates.

## Appendix E — Influences 🟢

State-of-the-art practices this plan borrows, for contributors who want the deeper why:

- **ZeroMQ C4 — Collective Code Construction Contract** (RFC 42, rfc.zeromq.org) and
  **Pieter Hintjens, *Social Architecture*** — optimize for contributors, problem-oriented
  patches, always-green master, collective ownership (§10).
- **Ports & Adapters / Hexagonal** (Alistair Cockburn) — the AzuraCast seam (§3.1, §3.5).
- **Domain-Driven Design** (Eric Evans) — entities, value objects, aggregates, repositories
  (§4).
- **Clean / Screaming Architecture & the Dependency principles** (Robert C. Martin) — the
  domain-noun module tree and the enforced acyclic graph (§3.2, §3.6).
- **Architecture Decision Records** (Michael Nygard) — `docs/adr/` (§10.3).
- **Walking Skeleton** (Cockburn) and **Simplest Thing That Could Possibly Work** (Kent
  Beck) — M0 and §2.3–2.4.
- **Conventional Commits · Semantic Versioning** — §9.6.
