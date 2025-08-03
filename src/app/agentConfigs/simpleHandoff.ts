import { RealtimeAgent } from "@openai/agents/realtime";
import { updateDocument } from "./documentBuilderAgent";

export const voiceAgent = new RealtimeAgent({
  name: "voice",
  voice: "shimmer",
  instructions:
    "You're a voice agent helping build a document for a user. The user speaks to you, at the end of every turn call the 'updateDocument' tool to build and update the document.",
  tools: [updateDocument],
});

export const simpleHandoffScenario = [voiceAgent];
