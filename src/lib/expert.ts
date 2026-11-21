// Client side of the expert handoff: calls the streamExpert server function and
// consumes its NDJSON stream.

import type { ExpertRequest } from "./expertPrompt";
import { streamExpert, type ExpertEvent } from "./geminiServer";

export interface ExpertResult {
  answer: string;
  model: string;
}

export async function askExpert(
  request: ExpertRequest,
  onText: (answerSoFar: string) => void
): Promise<ExpertResult> {
  const res = await streamExpert(request);
  if (!res.ok || !res.body) {
    throw new Error((await res.text().catch(() => "")) || `Expert request failed (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let answer = "";
  let model = "";

  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw) as ExpertEvent;
    if (event.type === "text") {
      answer += event.text;
      onText(answer);
    } else if (event.type === "done") {
      model = event.model;
    } else if (event.type === "error") {
      throw new Error(event.message);
    }
  };

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    lines.forEach(handle);
  }
  handle(buffer);

  if (!answer.trim()) throw new Error("The expert returned an empty answer.");
  return { answer: answer.trim(), model };
}
