# collaboration

The thin board + assignment + first notifications (docs/2 §11 M2): discussion
cards (PD §4.14), the board lens over them (PD §5.2), polymorphic assignment
(PD §4.13) and the in-app inbox (PD §5.12).

## Model in one breath

A **card** is a thread with an intent (`discussion|idea|prospect|task`), one
status lane (`open → in_progress → done → archived`), votes, assignees and an
explicit **outcome** — anchored to a domain object (`show|slot|occurrence|media`,
string ids because occurrence keys are composite) or standalone. **Promotion**
turns an unanchored `idea`/`prospect` into a real object and re-anchors the
thread onto it, so the conversation that booked an artist stays attached to the
slot it produced. The API returns cards **enriched per viewer**: vote tally +
`myVote`, comment count + last-reply snippet, assignees, anchor label, and the
unread dot.

## Invariants

- **Transitions are free, values are not** (PD §8.1): any status/intent may
  become any other — no workflow ceremony for a 4–6 person team — but values
  are validated as enum members, and **promotion is gated**: only an unanchored
  `idea`/`prospect` may promote (`illegal-transition` → 409), checked *before*
  the target object is created so a refusal has no side effects.
- **Unread is honest**: every mutation an actor makes seeds their own
  `card_read` at the same instant it bumps `last_activity_at`. "No read row" or
  "activity after last look" therefore always means *someone else acted* —
  including for the creator of a card.
- **Votes are ambient** (PD §5.2): one changeable vote per person; setting or
  clearing never bumps activity or unread — the tally is background signal,
  not conversation.
- **No user FKs**: user ids are plain integer columns; a drizzle FK would
  couple this schema file to the people module's. Integrity lives in the
  service (assignees must resolve through `UserDirectoryPort`) and reads
  degrade to `user #N` if the directory lags.
- **Assignment is polymorphic** (docs/2 §5.5): `(object_type, object_id)`
  with TEXT ids. M2 writes only `("card", String(cardId))`; shows/slots join
  later without a schema change.
- **Every mutation emits** `collaboration.card-changed` (coarse refetch hint);
  every inbox change emits `collaboration.notified` (future per-user push) —
  see `events.ts`.

## Wiring (composition root)

The module imports no other module; app.ts implements the three ports:

```ts
const collaborationService = new CollaborationService({
  repo: new DrizzleCollaborationRepo(db),
  // labels for anchor chips — resolve via scheduling (shows/slots) & content (media)
  anchors: { resolveLabel: async ({ type, id }) => /* show name, slot title… */ null },
  // promotion targets — scheduling's find-or-create show keeps names unforked
  promotion: {
    createShow: async (name) => ok(await schedulingRepo.findOrCreateShow(name)),
    slotExists: async (slotId) => (await schedulingRepo.getSlot(slotId)) !== null,
  },
  users: /* people directory: id → displayName */,
  bus, clock: systemClock, logger: logger.child({ component: "collaboration" }),
});
api.route("/", createCollaborationRoutes(collaborationService));
```

Card routes live under `/stations/{station}`; **notifications are user-scoped**
and mount at `/notifications` (no station prefix) — both come from the same
`createCollaborationRoutes` router. `GET /notifications` etc. must NOT be added
to the public paths: the inbox is per-session.

## Phase-1 scope notes

- Anchors are accepted as given on create/update; a dangling anchor just
  renders without a label. Tightening to existence checks can ride the same
  `AnchorResolverPort`.
- Notification triggers are the M2 minimum: `assigned` and `comment`. The
  state-driven triggers (validated-but-empty slot as air date nears…) arrive
  with the attention rail; `notification.anchor_*` columns and
  `UserDirectoryPort.allUserIds` are already in place for them.
- Promotion targets are `show` and existing `slot`; contribution promotion
  joins when the content module's intake lands.

## Extension points

New notification trigger → subscribe to the bus in app.ts (or the owning
module's use-case) and call a new `Inbox` kind; the wire schema is already
kind-agnostic. New anchor/promotion target → extend the shared `AnchorSchema` /
`PromoteCardInputSchema`, teach `AnchorResolverPort`/`PromotionPort` the type,
and the domain rule in `Card.canPromote` if it changes. New board face field →
extend `enrich.ts` (batched lookups only) + the shared `CardSchema`.
