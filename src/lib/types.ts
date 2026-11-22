// Data model. A conversation is the current markdown `document` plus an
// append-only log of `turns`. The log is what we show in the transcript pane,
// what we seed a fresh Live session with, and what we hand to the expert model.
//
// Turns are treated as immutable once a later turn exists: the expert prompt
// serializes them in order, so keeping the log append-only keeps the prompt
// prefix stable and lets implicit caching hit (see expertServer / geminiServer).

export type Turn = TurnBody & {
  /** Stable id (assigned by the store on append); also the persisted message id. */
  id?: string;
};

type TurnBody =
  /** Something the user said (Live input transcription). */
  | { role: "user"; text: string; selection?: string }
  /** What the Live voice model said back (output transcription). */
  | { role: "assistant"; text: string }
  /**
   * The document changed: a voice-model tool call, or the user pasting one in.
   * `after` is the new markdown (the replacement for a selection edit, the whole
   * document otherwise).
   */
  | {
      role: "edit";
      by?: "voice" | "user";
      scope: "selection" | "document";
      before?: string;
      after?: string;
      /** The Live tool call id, when the edit came from one. */
      callId?: string;
    }
  /** A request handed off to the expert model: what it changed and/or replied. */
  | { role: "expert"; question: string; model: string; edits?: string[]; reply?: string; callId?: string };

export interface Conversation {
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  document: string;
  turns: Turn[];
  /** Accumulated token usage and cost, split by model role. */
  usage?: { voice?: UsageTotals; expert?: UsageTotals };
}

import type { UsageTotals } from "./usage";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "edit" | "expert";
  text: string;
  /** For expert entries: the question that was handed off. */
  question?: string;
  /** For expert entries: one-line summaries of its document edits. */
  edits?: string[];
  /** For user entries: the passage that was highlighted while speaking. */
  selection?: string;
}

export function conversationTranscript(conversation: Conversation | undefined): TranscriptEntry[] {
  if (!conversation) return [];
  return conversation.turns.map((turn, index): TranscriptEntry => {
    const id = `${conversation.id}:${index}`;
    switch (turn.role) {
      case "user":
        return { id, role: "user", text: turn.text, selection: turn.selection };
      case "assistant":
        return { id, role: "assistant", text: turn.text };
      case "edit":
        return {
          id,
          role: "edit",
          text:
            turn.by === "user"
              ? "You pasted in the document"
              : turn.scope === "selection"
                ? "Edited the highlighted text"
                : "Rewrote the document",
        };
      case "expert":
        return { id, role: "expert", text: turn.reply ?? "", question: turn.question, edits: turn.edits };
    }
  });
}

/**
 * Plain-text rendering of the log, for the expert prompt and for seeding a new
 * Live session. Deterministic per turn so the serialization of a log is always a
 * prefix of the serialization of any longer log.
 */
export function serializeTurns(turns: Turn[]): string {
  return turns.map(serializeTurn).join("");
}

function serializeTurn(turn: Turn): string {
  switch (turn.role) {
    case "user":
      return turn.selection
        ? `User (with highlighted text: «${turn.selection}»): ${turn.text}\n\n`
        : `User: ${turn.text}\n\n`;
    case "assistant":
      return `Vito: ${turn.text}\n\n`;
    case "edit":
      if (turn.by === "user") return `[The user pasted in the document]\n\n`;
      return turn.scope === "selection"
        ? `[Vito replaced the highlighted text «${turn.before ?? ""}» with «${turn.after ?? ""}»]\n\n`
        : `[Vito rewrote the whole document]\n\n`;
    case "expert": {
      let text = turn.question ? `[Handed to expert] ${turn.question}\n` : `[Handed to expert]\n`;
      for (const edit of turn.edits ?? []) text += `[Expert edited the document: ${edit}]\n`;
      if (turn.reply) text += `Expert: ${turn.reply}\n`;
      return text + "\n";
    }
  }
}

/** First line of the first utterance, trimmed to a short title. */
export function titleFromUtterance(utterance: string): string {
  const firstLine = utterance.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 50 ? firstLine.slice(0, 50).trim() + "…" : firstLine;
}
