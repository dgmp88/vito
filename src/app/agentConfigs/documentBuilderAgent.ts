import { RealtimeItem, tool } from "@openai/agents/realtime";
import { documentActions } from "@/stores/documentStore";
import { eventActions } from "@/stores/eventStore";

export const documentBuilderAgentInstructions = `You are an expert document builder agent, tasked with collaborating to create a document for a user. You will be given the full conversation history so far, and you should create or update the document as needed.

# Instructions
- Create a document for the user based on what they're saying in the conversation history. 
- Be faithful to the conversation history, don't make up or infer information.
- Do modify the conversation to make it into a coherent, readable document to share with other people
- Use Markdown formatting as the main output.
- Do not include the transcript in the document, only the document content.


# Current Document:
{{currentDocument}}
  `;

export const documentUpdaterTools = [
  tool({
    type: "function",
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
      eventActions.logServerEvent(
        { type: "updateDocument", input },
        "tool call",
      );
      documentActions.updateDocument(input.newContent);
    },
  }),
  //   {
  //     type: "function",
  //     name: "getUserAccountInfo",
  //     description:
  //       "Tool to get user account information. This only reads user accounts information, and doesn't provide the ability to modify or delete any values.",
  //     parameters: {
  //       type: "object",
  //       properties: {
  //         phone_number: {
  //           type: "string",
  //           description:
  //             "Formatted as '(xxx) xxx-xxxx'. MUST be provided by the user, never a null or empty string.",
  //         },
  //       },
  //       required: ["phone_number"],
  //       additionalProperties: false,
  //     },
  //   },
];

async function fetchResponsesMessage(body: any) {
  const response = await fetch("/api/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    // Preserve the previous behaviour of forcing sequential tool calls.
    body: JSON.stringify({ ...body, parallel_tool_calls: false }),
  });

  if (!response.ok) {
    console.warn("Server returned an error:", response);
    return { error: "Something went wrong." };
  }

  const completion = await response.json();
  return completion;
}

function getToolResponse(fName: string, args: any) {
  switch (fName) {
    case "updateDocument":
      console.log("updateDocument", args);
      eventActions.logServerEvent(
        { type: "updateDocument", args },
        "tool call",
      );
      documentActions.updateDocument(args.newContent);

      return "Document updated";
    default:
      return { result: true };
  }
}

/**
 * Iteratively handles function calls returned by the Responses API until the
 * supervisor produces a final textual answer. Returns that answer as a string.
 */
async function handleToolCalls(
  body: any,
  response: any,
  addBreadcrumb?: (title: string, data?: any) => void,
) {
  let currentResponse = response;

  while (true) {
    if (currentResponse?.error) {
      return { error: "Something went wrong." } as any;
    }

    const outputItems: any[] = currentResponse.output ?? [];

    // Gather all function calls in the output.
    const functionCalls = outputItems.filter(
      (item) => item.type === "function_call",
    );

    if (functionCalls.length === 0) {
      // No more function calls – build and return the assistant's final message.
      const assistantMessages = outputItems.filter(
        (item) => item.type === "message",
      );

      const finalText = assistantMessages
        .map((msg: any) => {
          const contentArr = msg.content ?? [];
          return contentArr
            .filter((c: any) => c.type === "output_text")
            .map((c: any) => c.text)
            .join("");
        })
        .join("\n");

      return finalText;
    }

    // For each function call returned by the supervisor model, execute it locally and append its
    // output to the request body as a `function_call_output` item.
    for (const toolCall of functionCalls) {
      const fName = toolCall.name;
      const args = JSON.parse(toolCall.arguments || "{}");
      const toolRes = getToolResponse(fName, args);

      // Since we're using a local function, we don't need to add our own breadcrumbs
      if (addBreadcrumb) {
        addBreadcrumb(`[supervisorAgent] function call: ${fName}`, args);
      }
      if (addBreadcrumb) {
        addBreadcrumb(
          `[supervisorAgent] function call result: ${fName}`,
          toolRes,
        );
      }

      // Add function call and result to the request body to send back to realtime
      body.input.push(
        {
          type: "function_call",
          call_id: toolCall.call_id,
          name: toolCall.name,
          arguments: toolCall.arguments,
        },
        {
          type: "function_call_output",
          call_id: toolCall.call_id,
          output: JSON.stringify(toolRes),
        },
      );
    }

    // Make the follow-up request including the tool outputs.
    currentResponse = await fetchResponsesMessage(body);
  }
}

export const updateDocumentAgent = tool({
  name: "updateDocument",
  description:
    "Update the document based on the conversation history. The document is a Markdown file.",
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
  execute: async (input, details) => {
    const addBreadcrumb = (details?.context as any)?.addTranscriptBreadcrumb as
      | ((title: string, data?: any) => void)
      | undefined;

    const history: RealtimeItem[] = (details?.context as any)?.history ?? [];
    const filteredLogs = history.filter((log) => log.type === "message");

    const systemContent = documentBuilderAgentInstructions.replace(
      "{{currentDocument}}",
      documentActions.getDocument(),
    );

    const inputMessages = [
      {
        type: "message",
        role: "system",
        content: systemContent,
      },
      {
        type: "message",
        role: "user",
        content: `==== Conversation History ====
          ${JSON.stringify(filteredLogs, null, 2)}
          `,
      },
    ];

    console.log("input", input);

    const body: any = {
      model: "gpt-4.1",
      input: inputMessages,
      tools: documentUpdaterTools,
    };

    const response = await fetchResponsesMessage(body);
    if (response.error) {
      return { error: "Something went wrong." };
    }

    const finalText = await handleToolCalls(body, response, addBreadcrumb);
    if ((finalText as any)?.error) {
      return { error: "Something went wrong." };
    }

    return { nextResponse: finalText as string };
  },
});
