// Shared definition of the Live voice session: tools, VAD/transcription config,
// and the context messages we inject mid-session (the prompt is in prompts/voice.ts). Pure (no server/browser APIs) so the
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
import { VOICE_SYSTEM_PROMPT } from "./prompts/voice";

export const TOOL_REPLACE_SELECTION = "replace_selection";
export const TOOL_WRITE_DOCUMENT = "write_document";
export const TOOL_ASK_EXPERT = "ask_expert";

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
      "Hand a request that needs careful thought to a stronger model. It edits the document " +
      "directly and/or answers in text on screen; the outcome is returned to you when ready.",
    behavior: Behavior.NON_BLOCKING,
    parameters: {
      type: Type.OBJECT,
      properties: {
        question: {
          type: Type.STRING,
          description:
            "A self-contained statement of what the user wants, resolving references " +
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
    systemInstruction: VOICE_SYSTEM_PROMPT,
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
