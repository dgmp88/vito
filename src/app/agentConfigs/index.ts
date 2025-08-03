import { simpleHandoffScenario } from "./simpleHandoff";

import type { RealtimeAgent } from "@openai/agents/realtime";

// Map of scenario key -> array of RealtimeAgent objects
export const allAgentSets: Record<string, RealtimeAgent[]> = {
  simpleHandoff: simpleHandoffScenario,
};

export const defaultAgentSetKey = "chatSupervisor";
