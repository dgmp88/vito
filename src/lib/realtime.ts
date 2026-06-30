// Browser-side realtime transcription over WebRTC.
//
// Flow (see https://developers.openai.com/api/docs/guides/realtime-webrtc):
//   1. Ask our server for an ephemeral client secret (keeps the API key server-side).
//   2. Capture the mic and add the track to an RTCPeerConnection — WebRTC handles
//      audio encoding/streaming, so no manual PCM16 conversion is needed.
//   3. Exchange SDP with OpenAI's /v1/realtime/calls using the ephemeral secret.
//   4. Transcription results arrive as events on the "oai-events" data channel.
//
// The minted session is a transcription-only session (gpt-realtime-whisper).
// That model doesn't support turn detection, so Stop commits the buffered audio
// and waits for one `completed` event before closing the connection.

import { createRealtimeTranscriptionToken } from "./openaiServer";

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const CHANNEL_OPEN_TIMEOUT_MS = 10_000;
const FINAL_TRANSCRIPT_TIMEOUT_MS = 20_000;

export interface TranscriberCallbacks {
  /** Live, low-confidence text for the utterance currently being spoken. */
  onPartial?: (text: string) => void;
  /** A finished utterance (stable text). */
  onFinal?: (text: string) => void;
  /** Connection is live and listening. */
  onOpen?: () => void;
  /** Fatal error; the session is torn down. */
  onError?: (message: string) => void;
}

export class RealtimeTranscriber {
  private pc?: RTCPeerConnection;
  private dc?: RTCDataChannel;
  private stream?: MediaStream;
  private partial = "";
  private callbacks: TranscriberCallbacks = {};
  private pendingFinal?: {
    resolve: (text: string) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };

  /** Opens the mic and connects. Rejects if the connection can't be established. */
  async start(callbacks: TranscriberCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.partial = "";

    // 1. Ephemeral token from our server function.
    const tokenData = await createRealtimeTranscriptionToken();
    const ephemeralKey = tokenData.value ?? tokenData.client_secret?.value;
    if (!ephemeralKey) throw new Error("No ephemeral token in server response.");

    // 2. Microphone.
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });

    // 3. Peer connection + data channel.
    const pc = new RTCPeerConnection();
    this.pc = pc;
    for (const track of this.stream.getTracks()) pc.addTrack(track, this.stream);

    const dc = pc.createDataChannel("oai-events");
    this.dc = dc;
    const channelOpen = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Realtime event channel did not open.")),
        CHANNEL_OPEN_TIMEOUT_MS
      );
      dc.addEventListener(
        "open",
        () => {
          clearTimeout(timer);
          this.callbacks.onOpen?.();
          resolve();
        },
        { once: true }
      );
      dc.addEventListener(
        "close",
        () => {
          clearTimeout(timer);
          reject(new Error("Realtime event channel closed before opening."));
        },
        { once: true }
      );
      dc.addEventListener(
        "error",
        () => {
          clearTimeout(timer);
          reject(new Error("Realtime event channel failed to open."));
        },
        { once: true }
      );
    });
    void channelOpen.catch(() => undefined);
    dc.addEventListener("message", e => this.handleEvent(e.data as string));

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") {
        this.failPendingOrNotify("Realtime connection failed.");
      }
    });

    // 4. SDP offer → OpenAI → answer.
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    const sdpRes = await fetch(REALTIME_CALLS_URL, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${ephemeralKey}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!sdpRes.ok) {
      this.cleanup();
      const detail = await safeError(sdpRes);
      throw new Error(detail || `SDP exchange failed (HTTP ${sdpRes.status}).`);
    }
    await pc.setRemoteDescription({ type: "answer", sdp: await sdpRes.text() });
    await channelOpen;
  }

  /** Commits the buffered audio, waits for the final transcript, and releases the mic. */
  async stop(): Promise<string> {
    this.stopMic();
    const dc = this.dc;
    if (!dc || dc.readyState !== "open") {
      this.cleanup();
      return "";
    }

    const finalTranscript = this.waitForFinalTranscript();
    dc.send(JSON.stringify({ type: "input_audio_buffer.commit" }));

    try {
      return await finalTranscript;
    } finally {
      this.cleanup();
    }
  }

  /** Tears the session down without committing audio. Safe to call repeatedly. */
  cancel(): void {
    this.cleanup();
  }

  private handleEvent(raw: string): void {
    let event: { type?: string; delta?: string; transcript?: string; error?: { message?: string } };
    try {
      event = JSON.parse(raw);
    } catch {
      return;
    }

    switch (event.type) {
      case "conversation.item.input_audio_transcription.delta":
        if (typeof event.delta === "string") {
          this.partial += event.delta;
          this.callbacks.onPartial?.(this.partial);
        }
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof event.transcript === "string") {
          const transcript = event.transcript.trim() || this.partial.trim();
          if (transcript) this.callbacks.onFinal?.(transcript);
          this.resolvePendingFinal(transcript);
        }
        this.partial = "";
        break;
      case "error":
        this.failPendingOrNotify(event.error?.message ?? "Realtime API error.");
        break;
    }
  }

  private waitForFinalTranscript(): Promise<string> {
    return new Promise((resolve, reject) => {
      this.pendingFinal = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const fallback = this.partial.trim();
          this.pendingFinal = undefined;
          resolve(fallback);
        }, FINAL_TRANSCRIPT_TIMEOUT_MS),
      };
    });
  }

  private resolvePendingFinal(text: string): void {
    const pending = this.pendingFinal;
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingFinal = undefined;
    pending.resolve(text);
  }

  private failPendingOrNotify(message: string): void {
    const pending = this.pendingFinal;
    if (pending) {
      if (isEmptyAudioBufferError(message)) {
        this.resolvePendingFinal("");
        return;
      }
      clearTimeout(pending.timer);
      this.pendingFinal = undefined;
      pending.reject(new Error(message));
      return;
    }
    this.callbacks.onError?.(message);
  }

  private stopMic(): void {
    this.stream?.getTracks().forEach(t => t.stop());
    this.stream = undefined;
  }

  private cleanup(): void {
    this.resolvePendingFinal("");
    try {
      this.dc?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.stopMic();
    this.dc = undefined;
    this.pc = undefined;
  }
}

function isEmptyAudioBufferError(message: string): boolean {
  const lower = message.toLowerCase();
  return (
    lower.includes("audio buffer") &&
    (lower.includes("empty") || lower.includes("too small") || lower.includes("0.00ms"))
  );
}

async function safeError(res: Response): Promise<string | null> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof json.error === "string") return json.error;
      if (json.error?.message) return json.error.message;
    } catch {
      /* not JSON */
    }
    return text || null;
  } catch {
    return null;
  }
}
