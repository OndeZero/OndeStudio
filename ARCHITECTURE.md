# OndeStudio — Architecture

The map a newcomer reads first. The full spec lives in `docs/` —
[`docs/1-project_description.md`](docs/1-project_description.md) (the "PD": intent and the
normative domain vocabulary; it wins when documents disagree) and
[`docs/2-implementation_plan.md`](docs/2-implementation_plan.md) (the how). Decisions and their
why live in [`docs/adr/`](docs/adr/). Bare `§x` references below point into docs/2.

## What this is

OndeStudio is the single workspace where a radio team plans its schedule, manages its content,
discusses and decides — and those decisions actually take effect on air. Phase 1 is an **overlay
on AzuraCast**: OndeStudio reads playout reality and writes decisions through the AzuraCast API,
while the station keeps airing through AzuraCast untouched — OndeStudio is never in the playout
hot path.

The three-phase strategy (PD §6) shapes everything: phase 1 overlays AzuraCast through its API;
phase 2 takes capabilities in-house one by one behind stable interfaces, until AzuraCast is
reduced to a Liquidsoap/Icecast host; phase 3 owns playout directly and ships as a generic,
installable product. Hence the defining constraint: **the AzuraCast API is a boundary, not a
foundation** — nothing above the adapter may assume AzuraCast.

## Layering — hexagonal (ports & adapters)

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
   AzuraCast adapter · poll/SSE ingest · drift      §7
   ─────────────────────────────────────────────
   AzuraCast (Liquidsoap · Icecast · media · API)
```

The OndeStudio DB is the source of truth for everything AzuraCast cannot represent (states,
discussions, pipeline, policies); AzuraCast is the source of truth for playout reality.

## Monorepo tree

A Bun workspace. `shared` is what makes API-first concrete: one Zod schema → server validation +
OpenAPI document + client types.

```
packages/
├─ shared/          # Zod schemas + inferred types = the API/domain contract.
│                   #   Depends on neither api nor web; imported by both.
├─ api/
│  └─ src/
│     ├─ modules/<feature>/   # the six feature modules (below)
│     ├─ kernel/              # shared domain primitives: ids, Result, Clock, StationId,
│     │                       #   the event bus, base Entity/ValueObject, error types
│     ├─ platform/            # framework glue: Hono app, db connection, config, logging,
│     │                       #   OpenAPI, SSE. The only place IO is wired.
│     └─ app.ts               # composition root: wires modules + adapters + bus
└─ web/
   └─ src/
      ├─ features/<surface>/  # grid, board, media, shows, quick-edit, onair
      ├─ ui/                  # themed primitives (theming from day one)
      ├─ lib/api/             # typed client built on the `shared` schemas
      └─ stores/              # Pinia
```

## Six feature modules

The API is a **modular monolith** organised by feature, not by technical layer — folder names are
domain nouns ("screaming architecture"): you read the tree and see the radio, not the framework.

| Module | Owns |
|---|---|
| `scheduling` | shows, episodes, slots, occurrences, recurrence, fallback |
| `content` | media, fingerprints, contributions, rotation pools, insert rules |
| `collaboration` | cards, comments, votes, notifications, assignment |
| `people` | users, broadcasters (main/test fan-out), tags, sessions |
| `devices` | OndePi boxes, QR tokens, heartbeat (schema only in phase 1) |
| `playout` | the AzuraCast integration: ports + adapter + sync/drift |

**Every module has the same internal shape** — learn one, know them all:

```
modules/<feature>/
  domain/         # entities, value objects, state machines — pure TS, no IO
  service.ts      # application services = use-cases; orchestrate domain + ports
  ports.ts        # interfaces THIS module requires from outside
  repo.ts         # repository interface + Drizzle impl + row↔object mapper
  schema.ts       # Drizzle table definitions owned by this module
  routes.ts       # thin Hono routes: validate (shared Zod) → call service → map out
  events.ts       # domain events this module emits / subscribes to
  index.ts        # the module's PUBLIC surface — the only import point for other modules
  README.md       # purpose, invariants, extension points
  *.test.ts       # colocated tests
```

## How modules talk — two mechanisms, no third

1. **Direct call through `index.ts`** when a module needs another's data synchronously (e.g.
   `scheduling` reads a broadcaster via `people`'s public surface). Never reach past `index.ts`
   into another module's internals.
2. **Domain events on a typed in-process bus** (in `kernel`) for reactions, so the emitter does
   not know its consumers. Example: `scheduling` emits `EpisodeAttached`; `collaboration` raises
   a notification; `playout` pushes to AzuraCast. Synchronous, typed, no broker
   ([ADR-0006](docs/adr/0006-in-process-event-bus.md)).

## Ports — the phase-2 seam

Each capability the PD moves in-house in phase 2 sits behind a TypeScript interface with a
phase-1 AzuraCast-backed implementation in `modules/playout/adapters/azuracast`:

- `PlayoutPort` — push/remove schedule blocks, assign media, push now-playing meta.
- `MediaStorePort` — list/get media, playlist membership.
- `PlayoutStatePort` — live events + structural snapshots (read-only, AzuraCast-owned).
- `IdentityPort` — account import, broadcaster credential verification.

Repositories and the event bus are ports too. Implementations are wired once, in `app.ts`. A
phase-2 takeover is a new adapter plus a wiring change — nothing above the port notices. That is
the whole point of the seam.

## Dependency rules — CI-enforced, not aspirational

The import graph is acyclic and one-directional, checked by **dependency-cruiser** locally
(`bun run boundaries`, also pre-commit via Lefthook) and in CI — a violating PR fails; the
architecture defends itself without relying on reviewer vigilance:

```
web ─▶ shared ◀─ api
                  ├─ modules/* ─▶ kernel
                  ├─ modules/A ─▶ modules/B     ONLY via modules/B/index.ts
                  ├─ modules/*/domain ─▶ kernel only    ✗ no Hono, Drizzle, fetch, AzuraCast
                  ├─ modules/*/{routes,repo,adapters} ─▶ platform/ports   (the IO edge)
                  └─ app.ts ─▶ everything (composition root only)
```

- `domain/` is **pure** — business rules are testable with zero IO.
- Cross-module imports go **only through `index.ts`**; no import cycles (events break would-be
  cycles).
- `kernel` imports no module and no platform; `platform` never imports modules; `web` never
  imports `api` — both meet only in `shared`.
- IO touches reality only in `routes.ts`, `repo.ts`, `adapters/`, `platform/`.

## Domain design conventions

Lightweight DDD tactics (§4) — few patterns, applied uniformly:

- **Entity** — identity and a lifecycle; a class whose methods protect invariants (`Show`,
  `Occurrence`, `Card`, `Broadcaster`). Never bare field writes.
- **Value object** — immutable, equality by value (`Fingerprint`, `WallClockTime`,
  `NegotiationState`, `RecurrenceRule`). They make illegal states unrepresentable.
- **Aggregate** — one consistency boundary, one root (`Show` roots its episodes and slot
  bindings; `Slot` roots its occurrences); repositories load/save whole aggregates.
- **Application service** (`service.ts`) — one method per use-case; orchestrates domain + ports,
  holds no business rules of its own.
- **Repository** (`repo.ts`) — an interface in domain terms; the Drizzle implementation and a
  mapper translate rows ↔ objects. The domain never sees a row.
- **Errors** — expected failures are `Result<T, DomainError>` values; exceptions are for the
  truly exceptional. HTTP mapping lives once, in `platform`
  ([ADR-0005](docs/adr/0005-result-errors.md)).
- **State machines are objects** — `NegotiationState`
  (`pre-booked → dealing → validated → aired`, branches to `declined`/`cancelled`) and
  `ContentState` (`empty → received → ready → aired`, orthogonal issue flags) know their legal
  transitions; an illegal transition is a typed error, and the machines are exhaustively
  unit-tested.

## Going deeper

- **The canonical path to copy:** docs/2 Appendix C walks a full vertical slice in eight steps —
  every feature is a variation on it.
- **Extension recipes:** docs/2 Appendix B, summarised in [AGENTS.md](AGENTS.md).
- **Data model** §5 · **API design** §6 · **AzuraCast integration** §7 · **front office** §8 ·
  **conventions & contribution model** §9–§10 · **milestones** §11.
- **Why it is this way:** [`docs/adr/`](docs/adr/).
