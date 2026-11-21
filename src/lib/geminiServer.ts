// Server functions. The Gemini API key never leaves the server:
//   - createLiveSession() mints a single-use ephemeral token with the Live
//     session config (prompt, tools, VAD, transcription) locked in.
//   - streamExpert() runs the expert handoff on Gemini 4 Neon and streams the
//     answer back as NDJSON.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { markSafeError } from "@solidjs/web";
import { expertContents, expertSystemInstruction, type ExpertRequest } from "./expertPrompt";
import { liveSessionConfig } from "./liveConfig";

const LIVE_MODEL = process.env.VITO_LIVE_MODEL || "gemini-3.8-live";
const EXPERT_MODEL = process.env.VITO_EXPERT_MODEL || "gemini-4-neon";
const EXPERT_THINKING = (process.env.VITO_EXPERT_THINKING || "medium").toUpperCase() as ThinkingLevel;

/** One line of the expert stream. */
export type ExpertEvent =
  | { type: "text"; text: string }
  | { type: "done"; model: string; promptTokens?: number; cachedTokens?: number; outputTokens?: number }
  | { type: "error"; message: string };

let client: GoogleGenAI | undefined;
function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw markSafeError(new Error("GEMINI_API_KEY is not set on the server. Add it to .env."));
  }
  client ??= new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  return client;
}

export async function createLiveSession(): Promise<{ token: string; model: string }> {
  "use server";

  const now = Date.now();
  try {
    const token = await gemini().authTokens.create({
      config: {
        uses: 1,
        // Resumption reconnects (every ~10 min) reuse the token until this expires.
        expireTime: new Date(now + 30 * 60_000).toISOString(),
        newSessionExpireTime: new Date(now + 60_000).toISOString(),
        liveConnectConstraints: { model: LIVE_MODEL, config: liveSessionConfig() },
        // Lock only the fields set above; sessionResumption stays client-settable.
        lockAdditionalFields: [],
      },
    });
    if (!token.name) throw new Error("Gemini returned no token.");
    return { token: token.name, model: LIVE_MODEL };
  } catch (error) {
    throw markSafeError(new Error(`Couldn't start a Live session: ${(error as Error).message}`));
  }
}

export async function streamExpert(request: ExpertRequest): Promise<Response> {
  "use server";

  const ai = gemini();
  const encoder = new TextEncoder();
  const line = (event: ExpertEvent) => encoder.encode(JSON.stringify(event) + "\n");

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const stream = await ai.models.generateContentStream({
          model: EXPERT_MODEL,
          contents: expertContents(request),
          config: {
            systemInstruction: expertSystemInstruction(request.document),
            thinkingConfig: { thinkingLevel: EXPERT_THINKING },
          },
        });

        let usage: { promptTokenCount?: number; cachedContentTokenCount?: number; candidatesTokenCount?: number } = {};
        for await (const chunk of stream) {
          if (chunk.usageMetadata) usage = chunk.usageMetadata;
          const text = chunk.text;
          if (text) controller.enqueue(line({ type: "text", text }));
        }

        console.log(
          `[expert] ${EXPERT_MODEL} prompt=${usage.promptTokenCount ?? "?"} ` +
            `cached=${usage.cachedContentTokenCount ?? 0} out=${usage.candidatesTokenCount ?? "?"}`
        );
        controller.enqueue(
          line({
            type: "done",
            model: EXPERT_MODEL,
            promptTokens: usage.promptTokenCount,
            cachedTokens: usage.cachedContentTokenCount,
            outputTokens: usage.candidatesTokenCount,
          })
        );
      } catch (error) {
        controller.enqueue(line({ type: "error", message: (error as Error).message }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-cache" },
  });
}
