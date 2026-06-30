import { Show } from "solid-js";
import {
  errorMessage,
  isBusy,
  isRecording,
  isWritingDocument,
  phase,
  streamedTokens,
  toggleRecording,
} from "~/lib/appState";
import { deleteConversation, selectedConversation } from "~/lib/store";

export default function BottomBar() {
  const handleDelete = () => {
    const conversation = selectedConversation();
    if (conversation) deleteConversation(conversation.id);
  };

  const statusText = () => {
    switch (phase()) {
      case "connecting":
        return "Connecting…";
      case "recording":
        return "Listening…";
      case "transcribing":
        return "Transcribing…";
      case "responding": {
        const verb = isWritingDocument() ? "Writing" : "Thinking";
        return streamedTokens() > 0 ? `${verb}… ${streamedTokens()} tokens` : `${verb}…`;
      }
      case "error":
        return errorMessage();
      default:
        return "Ready";
    }
  };

  const recordLabel = () => {
    switch (phase()) {
      case "connecting":
        return "Starting";
      case "recording":
        return "Stop";
      case "transcribing":
        return "Finishing";
      default:
        return "Record";
    }
  };

  return (
    <div class="bottom-bar">
      <button
        classList={{ "record-btn": true, "record-btn--recording": isRecording() }}
        onClick={toggleRecording}
        disabled={isBusy()}
      >
        <span classList={{ "record-dot": true, "record-dot--pulse": isRecording() }} />
        {recordLabel()}
      </button>

      <span classList={{ status: true, "status--error": phase() === "error" }}>
        <Show when={phase() === "responding" && streamedTokens() > 0} fallback={statusText()}>
          <span class="status__tokens">{statusText()}</span>
        </Show>
      </span>

      <span class="hint">Space to record</span>

      <button class="icon-btn" onClick={handleDelete} disabled={!selectedConversation()}>
        Delete
      </button>
    </div>
  );
}
