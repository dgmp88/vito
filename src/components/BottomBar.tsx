import { Show } from "solid-js";
import {
  errorMessage,
  expertJobs,
  isBusy,
  isLive,
  notice,
  phase,
  speaking,
  toggleSession,
} from "~/lib/appState";
import { deleteConversation, selectedConversation } from "~/lib/store";
import { syncError } from "~/lib/sync";
import { formatCost, formatTokens, totalCost, type UsageTotals } from "~/lib/usage";

/** "Voice $0.012" with a hover card breaking the cost down by token type. */
function CostChip(props: { label: string; usage: UsageTotals | undefined }) {
  const rows = () => {
    const u = props.usage;
    if (!u) return [];
    return [
      { name: "Input", tokens: u.tokens.input, cost: u.cost.input },
      { name: "Cached", tokens: u.tokens.cached, cost: u.cost.cached },
      { name: "Output", tokens: u.tokens.output, cost: u.cost.output },
      { name: "Reasoning", tokens: u.tokens.reasoning, cost: u.cost.reasoning },
    ];
  };

  return (
    <span class="cost" tabindex="0">
      <span class="cost__label">{props.label}</span> {formatCost(totalCost(props.usage))}
      <span class="cost__card" role="tooltip">
        <span class="cost__title">{props.label} cost</span>
        {rows().map(row => (
          <span class="cost__row">
            <span>{row.name}</span>
            <span class="cost__tokens">{formatTokens(row.tokens)} tok</span>
            <span>{formatCost(row.cost)}</span>
          </span>
        ))}
        <Show when={!props.usage}>
          <span class="cost__empty">No usage yet</span>
        </Show>
      </span>
    </span>
  );
}

export default function BottomBar() {
  const handleDelete = () => {
    const conversation = selectedConversation();
    if (conversation) deleteConversation(conversation.id);
  };

  const statusText = () => {
    const expert = expertJobs().length > 0 ? "Expert is working…" : "";
    switch (phase()) {
      case "connecting":
        return "Connecting…";
      case "live": {
        // The mic is muted while the (blocking) expert call runs.
        if (expert) return `${expert} · mic muted`;
        return speaking() ? "Speaking…" : "Listening…";
      }
      case "error":
        return errorMessage();
      default:
        return expert || syncError() || notice() || "Ready";
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

  const usage = () => selectedConversation()?.usage;

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

      <span class={{ status: true, "status--error": phase() === "error" || (phase() !== "live" && !!syncError()) }}>
        <Show when={phase() === "live" && notice()} fallback={statusText()}>
          {statusText()} · {notice()}
        </Show>
      </span>

      <span class="hint">Space to start/stop · Esc clears highlight</span>

      <span class="costs">
        <CostChip label="Voice" usage={usage()?.voice} />
        <CostChip label="Expert" usage={usage()?.expert} />
      </span>

      <button class="icon-btn" onClick={handleDelete} disabled={!selectedConversation() || isBusy()}>
        Delete
      </button>
    </div>
  );
}
