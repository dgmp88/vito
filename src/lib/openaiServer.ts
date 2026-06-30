import type { ChatMessage } from "./types";
import { WRITE_DOCUMENT_TOOL } from "./types";

const CHAT_MODEL = process.env.VITO_CHAT_MODEL || "gpt-5.5";
const TRANSCRIBE_MODEL = process.env.VITO_TRANSCRIBE_MODEL || "gpt-realtime-whisper";

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

export async function createRealtimeTranscriptionToken(): Promise<{
  value?: string;
  client_secret?: { value?: string };
}> {
  "use server";

  const apiKey = openAIKey();
  const sessionConfig = {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: "en" },
          turn_detection: null,
        },
      },
    },
  };

  let upstream: Response;
  try {
    upstream = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(sessionConfig),
    });
  } catch (error) {
    throw new Error(`Couldn't reach OpenAI: ${(error as Error).message}`);
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    throw new Error(openAIError(text) ?? `Token request failed (HTTP ${upstream.status}).`);
  }

  try {
    return JSON.parse(text) as { value?: string; client_secret?: { value?: string } };
  } catch {
    throw new Error("OpenAI returned an unreadable realtime token response.");
  }
}

export async function streamChatCompletion(history: ChatMessage[]): Promise<Response> {
  "use server";

  const apiKey = openAIKey();
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
    return rawJson(
      { error: `Couldn't reach OpenAI: ${(error as Error).message}` },
      { status: 502 }
    );
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text();
    return rawResponse(text || JSON.stringify({ error: `HTTP ${upstream.status}` }), {
      status: upstream.status || 502,
      headers: { "Content-Type": "application/json" },
    });
  }

  return rawResponse(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}

function openAIKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set on the server. Add it to .env.");
  }
  return apiKey;
}

function rawJson(data: unknown, init: ResponseInit): Response {
  return rawResponse(JSON.stringify(data), {
    ...init,
    headers: withRawHeader(init.headers, { "Content-Type": "application/json" }),
  });
}

function rawResponse(body: BodyInit | null, init: ResponseInit): Response {
  return new Response(body, {
    ...init,
    headers: withRawHeader(init.headers),
  });
}

function withRawHeader(headersInit: HeadersInit | undefined, extra?: Record<string, string>): Headers {
  const headers = new Headers(headersInit);
  headers.set("X-Content-Raw", "true");
  for (const [key, value] of Object.entries(extra ?? {})) {
    headers.set(key, value);
  }
  return headers;
}

function openAIError(text: string): string | null {
  try {
    const json = JSON.parse(text) as { error?: { message?: string } | string };
    if (typeof json.error === "string") return json.error;
    if (json.error?.message) return json.error.message;
  } catch {
    /* not JSON */
  }
  return text || null;
}
