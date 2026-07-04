// The reactive orchestrator — the web analog of the native app's AppState.
// Ties the realtime transcriber to the document agent and exposes the phase /
// live-preview / streaming signals the UI renders. Conversations themselves live
// in the persisted store (store.ts); this module holds only ephemeral UI state.

import { createSignal } from "solid-js";
import { respond } from "./agent";
import { RealtimeTranscriber } from "./realtime";
import {
  appendMessages,
  ensureConversation,
  selectedConversation,
  setConversationTitle,
} from "./store";
import { titleFromUtterance } from "./types";

export type Phase = "idle" | "connecting" | "recording" | "transcribing" | "responding" | "error";

const [phase, setPhase] = createSignal<Phase>("idle");
const [errorMessage, setErrorMessage] = createSignal("");

// Live transcription preview while recording. `liveConfirmed` is the stable text
// (completed utterances); `liveVolatile` is the in-progress tail.
const [liveConfirmed, setLiveConfirmed] = createSignal("");
const [liveVolatile, setLiveVolatile] = createSignal("");

// Streaming state while the assistant responds.
const [streamedText, setStreamedText] = createSignal("");
const [streamedTokens, setStreamedTokens] = createSignal(0);
const [isWritingDocument, setIsWritingDocument] = createSignal(false);

export {
  phase,
  errorMessage,
  liveConfirmed,
  liveVolatile,
  streamedText,
  streamedTokens,
  isWritingDocument,
};

let transcriber: RealtimeTranscriber | undefined;

export function isRecording(): boolean {
  return phase() === "recording";
}

export function isBusy(): boolean {
  return phase() === "connecting" || phase() === "transcribing" || phase() === "responding";
}

/** True while a live preview is worth showing and some text has arrived. */
export function hasLivePreview(): boolean {
  return (
    (phase() === "recording" || phase() === "transcribing") &&
    !(liveConfirmed() === "" && liveVolatile() === "")
  );
}

export function toggleRecording(): void {
  switch (phase()) {
    case "recording":
      void stopAndProcess();
      break;
    case "idle":
    case "error":
      void startRecording();
      break;
    default:
      break; // ignore taps while responding
  }
}

async function startRecording(): Promise<void> {
  setErrorMessage("");
  setLiveConfirmed("");
  setLiveVolatile("");
  transcriber = new RealtimeTranscriber();
  setPhase("connecting");
  try {
    await transcriber.start({
      onFinal: text => {
        if (!text) return;
        setLiveConfirmed(prev => (prev ? `${prev} ${text}` : text));
        setLiveVolatile("");
      },
      onPartial: text => setLiveVolatile(text),
      onError: message => {
        transcriber?.cancel();
        transcriber = undefined;
        fail("Transcription error", message);
      },
    });
    setPhase("recording");
  } catch (error) {
    transcriber?.cancel();
    transcriber = undefined;
    fail("Couldn't start recording", (error as Error).message);
  }
}

async function stopAndProcess(): Promise<void> {
  const activeTranscriber = transcriber;
  transcriber = undefined;
  setPhase("transcribing");
  try {
    await activeTranscriber?.stop();
  } catch (error) {
    activeTranscriber?.cancel();
    fail("Transcription error", (error as Error).message);
    return;
  }

  const spoken = [liveConfirmed(), liveVolatile()]
    .filter(Boolean)
    .join(" ")
    .trim();
  setLiveConfirmed("");
  setLiveVolatile("");

  if (!spoken) {
    // No speech detected — silently return to idle.
    setPhase("idle");
    return;
  }

  // Lazily create the conversation on first speech, then record the turn.
  const conversation = ensureConversation();
  if (!conversation.title) {
    setConversationTitle(conversation.id, titleFromUtterance(spoken));
  }
  appendMessages(conversation.id, [{ role: "user", content: spoken }]);

  // Send the full history for multi-turn context.
  setPhase("responding");
  resetStreamingState();
  try {
    const history = selectedConversation()?.messages ?? [];
    const appended = await respond(history, update => {
      setStreamedText(update.assistantText);
      setStreamedTokens(update.tokenCount);
      setIsWritingDocument(update.isWritingDocument);
    });
    appendMessages(conversation.id, appended);
    resetStreamingState();
    setPhase("idle");
  } catch (error) {
    resetStreamingState();
    fail("Assistant failed", (error as Error).message);
  }
}

function resetStreamingState(): void {
  setStreamedText("");
  setStreamedTokens(0);
  setIsWritingDocument(false);
}

function fail(context: string, message: string): void {
  setErrorMessage(`${context}: ${message}`);
  setPhase("error");
}

/** Clears a stuck error back to idle (e.g. when the user switches chats). */
export function clearError(): void {
  if (phase() === "error") {
    setPhase("idle");
    setErrorMessage("");
  }
}
