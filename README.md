# OndeStudio

**OndeStudio is an open-source webradio studio interface** — the single workspace where a radio
team plans its schedule, manages its content, discusses and decides, and where those decisions
actually take effect on air. Built by [OndeZero](https://github.com/OndeZero) for its station
[wavezero.world](https://wavezero.world), designed to grow generic over three phases:

1. **Overlay** — a supercharged interface on top of AzuraCast, through its API *(where we are)*.
2. **Takeover** — capabilities move in-house one by one, behind stable interfaces.
3. **Autonomous** — a packaged, installable studio + playout product; AzuraCast exits the picture.

**Status:** phase 1 — the **M0 walking skeleton** just landed (one vertical slice through every
layer, all CI gates green); next up is **M1**, the week-grid prototype.

## Quickstart

```sh
git clone git@github.com:OndeZero/OndeStudio.git
cd OndeStudio
cp .env.example .env      # then fill in the documented variables
bun install
bun dev
```

Web on <http://localhost:5173> (proxying `/api`), API on <http://localhost:4400>. Run commands
from the repo root so `.env` loads. `bun run check` runs every gate locally (typecheck · lint ·
boundaries · tests).

## Repo map

```
packages/shared    Zod schemas + inferred types — the single API/domain contract
packages/api       Hono + Drizzle + bun:sqlite; hexagonal: kernel/ platform/ modules/<feature>/
packages/web       Vue 3 + Vite + Pinia; features/<surface>/ mirror the module idea
docs/              the specification set (below) · docs/adr/ decisions · docs/rfc/ proposals
```

## The docs are the spec

Read in this order:

1. [`docs/1-project_description.md`](docs/1-project_description.md) — contexts, goals, the
   normative domain vocabulary, the 3-phase strategy. **When documents disagree, this one wins.**
2. [`docs/2-implementation_plan.md`](docs/2-implementation_plan.md) — architecture, data model,
   API, milestones, engineering conventions, contribution model.
3. [`docs/3-storage-layout.md`](docs/3-storage-layout.md) — target media filetree (proposal,
   pending team validation).
4. [`docs/azuracast-write-audit.md`](docs/azuracast-write-audit.md) — confirmed AzuraCast API
   write capabilities.

[ARCHITECTURE.md](ARCHITECTURE.md) is the short map distilled from 1–2 — newcomers start there.

## Contributing

Contributions — human and AI — are welcome: [CONTRIBUTING.md](CONTRIBUTING.md) for the process,
[AGENTS.md](AGENTS.md) for the AI-agent on-ramp, [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for the
baseline.

## License

GNU AGPL-3.0. Dependencies must be license-compatible with AGPL-3.0.
