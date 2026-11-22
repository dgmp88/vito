// Prompt layout for the expert handoff, engineered for Gemini implicit caching
// (prefix match, >= 4,096 tokens on Gemini 4 Neon):
//
//   tools + systemInstruction: [static prompt][document]   ← changes only on edits
//   contents[0] (user): [conversation log][handoff request] ← log is append-only
//
// Everything that varies per request sits at the very end, so consecutive
// handoffs share the longest possible prefix: tools + prompt + document + the
// log up to the previous handoff. A document edit busts the cache from the
// document onward, which is the cheapest place for it to happen.

import { Type, type Content, type FunctionDeclaration } from "@google/genai";
import { EXPERT_SYSTEM_PROMPT } from "./prompts/expert";
import { serializeTurns, type Turn } from "./types";

export const EXPERT_TOOL_EDIT = "edit_document";
export const EXPERT_TOOL_WRITE = "write_document";
export const EXPERT_TOOL_REPLY = "reply";

export interface ExpertRequest {
  document: string;
  turns: Turn[];
  question: string;
  selection?: string | null;
}

const summary = {
  type: Type.STRING,
  description: "One short line describing the change, shown to the user.",
};

export const EXPERT_TOOLS: FunctionDeclaration[] = [
  {
    name: EXPERT_TOOL_EDIT,
    description: "Apply targeted find/replace edits to the document, in order.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        edits: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              find: {
                type: Type.STRING,
                description: "Exact text copied from the current document; must occur exactly once.",
              },
              replace: { type: Type.STRING, description: "The replacement text (may be empty)." },
            },
            required: ["find", "replace"],
          },
        },
        summary,
      },
      required: ["edits", "summary"],
    },
  },
  {
    name: EXPERT_TOOL_WRITE,
    description: "Write the complete document, replacing everything.",
    parameters: {
      type: Type.OBJECT,
      properties: {
        markdown: { type: Type.STRING, description: "The complete markdown document." },
        summary,
      },
      required: ["markdown", "summary"],
    },
  },
  {
    name: EXPERT_TOOL_REPLY,
    description: "Answer the user in markdown, shown in the transcript.",
    parameters: {
      type: Type.OBJECT,
      properties: { markdown: { type: Type.STRING, description: "The answer, in markdown." } },
      required: ["markdown"],
    },
  },
];

export function expertSystemInstruction(document: string): string {
  const body = document.trim() ? document : "(The document is empty.)";
  return `${EXPERT_SYSTEM_PROMPT}\n\n<document>\n${body}\n</document>`;
}

export function expertContents(request: ExpertRequest): Content[] {
  const log = serializeTurns(request.turns);
  const ask = request.question
    ? `Request: ${request.question}`
    : "Handle the user's latest message in the conversation above.";
  const handoff = request.selection
    ? `<handoff>\nThe user has this text highlighted in the document:\n«${request.selection}»\n\n${ask}\n</handoff>`
    : `<handoff>\n${ask}\n</handoff>`;
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
