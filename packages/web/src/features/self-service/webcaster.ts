import { Mp3Encoder } from "@breezystack/lamejs";
import { ref } from "vue";

/**
 * A custom browser broadcast client (PD §5.6, "broadcast from here"): capture
 * the mic, encode to MP3, and stream it to the broadcaster's AzuraCast/liquidsoap
 * WebDJ harbor over the webcaster WebSocket protocol — authenticated with the
 * broadcaster's own Icecast credentials.
 *
 * NOTE: the mic capture, level meter and MP3 pipeline are self-contained and
 * testable (a fake audio device drives the meter). The harbor handshake targets
 * AzuraCast's WebDJ (`wss://host/radio/<dj_port>/<mount>`, subprotocol
 * "webcast") and needs an on-air check against the live stream — a browser can't
 * be verified audibly headless. Other inputs (soundcard, other apps) are later.
 */
export type WebcasterState = "idle" | "opening" | "ready" | "connecting" | "live" | "error";

export function useWebcaster() {
  const state = ref<WebcasterState>("idle");
  /** Normalised mic level 0..1 for the meter. */
  const level = ref(0);
  const error = ref<string | null>(null);
  const devices = ref<MediaDeviceInfo[]>([]);
  const deviceId = ref<string>("");

  let stream: MediaStream | null = null;
  let ctx: AudioContext | null = null;
  let source: MediaStreamAudioSourceNode | null = null;
  let analyser: AnalyserNode | null = null;
  let processor: ScriptProcessorNode | null = null;
  let mute: GainNode | null = null;
  let encoder: Mp3Encoder | null = null;
  let socket: WebSocket | null = null;
  let raf = 0;

  async function refreshDevices(): Promise<void> {
    const all = await navigator.mediaDevices.enumerateDevices();
    devices.value = all.filter((d) => d.kind === "audioinput");
    if (!deviceId.value && devices.value[0]) deviceId.value = devices.value[0].deviceId;
  }

  /** Open the selected mic and start the level meter — no streaming yet. */
  async function openMic(): Promise<void> {
    error.value = null;
    state.value = "opening";
    try {
      stopTracks();
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId.value ? { deviceId: { exact: deviceId.value } } : true,
      });
      await refreshDevices(); // labels are only populated after permission
      ctx ??= new AudioContext();
      await ctx.resume();
      source?.disconnect();
      source = ctx.createMediaStreamSource(stream);
      analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      runMeter();
      state.value = "ready";
    } catch (cause) {
      error.value = describeMicError(cause);
      state.value = "error";
    }
  }

  function runMeter(): void {
    cancelAnimationFrame(raf);
    const buf = new Float32Array(analyser?.fftSize ?? 1024);
    const tick = (): void => {
      if (!analyser) return;
      analyser.getFloatTimeDomainData(buf);
      let sum = 0;
      for (const s of buf) sum += s * s;
      // RMS, lightly boosted so speech reads mid-scale; capped at 1.
      level.value = Math.min(1, Math.sqrt(sum / buf.length) * 3);
      raf = requestAnimationFrame(tick);
    };
    tick();
  }

  /** Go on air: MP3-encode the mic and stream it to the WebDJ harbor. */
  function goLive(webDjUrl: string, username: string, password: string): void {
    if (!ctx || !source) {
      error.value = "Open the mic first.";
      return;
    }
    error.value = null;
    state.value = "connecting";
    try {
      encoder = new Mp3Encoder(1, ctx.sampleRate, 128);
      processor = ctx.createScriptProcessor(4096, 1, 1);
      // Route through a muted gain so the processor runs without echoing locally.
      mute = ctx.createGain();
      mute.gain.value = 0;
      source.connect(processor);
      processor.connect(mute);
      mute.connect(ctx.destination);

      socket = new WebSocket(webDjUrl, "webcast");
      socket.binaryType = "arraybuffer";
      socket.onopen = () => {
        // The webcaster hello — mime + the broadcaster's source credentials.
        socket?.send(
          JSON.stringify({ type: "hello", data: { mime: "audio/mpeg", user: username, password } }),
        );
        state.value = "live";
      };
      socket.onerror = () => {
        error.value = "Could not reach the stream. Check your credentials and try again.";
        state.value = "error";
      };
      socket.onclose = () => {
        if (state.value === "live" || state.value === "connecting") stopStreaming("ready");
      };
      processor.onaudioprocess = (event) => {
        if (!encoder || socket?.readyState !== WebSocket.OPEN) return;
        const mp3 = encoder.encodeBuffer(floatTo16(event.inputBuffer.getChannelData(0)));
        if (mp3.length > 0) socket.send(mp3);
      };
    } catch (cause) {
      error.value = String(cause);
      state.value = "error";
    }
  }

  /** Stop the stream but keep the mic open (back to "ready"). */
  function stopStreaming(next: WebcasterState): void {
    if (encoder && socket?.readyState === WebSocket.OPEN) {
      const tail = encoder.flush();
      if (tail.length > 0) socket.send(tail);
    }
    socket?.close();
    socket = null;
    encoder = null;
    processor?.disconnect();
    mute?.disconnect();
    processor = null;
    mute = null;
    if (state.value !== "error") state.value = next;
  }

  function stopTracks(): void {
    for (const track of stream?.getTracks() ?? []) track.stop();
    stream = null;
  }

  /** Full teardown — stop streaming, the meter and the mic. */
  function stop(): void {
    stopStreaming("idle");
    cancelAnimationFrame(raf);
    source?.disconnect();
    analyser?.disconnect();
    source = null;
    analyser = null;
    stopTracks();
    level.value = 0;
    if (state.value !== "error") state.value = "idle";
  }

  return { state, level, error, devices, deviceId, openMic, goLive, stopStreaming, stop };
}

function floatTo16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length);
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i] ?? 0));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

function describeMicError(cause: unknown): string {
  const name = cause instanceof DOMException ? cause.name : "";
  if (name === "NotAllowedError") return "Microphone access was blocked — allow it and retry.";
  if (name === "NotFoundError") return "No microphone found.";
  return "Could not open the microphone.";
}
