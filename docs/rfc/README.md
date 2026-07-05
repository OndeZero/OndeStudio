# RFCs

Lightweight design proposals for **cross-cutting changes** — the ZeroMQ habit of speccing the
contract before the code (docs/2 §10.3). An RFC is warranted when a change reshapes shared
ground; ordinary features do not need one (an issue + an ADR, if a decision is taken, suffice).

RFC territory:

- a **new feature module** or a change to module boundaries;
- an **API-contract break** (a change consumers of `/api/v1` or `packages/shared` would feel);
- a **phase-2 takeover** of a capability (swapping an AzuraCast adapter for a native one);
- **galaxy coordination** — changes that must be negotiated with the satellites (OndePlayer,
  the drop tool, OndePi).

## Format

Copy [`0000-template.md`](0000-template.md) to `NNNN-short-slug.md` (next free number):
**Problem · Constraints · Proposal · Contract changes · Migration & satellite coordination ·
Open questions.** Keep it as short as the change allows.

## Process

1. Open the RFC as a PR; discussion happens on the PR.
2. Merge when the team agrees the contract is right — code follows in separate PRs.
3. Decisions the RFC settles get their ADRs as the implementation lands.
