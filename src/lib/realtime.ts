// Browser-side realtime transcription over WebRTC.
//
// Flow (see https://developers.openai.com/api/docs/guides/realtime-webrtc):
//   1. Ask our server for an ephemeral client secret (keeps the API key server-side).
//   2. Capture the mic and add the track to an RTCPeerConnection — WebRTC handles
//      audio encoding/streaming, so no manual PCM16 conversion is needed.
//   3. Exchange SDP with OpenAI's /v1/realtime/calls using the ephemeral secret.
//   4. Transcription results arrive as events on the "oai-events" data channel.
//
// The minted session is a transcription-only session (gpt-realtime-whisper) with
// server VAD, so each spoken utterance produces streaming `delta` events followed
// by one `completed` event.

const REALTIME_CALLS_URL = "https://api.openai.com/v1/realtime/calls";

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

  /** Opens the mic and connects. Rejects if the connection can't be established. */
  async start(callbacks: TranscriberCallbacks): Promise<void> {
    this.callbacks = callbacks;
    this.partial = "";

    // 1. Ephemeral token from our server.
    const tokenRes = await fetch("/api/realtime-token", { method: "POST" });
    if (!tokenRes.ok) {
      const detail = await safeError(tokenRes);
      throw new Error(detail || `Token request failed (HTTP ${tokenRes.status}).`);
    }
    const tokenData = (await tokenRes.json()) as {
      value?: string;
      client_secret?: { value?: string };
    };
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
    dc.addEventListener("open", () => this.callbacks.onOpen?.());
    dc.addEventListener("message", e => this.handleEvent(e.data as string));

    pc.addEventListener("connectionstatechange", () => {
      if (pc.connectionState === "failed") {
        this.callbacks.onError?.("Realtime connection failed.");
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
  }

  /** Tears the session down and releases the mic. Safe to call repeatedly. */
  stop(): void {
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
          this.callbacks.onFinal?.(event.transcript.trim());
        }
        this.partial = "";
        break;
      case "error":
        this.callbacks.onError?.(event.error?.message ?? "Realtime API error.");
        break;
    }
  }

  private cleanup(): void {
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
    this.stream?.getTracks().forEach(t => t.stop());
    this.dc = undefined;
    this.pc = undefined;
    this.stream = undefined;
  }
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
