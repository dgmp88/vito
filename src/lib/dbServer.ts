// Server functions for conversation persistence in Neon Postgres.
//
// Each call takes the caller's Neon Auth JWT, verifies it to get the user id,
// and scopes every read and write to that user. Server-only modules (db client,
// jose) are imported inside the "use server" bodies so they stay out of the
// client bundle. (messages.ts is pure and shared with the client.)
//
// Writes arrive as a batch of ops from the client's write queue (sync.ts) and
// are applied in order inside one transaction.

import { messagesToTurns, turnToMessages } from "./messages";
import type { Conversation, Turn } from "./types";
import type { UsageTotals } from "./usage";

export type SyncOp =
  | { op: "createConversation"; id: string; title: string; document: string; createdAt: string }
  | { op: "updateConversation"; id: string; title?: string; document?: string }
  /** Insert a turn, or rewrite it if it already exists (same turn id). */
  | { op: "putTurn"; conversationId: string; turn: Turn & { id: string } }
  | { op: "recordUsage"; conversationId: string; kind: "voice" | "expert"; model: string; usage: UsageTotals }
  | { op: "deleteConversation"; id: string };

function conversationIdOf(op: SyncOp): string {
  return op.op === "putTurn" || op.op === "recordUsage" ? op.conversationId : op.id;
}

/** All of the signed-in user's conversations, newest first, with turns and usage totals. */
export async function loadConversations(token: string): Promise<Conversation[]> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getDb } = await import("./db/client");
  const { sql } = await import("kysely");

  const userId = await verifyUser(token);
  const db = getDb();

  const [conversations, messages, usage] = await Promise.all([
    db
      .selectFrom("conversations")
      .select(["id", "title", "document", "created_at", "updated_at"])
      .where("user_id", "=", userId)
      .orderBy("updated_at", "desc")
      .execute(),
    db
      .selectFrom("messages as m")
      .innerJoin("conversations as c", "c.id", "m.conversation_id")
      .select(["m.id", "m.conversation_id", "m.role", "m.content", "m.tool_calls", "m.tool_call_id", "m.metadata"])
      .where("c.user_id", "=", userId)
      .orderBy("m.seq")
      .execute(),
    db
      .selectFrom("usage_events as u")
      .innerJoin("conversations as c", "c.id", "u.conversation_id")
      .select(eb => [
        "u.conversation_id",
        "u.kind",
        sql<number>`sum(u.input_tokens)::float8`.as("input_tokens"),
        sql<number>`sum(u.cached_tokens)::float8`.as("cached_tokens"),
        sql<number>`sum(u.output_tokens)::float8`.as("output_tokens"),
        sql<number>`sum(u.reasoning_tokens)::float8`.as("reasoning_tokens"),
        eb.fn.sum<number>("u.input_cost").as("input_cost"),
        eb.fn.sum<number>("u.cached_cost").as("cached_cost"),
        eb.fn.sum<number>("u.output_cost").as("output_cost"),
        eb.fn.sum<number>("u.reasoning_cost").as("reasoning_cost"),
      ])
      .where("c.user_id", "=", userId)
      .groupBy(["u.conversation_id", "u.kind"])
      .execute(),
  ]);

  const messagesBy = Map.groupBy(messages, m => m.conversation_id);
  const usageBy = Map.groupBy(usage, u => u.conversation_id);

  return conversations.map(c => {
    const totals: Conversation["usage"] = {};
    for (const u of usageBy.get(c.id) ?? []) {
      totals[u.kind] = {
        tokens: { input: u.input_tokens, cached: u.cached_tokens, output: u.output_tokens, reasoning: u.reasoning_tokens },
        cost: { input: u.input_cost, cached: u.cached_cost, output: u.output_cost, reasoning: u.reasoning_cost },
      };
    }
    return {
      id: c.id,
      title: c.title,
      document: c.document,
      createdAt: c.created_at.toISOString(),
      updatedAt: c.updated_at.toISOString(),
      turns: messagesToTurns(messagesBy.get(c.id) ?? []),
      usage: totals,
    };
  });
}

/** Apply a batch of writes, in order, in one transaction. */
export async function applySync(token: string, ops: SyncOp[]): Promise<void> {
  "use server";
  const { verifyUser } = await import("./authServer");
  const { getDb } = await import("./db/client");
  const { sql } = await import("kysely");

  const userId = await verifyUser(token);
  if (ops.length === 0) return;

  await getDb()
    .transaction()
    .execute(async trx => {
      // Which of the referenced conversations this user owns. Ops on anything
      // else (another user's, or one deleted earlier) are skipped.
      const referenced = [...new Set(ops.map(conversationIdOf))];
      const owned = new Set(
        (
          await trx
            .selectFrom("conversations")
            .select("id")
            .where("user_id", "=", userId)
            .where("id", "in", referenced)
            .execute()
        ).map(r => r.id)
      );

      for (const op of ops) {
        if (op.op === "createConversation") {
          const created = await trx
            .insertInto("conversations")
            .values({ id: op.id, user_id: userId, title: op.title, document: op.document, created_at: op.createdAt, updated_at: op.createdAt })
            .onConflict(oc => oc.column("id").doNothing())
            .returning("id")
            .executeTakeFirst();
          if (created) owned.add(op.id);
          continue;
        }

        const conversationId = conversationIdOf(op);
        if (!owned.has(conversationId)) {
          console.warn(`[sync] skipping ${op.op} for unknown conversation ${conversationId}`);
          continue;
        }

        switch (op.op) {
          case "updateConversation": {
            const patch: { title?: string; document?: string } = {};
            if (op.title !== undefined) patch.title = op.title;
            if (op.document !== undefined) patch.document = op.document;
            await trx
              .updateTable("conversations")
              .set({ ...patch, updated_at: sql`now()` })
              .where("id", "=", op.id)
              .execute();
            break;
          }
          case "putTurn": {
            const rows = turnToMessages(op.turn).map(m => ({
              ...m,
              conversation_id: op.conversationId,
              // jsonb params go in as JSON text (pg would send a JS array as a Postgres array).
              tool_calls: m.tool_calls ? JSON.stringify(m.tool_calls) : null,
              metadata: JSON.stringify(m.metadata),
            }));
            await trx
              .insertInto("messages")
              .values(rows)
              .onConflict(oc =>
                oc
                  .column("id")
                  .doUpdateSet(eb => ({
                    content: eb.ref("excluded.content"),
                    tool_calls: eb.ref("excluded.tool_calls"),
                    metadata: eb.ref("excluded.metadata"),
                  }))
                  // Never touch a message that belongs to a different conversation.
                  .where("messages.conversation_id", "=", eb => eb.ref("excluded.conversation_id"))
              )
              .execute();
            await trx
              .updateTable("conversations")
              .set({ updated_at: sql`now()` })
              .where("id", "=", op.conversationId)
              .execute();
            break;
          }
          case "recordUsage": {
            const { tokens, cost } = op.usage;
            await trx
              .insertInto("usage_events")
              .values({
                conversation_id: op.conversationId,
                kind: op.kind,
                model: op.model,
                input_tokens: tokens.input,
                cached_tokens: tokens.cached,
                output_tokens: tokens.output,
                reasoning_tokens: tokens.reasoning,
                input_cost: cost.input,
                cached_cost: cost.cached,
                output_cost: cost.output,
                reasoning_cost: cost.reasoning,
              })
              .execute();
            break;
          }
          case "deleteConversation":
            await trx.deleteFrom("conversations").where("id", "=", op.id).execute();
            owned.delete(op.id);
            break;
        }
      }
    });
}
