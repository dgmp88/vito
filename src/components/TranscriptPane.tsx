import { For, Show, createEffect, createMemo } from "solid-js";
import { marked } from "marked";
import { selectedConversation } from "~/lib/store";
import { conversationTranscript } from "~/lib/types";
import { expertJobs, liveAssistant, liveUser } from "~/lib/appState";

/** Expert answers are markdown; render them (self-authored LLM output, spike-trusted). */
function markdownHtml(text: string): string {
  return marked.parse(text, { async: false }) as string;
}

/** An expert turn: the handed-off request, edits it made, and/or its reply. */
function ExpertBody(props: { question: string; edits: string[]; reply: string; thinking?: string }) {
  return (
    <div class="entry__text expert">
      <Show when={props.question}>
        <div class="expert__question">{props.question}</div>
      </Show>
      <For each={props.edits}>{edit => <div class="expert__edit">{edit}</div>}</For>
      <Show when={props.reply}>
        {/* eslint-disable-next-line solid/no-innerhtml */}
        <div class="entry__markdown" innerHTML={markdownHtml(props.reply)} />
      </Show>
      <Show when={props.thinking}>
        <div class="entry__thinking">{props.thinking}</div>
      </Show>
    </div>
  );
}

export default function TranscriptPane() {
  const entries = createMemo(() => conversationTranscript(selectedConversation()));
  let body: HTMLDivElement | undefined;

  // Keep the latest turn / live preview in view as text streams in.
  createEffect(
    () => [entries(), liveUser(), liveAssistant(), expertJobs()],
    () => {
      if (body) body.scrollTop = body.scrollHeight;
    }
  );

  const showAnything = () =>
    entries().length > 0 || liveUser() !== "" || liveAssistant() !== "" || expertJobs().length > 0;

  return (
    <section class="pane pane--transcript">
      <div class="pane__header">Transcript</div>
      <div class="pane__body" ref={body}>
        <Show
          when={showAnything()}
          fallback={
            <p class="placeholder">
              Press record and talk. Highlight text in the document to edit it or ask about it.
            </p>
          }
        >
          <div class="transcript">
            <For each={entries()} keyed={entry => entry.id}>
              {entry => (
                <div class={`entry entry--${entry().role}`}>
                  <Show when={entry().role !== "edit"}>
                    <span class="entry__role">
                      {entry().role === "user" ? "You" : entry().role === "expert" ? "Expert" : "Vito"}
                    </span>
                  </Show>
                  <Show when={entry().selection}>
                    <div class="entry__selection">{entry().selection}</div>
                  </Show>
                  <Show
                    when={entry().role === "expert"}
                    fallback={<div class="entry__text">{entry().text}</div>}
                  >
                    <ExpertBody question={entry().question ?? ""} edits={entry().edits ?? []} reply={entry().text} />
                  </Show>
                </div>
              )}
            </For>

            <Show when={liveUser()}>
              <div class="entry entry--user entry--live">
                <span class="entry__role">You</span>
                <div class="entry__text">{liveUser()}</div>
              </div>
            </Show>

            <Show when={liveAssistant()}>
              <div class="entry entry--assistant entry--streaming">
                <span class="entry__role">Vito</span>
                <div class="entry__text">{liveAssistant()}</div>
              </div>
            </Show>

            <For each={expertJobs()} keyed={job => job.id}>
              {job => (
                <div class="entry entry--expert entry--streaming">
                  <span class="entry__role">Expert</span>
                  <ExpertBody
                    question={job().question}
                    edits={job().edits}
                    reply={job().reply}
                    thinking={job().thought || "Thinking…"}
                  />
                </div>
              )}
            </For>
          </div>
        </Show>
      </div>
    </section>
  );
}
