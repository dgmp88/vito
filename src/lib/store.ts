import { createStore, produce } from "solid-js/store";
import { isServer } from "solid-js/web";
import type { ChatMessage, Conversation } from "./types";
import { markdownFromToolCalls } from "./types";
import { authToken } from "./auth";
import * as remote from "./dbServer";

interface StoreShape {
  conversations: Conversation[];
  /** The chat shown. `null` = a fresh, not-yet-created chat (the "New" state). */
  selectedId: string | null;
}

const [store, setStore] = createStore<StoreShape>({
  conversations: [],
  selectedId: null,
});

export { store };

function uid(): string {
  // crypto.randomUUID exists in browsers and Node 22; this only runs client-side.
  return crypto.randomUUID();
}

// Derived getters. Plain functions (not createMemo) so they need no reactive
// owner at module scope; they stay reactive when read inside a component.

/** Conversations newest-first, for the sidebar. */
export function sortedConversations(): Conversation[] {
  return [...store.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function selectedConversation(): Conversation | undefined {
  return store.conversations.find(c => c.id === store.selectedId);
}

// MARK: - Persistence
//
// Conversations are persisted to Neon Postgres, per user, via the server
// functions in dbServer.ts. Mutations update the in-memory reactive store
// synchronously — the UI stays snappy — and are written through to Neon in the
// background. Without a signed-in user (Neon Auth disabled) there's no backend,
// so conversations live only in memory for the session.

// Remote writes run through a promise chain so they land in program order (a
// conversation is created before its messages are appended). Failures are logged,
// not fatal: the optimistic in-memory state is what the user sees.
let writeChain: Promise<unknown> = Promise.resolve();

function remoteWrite(op: (token: string) => Promise<void>): void {
  writeChain = writeChain
    .then(async () => {
      const token = await authToken();
      if (!token) return; // Not signed in — nothing to scope the write to.
      await op(token);
    })
    .catch(error => console.error("[store] remote write failed:", error));
}

/** Load the signed-in user's conversations from Neon. Call on mount. */
export async function loadConversations(): Promise<void> {
  if (isServer) return;
  try {
    const token = await authToken();
    if (!token) return; // No user — nothing persisted to load.
    setStore("conversations", await remote.fetchConversations(token));
  } catch (error) {
    console.error("[store] failed to load conversations:", error);
  }
}

// MARK: - Conversation management

/** Start a fresh chat. Creation is deferred to the first utterance. */
export function newConversation(): void {
  setStore("selectedId", null);
}

export function selectConversation(id: string): void {
  setStore("selectedId", id);
}

export function deleteConversation(id: string): void {
  setStore(
    produce(s => {
      s.conversations = s.conversations.filter(c => c.id !== id);
      if (s.selectedId === id) s.selectedId = null;
    })
  );
  remoteWrite(token => remote.deleteConversation(token, id));
}

/** Returns the selected conversation, lazily creating one on first speech. */
export function ensureConversation(): Conversation {
  const existing = selectedConversation();
  if (existing) return existing;
  const now = new Date().toISOString();
  const conversation: Conversation = {
    id: uid(),
    title: "",
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
  setStore(
    produce(s => {
      s.conversations.push(conversation);
      s.selectedId = conversation.id;
    })
  );
  remoteWrite(token =>
    remote.createConversation(token, {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
    })
  );
  return conversation;
}

export function appendMessages(conversationId: string, messages: ChatMessage[]): void {
  const updatedAt = new Date().toISOString();
  setStore(
    produce(s => {
      const conversation = s.conversations.find(c => c.id === conversationId);
      if (!conversation) return;
      conversation.messages.push(...messages);
      conversation.updatedAt = updatedAt;
    })
  );
  // If this batch wrote the document, carry its markdown to the documents table.
  let document: string | null = null;
  for (const message of messages) {
    const markdown = markdownFromToolCalls(message.tool_calls);
    if (markdown !== null) document = markdown;
  }
  remoteWrite(token => remote.appendMessages(token, conversationId, messages, updatedAt, document));
}

export function setConversationTitle(conversationId: string, title: string): void {
  setStore(
    produce(s => {
      const conversation = s.conversations.find(c => c.id === conversationId);
      if (conversation) conversation.title = title;
    })
  );
  remoteWrite(token => remote.setConversationTitle(token, conversationId, title));
}
