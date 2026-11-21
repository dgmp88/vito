// Token usage → cost. Pure, shared by server (expert) and client (voice).
//
// Costs are computed when usage is recorded, with the pricing of the model that
// produced it, and stored alongside the token counts, so a conversation's total
// stays correct even if models or prices change later.

import type { GenerateContentResponseUsageMetadata, UsageMetadata } from "@google/genai";

/** USD per 1M tokens. https://ai.google.dev/gemini-api/docs/pricing */
interface Pricing {
  inputText: number;
  inputAudio: number;
  cached: number;
  outputText: number;
  outputAudio: number;
  /** Thinking tokens, billed as (text) output. */
  reasoning: number;
}

const PRICING: Record<string, Pricing> = {
  // Live has no caching discount listed; cached tokens are priced as text input.
  "gemini-3.8-live": { inputText: 0.75, inputAudio: 3.0, cached: 0.75, outputText: 4.5, outputAudio: 12.0, reasoning: 4.5 },
  "gemini-3.8-live-extended-thinking": { inputText: 0.75, inputAudio: 3.0, cached: 0.75, outputText: 4.5, outputAudio: 12.0, reasoning: 4.5 },
  "gemini-4-neon": { inputText: 3.0, inputAudio: 3.0, cached: 0.15, outputText: 15.0, outputAudio: 15.0, reasoning: 15.0 },
};

export interface UsageBuckets {
  input: number;
  cached: number;
  output: number;
  reasoning: number;
}

export interface UsageTotals {
  tokens: UsageBuckets;
  /** USD. */
  cost: UsageBuckets;
}

export function emptyUsage(): UsageTotals {
  return { tokens: zero(), cost: zero() };
}

function zero(): UsageBuckets {
  return { input: 0, cached: 0, output: 0, reasoning: 0 };
}

export function addUsage(a: UsageTotals, b: UsageTotals): UsageTotals {
  return { tokens: sum(a.tokens, b.tokens), cost: sum(a.cost, b.cost) };
}

function sum(a: UsageBuckets, b: UsageBuckets): UsageBuckets {
  return {
    input: a.input + b.input,
    cached: a.cached + b.cached,
    output: a.output + b.output,
    reasoning: a.reasoning + b.reasoning,
  };
}

export function totalCost(usage: UsageTotals | undefined): number {
  if (!usage) return 0;
  const c = usage.cost;
  return c.input + c.cached + c.output + c.reasoning;
}

const modalityCount = (details: { modality?: string; tokenCount?: number }[] | undefined, modality: string) =>
  (details ?? []).filter(d => d.modality === modality).reduce((n, d) => n + (d.tokenCount ?? 0), 0);

/**
 * One Live turn's usage. The Live API sends one usageMetadata per turn whose
 * prompt count covers the whole context window, which is what's billed.
 */
export function liveUsage(model: string, meta: UsageMetadata): UsageTotals {
  const p = PRICING[model];
  const prompt = (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0);
  const cached = meta.cachedContentTokenCount ?? 0;
  const audioIn = Math.min(modalityCount(meta.promptTokensDetails, "AUDIO"), prompt - cached);
  const textIn = Math.max(0, prompt - cached - audioIn);
  const response = meta.responseTokenCount ?? 0;
  const audioOut = modalityCount(meta.responseTokensDetails, "AUDIO");
  const textOut = Math.max(0, response - audioOut);
  const reasoning = meta.thoughtsTokenCount ?? 0;

  return {
    tokens: { input: textIn + audioIn, cached, output: response, reasoning },
    cost: p
      ? {
          input: (textIn * p.inputText + audioIn * p.inputAudio) / 1e6,
          cached: (cached * p.cached) / 1e6,
          output: (textOut * p.outputText + audioOut * p.outputAudio) / 1e6,
          reasoning: (reasoning * p.reasoning) / 1e6,
        }
      : zero(),
  };
}

/** One generateContent call's usage (text in, text out). */
export function generateUsage(model: string, meta: GenerateContentResponseUsageMetadata | undefined): UsageTotals {
  if (!meta) return emptyUsage();
  const p = PRICING[model];
  const cached = meta.cachedContentTokenCount ?? 0;
  const input = Math.max(0, (meta.promptTokenCount ?? 0) + (meta.toolUsePromptTokenCount ?? 0) - cached);
  const output = meta.candidatesTokenCount ?? 0;
  const reasoning = meta.thoughtsTokenCount ?? 0;
  return {
    tokens: { input, cached, output, reasoning },
    cost: p
      ? {
          input: (input * p.inputText) / 1e6,
          cached: (cached * p.cached) / 1e6,
          output: (output * p.outputText) / 1e6,
          reasoning: (reasoning * p.reasoning) / 1e6,
        }
      : zero(),
  };
}

export function formatCost(usd: number): string {
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

export function formatTokens(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString("en-US");
}
