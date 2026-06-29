import type { APIEvent } from "@solidjs/start/server";
import type { ChatMessage } from "~/lib/types";
import { WRITE_DOCUMENT_TOOL } from "~/lib/types";

// Proxies a streaming chat completion to GPT-5.5, keeping the API key server-side.
// The browser POSTs the OAI-shaped message history; we prepend the system prompt,
// attach the write_document tool, and pipe the SSE stream straight back.

const CHAT_MODEL = process.env.VITO_CHAT_MODEL || "gpt-5.5";

const SYSTEM_PROMPT = `You are a concise voice assistant. The user talks to you; their speech is \
transcribed and sent to you as a message. You can either reply with a short text answer, or, when \
the user wants to create or change a written document, call the \`write_document\` tool with the \
COMPLETE new markdown for the document.

- If the user is asking to write, draft, edit, append to, or restructure a document, call \
\`write_document\` with the full updated markdown (not a diff).
- When editing, start from the most recent version you wrote (your previous \`write_document\` calls \
are in the conversation) and return the whole thing with the changes applied.
- Otherwise, just answer in text.`;

const TOOLS = [
  {
    type: "function",
    function: {
      name: WRITE_DOCUMENT_TOOL,
      description: "Create or replace the document with new markdown content.",
      parameters: {
        type: "object",
        properties: {
          markdown: {
            type: "string",
            description: "The complete markdown content of the document.",
          },
        },
        required: ["markdown"],
      },
    },
  },
];

export async function POST(event: APIEvent) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server. Add it to .env." },
      { status: 500 }
    );
  }

  let history: ChatMessage[];
  try {
    const body = (await event.request.json()) as { messages?: ChatMessage[] };
    history = Array.isArray(body.messages) ? body.messages : [];
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  const payload = {
    model: CHAT_MODEL,
    messages: [{ role: "system", content: SYSTEM_PROMPT }, ...history],
    tools: TOOLS,
    stream: true,
    stream_options: { include_usage: true },
  };

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (error) {
    return Response.json(
      { error: `Couldn't reach OpenAI: ${(error as Error).message}` },
      { status: 502 }
    );
  }

  // Non-2xx bodies aren't SSE — forward the error JSON for the client to surface.
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return new Response(text || JSON.stringify({ error: `HTTP ${upstream.status}` }), {
      status: upstream.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Pipe the upstream SSE stream straight to the browser.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
