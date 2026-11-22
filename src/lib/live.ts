// Browser-side Gemini Live session: mic in, voice + transcripts + tool calls out.
//
// Flow:
//   1. Our server mints a single-use ephemeral token with the session config
//      (prompt, tools, VAD, transcription) locked in. The API key stays server-side.
//   2. We connect with @google/genai's live client over WebSocket, stream mic PCM
//      as realtime input, and let server-side VAD decide when turns end.
//   3. Context (document, selection, prior history) goes in as client content
//      with turnComplete: false, so it's added to context without triggering a reply.
//   4. On GoAway (connections last ~10 min) we transparently reconnect with the
//      latest session-resumption handle, reusing the same token.

import {
  GoogleGenAI,
  type FunctionCall,
  type FunctionResponse,
  type LiveServerMessage,
  type Session,
  type UsageMetadata,
} from "@google/genai";
import { AudioPlayer, MicCapture } from "./audio";
import { authToken } from "./auth";
import { createLiveSession } from "./geminiServer";

export interface LiveCallbacks {
  /** Incremental transcription of the user's speech. */
  onInputTranscript: (text: string) => void;
  /** Incremental transcription of the model's speech. */
  onOutputTranscript: (text: string) => void;
  onToolCalls: (calls: FunctionCall[]) => void;
  onToolCancellation: (ids: string[]) => void;
  /** The user barged in; the model's in-flight reply was discarded. */
  onInterrupted: () => void;
  onTurnComplete: () => void;
  onSpeakingChange: (speaking: boolean) => void;
  /** Token usage for one model turn (the Live API reports it once per turn). */
  onUsage: (model: string, usage: UsageMetadata) => void;
  /** Fatal: the session is gone and won't reconnect. */
  onError: (message: string) => void;
}

const SETUP_TIMEOUT_MS = 15_000;

export class LiveVoiceSession {
  private session?: Session;
  private mic = new MicCapture();
  private player: AudioPlayer;
  private token = "";
  private model = "";
  private resumeHandle?: string;
  private reconnecting = false;
  private closedByUser = false;
  private inputPaused = false;

  constructor(private callbacks: LiveCallbacks) {
    this.player = new AudioPlayer(speaking => callbacks.onSpeakingChange(speaking));
  }

  /**
   * Connects, sends `initialContext` (each string becomes one context message),
   * then opens the mic. Call from a user gesture so audio playback is allowed.
   */
  async start(initialContext: string[]): Promise<void> {
    this.closedByUser = false;
    this.player.start();
    const { token, model } = await createLiveSession(await authToken());
    this.token = token;
    this.model = model;
    await this.connect();
    if (initialContext.length > 0) this.sendContext(initialContext);
    await this.mic.start((data, mimeType) => {
      // Drop audio during the brief reconnect gap, and while input is paused.
      if (this.reconnecting || this.inputPaused) return;
      try {
        this.session?.sendRealtimeInput({ audio: { data, mimeType } });
      } catch {
        /* socket closing; the close handler deals with it */
      }
    });
  }

  /** Adds context messages without asking the model to respond. */
  sendContext(messages: string[]): void {
    this.session?.sendClientContent({
      turns: messages.map(text => ({ role: "user", parts: [{ text }] })),
      turnComplete: false,
    });
  }

  /**
   * Stop (or resume) sending mic audio, e.g. while a blocking tool call is
   * running, so speech can't interrupt it. The mic itself stays open.
   */
  setInputPaused(paused: boolean): void {
    if (paused === this.inputPaused) return;
    this.inputPaused = paused;
    if (!paused) return;
    try {
      // Tell the server the stream has stopped so it flushes any buffered audio.
      this.session?.sendRealtimeInput({ audioStreamEnd: true });
    } catch {
      /* socket closing */
    }
  }

  sendToolResponses(responses: FunctionResponse[]): void {
    this.session?.sendToolResponse({ functionResponses: responses });
  }

  stop(): void {
    this.closedByUser = true;
    this.mic.stop();
    this.player.stop();
    try {
      this.session?.close();
    } catch {
      /* ignore */
    }
    this.session = undefined;
  }

  private async connect(): Promise<void> {
    const ai = new GoogleGenAI({ apiKey: this.token, httpOptions: { apiVersion: "v1beta" } });
    let resolveSetup!: () => void;
    let rejectSetup!: (error: Error) => void;
    const setup = new Promise<void>((resolve, reject) => {
      resolveSetup = resolve;
      rejectSetup = reject;
    });
    const timer = setTimeout(() => rejectSetup(new Error("Live session setup timed out.")), SETUP_TIMEOUT_MS);

    // Assigned after connect resolves; a close before that just rejects `setup`.
    let session: Session | undefined;
    session = await ai.live.connect({
      model: this.model,
      config: { sessionResumption: this.resumeHandle ? { handle: this.resumeHandle } : {} },
      callbacks: {
        onmessage: (message: LiveServerMessage) => {
          if (message.setupComplete) {
            clearTimeout(timer);
            resolveSetup();
          }
          this.handleMessage(message);
        },
        onerror: (event: ErrorEvent) => {
          clearTimeout(timer);
          rejectSetup(new Error(event.message || "Live connection error."));
        },
        onclose: (event: CloseEvent) => {
          clearTimeout(timer);
          rejectSetup(new Error(event.reason || `Live connection closed (${event.code}).`));
          if (!session || session !== this.session || this.closedByUser || this.reconnecting) return;
          // Unexpected close: try once to resume, else surface the error.
          if (this.resumeHandle) {
            void this.reconnect();
          } else {
            this.callbacks.onError(event.reason || `Live connection closed (${event.code}).`);
          }
        },
      },
    });
    this.session = session;
    await setup;
  }

  private async reconnect(): Promise<void> {
    if (this.reconnecting || this.closedByUser) return;
    this.reconnecting = true;
    const old = this.session;
    this.session = undefined;
    try {
      old?.close();
    } catch {
      /* ignore */
    }
    try {
      await this.connect();
    } catch (error) {
      this.callbacks.onError(`Couldn't resume the Live session: ${(error as Error).message}`);
    } finally {
      this.reconnecting = false;
    }
  }

  private handleMessage(message: LiveServerMessage): void {
    const content = message.serverContent;
    if (content) {
      if (content.interrupted) {
        this.player.flush();
        this.callbacks.onInterrupted();
      }
      if (content.inputTranscription?.text) {
        this.callbacks.onInputTranscript(content.inputTranscription.text);
      }
      if (content.outputTranscription?.text) {
        this.callbacks.onOutputTranscript(content.outputTranscription.text);
      }
      for (const part of content.modelTurn?.parts ?? []) {
        if (part.inlineData?.data) this.player.enqueue(part.inlineData.data, part.inlineData.mimeType);
      }
      if (content.turnComplete) this.callbacks.onTurnComplete();
    }

    if (message.toolCall?.functionCalls?.length) {
      this.callbacks.onToolCalls(message.toolCall.functionCalls);
    }
    if (message.toolCallCancellation?.ids?.length) {
      this.callbacks.onToolCancellation(message.toolCallCancellation.ids);
    }
    if (message.sessionResumptionUpdate?.resumable && message.sessionResumptionUpdate.newHandle) {
      this.resumeHandle = message.sessionResumptionUpdate.newHandle;
    }
    if (message.usageMetadata) this.callbacks.onUsage(this.model, message.usageMetadata);
    if (message.goAway) void this.reconnect();
  }
}
