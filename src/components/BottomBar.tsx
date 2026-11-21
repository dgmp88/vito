import { Show } from "solid-js";
import {
  errorMessage,
  expertJobs,
  isBusy,
  isLive,
  muted,
  notice,
  phase,
  speaking,
  toggleMuted,
  toggleSession,
} from "~/lib/appState";
import { deleteConversation, selectedConversation } from "~/lib/store";

export default function BottomBar() {
  const handleDelete = () => {
    const conversation = selectedConversation();
    if (conversation) deleteConversation(conversation.id);
  };

  const statusText = () => {
    const expert = expertJobs().length > 0 ? "Expert is thinking…" : "";
    switch (phase()) {
      case "connecting":
        return "Connecting…";
      case "live": {
        const voice = speaking() ? "Speaking…" : "Listening…";
        return [voice, expert].filter(Boolean).join(" · ");
      }
      case "error":
        return errorMessage();
      default:
        return expert || notice() || "Ready";
    }
  };

  const recordLabel = () => {
    switch (phase()) {
      case "connecting":
        return "Starting";
      case "live":
        return "Stop";
      default:
        return "Record";
    }
  };

  return (
    <div class="bottom-bar">
      <button
        class={{ "record-btn": true, "record-btn--recording": isLive() }}
        // Keep a document highlight from being dropped by focus moving to the button.
        onMouseDown={e => e.preventDefault()}
        onClick={toggleSession}
        disabled={phase() === "connecting"}
      >
        <span class={{ "record-dot": true, "record-dot--pulse": isLive() }} />
        {recordLabel()}
      </button>

      <span class={{ status: true, "status--error": phase() === "error" }}>
        <Show when={phase() === "live" && notice()} fallback={statusText()}>
          {statusText()} · {notice()}
        </Show>
      </span>

      <span class="hint">Space to start/stop · Esc clears highlight</span>

      <button
        class="icon-btn"
        onMouseDown={e => e.preventDefault()}
        onClick={toggleMuted}
        title={muted() ? "Vito's voice is muted" : "Mute Vito's voice"}
      >
        {muted() ? "Voice off" : "Voice on"}
      </button>

      <button class="icon-btn" onClick={handleDelete} disabled={!selectedConversation() || isBusy()}>
        Delete
      </button>
    </div>
  );
}
