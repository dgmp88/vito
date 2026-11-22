// Turns ↔ stored messages. The app works with `Turn`s (types.ts); the database
// stores OpenAI chat-completions messages so the log is portable:
//
//   user      → user       { content: text, metadata.selection }
//   assistant → assistant  { content: text }
//   edit      → assistant  { tool_calls: [replace_selection | write_document({ markdown })] }
//               tool       { content: the result Vito returned to the model }
//   paste     → system     { content: "The user pasted in this document: …", metadata.kind = "paste" }
//   expert    → assistant  { tool_calls: [ask_expert({ question })] }
//               tool       { content: { edits_made, reply_shown_to_user }, metadata.model }
//
// Every tool is BLOCKING, so a tool result always directly follows its call.
// A turn's first message reuses the turn id; its tool result gets `<id>:result`.

import type { MessageMetadata, ToolCall } from "./db/json";
import { TOOL_ASK_EXPERT, TOOL_REPLACE_SELECTION, TOOL_WRITE_DOCUMENT } from "./liveConfig";
import type { Turn } from "./types";

export interface StoredMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls: ToolCall[] | null;
  tool_call_id: string | null;
  metadata: MessageMetadata;
}

const PASTE_PREFIX = "The user pasted in this document:\n\n";

export const SELECTION_RESULT = "Replaced the highlighted text. The highlight is now cleared.";
export const DOCUMENT_RESULT = "Document updated.";

/** What ask_expert returns to the voice model (and what we store as its result). */
export interface ExpertOutcome {
  edits_made: string[];
  reply_shown_to_user: string | null;
}

export function expertOutcome(turn: { edits?: string[]; reply?: string }): ExpertOutcome {
  return { edits_made: turn.edits ?? [], reply_shown_to_user: turn.reply || null };
}

function message(id: string, role: StoredMessage["role"], fields: Partial<StoredMessage>): StoredMessage {
  return { id, role, content: null, tool_calls: null, tool_call_id: null, metadata: {}, ...fields };
}

function toolPair(
  id: string,
  callId: string,
  name: string,
  args: unknown,
  result: unknown,
  callMetadata: MessageMetadata = {},
  resultMetadata: MessageMetadata = {}
): StoredMessage[] {
  const call: ToolCall = { id: callId, type: "function", function: { name, arguments: JSON.stringify(args) } };
  return [
    message(id, "assistant", { tool_calls: [call], metadata: callMetadata }),
    message(`${id}:result`, "tool", {
      tool_call_id: callId,
      content: JSON.stringify(result),
      metadata: resultMetadata,
    }),
  ];
}

export function turnToMessages(turn: Turn & { id: string }): StoredMessage[] {
  const { id } = turn;
  switch (turn.role) {
    case "user":
      return [message(id, "user", { content: turn.text, metadata: turn.selection ? { selection: turn.selection } : {} })];
    case "assistant":
      return [message(id, "assistant", { content: turn.text })];
    case "edit":
      if (turn.by === "user") {
        return [message(id, "system", { content: PASTE_PREFIX + (turn.after ?? ""), metadata: { kind: "paste" } })];
      }
      return turn.scope === "selection"
        ? toolPair(
            id,
            turn.callId ?? `call_${id}`,
            TOOL_REPLACE_SELECTION,
            { markdown: turn.after ?? "" },
            { result: SELECTION_RESULT },
            turn.before !== undefined ? { before: turn.before } : {}
          )
        : toolPair(id, turn.callId ?? `call_${id}`, TOOL_WRITE_DOCUMENT, { markdown: turn.after ?? "" }, { result: DOCUMENT_RESULT });
    case "expert":
      return toolPair(
        id,
        turn.callId ?? `call_${id}`,
        TOOL_ASK_EXPERT,
        { question: turn.question },
        expertOutcome(turn),
        {},
        { model: turn.model }
      );
  }
}

function parse<T>(json: string | null): Partial<T> {
  try {
    const value = JSON.parse(json ?? "");
    return value && typeof value === "object" ? (value as Partial<T>) : {};
  } catch {
    return {};
  }
}

export function messagesToTurns(messages: StoredMessage[]): Turn[] {
  const results = new Map<string, StoredMessage>();
  for (const m of messages) if (m.role === "tool" && m.tool_call_id) results.set(m.tool_call_id, m);

  const turns: Turn[] = [];
  for (const m of messages) {
    const { id, metadata } = m;
    if (m.role === "user") {
      turns.push(metadata.selection ? { id, role: "user", text: m.content ?? "", selection: metadata.selection } : { id, role: "user", text: m.content ?? "" });
    } else if (m.role === "system" && metadata.kind === "paste") {
      const content = m.content ?? "";
      const after = content.startsWith(PASTE_PREFIX) ? content.slice(PASTE_PREFIX.length) : content;
      turns.push({ id, role: "edit", by: "user", scope: "document", after });
    } else if (m.role === "assistant" && !m.tool_calls?.length) {
      turns.push({ id, role: "assistant", text: m.content ?? "" });
    } else if (m.role === "assistant") {
      for (const call of m.tool_calls ?? []) {
        const args = parse<{ markdown: string; question: string }>(call.function.arguments);
        const result = results.get(call.id);
        switch (call.function.name) {
          case TOOL_REPLACE_SELECTION:
            turns.push({ id, role: "edit", scope: "selection", before: metadata.before, after: args.markdown, callId: call.id });
            break;
          case TOOL_WRITE_DOCUMENT:
            turns.push({ id, role: "edit", scope: "document", after: args.markdown, callId: call.id });
            break;
          case TOOL_ASK_EXPERT: {
            const outcome = parse<ExpertOutcome>(result?.content ?? null);
            const turn: Turn = { id, role: "expert", question: args.question ?? "", model: result?.metadata.model ?? "", callId: call.id };
            if (outcome.edits_made?.length) turn.edits = outcome.edits_made;
            if (outcome.reply_shown_to_user) turn.reply = outcome.reply_shown_to_user;
            turns.push(turn);
            break;
          }
        }
      }
    }
  }
  return turns;
}
