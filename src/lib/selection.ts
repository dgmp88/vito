// Highlight-to-edit plumbing. The document renders as one element per top-level
// markdown block, each tagged with its [start, end) offsets in the markdown
// source. When the user highlights rendered text we map it back to a source
// span: the exact markdown of the selected text when we can find it inside the
// covered blocks, otherwise the covered blocks whole. That span is what the
// voice model sees as "the highlighted text" and what replace_selection replaces.

import { createSignal } from "solid-js";
import { marked, type Token, type TokensList } from "marked";

export interface DocBlock {
  start: number;
  end: number;
  html: string;
}

export interface DocSelection {
  start: number;
  end: number;
  /** The markdown source of the span. */
  text: string;
  /** The document the offsets refer to; a selection is stale once it changes. */
  document: string;
}

const HIGHLIGHT_NAME = "vito-selection";

const [selection, setSelectionSignal] = createSignal<DocSelection | null>(null);
export { selection };

/** Renders markdown into offset-tagged blocks. */
export function renderBlocks(markdown: string): DocBlock[] {
  const tokens = marked.lexer(markdown);
  const blocks: DocBlock[] = [];
  let offset = 0;
  for (const token of tokens) {
    const start = offset;
    offset += token.raw.length;
    if (token.type === "space") continue;
    blocks.push({ start, end: offset, html: renderToken(token, tokens) });
  }
  // If the lexer normalized anything, offsets are unreliable: one block for everything.
  if (offset !== markdown.length) {
    return [{ start: 0, end: markdown.length, html: marked.parse(markdown, { async: false }) as string }];
  }
  return blocks;
}

function renderToken(token: Token, all: TokensList): string {
  const list = Object.assign([token], { links: all.links }) as TokensList;
  return marked.parser(list);
}

/**
 * Start tracking the user's selection inside `root` (the rendered document).
 * Selections elsewhere on the page leave the current one alone, so clicking
 * Record doesn't drop it; a click inside the document clears it.
 */
export function trackSelection(root: HTMLElement, getDocument: () => string): () => void {
  const onChange = () => {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (!root.contains(range.commonAncestorContainer)) return;
    if (sel.isCollapsed) {
      clearSelection();
      return;
    }
    const mapped = mapRange(root, range, sel.toString(), getDocument());
    setSelection(mapped, mapped ? range.cloneRange() : null);
  };
  document.addEventListener("selectionchange", onChange);
  return () => document.removeEventListener("selectionchange", onChange);
}

export function clearSelection(): void {
  setSelection(null, null);
}

/** Returns the selection only if it still refers to `document`. */
export function currentSelection(document: string): DocSelection | null {
  const current = selection();
  return current && current.document === document ? current : null;
}

function setSelection(value: DocSelection | null, range: Range | null): void {
  const previous = selection();
  if (previous?.start !== value?.start || previous?.end !== value?.end || previous?.document !== value?.document) {
    setSelectionSignal(value);
  }
  // Paint a persistent highlight (survives focus moving to the Record button).
  const highlights = (globalThis as any).CSS?.highlights as Map<string, unknown> | undefined;
  const HighlightCtor = (globalThis as any).Highlight as (new (...ranges: Range[]) => unknown) | undefined;
  if (!highlights || !HighlightCtor) return;
  if (range) highlights.set(HIGHLIGHT_NAME, new HighlightCtor(range));
  else highlights.delete(HIGHLIGHT_NAME);
}

function mapRange(root: HTMLElement, range: Range, selectedText: string, markdown: string): DocSelection | null {
  const blocks = [...root.querySelectorAll<HTMLElement>("[data-start]")].filter(b => range.intersectsNode(b));
  if (blocks.length === 0) return null;
  const blockStart = Number(blocks[0].dataset.start);
  const blockEnd = Number(blocks[blocks.length - 1].dataset.end);
  const source = markdown.slice(blockStart, blockEnd);

  const exact = findInSource(source, selectedText.trim());
  if (exact) {
    const start = blockStart + exact.index;
    const end = start + exact.length;
    return { start, end, text: markdown.slice(start, end), document: markdown };
  }

  // Fall back to the covered blocks, minus trailing newlines (keep block separation).
  const trimmedEnd = blockStart + source.replace(/\s+$/, "").length;
  return { start: blockStart, end: trimmedEnd, text: markdown.slice(blockStart, trimmedEnd), document: markdown };
}

/** Finds rendered text in markdown source, tolerating line wraps and spacing. */
function findInSource(source: string, text: string): { index: number; length: number } | null {
  if (!text) return null;
  const direct = source.indexOf(text);
  if (direct !== -1) return { index: direct, length: text.length };
  const pattern = text
    .split(/\s+/)
    .map(word => word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("\\s+");
  const match = new RegExp(pattern).exec(source);
  return match ? { index: match.index, length: match[0].length } : null;
}
