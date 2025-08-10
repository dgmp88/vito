import { Agent } from "@openai/agents";
import { webSearchTool as OAIWebSearchTool } from "@openai/agents";

const webSearchAgent = new Agent({
  model: "gpt-4o-search-preview",
  name: "Web Search",
  instructions:
    "You are a web search agent. You will be given a query and you will need to search the web for the most relevant information. You will then return the most relevant information in a structured format.",

  tools: [OAIWebSearchTool()],
});

export const webSearchTool = webSearchAgent.asTool({
  toolName: "webSearch",
  toolDescription: "Search the web for the most relevant information.",
});
