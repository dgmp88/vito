import { RealtimeAgent } from "@openai/agents/realtime";
import {
  documentUpdaterTools,
  updateDocumentAgent,
} from "./documentBuilderAgent";

// Indirect editor
export const voiceAgentIndirect = new RealtimeAgent({
  name: "voice",
  voice: "shimmer",
  instructions:
    "You're a voice agent helping build a document for a user. The user speaks to you, at the end of every turn call the 'updateDocument' tool to build and update the document. Never read the document out loud, only update it. Keep your responses very short - e.g. 'Sure' or 'Got it' and let the updateDocument tool do the work.",
  tools: [updateDocumentAgent],
});

export const voiceAgentDirect = new RealtimeAgent({
  name: "voice",
  voice: "shimmer",
  instructions: `You're a voice agent helping build a document for a user. After the user speaks, call the 'updateDocument' tool to build and update the document. Never read the document out loud, only update it. Only call the updateDocument tool. 
    
# Instructions
- Create a document for the user based on what they're saying in the conversation history. 
- Be faithful to the conversation history, don't make up or infer information unless the user asks you to.
- Do modify the conversation to make it into a coherent, readable document to share with other people
- Use Markdown formatting as the main output.
- Do not include the transcript in the document, only the document content.
- After the user speaks, call the 'updateDocument' tool to build and update the document.
- Respond *only* with very short responses like "OK", "Yes", "Done", "Sure", "Got it", "yep", "uh-huh" etc. Vary your responses but keep them very short.

`,
  tools: documentUpdaterTools,
});

export const voiceAgent = voiceAgentDirect;

export const simpleHandoffScenario = [voiceAgent];
