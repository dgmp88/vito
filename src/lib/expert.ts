// Client side of the expert handoff: calls the streamExpert server function and
// dispatches its NDJSON events as they arrive.

import type { ExpertEvent } from "./expertAgent";
import type { ExpertRequest } from "./expertPrompt";
import { streamExpert } from "./geminiServer";

type Handlers = (event: Exclude<ExpertEvent, { type: "error" }>) => void;

export async function askExpert(request: ExpertRequest, onEvent: Handlers): Promise<void> {
  const res = await streamExpert(request);
  if (!res.ok || !res.body) {
    throw new Error((await res.text().catch(() => "")) || `Expert request failed (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (raw: string) => {
    if (!raw.trim()) return;
    const event = JSON.parse(raw) as ExpertEvent;
    if (event.type === "error") throw new Error(event.message);
    onEvent(event);
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
}
