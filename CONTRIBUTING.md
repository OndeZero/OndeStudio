# Contributing to OndeStudio

OndeStudio is built by a small radio collective and welcomes contributions from anyone — human or
AI — who wants to solve a real problem. The process is deliberately light, borrowed in spirit from
ZeroMQ's C4 and sized for a small project: optimise for the contributor, start from a problem,
ship the smallest correct change.

## Run it

```sh
git clone git@github.com:OndeZero/OndeStudio.git
cd OndeStudio
cp .env.example .env   # then fill in the documented variables
bun install
bun dev                # api on http://localhost:4400, web on http://localhost:5173
```

`bun dev` runs the API and the web dev server together; `bun run dev:api` / `bun run dev:web` run
one side alone. Run commands from the repo root so `.env` loads.

## The workflow: problem first

1. **Start from a problem.** Open (or pick) an issue that states what is wrong or missing —
   observed vs expected, not a pre-baked solution. `good first issue` labels mark friendly entry
   points.
2. **Write the smallest correct patch** that solves exactly that problem. "Could we need it
   later?" is not a reason to build it now.
3. **Ship it with a test.** Every behavioural change comes with a test — colocated `*.test.ts`
   next to the code it proves.
4. **Open a small PR** answering three questions (the template asks them):
   - Which problem does this solve? (link the issue)
   - Which test proves it?
   - Which ADR/RFC, if this takes a decision?

Small, focused PRs get reviewed fast. Review is about correctness, scope and convention
adherence — style is automated, never debated.

## Check gates

Run the full gate locally before pushing:

```sh
bun run check          # typecheck + lint + boundaries + tests
```

Or piecewise: `bun run typecheck` · `bun run lint` (Biome; `lint:fix` auto-fixes) ·
`bun run boundaries` (dependency-cruiser — the architecture's import rules) · `bun run test`.

CI runs the same gates on every PR. **`main` is always green**: a red build blocks everyone, and
fixing it is everyone's first priority.

## Commits & merges

- **Conventional Commits** (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:` …).
- PRs are **squash-merged**, so the PR title becomes the commit — make it a good Conventional
  Commit.
- A changeset accompanies user-visible changes once the changesets tooling lands with the first
  release; until then, say what's user-visible in the PR description.

## Code conventions (short version)

TypeScript strict, no `any` · kebab-case files, one primary export per file · ~200–300 lines per
file soft budget · comments explain *why*, not what. The full map — layering, the module shape,
the dependency rules, the domain patterns — is in [ARCHITECTURE.md](ARCHITECTURE.md). Read it
first; it is short.

## Where decisions live

Every non-trivial decision is a short ADR in [`docs/adr/`](docs/adr/). Cross-cutting changes (a
new module, an API-contract break, a phase-2 takeover) go through a lightweight RFC in
[`docs/rfc/`](docs/rfc/) before code. If your patch takes a decision, add the ADR in the same PR.

The full spec lives in `docs/`: [`docs/1-project_description.md`](docs/1-project_description.md)
(intent — it wins when documents disagree) and
[`docs/2-implementation_plan.md`](docs/2-implementation_plan.md) (the how).

## AI contributors

AI-agent contributions are welcome under exactly the same rules — same problem-first workflow,
same gates, same review. [AGENTS.md](AGENTS.md) is the dedicated on-ramp: what to read, the shape
to copy, the guardrails that catch mistakes.

## Conduct

We keep this a welcoming, harassment-free project: [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
