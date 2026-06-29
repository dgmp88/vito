import type { APIEvent } from "@solidjs/start/server";

// Mints a short-lived ephemeral client secret for a realtime *transcription*
// session (gpt-realtime-whisper). The browser uses the returned `value` to open
// a WebRTC connection directly to OpenAI — the real API key never leaves the
// server. See src/lib/realtime.ts for the browser side.

const TRANSCRIBE_MODEL = process.env.VITO_TRANSCRIBE_MODEL || "gpt-realtime-whisper";

export async function POST(_event: APIEvent) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return Response.json(
      { error: "OPENAI_API_KEY is not set on the server. Add it to .env." },
      { status: 500 }
    );
  }

  // A transcription-only session: VAD segments the audio so we get a
  // `...transcription.completed` event per utterance plus streaming deltas.
  const sessionConfig = {
    session: {
      type: "transcription",
      audio: {
        input: {
          transcription: { model: TRANSCRIBE_MODEL, language: "en" },
          turn_detection: { type: "server_vad" },
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
    return Response.json(
      { error: `Couldn't reach OpenAI: ${(error as Error).message}` },
      { status: 502 }
    );
  }

  const text = await upstream.text();
  if (!upstream.ok) {
    return new Response(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  }
  // Pass the client-secret payload straight through; the browser reads `.value`.
  return new Response(text, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}
