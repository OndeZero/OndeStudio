# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repository Status

OndeStudio (the OndeZero studio) is **design-complete, pre-build**: no code yet — the repo holds the specification set under `docs/`, finalized by the 2026-07-05 pre-build audit. Building starts at docs/2 §11 **M0** (walking skeleton). Update this file with build/lint/test commands as code lands.

## The docs are the spec

Read in this order:

1. `docs/1-project_description.md` (the "PD") — contexts, goals, **normative** domain vocabulary (§4), 3-phase architecture strategy (§6). **When documents disagree, the PD wins.**
2. `docs/2-implementation_plan.md` — architecture (modular monolith, ports & adapters), data model, API, milestones (§11), engineering conventions and contribution model (§9–§10).
3. `docs/3-storage-layout.md` — target media filetree (proposal, pending team validation; phase 1 reads the current tree as-is).
4. `docs/azuracast-write-audit.md` — confirmed AzuraCast API write capabilities (tested on `wz-test` only).

## Key Facts

- Remote: `git@github.com:OndeZero/OndeStudio.git` (default branch: `main`)
- License: GNU AGPL-3.0 — dependencies added to this project must be license-compatible with AGPL-3.0.
- Stack (locked, PD §7.1 / docs/2 §3.8): Bun · TypeScript · Hono · Vue 3 + Vite · SQLite (Drizzle) · Zod.
- Secrets live in the repo-local `.env` (gitignored); `.env.example` documents the variables. Never commit credentials.
- **AzuraCast writes: never against `oz` (production) until the per-feature adoption step says so** — test writes target `wz-test`, and production writes require the dedicated API account (docs/2 §7.7).
