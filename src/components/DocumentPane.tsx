import { Show, createEffect, createMemo, onSettled } from "solid-js";
import { selectedConversation } from "~/lib/store";
import { canPasteDocument, pasteDocument } from "~/lib/appState";
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
    const stopTracking = trackSelection(body, markdown);
    // Before anything has happened in a chat, a paste anywhere becomes its document.
    const onPaste = (e: ClipboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable]")) return;
      const text = e.clipboardData?.getData("text/plain") ?? "";
      if (!text.trim() || !canPasteDocument()) return;
      e.preventDefault();
      pasteDocument(text);
    };
    window.addEventListener("paste", onPaste);
    return () => {
      stopTracking();
      window.removeEventListener("paste", onPaste);
    };
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
          fallback={
            <p class="doc--empty">
              <Show when={canPasteDocument()} fallback="No document yet. Ask Vito to write one.">
                No document yet. Paste one in (⌘V), or ask Vito to write one.
              </Show>
            </p>
          }
        >
          {/* eslint-disable-next-line solid/no-innerhtml */}
          <div class="doc" innerHTML={html()} />
        </Show>
      </div>
    </section>
  );
}
