# RFC 0003 — M5: OndePlayer reads OndeStudio's schedule (AzuraCast fallback)

- **Status:** proposed (draft for team review, 2026-07-11)
- **Milestone:** docs/2 §11 — **M5** (OndePlayer switches its Upcoming/now-playing source onto OndeStudio). Exit bar: **OndePlayer's Upcoming panel is rendered from OndeStudio's public `schedule` seam when OndeStudio is reachable, and falls back to today's AzuraCast source, unchanged, when it is not.**
- **Relates to:** docs/2 §6.4-6.5 (the public read seam — `schedule`/`now` as first-class public API; "public read auth decided with the M5 OndePlayer switch"), §7.1 + §7.3 (the live-meta-sync handover; reuse of OndePlayer's enriched-Upcoming builder), RFC 0001 (invariant 1: air is never in the hot path), RFC 0002 (deployment — makes OndeStudio reachable; the "M5 seam auth" open question is settled here), PD §5.5 (revert-to-generic after a slot + its echoes air), PD §4.12 (external accounts see only their own metadata), PD §7.2 (the galaxy read seam).
- **Two repos:** the seam lives in **OndeStudio** (this repo); the source selector + fallback live in **OndePlayer** (`../OndePlayer`, a separate Bun/systemd app on `onde-zero`). This RFC specifies both and the handover between them.

## Problem

OndePlayer sources its **Upcoming** panel and its now-playing from **AzuraCast** today. Server-side, `buildSchedule()` (`OndePlayer server/server.js:408`) fetches AzuraCast playlists + streamers (with an API key) or the public `/api/station/{sc}/schedule?rows=50` (`server.js:277`, `fetchPublicSchedule`), expands recurring `schedule_items` into dated entries, caches 5 min, and serves `GET /api/schedule`. Now-playing is browser-direct: `EventSource(config.sseUrl)` onto AzuraCast's Centrifugo SSE (`server.js:158`, `public/player.js:124`); the OndePlayer server is not in that path.

M5 wants the **Upcoming** panel driven by OndeStudio's **OS-native view** — real slot/show **titles**, slot **kind** (show/series/echo/live), the **live-slot → broadcaster** binding, per-slot **now-playing meta** a broadcaster set via self-service (PD §5.6), and **episode enrichment with revert-to-generic** after a slot + its echoes air (PD §5.5). That richness does **not** fully round-trip through AzuraCast even once M3 projects the schedule there: the driver writes generic tagged playlists/`schedule_items`, not the OS titles/meta/negotiation the studio holds. Reading OndeStudio directly is the point (docs/2 §6.4).

Two facts make a naïve "point OndePlayer at OndeStudio" wrong:

1. **OndeStudio prod is not up yet** (RFC 0002 is *proposed*; the URL does not exist). M5 cannot block on deployment.
2. **OndePlayer sits closer to air than OndeStudio.** A hard dependency would put OndeStudio in air's hot path — a direct violation of RFC 0001 invariant 1. If OndeStudio is down, unconfigured, or wedged, OndePlayer's Upcoming must keep rendering.

So the design is: **OndePlayer prefers OndeStudio, falls back to today's AzuraCast source.** This is not temporary scaffolding removed after cutover — it is the correct **permanent** resilience property. It also decouples M5's ship date from the deployment: OndePlayer ships the selector with the OndeStudio URL *unset* (byte-for-byte today's behaviour) and the cutover is one env var once prod exists.

## Constraints

- **Air is never in the hot path** (RFC 0001 invariant 1). OndeStudio down/unconfigured/slow **must never** degrade OndePlayer's Upcoming below today's AzuraCast baseline. The fallback is mandatory and permanent, and the OndeStudio fetch is time-boxed so a slow studio can't stall a render.
- **Public read seam only** (docs/2 §6.4-6.5). `schedule` returns **only publicly-announceable occurrences** — `validated` (plus `aired` within past ranges) — with episode-enriched **public** metadata, computing revert-to-generic **server-side** (PD §5.5). Negotiation states, `prebooked` holds, team-only fields, and other stations' internals **never** leak onto this seam.
- **Never two writers on the same metadata** (docs/2 §7.1). This RFC is **read-only**. It does **not** touch OndePlayer's `live-meta-sync` (the reverse *writer* path, `OndePlayer server/live-meta-sync.js`) and does **not** arm OndeStudio's now-playing meta push. Those are a separate, coordinated handover (below, Out of scope).
- **Decoupled from deployment.** OndePlayer's selector is inert (`ONDESTUDIO_URL` unset) until a reachable studio exists; enabling it is one env var + restart, reversible by unsetting.
- **Low operational complexity** (PD goal). Reuse OndePlayer's existing choke point (`buildSchedule`) and 5-min cache, and OndeStudio's existing occurrence engine. No new datastore, no browser-reachable OndeStudio surface, no change to OndePlayer's frontend.

## Design

### The now-playing/schedule split (why M5 is really about *schedule*)

docs/2 §6.4 frames M5 as switching OndePlayer's "Upcoming/now-playing source." In practice the two halves want different treatment:

- **Now-playing stays on AzuraCast SSE.** OndeStudio's `now` (`OnAir`) is a **10 s-polled mirror** of AzuraCast now-playing (`NOW_POLL_SECONDS` default 10; `PlayoutStatePort` over the AzuraCast now-playing API). The browser's direct Centrifugo SSE is *fresher and more air-accurate* than routing through OndeStudio would be, and the only extra richness — the live streamer name — is already in AzuraCast's `np.live`. Crucially, the **slot-aware** now-playing richness (revert-to-generic, per-slot broadcaster meta) reaches OndePlayer the *other* way: via the **meta push** (OndeStudio → AzuraCast), read by the existing browser SSE. So OndePlayer likely **never** needs to read OndeStudio's `now` seam — the correction flows *through* AzuraCast. Switching now-playing is therefore deferred to (and subsumed by) the meta-push handover (§7.1), not this read-switch.
- **Schedule (Upcoming) moves to OndeStudio.** This is where OS holds data AzuraCast can't represent. M5 == this switch, with fallback.

The rest of this RFC therefore specifies the **`schedule`** seam and OndePlayer's Upcoming source selector. `now` is unchanged on both sides.

### A. OndeStudio side — the public `schedule` seam

**`now` already ships**: `GET /api/v1/stations/{station}/now` (public; `OnAirSchema`; `playout/routes.ts:9-35`) + SSE `onair` (`platform/sse`, public channel). No change; it is already in `PUBLIC_PATHS` (`app.ts:73-74`) and on the read seam RFC 0002 exposes.

**Add `GET /api/v1/stations/{station}/schedule?from&to`** — a public read returning publicly-announceable occurrences over a horizon:

- **Source.** Reuse the existing occurrence engine (`scheduling` `listOccurrences` over a `[from,to)` window — `routes.ts:33-44`, `windowQuery`; `occurrenceToContract`, `contract.ts:14-39`), which already computes dated occurrences with `title`, `episodeTitle`, `kind`, `startsAt`/`endsAt`, `durationMin`, `broadcasterId`, `moved`, and the clock-relative `negotiationState`/`contentState`.
- **Public projection (the filter that makes it safe).** A dedicated mapper — **not** the team `occurrenceToContract` — keeps only `negotiationState === "validated"` (plus `aired` in past ranges), drops `negotiationState`/`contentState`/`issueFlags`/`originalStartsAt` and any `prebooked`/team internals, and applies **revert-to-generic** server-side (PD §5.5): once a slot + its echoes have aired, the episode-specific title reverts to the generic show title. Live slots carry a public **broadcaster display label** (from the binding), never the internal id. This is the "publicly-announceable occurrences … public metadata" of §6.4 made concrete.
- **Shape.** New shared `PublicScheduleSchema` in `packages/shared` (a public sibling of `OnAir`), e.g. `{ station, generatedAt, items: [{ id, kind, title, episodeTitle|null, live: { streamerName|null }|null, startsAt, endsAt, durationMin }] }`. Deliberately minimal and announcement-safe; it maps 1:1 to what OndePlayer's frontend already renders (below).
- **Horizon.** Default window now → **now+3 days** to match OndePlayer's `buildSchedule` range (`server.js:417`), overridable via `from`/`to`. `is_now` is a consumer-side computation (OndePlayer already derives it), so the seam need not carry it.
- **Auth / exposure — the §6.5 decision this RFC settles.** M5's consumer (OndePlayer) is **on-box** with OndeStudio (both on `onde-zero`), so it reads `schedule` over the on-box hairpin `http://localhost:4400` — **no public internet exposure is required for M5.** Recommendation: keep `/stations/*/schedule` **tailnet/on-box only** for M5 (add it to `PUBLIC_PATHS` so it needs no team session, but do **not** add it to the tyrell public allowlist yet — RFC 0002's allowlist stays `/self/*` + `/stations/*/{now,sse}`). It joins the *public* internet seam later, with the galaxy (PD §7.2), as its own small step. This keeps the announcement-safe schedule off the raw internet until the galaxy actually needs it, while unblocking M5 today.

### B. OndePlayer side — the Upcoming source selector (with AzuraCast fallback)

One new optional env var and one branch at the existing choke point; **no frontend change**.

- **Config.** `ONDESTUDIO_URL` (optional, e.g. `http://localhost:4400`), read alongside the existing `AZURACAST_INTERNAL_URL`/`AZURACAST_API_KEY` (`server.js:262-263`). **Unset ⇒ `buildSchedule` behaves exactly as today** — the entire feature is gated off with zero behavioural change, which is what lets it ship before OndeStudio prod exists.
- **The branch.** At the single choke point `buildSchedule(config, stationId)` (`server.js:408`), when `ONDESTUDIO_URL` is set: try `fetchOndeStudioSchedule(shortcode, range)` first, **time-boxed** (`AbortSignal.timeout(~5_000)` — tighter than the 15 s AzuraCast budget, since the on-box hop is local and a slow studio must not stall the render). On any non-200 / timeout / thrown error / empty result → **fall back** to the existing path unchanged (`fetchPublicSchedule`, or the enriched playlists/streamers builder when an API key is present). The existing 5-min `scheduleCache` (`server.js:264`, keyed by stationId) bounds how often the OndeStudio fetch runs, so a plain per-fetch `try/catch` is sufficient; a tiny circuit-breaker is optional polish, not required.
- **Shape mapping (frontend unchanged).** OndePlayer's Upcoming reads entries of shape `{ id, type, name, title, description, start, end, is_now }` (emitted at `server.js:371-380`, consumed at `public/station-ui.js:443-472`; live badge on `type === 'streamer'` or `/^\[LIVE\]/i`). Map each `PublicScheduleSchema` item → that shape: `title`/`episodeTitle` → `name`/`title` (+ `episodeTitle` or the broadcaster label → `description`); `kind === "live"` → `type: "streamer"` (drives the live badge), else `"playlist"`; `startsAt`/`endsAt` → `start`/`end`; `is_now` computed by OndePlayer as today. Because the emitted shape is identical, `station-ui.js` renders with no change.
- **Station shortcode mapping.** OndePlayer stations `oz` and `wz` both use AzuraCast shortcode `oz`; `test` uses `wz-test` (`OndePlayer stations/*/config.json`). The OndeStudio call uses the AzuraCast shortcode (`config.stationShortcode`), so the mapping is already carried in config — no new mapping table.
- **Now-playing untouched.** `config.sseUrl` still points at AzuraCast (`server.js:158`); `player.js` is unchanged. (See the now-playing split above and Out of scope.)

### Ship order (staged, deployment-decoupled)

1. **OndeStudio:** land the `schedule` seam (read-only; ships inside the same `wz-test`-gated deploy as RFC 0002 — it performs no writes). Verify on-box: `curl http://localhost:4400/api/v1/stations/oz/schedule?...` returns announcement-safe JSON.
2. **OndePlayer:** land the selector with `ONDESTUDIO_URL` **unset** → provably identical to today; ship anytime, independent of OndeStudio being up.
3. **Deploy:** OndeStudio reaches RFC 0002 Stage 0/1 (running on `onde-zero`, tailnet/on-box, still `wz-test`).
4. **Cutover:** set `ONDESTUDIO_URL=http://localhost:4400` on OndePlayer + restart → Upcoming now renders from OndeStudio, auto-falling-back to AzuraCast on any hiccup. Reversible by unsetting.
5. **Later, separate:** the now-playing **meta-push handover** (§7.1) — arms OndeStudio's push and retires `live-meta-sync` in one coordinated change. Not part of M5.

## Contract changes

- **OndeStudio (`packages/shared` + api):** new `PublicScheduleSchema` (+ item schema) and a new public route `GET /api/v1/stations/{station}/schedule` (playout or scheduling module) with a `from`/`to` window; `/stations/*/schedule` added to `PUBLIC_PATHS` (`app.ts`). A new **public** occurrence projector (announceable-only, revert-to-generic) beside the team `occurrenceToContract`. **No change** to `OnAir`/`now` or any team route.
- **OndePlayer:** new optional env `ONDESTUDIO_URL`; new `fetchOndeStudioSchedule` + the prefer-OndeStudio branch in `buildSchedule`. **No** frontend change (schedule entry shape preserved); **no** change to `live-meta-sync` or now-playing SSE.
- **No DB, event, or port changes** in OndeStudio (the seam is a read over existing scheduling capabilities).

## Migration & satellite coordination

- **Order** per Ship order above. The two changes are independent until step 4; the cutover is one env var + `systemctl restart ondeplayer` on `onde-zero`, reversible by unsetting `ONDESTUDIO_URL`.
- **OndePlayer is a separate repo/session** (`../OndePlayer`, Bun, `ondeplayer.service`). The OndeStudio seam must land and be verifiable on-box *before* OndePlayer's cutover, but the OndePlayer selector code can land first (inert while unset).
- **Explicit non-bundling:** the now-playing **meta push** (retire `live-meta-sync`, docs/2 §7.1, playout README "Now-playing meta push — handoff") is a *different* change with its own two-writers discipline. Do not combine it with this read-switch; conflating them is exactly the failure §7.1 warns about.

## Out of scope

- **Now-playing onto OndeStudio.** Deferred by design: it is fresher on AzuraCast SSE, and its slot-aware richness arrives via the meta-push, not this read seam (see the split above).
- **The meta-push handover / retiring `live-meta-sync`** — §7.1; a separate coordinated change.
- **Public-internet exposure of `schedule`** at the tyrell edge — M5 reads on-box; the galaxy exposure (PD §7.2) is a later, separate allowlist step.
- **`oz` write adoption** — orthogonal; this seam is read-only and works identically whether writes target `wz-test` or `oz` (RFC 0002 Stage 4).

## Open questions

- **`PublicScheduleSchema` exact fields + revert-to-generic timing.** The precise announceable field set and the exact clock rule for reverting an episode title to the generic show title after a slot + its echoes air (PD §5.5) — settled when the seam is implemented, reusing the occurrence engine's existing state computation.
- **`schedule` seam auth beyond on-box.** This RFC keeps it tailnet/on-box for M5. When the galaxy needs it publicly (PD §7.2), does it join the tyrell allowlist as-is, or gain a read token? Settled with the galaxy read-seam work, not here.
- **Horizon & cache.** Confirm now→+3d is the right default window and that OndePlayer's 5-min cache TTL is appropriate over the on-box hop (it likely is; the studio schedule changes on human timescales).
- **Whether OndePlayer ever reads OndeStudio's `now`.** Under the meta-push design it should not need to. If a case appears where OndePlayer wants OS-native now-playing directly (bypassing AzuraCast), reopen the now-playing switch — but expect it to remain unnecessary.
