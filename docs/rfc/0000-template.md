# NNNN — Title

- **Status:** draft | accepted | rejected | implemented
- **Date:** YYYY-MM-DD

## Problem

What is wrong or missing, for whom, and why it is worth a cross-cutting change. Link the issue(s).

## Constraints

The invariants this proposal must not break (air never in the hot path, AzuraCast as boundary,
soft slot boundaries, low complexity…) and any milestone/ordering constraints.

## Proposal

The smallest design that solves the problem. Name what it deliberately does *not* do.

## Contract changes

Changes to `packages/shared` schemas, `/api/v1` resources, ports, events, or DB schema — the
surfaces other code and other people depend on.

## Migration & satellite coordination

How existing data/objects move, and what must be coordinated with OndePlayer, the drop tool or
OndePi (who changes what, in which order, with which handover).

## Open questions

What this RFC leaves deliberately unresolved, and where each item gets settled.
