// Server-only. Neon Postgres client plus a lazy, idempotent schema bootstrap.
//
// The connection string lives in `DATABASE_URL` (server secret, never exposed to
// the browser). We use the neon() HTTP driver — no pooling to manage, ideal for
// the per-request server functions in `dbServer.ts`. This module must only ever
// be reached from inside a `"use server"` function (it's imported dynamically
// there) so the driver never lands in the client bundle.

import { neon } from "@neondatabase/serverless";

type Sql = ReturnType<typeof neon>;

let sql: Sql | undefined;

export function getSql(): Sql {
  if (!sql) {
    const url = process.env.DATABASE_URL;
    if (!url) {
      throw new Error("DATABASE_URL is not set on the server. Add it to .env.");
    }
    sql = neon(url);
  }
  return sql;
}

// Run the schema creation once per server process. On failure we clear the cached
// promise so a later request can retry rather than being stuck with a rejection.
let schemaReady: Promise<void> | undefined;

export function ensureSchema(): Promise<void> {
  if (!schemaReady) {
    schemaReady = createSchema().catch(error => {
      schemaReady = undefined;
      throw error;
    });
  }
  return schemaReady;
}

async function createSchema(): Promise<void> {
  const sql = getSql();

  // Conversations: one row per chat, scoped to the Neon Auth user.
  await sql`
    CREATE TABLE IF NOT EXISTS conversations (
      id         text PRIMARY KEY,
      user_id    text NOT NULL,
      title      text NOT NULL DEFAULT '',
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
      ON conversations (user_id, updated_at DESC)
  `;

  // Messages: OpenAI chat-completions shape. `seq` gives a stable per-insert
  // ordering; `tool_calls` holds the spec JSON (arguments stay a JSON string).
  await sql`
    CREATE TABLE IF NOT EXISTS messages (
      seq             bigserial PRIMARY KEY,
      conversation_id text NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
      user_id         text NOT NULL,
      role            text NOT NULL,
      content         text,
      tool_calls      jsonb,
      tool_call_id    text,
      created_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS messages_conversation_seq_idx
      ON messages (conversation_id, seq)
  `;

  // Documents: the current markdown per conversation — a materialized projection
  // of the latest write_document tool call. One row per conversation, upserted.
  await sql`
    CREATE TABLE IF NOT EXISTS documents (
      conversation_id text PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
      user_id         text NOT NULL,
      content         text NOT NULL DEFAULT '',
      updated_at      timestamptz NOT NULL DEFAULT now()
    )
  `;
  await sql`
    CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id)
  `;
}
