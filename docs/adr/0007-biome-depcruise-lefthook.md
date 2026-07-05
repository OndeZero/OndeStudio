# 0007 — One fast toolchain: Biome + dependency-cruiser + Lefthook

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Style must never be debated in review, the import graph must not rot, and the toolchain itself
must stay low-config (low cognitive load is an invariant). Green checks locally in seconds is a
contributor-experience requirement.

## Decision

- **Biome** formats and lints everything with one shared config — replacing the ESLint+Prettier
  pair.
- **dependency-cruiser** enforces the docs/2 §3.6 import graph (`bun run boundaries`): pure
  `domain/`, cross-module imports only via `index.ts`, kernel/platform/web rules.
- **Lefthook** runs format, lint, typecheck and boundary-check pre-commit; CI runs the same
  gates. A violating PR fails — the architecture defends itself.
- **`.vue` caveat (decided at M0):** Biome covers `.vue` script blocks; template linting
  (eslint-plugin-vue) is deliberately left out and **revisited when it hurts**.

## Consequences

- Zero style debate; review is about correctness, scope and conventions.
- One fast tool each for style, boundaries and hooks — small config surface.
- Vue templates are unlinted for now — a known, accepted gap.

## Links

- docs/2 §3.8 (stack, incl. the Biome caveat), §9.2 (format/lint/boundaries), §3.6 (rules).
