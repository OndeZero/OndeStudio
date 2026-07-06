# board

The M2 discussion board (PD §4.14, §5.2): one pivotable surface over cards — group-by
(status / intent / assignee) and sort (activity / votes) are client-side computeds over
one flat list (board-pivots.ts), explicitly *not* a Wekan clone. Cards are voted with
the fixed emoji set, anchored to domain objects, and promotable into real ones. The
detail drawer is route-driven (`/board/{id}`) so threads deep-link from notifications,
the attention rail and show pages.

## Rough edges, deliberate for the first cut

- **Promote-to-slot takes a raw numeric slot id.** The honest picker is a grid
  selection mode ("promote onto this slot"), which needs grid work that is not M2's.
  The id is visible nowhere friendly yet — promote-to-show is the expected main path
  (it matches the idea → booked-artist story in PD §4.14).
- **Subject and body are read-only in the drawer.** `PUT /cards/{id}` supports both;
  an edit affordance is a small follow-up once the team asks for it.
- **Assignee grouping duplicates multi-assignee cards into each person's lane** — by
  design: "my lane shows everything that is mine" beats deduplication.
- **Vote failure resyncs by refetch**, same stance as the grid store: the list may
  hold fresher SSE state than any local rollback snapshot.
