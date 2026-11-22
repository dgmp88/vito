// Initial schema. Conversations belong to a Neon Auth user (neon_auth.user.id,
// the JWT `sub`). Messages are stored in OpenAI chat-completions shape; see
// src/lib/messages.ts for how the app's turns map onto them.

import { sql, type Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable("conversations")
    .addColumn("id", "text", col => col.primaryKey())
    .addColumn("user_id", "text", col => col.notNull())
    .addColumn("title", "text", col => col.notNull().defaultTo(""))
    // The current markdown. Authoritative: replace_selection edits are
    // position-based, so it can't be cheaply rebuilt from the message log.
    .addColumn("document", "text", col => col.notNull().defaultTo(""))
    .addColumn("created_at", "timestamptz", col => col.notNull().defaultTo(sql`now()`))
    .addColumn("updated_at", "timestamptz", col => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("conversations_user_updated_idx")
    .on("conversations")
    .columns(["user_id", "updated_at desc"])
    .execute();

  await db.schema
    .createTable("messages")
    // Client-generated, so rewriting a message (a user utterance whose
    // transcription is still arriving) is an upsert.
    .addColumn("id", "text", col => col.primaryKey())
    .addColumn("conversation_id", "text", col =>
      col.notNull().references("conversations.id").onDelete("cascade")
    )
    // Insertion order. Writes are serialized per client, so this is log order.
    .addColumn("seq", "bigint", col => col.notNull().generatedAlwaysAsIdentity())
    .addColumn("role", "text", col =>
      col.notNull().check(sql`role in ('system', 'user', 'assistant', 'tool')`)
    )
    .addColumn("content", "text")
    // [{ id, type: 'function', function: { name, arguments } }], arguments a JSON string.
    .addColumn("tool_calls", "jsonb")
    .addColumn("tool_call_id", "text")
    // Vito-specific extras that have no chat-completions field: the highlighted
    // text for a user message, the text a replace_selection replaced, etc.
    .addColumn("metadata", "jsonb", col => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn("created_at", "timestamptz", col => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("messages_conversation_seq_idx")
    .on("messages")
    .columns(["conversation_id", "seq"])
    .execute();

  // One row per billed model call. Append-only, so voice and expert usage never
  // race on a shared total; conversation totals are a SUM at load time.
  await db.schema
    .createTable("usage_events")
    .addColumn("id", "bigint", col => col.primaryKey().generatedAlwaysAsIdentity())
    .addColumn("conversation_id", "text", col =>
      col.notNull().references("conversations.id").onDelete("cascade")
    )
    .addColumn("kind", "text", col => col.notNull().check(sql`kind in ('voice', 'expert')`))
    .addColumn("model", "text", col => col.notNull())
    .addColumn("input_tokens", "integer", col => col.notNull())
    .addColumn("cached_tokens", "integer", col => col.notNull())
    .addColumn("output_tokens", "integer", col => col.notNull())
    .addColumn("reasoning_tokens", "integer", col => col.notNull())
    // USD, computed with the model's pricing when the usage was recorded.
    .addColumn("input_cost", "double precision", col => col.notNull())
    .addColumn("cached_cost", "double precision", col => col.notNull())
    .addColumn("output_cost", "double precision", col => col.notNull())
    .addColumn("reasoning_cost", "double precision", col => col.notNull())
    .addColumn("created_at", "timestamptz", col => col.notNull().defaultTo(sql`now()`))
    .execute();

  await db.schema
    .createIndex("usage_events_conversation_idx")
    .on("usage_events")
    .column("conversation_id")
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable("usage_events").execute();
  await db.schema.dropTable("messages").execute();
  await db.schema.dropTable("conversations").execute();
}
