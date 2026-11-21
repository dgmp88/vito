// Find/replace edits on the markdown document. Shared by the expert agent
// (server, to validate against its working copy) and the client (to apply onto
// the live document, which the voice model may have changed in the meantime).

export interface DocEdit {
  find: string;
  replace: string;
}

export type EditResult = { ok: true; document: string } | { ok: false; error: string };

/** Applies edits in order, all or nothing. Each `find` must occur exactly once. */
export function applyEdits(document: string, edits: DocEdit[]): EditResult {
  let next = document;
  for (const [i, edit] of edits.entries()) {
    const label = `Edit ${i + 1}`;
    if (!edit.find) return { ok: false, error: `${label}: "find" is empty.` };
    const at = next.indexOf(edit.find);
    if (at === -1) {
      return { ok: false, error: `${label}: "find" text not found in the document. Copy it verbatim.` };
    }
    if (next.indexOf(edit.find, at + 1) !== -1) {
      return { ok: false, error: `${label}: "find" text occurs more than once. Include more context.` };
    }
    next = next.slice(0, at) + edit.replace + next.slice(at + edit.find.length);
  }
  return { ok: true, document: next };
}
