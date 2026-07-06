# content

The media lens (PD §5.3, docs/2 §3.2): browse the canonical filetree the
playout system indexes and link every entry to its owning show (the PD §5.4
ownership badge). Phase-1 substrate (PD §4.11): the tree is AzuraCast's —
read live through `MediaStorePort`, never copied.

## Model in one breath

The upstream files API returns a **flat list of file paths**; the service
derives one directory's **direct children on read** — subdirectories with a
child count, files with their metadata — and badges each entry with the
**deepest drop folder** (scheduling's `show.drop_folder_path`) that contains
it. No tables yet: the `media` table arrives with fingerprint identity, which
needs read-only filesystem access OndeStudio only has once deployed on
`onde-zero` beside AzuraCast (docs/2 §5.5) — see `schema.ts`.

## Invariants

- **Read-only in phase 1** (PD §4.11): intake stays SFTP / the AzuraCast UI.
  Upload, move, rename, delete and the convergence conventions arrive with the
  docs/3 rollout (phase 2).
- **Paths are root-relative and traversal-free**: `..` is a validation error,
  stray slashes are forgiven, `""` is the media root.
- **A flat index cannot show empty directories**: unknown path and empty
  directory coincide → not-found (the root always exists).
- **Upstream failures degrade loudly** (invariant 1): a dead playout link is a
  503 on browse, never a silent empty tree.

## Extension points

Fingerprints, duplicate warnings, placement/upload/moves (phase 2, docs/3 §6)
→ the `media` table lands in `schema.ts` plus a write side on
`MediaStorePort`. Rotation pools and insert rules read-only (PD §4.7–4.8) →
new ports beside `MediaStorePort`, same derive-on-read discipline.
