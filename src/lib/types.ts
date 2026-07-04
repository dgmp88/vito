// Data model, kept in the OpenAI chat-completions shape so the conversation list
// *is* the resumable request payload (load = decode, resume = re-send) and so it
// drops straight into a DB later with no reshaping. Mirrors the native app's
// Conversation / Message / ChatMessage.

export const WRITE_DOCUMENT_TOOL = "write_document";

export type Role = "system" | "user" | "assistant" | "tool";

/** An OpenAI tool call. `arguments` is a JSON *string* per the OpenAI spec. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** One message, mirroring an OpenAI chat-completions message. */
export interface ChatMessage {
  role: Role;
  content: string | null;
  tool_calls?: ToolCall[];
  /** Set on `tool`-role responses, linking back to the originating tool call. */
  tool_call_id?: string;
}

/** A stored chat. `messages` holds the full history minus the system prompt. */
export interface Conversation {
  id: string;
  title: string;
  createdAt: string; // ISO 8601
  updatedAt: string; // ISO 8601
  messages: ChatMessage[];
}

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
}

/**
 * The markdown a `write_document` tool call wrote, or null if `toolCalls`
 * holds no such call. Arguments are a JSON string (OpenAI spec); parse leniently.
 */
export function markdownFromToolCalls(toolCalls: ToolCall[] | undefined): string | null {
  if (!toolCalls) return null;
  for (const call of toolCalls) {
    if (call.function?.name !== WRITE_DOCUMENT_TOOL) continue;
    try {
      const args = JSON.parse(call.function.arguments) as { markdown?: unknown };
      if (typeof args.markdown === "string") return args.markdown;
    } catch {
      // Ignore malformed argument JSON; treat as "no document".
    }
  }
  return null;
}

/**
 * The current document = the markdown from the most recent `write_document`
 * tool call in the history. Empty if the assistant has only replied in text.
 */
export function conversationDocument(conversation: Conversation | undefined): string {
  if (!conversation) return "";
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const message = conversation.messages[i];
    if (message.role !== "assistant") continue;
    const markdown = markdownFromToolCalls(message.tool_calls);
    if (markdown !== null) return markdown;
  }
  return "";
}

/**
 * User utterances and text replies for the transcript pane. A tool-call-only
 * assistant turn becomes a short "updated the document" note; system and tool
 * messages aren't shown.
 */
export function conversationTranscript(conversation: Conversation | undefined): TranscriptEntry[] {
  if (!conversation) return [];
  const entries: TranscriptEntry[] = [];
  conversation.messages.forEach((message, index) => {
    const id = `${conversation.id}:${index}`;
    if (message.role === "user" && message.content) {
      entries.push({ id, role: "user", text: message.content });
    } else if (message.role === "assistant") {
      const text = message.content?.trim();
      if (text) {
        entries.push({ id, role: "assistant", text });
      } else if (markdownFromToolCalls(message.tool_calls) !== null) {
        entries.push({ id, role: "assistant", text: "📝 Updated the document." });
      }
    }
  });
  return entries;
}

/** First line of the first utterance, trimmed to a short title. */
export function titleFromUtterance(utterance: string): string {
  const firstLine = utterance.split(/\r?\n/, 1)[0].trim();
  return firstLine.length > 50 ? firstLine.slice(0, 50).trim() + "…" : firstLine;
}
