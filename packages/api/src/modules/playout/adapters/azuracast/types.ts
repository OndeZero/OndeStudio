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

/**
 * Subset of `/api/station/{station}/playlists` the mirror-schedule read uses.
 * `type` is open-ended upstream ("default" | "custom" | "once_per_x_minutes" |
 * "once_per_hour" | …); the `once_per_*` cadence types mark insert-rule windows.
 */
export interface AzPlaylist {
  id: number;
  name: string;
  type: string;
  is_enabled: boolean;
  schedule_items: AzScheduleItem[];
}

/** Subset of `/api/station/{station}/streamers` the mirror-schedule read uses. */
export interface AzStreamer {
  id: number;
  streamer_username: string;
  /** May be empty — display falls back to streamer_username. */
  display_name: string;
  is_active: boolean;
  enforce_schedule: boolean;
  schedule_items: AzScheduleItem[];
}

/**
 * One AzuraCast schedule row (0.23.3, probed live 2026-07-05).
 * `start_time`/`end_time` are DST-naive HHMM integers (1038 = 10:38);
 * `end <= start` wraps past midnight into the next day. `days` are ISO
 * weekdays 1=Mon…7=Sun and an EMPTY array means "every day".
 */
export interface AzScheduleItem {
  start_time: number;
  end_time: number;
  days: number[];
  loop_once?: boolean;
}
