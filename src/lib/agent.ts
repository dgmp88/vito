// Sends the conversation history to /api/chat (which proxies GPT-5.5) and consumes
// the streamed SSE response, accumulating the assistant's text reply and any
// `write_document` tool call. Mirrors the native app's DocumentAgent.
//
// Returns the new message(s) to append, in OpenAI shape: an assistant text reply,
// or an assistant tool call plus the required `tool`-role response so the next
// request stays protocol-valid.

import type { ChatMessage, ToolCall } from "./types";
import { WRITE_DOCUMENT_TOOL } from "./types";

export interface AgentProgress {
  /** Accumulated assistant text so far (empty for a tool-only turn). */
  assistantText: string;
  /** Streamed completion tokens (exact once usage arrives, else a chunk count). */
  tokenCount: number;
  /** True once the model starts emitting a `write_document` tool call. */
  isWritingDocument: boolean;
}

interface PartialToolCall {
  id: string;
  name: string;
  args: string;
}

export async function respond(
  history: ChatMessage[],
  onProgress: (progress: AgentProgress) => void
): Promise<ChatMessage[]> {
  const res = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: history }),
  });

  if (!res.ok || !res.body) {
    throw new Error(await extractError(res));
  }

  let assistantText = "";
  let chunkCount = 0;
  let usageTokens: number | undefined;
  const toolCalls = new Map<number, PartialToolCall>();

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are newline-delimited; keep the trailing partial line buffered.
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice("data:".length).trim();
      if (payload === "[DONE]") continue;

      let chunk: any;
      try {
        chunk = JSON.parse(payload);
      } catch {
        continue;
      }

      if (typeof chunk?.usage?.completion_tokens === "number") {
        usageTokens = chunk.usage.completion_tokens;
      }

      const delta = chunk?.choices?.[0]?.delta;
      if (!delta) continue;

      let emitted = false;
      if (typeof delta.content === "string" && delta.content.length > 0) {
        assistantText += delta.content;
        emitted = true;
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const call of delta.tool_calls) {
          const index: number = call.index ?? 0;
          const entry = toolCalls.get(index) ?? { id: "", name: "", args: "" };
          if (call.id) entry.id = call.id;
          if (call.function?.name) entry.name = call.function.name;
          if (typeof call.function?.arguments === "string") {
            entry.args += call.function.arguments;
          }
          toolCalls.set(index, entry);
        }
        emitted = true;
      }

      if (emitted) {
        chunkCount += 1;
        onProgress({
          assistantText,
          tokenCount: usageTokens ?? chunkCount,
          isWritingDocument: toolCalls.size > 0,
        });
      }
    }
  }

  const trimmedText = assistantText.trim();

  // Prefer a write_document tool call if the model made one.
  const docCall = [...toolCalls.values()].find(c => c.name === WRITE_DOCUMENT_TOOL);
  if (docCall) {
    const markdown = parseMarkdown(docCall.args);
    if (markdown === null) {
      throw new Error("The write_document tool call had no readable 'markdown' argument.");
    }
    const callId = docCall.id || "call_0";
    const toolCall: ToolCall = {
      id: callId,
      type: "function",
      // Normalize to a spec-compliant JSON *string* for storage and replay.
      function: { name: WRITE_DOCUMENT_TOOL, arguments: JSON.stringify({ markdown }) },
    };
    const assistant: ChatMessage = {
      role: "assistant",
      content: trimmedText || null,
      tool_calls: [toolCall],
    };
    const toolResult: ChatMessage = {
      role: "tool",
      content: "Document updated.",
      tool_call_id: callId,
    };
    return [assistant, toolResult];
  }

  if (!trimmedText) {
    throw new Error("The response had no tool call and no text content.");
  }
  return [{ role: "assistant", content: trimmedText }];
}

/** Tool-call arguments are a JSON string; pull out `markdown` leniently. */
function parseMarkdown(args: string): string | null {
  try {
    const parsed = JSON.parse(args) as { markdown?: unknown };
    return typeof parsed.markdown === "string" ? parsed.markdown : null;
  } catch {
    return null;
  }
}

async function extractError(res: Response): Promise<string> {
  try {
    const text = await res.text();
    try {
      const json = JSON.parse(text) as { error?: { message?: string } | string };
      if (typeof json.error === "string") return json.error;
      if (json.error?.message) return json.error.message;
    } catch {
      /* not JSON */
    }
    return text || `Request failed (HTTP ${res.status}).`;
  } catch {
    return `Request failed (HTTP ${res.status}).`;
  }
}
