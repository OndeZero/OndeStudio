/**
 * The subset of AzuraCast's `/api/nowplaying/{station}` payload the adapter
 * reads. AzuraCast shapes never escape this folder (docs/2 §7.2) — the rest of
 * the codebase speaks NowSnapshot.
 */
export interface AzNowPlayingResponse {
  station: { shortcode: string; name: string };
  live: { is_live: boolean; streamer_name: string };
  now_playing: AzQueuedSong | null;
  playing_next: AzQueuedSong | null;
}

export interface AzQueuedSong {
  song: { title: string; artist: string; text: string };
  /** Unix seconds; 0 when unknown. */
  played_at: number;
  /** Seconds, possibly fractional (observed live: 134.60898); 0 for untimed sources (e.g. a live input). */
  duration: number;
  playlist: string;
}
