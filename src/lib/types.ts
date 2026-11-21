// Data model. A conversation is the current markdown `document` plus an
// append-only log of `turns`. The log is what we show in the transcript pane,
// what we seed a fresh Live session with, and what we hand to the expert model.
//
// Turns are treated as immutable once a later turn exists: the expert prompt
// serializes them in order, so keeping the log append-only keeps the prompt
// prefix stable and lets implicit caching hit (see expertServer / geminiServer).

export type Turn =
  /** Something the user said (Live input transcription). */
  | { role: "user"; text: string; selection?: string }
  /** What the Live voice model said back (output transcription). */
  | { role: "assistant"; text: string }
  /** The Live model edited the document via a tool call. */
  | { role: "edit"; scope: "selection" | "document"; before?: string; after?: string }
  /** A question handed off to the expert model, and its text answer. */
  | { role: "expert"; question: string; answer: string; model: string };

export interface Conversation {
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  document: string;
  turns: Turn[];
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant" | "edit" | "expert";
  text: string;
  /** For expert entries: the question that was handed off. */
  question?: string;
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
          text: turn.scope === "selection" ? "Edited the highlighted text" : "Rewrote the document",
        };
      case "expert":
        return { id, role: "expert", text: turn.answer, question: turn.question };
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
      return turn.scope === "selection"
        ? `[Vito replaced the highlighted text «${turn.before ?? ""}» with «${turn.after ?? ""}»]\n\n`
        : `[Vito rewrote the whole document]\n\n`;
    case "expert":
      return `[Handed to expert] ${turn.question}\nExpert: ${turn.answer}\n\n`;
  }
}

/** First line of the first utterance, trimmed to a short title. */
export function titleFromUtterance(utterance: string): string {
  const firstLine = utterance.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 50 ? firstLine.slice(0, 50).trim() + "…" : firstLine;
}

// MARK: - Migration from v1 (OpenAI chat-completions shaped) storage.

interface LegacyMessage {
  role: string;
  content: string | null;
  tool_calls?: { function?: { name?: string; arguments?: string } }[];
}

interface LegacyConversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: LegacyMessage[];
}

export function migrateLegacyConversation(legacy: LegacyConversation): Conversation {
  const turns: Turn[] = [];
  let document = "";
  for (const message of legacy.messages ?? []) {
    if (message.role === "user" && message.content) {
      turns.push({ role: "user", text: message.content });
    } else if (message.role === "assistant") {
      const markdown = legacyMarkdown(message);
      if (markdown !== null) {
        document = markdown;
        turns.push({ role: "edit", scope: "document" });
      } else if (message.content?.trim()) {
        turns.push({ role: "assistant", text: message.content.trim() });
      }
    }
  }
  return {
    id: legacy.id,
    title: legacy.title,
    createdAt: legacy.createdAt,
    updatedAt: legacy.updatedAt,
    document,
    turns,
  };
}

function legacyMarkdown(message: LegacyMessage): string | null {
  for (const call of message.tool_calls ?? []) {
    if (call.function?.name !== "write_document") continue;
    try {
      const args = JSON.parse(call.function.arguments ?? "") as { markdown?: unknown };
      if (typeof args.markdown === "string") return args.markdown;
    } catch {
      /* ignore */
    }
  }
  return null;
}
