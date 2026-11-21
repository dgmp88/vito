// The expert handoff loop (server-side). Gemini 4 Neon acts only through tool
// calls (function calling mode ANY): edit_document, write_document, reply.
// Edits are validated against a working copy of the document; if any call
// fails, the errors go back to the model for another round (up to MAX_ROUNDS).
// Each accepted call is emitted as an event as soon as it's validated.

import { FunctionCallingConfigMode, type Content, type GoogleGenAI, type Part, type ThinkingLevel } from "@google/genai";
import { applyEdits, type DocEdit } from "./docEdits";
import {
  EXPERT_TOOLS,
  EXPERT_TOOL_EDIT,
  EXPERT_TOOL_REPLY,
  EXPERT_TOOL_WRITE,
  expertContents,
  expertSystemInstruction,
  type ExpertRequest,
} from "./expertPrompt";
import { addUsage, emptyUsage, generateUsage, type UsageTotals } from "./usage";

const MAX_ROUNDS = 3;

/** One line of the expert stream. */
export type ExpertEvent =
  | { type: "thought"; text: string }
  | { type: "edit"; edits: DocEdit[]; summary: string }
  | { type: "write"; markdown: string; summary: string }
  | { type: "reply"; markdown: string }
  | { type: "done"; model: string; usage: UsageTotals }
  | { type: "error"; message: string };

export async function runExpert(
  ai: GoogleGenAI,
  model: string,
  thinkingLevel: ThinkingLevel,
  request: ExpertRequest,
  emit: (event: ExpertEvent) => void
): Promise<void> {
  const contents: Content[] = expertContents(request);
  let document = request.document;
  let usage = emptyUsage();

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const stream = await ai.models.generateContentStream({
      model,
      contents,
      config: {
        systemInstruction: expertSystemInstruction(request.document),
        tools: [{ functionDeclarations: EXPERT_TOOLS }],
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        thinkingConfig: { thinkingLevel, includeThoughts: true },
      },
    });

    // Keep every part (thought signatures included) to replay the model turn.
    const modelParts: Part[] = [];
    let roundUsage;
    for await (const chunk of stream) {
      if (chunk.usageMetadata) roundUsage = chunk.usageMetadata;
      for (const part of chunk.candidates?.[0]?.content?.parts ?? []) {
        modelParts.push(part);
        if (part.thought && part.text) emit({ type: "thought", text: part.text });
      }
    }
    const thisRound = generateUsage(model, roundUsage);
    usage = addUsage(usage, thisRound);
    console.log(
      `[expert] ${model} round ${round + 1}: in=${thisRound.tokens.input} cached=${thisRound.tokens.cached} ` +
        `out=${thisRound.tokens.output} reasoning=${thisRound.tokens.reasoning}`
    );

    const calls = modelParts.filter(p => p.functionCall).map(p => p.functionCall!);
    if (calls.length === 0) break;

    const responses: Part[] = [];
    let failed = false;
    for (const call of calls) {
      const args = (call.args ?? {}) as Record<string, any>;
      let result: Record<string, unknown>;
      switch (call.name) {
        case EXPERT_TOOL_EDIT: {
          const edits: DocEdit[] = Array.isArray(args.edits)
            ? args.edits.map((e: any) => ({ find: String(e?.find ?? ""), replace: String(e?.replace ?? "") }))
            : [];
          const applied = edits.length ? applyEdits(document, edits) : { ok: false as const, error: "No edits given." };
          if (applied.ok) {
            document = applied.document;
            emit({ type: "edit", edits, summary: String(args.summary ?? "") });
            result = { result: "Edits applied." };
          } else {
            result = { error: applied.error };
          }
          break;
        }
        case EXPERT_TOOL_WRITE: {
          const markdown = String(args.markdown ?? "");
          if (markdown.trim()) {
            document = markdown;
            emit({ type: "write", markdown, summary: String(args.summary ?? "") });
            result = { result: "Document written." };
          } else {
            result = { error: "The markdown was empty." };
          }
          break;
        }
        case EXPERT_TOOL_REPLY: {
          const markdown = String(args.markdown ?? "").trim();
          if (markdown) emit({ type: "reply", markdown });
          result = markdown ? { result: "Shown to the user." } : { error: "The reply was empty." };
          break;
        }
        default:
          result = { error: `Unknown tool ${call.name}.` };
      }
      if ("error" in result) failed = true;
      responses.push({ functionResponse: { id: call.id, name: call.name, response: result } });
    }

    // Every call landed: done. (Mode ANY would force yet another call otherwise.)
    if (!failed) break;
    contents.push({ role: "model", parts: modelParts }, { role: "user", parts: responses });
  }

  emit({ type: "done", model, usage });
}
