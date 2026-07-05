# 0001 — Modular monolith in six feature modules

- **Status:** accepted
- **Date:** 2026-07-05

## Context

Phase 1 must be operationally simple — one process, air never in OndeStudio's hot path — yet the
codebase must stay graspable for a 4–6-person team and welcoming to external human and AI
contributors (low cognitive load is an architectural invariant). Phase 2 will take capabilities
in-house one by one, so boundaries must exist from day one.

## Decision

Ship one Bun process, organised as a **modular monolith by feature / bounded context**, not by
technical layer. Six modules map 1:1 to the PD concept groups: `scheduling`, `content`,
`collaboration`, `people`, `devices`, `playout`. Folder names are domain nouns ("screaming
architecture"): the tree shows the radio, not the framework. Every module has the same internal
shape — `domain/ service.ts ports.ts repo.ts schema.ts routes.ts events.ts index.ts README.md
*.test.ts`.

## Consequences

- Learn one module, know them all; a feature touches one module; a reviewer checks the same six
  files every time.
- A whole module fits in an AI agent's context — reason about it in isolation.
- Boundary discipline is required and cannot rely on goodwill — it is machine-enforced
  (ADR-0007, dependency-cruiser).
- No microservice/deployment complexity in phases 1–2.

## Links

- docs/2 §3.2 (decomposition), §3.3 (tree); PD §3.1 goal 7, §8.2.
