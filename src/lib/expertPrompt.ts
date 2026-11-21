// Prompt layout for the expert handoff, engineered for Gemini implicit caching
// (prefix match, >= 4,096 tokens on Gemini 4 Neon):
//
//   systemInstruction: [static instructions][document]      ← changes only on edits
//   contents[0] (user): [conversation log][handoff request] ← log is append-only
//
// Everything that varies per request sits at the very end, so consecutive
// handoffs share the longest possible prefix: instructions + document + the log
// up to the previous handoff. A document edit busts the cache from the
// document onward, which is the cheapest place for it to happen.

import type { Content } from "@google/genai";
import { serializeTurns, type Turn } from "./types";

export interface ExpertRequest {
  document: string;
  turns: Turn[];
  question: string;
  selection?: string | null;
}

const EXPERT_INSTRUCTIONS = `You are the expert behind Vito, a voice-driven writing assistant. A \
fast voice model talks with the user and hands you the requests that need careful thought. Your answer \
is shown to the user as text beside their document.

- Answer the handoff request directly. No preamble, and don't restate the question.
- Be thorough where it matters and brief where it doesn't. Use markdown (short headings, lists, bold) \
when it makes the answer easier to scan.
- Ground your answer in the document and the conversation when they are relevant. Quote the document \
sparingly.
- You can't edit the document. If the user would benefit from a change, propose the exact wording; \
they can ask Vito to apply it.`;

export function expertSystemInstruction(document: string): string {
  const body = document.trim() ? document : "(The document is empty.)";
  return `${EXPERT_INSTRUCTIONS}\n\n<document>\n${body}\n</document>`;
}

export function expertContents(request: ExpertRequest): Content[] {
  const log = serializeTurns(request.turns);
  const handoff = request.selection
    ? `<handoff>\nThe user has this text highlighted in the document:\n«${request.selection}»\n\n` +
      `Request: ${request.question}\n</handoff>`
    : `<handoff>\nRequest: ${request.question}\n</handoff>`;
  return [
    {
      role: "user",
      parts: [
        // No placeholder for an empty log: it would differ from the next request's prefix.
        { text: `<conversation>\n${log}` },
        { text: `</conversation>\n\n${handoff}` },
      ],
    },
  ];
}
