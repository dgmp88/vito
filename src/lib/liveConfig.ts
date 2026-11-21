// Shared definition of the Live voice session: system prompt, tools, and the
// context messages we inject mid-session. Pure (no server/browser APIs) so the
// server can lock it into the ephemeral token and the client can reuse the
// tool names and message builders.

import {
  Behavior,
  EndSensitivity,
  Modality,
  StartSensitivity,
  Type,
  type FunctionDeclaration,
  type LiveConnectConfig,
} from "@google/genai";

export const TOOL_REPLACE_SELECTION = "replace_selection";
export const TOOL_WRITE_DOCUMENT = "write_document";
export const TOOL_ASK_EXPERT = "ask_expert";

export const LIVE_SYSTEM_PROMPT = `You are Vito, a fast voice assistant sitting beside a markdown \
document the user is working on. The user talks to you; you act mostly through tools and speak very \
little.

Context arrives as user messages that start with a bracketed tag, like "[Document]" or "[Selection]". \
They are information, not requests: never reply to them on their own. The most recent [Selection] \
message says what the user currently has highlighted (or that nothing is highlighted).

For each spoken request, pick exactly one of these:
1. The user wants the highlighted text changed (rewrite, shorten, fix, translate, reformat, expand…): \
call ${TOOL_REPLACE_SELECTION} with the markdown that should replace exactly the highlighted text. \
Keep the surrounding formatting consistent and change only what was asked.
2. The user wants the document created or changed and nothing is highlighted, or the change spans the \
whole document: call ${TOOL_WRITE_DOCUMENT} with the COMPLETE new markdown (never a diff or a fragment).
3. The user wants an answer that takes real thought: a question, explanation, opinion, feedback, \
analysis, brainstorm, or anything you would need more than one sentence for. Call ${TOOL_ASK_EXPERT} \
with a self-contained restatement of what they want (say what "this" or "it" refers to). A stronger \
model answers in text on screen. Do not answer it yourself.
4. Trivial chit-chat or a quick clarification: answer in one short sentence.

How you speak:
- Keep every spoken reply to a few words, like "Done.", "On it.", or "Let me get that for you." Never \
read the document, an edit, or an answer aloud.
- If a request is ambiguous, ask one short clarifying question instead of guessing.
- When the user interrupts, stop and listen.`;

const LIVE_TOOLS: FunctionDeclaration[] = [
  {
    name: TOOL_REPLACE_SELECTION,
    description:
      "Replace the text the user currently has highlighted in the document with new markdown.",
    behavior: Behavior.BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        markdown: {
          type: Type.STRING,
          description: "Markdown that replaces exactly the highlighted text.",
        },
      },
      required: ["markdown"],
    },
  },
  {
    name: TOOL_WRITE_DOCUMENT,
    description: "Create or replace the whole document with new markdown.",
    behavior: Behavior.BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        markdown: {
          type: Type.STRING,
          description: "The complete markdown content of the document.",
        },
      },
      required: ["markdown"],
    },
  },
  {
    name: TOOL_ASK_EXPERT,
    description:
      "Hand a question that needs careful thought to a stronger model. Its answer is shown to the " +
      "user as text, and the result is returned to you when it is ready.",
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description:
            "A self-contained statement of what the user wants answered, resolving references " +
            "like 'this' or 'the second paragraph'.",
        },
      },
      required: ["question"],
    },
  },
];

/**
 * The session config, locked into the ephemeral token server-side. Session
 * resumption is deliberately left out so the client can pass a resume handle.
 */
export function liveSessionConfig(): LiveConnectConfig {
  return {
    responseModalities: [Modality.AUDIO],
    systemInstruction: LIVE_SYSTEM_PROMPT,
    tools: [{ functionDeclarations: LIVE_TOOLS }],
    inputAudioTranscription: {},
    outputAudioTranscription: {},
    contextWindowCompression: { slidingWindow: {} },
    realtimeInputConfig: {
      automaticActivityDetection: {
        startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
        endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
        prefixPaddingMs: 200,
        // Thinking-out-loud pauses are common while dictating edits; don't cut in early.
        silenceDurationMs: 800,
      },
    },
  };
}

// MARK: - Context messages (sent with sendClientContent, turnComplete: false)

export function documentContext(document: string): string {
  return document.trim()
    ? `[Document] The current document:\n<document>\n${document}\n</document>`
    : "[Document] The document is empty.";
}

export function selectionContext(selection: string | null): string {
  return selection
    ? `[Selection] The user has highlighted this text in the document:\n«${selection}»`
    : "[Selection] Nothing is highlighted.";
}

export function historyContext(transcript: string): string {
  return `[History] The conversation so far, from an earlier session:\n${transcript.trim()}`;
}
