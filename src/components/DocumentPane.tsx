import { Show, createEffect, createMemo, onSettled } from "solid-js";
import { selectedConversation } from "~/lib/store";
import { clearSelection, renderBlocks, selection, trackSelection } from "~/lib/selection";

export default function DocumentPane() {
  const markdown = () => selectedConversation()?.document ?? "";
  let body: HTMLDivElement | undefined;

  // Each top-level block carries its source offsets so a highlight can be mapped
  // back to markdown. Local, self-authored content (the user's own LLM output)
  // rendered for a spike — sanitize before any multi-user / DB-backed use.
  const html = createMemo(() =>
    renderBlocks(markdown())
      .map(b => `<div class="doc-block" data-start="${b.start}" data-end="${b.end}">${b.html}</div>`)
      .join("")
  );

  // Re-rendering invalidates any highlight, and offsets refer to the old text.
  createEffect(markdown, () => clearSelection());

  onSettled(() => {
    if (!body) return;
    return trackSelection(body, markdown);
  });

  return (
    <section class="pane pane--document">
      <div class="pane__header">
        Document
        <Show when={selection()}>
          <span class="pane__badge">
            Highlighted · speak to edit or ask
            <button class="pane__badge-clear" onClick={() => clearSelection()} title="Clear (Esc)">
              ×
            </button>
          </span>
        </Show>
      </div>
      <div class="pane__body" ref={body}>
        <Show
          when={markdown()}
          fallback={<p class="doc--empty">No document yet. Ask Vito to write one.</p>}
        >
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div class="doc" innerHTML={html()} />
        </Show>
      </div>
    </section>
  );
}
