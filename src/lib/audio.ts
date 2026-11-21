// Browser audio I/O for the Live session.
//   MicCapture:  mic → AudioWorklet → 16-bit PCM chunks (base64) at the context's
//                native rate. The Live API resamples, so we just declare the rate.
//   AudioPlayer: base64 16-bit PCM (24 kHz from Gemini) → gapless playback, with
//                an instant flush for barge-in.

const WORKLET_SOURCE = `
class VitoCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.size = Math.round(sampleRate / 20); // ~50 ms per chunk
    this.buf = new Int16Array(this.size);
    this.n = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (ch) {
      for (let i = 0; i < ch.length; i++) {
        const s = Math.max(-1, Math.min(1, ch[i]));
        this.buf[this.n++] = s < 0 ? s * 0x8000 : s * 0x7fff;
        if (this.n === this.size) {
          this.port.postMessage(this.buf.buffer, [this.buf.buffer]);
          this.buf = new Int16Array(this.size);
          this.n = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("vito-capture", VitoCapture);
`;

export class MicCapture {
  private ctx?: AudioContext;
  private stream?: MediaStream;
  private node?: AudioWorkletNode;

  /** Starts the mic; `onChunk` receives base64 PCM16 and its MIME type. */
  async start(onChunk: (base64: string, mimeType: string) => void): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const ctx = new AudioContext();
    this.ctx = ctx;
    // Created after async work (token fetch, permission prompt), so make sure it's running.
    if (ctx.state === "suspended") await ctx.resume();
    const url = URL.createObjectURL(new Blob([WORKLET_SOURCE], { type: "text/javascript" }));
    try {
      await ctx.audioWorklet.addModule(url);
    } finally {
      URL.revokeObjectURL(url);
    }
    const mimeType = `audio/pcm;rate=${ctx.sampleRate}`;
    const node = new AudioWorkletNode(ctx, "vito-capture");
    this.node = node;
    node.port.onmessage = (e: MessageEvent<ArrayBuffer>) => onChunk(toBase64(e.data), mimeType);
    ctx.createMediaStreamSource(this.stream).connect(node);
    // Not connected to the destination: we only want the samples, not monitoring.
  }

  stop(): void {
    this.node?.port.close();
    this.node?.disconnect();
    this.stream?.getTracks().forEach(t => t.stop());
    void this.ctx?.close().catch(() => undefined);
    this.node = undefined;
    this.stream = undefined;
    this.ctx = undefined;
  }
}

export class AudioPlayer {
  private ctx?: AudioContext;
  private gain?: GainNode;
  private nextTime = 0;
  private sources = new Set<AudioBufferSourceNode>();

  constructor(private onSpeakingChange: (speaking: boolean) => void) {}

  /** Must be called from a user gesture (e.g. the Record click) so audio can start. */
  start(): void {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    this.gain.connect(this.ctx.destination);
    this.nextTime = 0;
  }

  enqueue(base64: string, mimeType: string | undefined): void {
    const ctx = this.ctx;
    if (!ctx || !this.gain) return;
    const rate = Number(/rate=(\d+)/.exec(mimeType ?? "")?.[1] ?? 24000);
    const pcm = new Int16Array(fromBase64(base64));
    if (pcm.length === 0) return;
    const buffer = ctx.createBuffer(1, pcm.length, rate);
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < pcm.length; i++) channel[i] = pcm[i] / 0x8000;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.gain);
    const startAt = Math.max(ctx.currentTime + 0.02, this.nextTime);
    source.start(startAt);
    this.nextTime = startAt + buffer.duration;

    if (this.sources.size === 0) this.onSpeakingChange(true);
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      if (this.sources.size === 0) this.onSpeakingChange(false);
    };
  }

  /** Stop playback immediately and drop anything queued (barge-in). */
  flush(): void {
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        /* already stopped */
      }
    }
    const wasSpeaking = this.sources.size > 0;
    this.sources.clear();
    this.nextTime = 0;
    if (wasSpeaking) this.onSpeakingChange(false);
  }

  stop(): void {
    this.flush();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = undefined;
    this.gain = undefined;
  }
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

function fromBase64(base64: string): ArrayBuffer {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}
