import { tool } from "@openai/agents/realtime";
import { documentActions } from "@/stores/documentStore";
import { eventActions } from "@/stores/eventStore";

export const updateDocumentTool = tool({
  name: "updateDocument",
  description:
    "Update the document based on the conversation history. The document is a Markdown file. Regenerate the document from scratch every time.",
  parameters: {
    type: "object",
    properties: {
      newContent: {
        type: "string",
        description:
          "The updated, complete document content in Markdown format.",
      },
    },
    required: ["newContent"],
    additionalProperties: false,
  },
  execute: async (input) => {
    console.log("updateDocument", input);
    eventActions.logServerEvent({ type: "updateDocument", input }, "tool call");
    documentActions.updateDocument((input as any).newContent);
    return { status: "success" };
  },
});
