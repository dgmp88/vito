import { For, Show, createEffect } from "solid-js";
import { selectedConversation } from "~/lib/store";
import { conversationTranscript } from "~/lib/types";
import {
  hasLivePreview,
  liveConfirmed,
  liveVolatile,
  phase,
  streamedText,
} from "~/lib/appState";

export default function TranscriptPane() {
  const entries = () => conversationTranscript(selectedConversation());
  let body: HTMLDivElement | undefined;

  // Keep the latest turn / live preview in view as text streams in.
  createEffect(() => {
    entries();
    liveConfirmed();
    liveVolatile();
    streamedText();
    if (body) body.scrollTop = body.scrollHeight;
  });

  const showAnything = () =>
    entries().length > 0 || hasLivePreview() || (phase() === "responding" && streamedText());

  return (
    <section class="pane pane--transcript">
      <div class="pane__header">Transcript</div>
      <div class="pane__body" ref={body}>
        <Show
          when={showAnything()}
          fallback={<p class="placeholder">Press record and start speaking.</p>}
        >
          <div class="transcript">
            <For each={entries()}>
              {entry => (
                <div classList={{ entry: true, [`entry--${entry.role}`]: true }}>
                  <span class="entry__role">{entry.role === "user" ? "You" : "Vito"}</span>
                  <div class="entry__text">{entry.text}</div>
                </div>
              )}
            </For>

            <Show when={hasLivePreview()}>
              <div class="entry entry--user entry--live">
                <span class="entry__role">You</span>
                <div class="entry__text">
                  {liveConfirmed()}
                  <Show when={liveVolatile()}>
                    <span class="entry__volatile">
                      {liveConfirmed() ? " " : ""}
                      {liveVolatile()}
                    </span>
                  </Show>
                </div>
              </div>
            </Show>

            <Show when={phase() === "responding" && streamedText()}>
              <div class="entry entry--assistant entry--streaming">
                <span class="entry__role">Vito</span>
                <div class="entry__text">{streamedText()}</div>
              </div>
            </Show>
          </div>
        </Show>
      </div>
    </section>
  );
}
