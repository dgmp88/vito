import { RealtimeAgent } from "@openai/agents/realtime";
import { updateDocumentTool } from "./documentBuilderAgent";

export const voiceAgent = new RealtimeAgent({
  name: "voice",
  voice: "shimmer",
  instructions:
    "You're a voice agent helping build a document for a user. The user speaks to you, at the end of every turn call the 'updateDocument' tool to build and update the document. Never read the document out loud, only update it. Keep your responses very short - e.g. 'Sure' or 'Got it' and let the updateDocument tool do the work.",
  tools: [updateDocumentTool],
});

export const simpleHandoffScenario = [voiceAgent];
