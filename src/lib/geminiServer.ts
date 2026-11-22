// Server functions. Both require a signed-in user (Neon Auth JWT, verified in
// authServer.ts). The Gemini API key never leaves the server:
//   - createLiveSession() mints a single-use ephemeral token with the Live
//     session config (prompt, tools, VAD, transcription) locked in.
//   - streamExpert() runs the expert handoff (tool-calling loop on Gemini 4 Neon)
//     and streams its edits / reply / usage back as NDJSON.

import { GoogleGenAI, ThinkingLevel } from "@google/genai";
import { markSafeError } from "@solidjs/web";
import { runExpert, type ExpertEvent } from "./expertAgent";
import type { ExpertRequest } from "./expertPrompt";
import { liveSessionConfig } from "./liveConfig";

const LIVE_MODEL = process.env.VITO_LIVE_MODEL || "gemini-3.8-live";
const EXPERT_MODEL = process.env.VITO_EXPERT_MODEL || "gemini-4-neon";
const EXPERT_THINKING = (process.env.VITO_EXPERT_THINKING || "high").toUpperCase() as ThinkingLevel;

let client: GoogleGenAI | undefined;
function gemini(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw markSafeError(new Error("GEMINI_API_KEY is not set on the server. Add it to .env."));
  }
  client ??= new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1beta" } });
  return client;
}

export async function createLiveSession(authToken: string): Promise<{ token: string; model: string }> {
  "use server";
  const { verifyUser } = await import("./authServer");
  await verifyUser(authToken);

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

export async function streamExpert(authToken: string, request: ExpertRequest): Promise<Response> {
  "use server";
  const { verifyUser } = await import("./authServer");
  await verifyUser(authToken);

  const ai = gemini();
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: ExpertEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      try {
        await runExpert(ai, EXPERT_MODEL, EXPERT_THINKING, request, emit);
      } catch (error) {
        emit({ type: "error", message: (error as Error).message });
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
