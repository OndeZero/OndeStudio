import type { SseChannel, StationSlug } from "@ondestudio/shared";

/**
 * Subscribe to a station's realtime stream (docs/2 §6.3) and get back the one
 * cleanup handle the caller needs.
 *
 * The server emits named events per channel (e.g. "onair") plus "ping"
 * keepalives. Only the requested channels get listeners, so pings are ignored
 * by construction. EventSource reconnects automatically after a drop — that
 * native behavior is the whole retry strategy on purpose (invariant 6:
 * simplest thing that works).
 */
export function subscribeStationSse(
  station: StationSlug,
  channels: readonly SseChannel[],
  onEvent: (event: SseChannel, data: unknown) => void,
): () => void {
  const source = new EventSource(`/api/v1/stations/${station}/sse?channels=${channels.join(",")}`);

  for (const channel of channels) {
    source.addEventListener(channel, (event) => {
      // Custom named events are typed as plain Event by lib.dom; they are
      // MessageEvents at runtime.
      const { data } = event as MessageEvent<string>;
      try {
        onEvent(channel, JSON.parse(data));
      } catch {
        // One malformed frame must not kill the subscription; skip it.
      }
    });
  }

  return () => source.close();
}
