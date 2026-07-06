# 0012 — Negotiation states are freely reversible (except `aired`)

- **Status:** accepted
- **Date:** 2026-07-07

## Context

The original PD §4.4 diagram read as a forward pipeline: `pre-booked → dealing →
validated`, with `declined`/`cancelled` as terminal ghosts. During the M1/M2
validation the team hit reality: a cancelled slot sometimes ends up happening after
all, a declined prospect gets revived next season, a validated slot reopens for
negotiation. A one-way machine forced workarounds (delete + recreate) that lose the
slot's history.

## Decision

All five human states (`prebooked`, `dealing`, `validated`, `declined`, `cancelled`)
transition freely to one another. Only `aired` is one-way: it is computed from time
(`validated` + past end), never stored or set by a human. The single transition map in
`packages/shared/src/scheduling-states.ts` carries the rule for both the domain state
machine and the quick-edit UI; PD §4.4 carries the dated amendment.

## Consequences

- The state labels keep their *meaning* (`cancelled` still implies "the public may
  have seen it announced" — the quick-edit confirm dialogs stay) but no longer their
  *finality*.
- Ghost rendering (strikethrough, locked drag) applies while a slot is
  declined/cancelled and lifts on revival.
- The grid's locked-card rule is unchanged: terminal-*rendered* cards can still be
  transitioned from the quick-edit, which is exactly the revival path.
