# AGENTS.md — AI contributors start here

OndeStudio is deliberately built so an AI agent can contribute well: modules sized to fit a
context window, one uniform shape everywhere, and machine-checkable guardrails that a wrong
change cannot silently pass. AI contributions follow the same rules as human ones
([CONTRIBUTING.md](CONTRIBUTING.md)): problem first, smallest correct patch, test included.

## Read first, in order

1. [ARCHITECTURE.md](ARCHITECTURE.md) — the map: layering, the six feature modules, the
   dependency rules. Short by design.
2. **The module you are touching** — `packages/api/src/modules/<feature>/` (or
   `packages/web/src/features/<surface>/`). A whole module fits in context; load all of it.
3. **That module's `README.md`** — its purpose, invariants and extension points.
4. When intent is unclear: [`docs/adr/`](docs/adr/) records why decisions were taken;
   [`docs/1-project_description.md`](docs/1-project_description.md) and
   [`docs/2-implementation_plan.md`](docs/2-implementation_plan.md) are the full spec.

## The shape to copy

Every API feature module has the same files — put new code where the pattern puts it:

```
domain/      pure rules (entities, value objects, state machines) — no IO, kernel imports only
service.ts   use-cases: load via repo, call domain methods, persist, emit events
ports.ts     interfaces this module requires from outside
repo.ts      repository interface + Drizzle implementation + row↔object mapper
schema.ts    Drizzle tables owned by this module
routes.ts    thin Hono routes: validate (shared Zod) → call service → map out
events.ts    domain events emitted / subscribed
index.ts     the ONLY thing other modules may import
*.test.ts    colocated tests
```

docs/2 Appendix C walks the canonical vertical slice (contract → route → service → domain →
persist → event → SSE → test). Every feature is a variation on those eight steps.

## Guardrails — they will catch you, so run them first

```sh
bun run check     # typecheck + lint + boundaries + tests — run from the repo root
```

| Gate | Catches |
|---|---|
| `bun run typecheck` | TypeScript strict — no `any`, `noUncheckedIndexedAccess` |
| `bun run lint` | Biome format/lint drift (`bun run lint:fix` auto-fixes) |
| `bun run boundaries` | dependency-cruiser: impure `domain/`, imports past another module's `index.ts`, kernel→module, platform→module, web→api |
| `bun run test` | missing/broken tests — every behavioural change ships with one; adapters test against recorded fixtures, never live stations |

CI runs the same gates; a red gate fails the PR.

## Extension recipes

- **A new API resource** — add the Zod schema to `packages/shared`; then in the owning module:
  the route in `routes.ts`, the use-case in `service.ts`, the table in `schema.ts` plus
  `bun run db:generate` for the migration, the repo method in `repo.ts`; colocate a test.
  OpenAPI updates itself.
- **A new slot kind** — extend the `slot.kind` value object and its transitions in
  `scheduling/domain`; teach the grid renderer its badge/colour; add an ADR if it changes
  scheduling semantics.
- **A new port adapter (phase 2)** — implement the existing port interface (§3.5) in a new
  `adapters/` folder; swap the wiring in `app.ts`. Nothing above the port changes.
- **A cross-module reaction** (e.g. a new notification) — subscribe to the relevant domain event
  in `collaboration/events.ts`; the emitting module does not change.

## Hard rules

- **Never write to the production station `oz`.** Test writes target `wz-test` only; production
  writes happen per-feature, only with the dedicated API account (docs/2 §7.7).
- **Never commit secrets.** Credentials live in the gitignored repo-local `.env`;
  `.env.example` documents the variables.
- **Precedence when sources disagree:** `docs/1` (the PD) wins over `docs/2`, which wins over
  code comments. Fix the loser, don't follow it.
- **Keep the shape:** files ≤ ~300 lines, one primary export per file, kebab-case filenames,
  colocated tests, comments explain *why*.
- **Record decisions.** A non-trivial decision gets an ADR in the same PR (`docs/adr/`);
  cross-cutting changes go through `docs/rfc/` first.
