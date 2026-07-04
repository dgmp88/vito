// SolidStart server functions for conversation persistence in Neon Postgres.
//
// Every function takes the caller's Neon Auth JWT, verifies it server-side to
// recover the user id, and scopes all reads/writes to that user. The heavy
// server-only modules (db, authServer) are imported *inside* each `"use server"`
// body so the neon driver and jose stay out of the client bundle; the client
// only ever sees RPC stubs for these exports.

import type { ChatMessage, Conversation } from "./types";

interface ConversationRow {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  conversation_id: string;
  role: string;
  content: string | null;
  tool_calls: unknown;
  tool_call_id: string | null;
}

function iso(value: string): string {
  // Normalize whatever the driver returns for timestamptz into an ISO 8601 string.
  return new Date(value).toISOString();
}

function toMessage(row: MessageRow): ChatMessage {
  const rawCalls = typeof row.tool_calls === "string" ? safeParse(row.tool_calls) : row.tool_calls;
  return {
    role: row.role as ChatMessage["role"],
    content: row.content,
    ...(Array.isArray(rawCalls) && rawCalls.length > 0
      ? { tool_calls: rawCalls as ChatMessage["tool_calls"] }
      : {}),
    ...(row.tool_call_id ? { tool_call_id: row.tool_call_id } : {}),
  };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** All of the signed-in user's conversations, newest-first, with their messages. */
export async function fetchConversations(token: string): Promise<Conversation[]> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getSql, runMigrations } = await import("./db");

  const userId = await verifyUser(token);
  await runMigrations();
  const sql = getSql();

  const convRows = (await sql`
    SELECT id, title, created_at, updated_at
    FROM conversations
    WHERE user_id = ${userId}
    ORDER BY updated_at DESC
  `) as ConversationRow[];

  const msgRows = (await sql`
    SELECT conversation_id, role, content, tool_calls, tool_call_id
    FROM messages
    WHERE user_id = ${userId}
    ORDER BY conversation_id, seq
  `) as MessageRow[];

  const byConversation = new Map<string, ChatMessage[]>();
  for (const row of msgRows) {
    const list = byConversation.get(row.conversation_id) ?? [];
    list.push(toMessage(row));
    byConversation.set(row.conversation_id, list);
  }

  return convRows.map(row => ({
    id: row.id,
    title: row.title,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    messages: byConversation.get(row.id) ?? [],
  }));
}

/** Create an empty conversation. Idempotent — a re-send won't duplicate it. */
export async function createConversation(
  token: string,
  conversation: { id: string; title: string; createdAt: string; updatedAt: string }
): Promise<void> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getSql, runMigrations } = await import("./db");

  const userId = await verifyUser(token);
  await runMigrations();
  const sql = getSql();

  await sql`
    INSERT INTO conversations (id, user_id, title, created_at, updated_at)
    VALUES (${conversation.id}, ${userId}, ${conversation.title}, ${conversation.createdAt}, ${conversation.updatedAt})
    ON CONFLICT (id) DO NOTHING
  `;
}

/**
 * Append messages to a conversation and bump its `updated_at`. When `document`
 * is non-null (the turn wrote the document), the documents projection is upserted
 * too. Message inserts are guarded so they only land if the conversation belongs
 * to this user.
 */
export async function appendMessages(
  token: string,
  conversationId: string,
  messages: ChatMessage[],
  updatedAt: string,
  document: string | null
): Promise<void> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getSql, runMigrations } = await import("./db");

  const userId = await verifyUser(token);
  await runMigrations();
  const sql = getSql();

  for (const message of messages) {
    const toolCalls = message.tool_calls ? JSON.stringify(message.tool_calls) : null;
    await sql`
      INSERT INTO messages (conversation_id, user_id, role, content, tool_calls, tool_call_id)
      SELECT ${conversationId}, ${userId}, ${message.role}, ${message.content ?? null},
             ${toolCalls}::jsonb, ${message.tool_call_id ?? null}
      WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}
      )
    `;
  }

  await sql`
    UPDATE conversations SET updated_at = ${updatedAt}
    WHERE id = ${conversationId} AND user_id = ${userId}
  `;

  if (document !== null) {
    // Guarded like the message insert above: the row is only proposed when the
    // conversation belongs to this user, so ON CONFLICT can never overwrite
    // another user's document row.
    await sql`
      INSERT INTO documents (conversation_id, user_id, content, updated_at)
      SELECT ${conversationId}, ${userId}, ${document}, ${updatedAt}
      WHERE EXISTS (
        SELECT 1 FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}
      )
      ON CONFLICT (conversation_id)
      DO UPDATE SET content = EXCLUDED.content, updated_at = EXCLUDED.updated_at
    `;
  }
}

/** Rename a conversation. */
export async function setConversationTitle(
  token: string,
  conversationId: string,
  title: string
): Promise<void> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getSql, runMigrations } = await import("./db");

  const userId = await verifyUser(token);
  await runMigrations();
  const sql = getSql();

  await sql`
    UPDATE conversations SET title = ${title}
    WHERE id = ${conversationId} AND user_id = ${userId}
  `;
}

/** Delete a conversation; messages and its document cascade away. */
export async function deleteConversation(token: string, conversationId: string): Promise<void> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getSql, runMigrations } = await import("./db");

  const userId = await verifyUser(token);
  await runMigrations();
  const sql = getSql();

  await sql`
    DELETE FROM conversations WHERE id = ${conversationId} AND user_id = ${userId}
  `;
}
