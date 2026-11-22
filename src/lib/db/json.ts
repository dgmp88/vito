// Shapes of the jsonb columns. Referenced by the generated schema (schema.ts)
// through .kysely-codegenrc.json overrides.

/** A chat-completions tool call. `arguments` is a JSON string, as in the spec. */
export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

/** Vito-specific message details that have no chat-completions field. */
export interface MessageMetadata {
  /** user: the text highlighted while speaking. */
  selection?: string;
  /** assistant replace_selection call: the highlighted text it replaced. */
  before?: string;
  /** system: what kind of event this note records. */
  kind?: "paste";
  /** tool result of ask_expert: the expert model that answered. */
  model?: string;
}
