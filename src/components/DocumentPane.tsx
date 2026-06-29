import { Show, createMemo } from "solid-js";
import { marked } from "marked";
import { selectedConversation } from "~/lib/store";
import { conversationDocument } from "~/lib/types";

export default function DocumentPane() {
  const html = createMemo(() => {
    const markdown = conversationDocument(selectedConversation());
    if (!markdown) return "";
    // Local, self-authored content (the user's own LLM output) rendered for a
    // spike — fine to trust. Sanitize here before any multi-user / DB-backed use.
    return marked.parse(markdown, { async: false }) as string;
  });

  return (
    <section class="pane pane--document">
      <div class="pane__header">Document</div>
      <div class="pane__body">
        <Show
          when={html()}
          fallback={<p class="doc--empty">No document yet. Ask Vito to write or edit one.</p>}
        >
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div class="doc" innerHTML={html()} />
        </Show>
      </div>
    </section>
  );
}
