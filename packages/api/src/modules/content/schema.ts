/**
 * No content-owned tables yet — deliberately (docs/2 §2.4: columns land when a
 * milestone uses them). The `media` table (docs/2 §5.2) arrives with
 * fingerprint identity, and fingerprints are computed by reading the media
 * filesystem read-only — access OndeStudio only has once deployed on
 * `onde-zero` beside AzuraCast (docs/2 §5.5). Until then the playout system's
 * files API already IS the index, so browsing reads live through
 * MediaStorePort and the simplest thing that works is no second copy of it.
 */
export {};
