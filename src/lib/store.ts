import { createStore, produce } from "solid-js/store";
import { createEffect } from "solid-js";
import { isServer } from "solid-js/web";
import type { ChatMessage, Conversation } from "./types";
import { markdownFromToolCalls } from "./types";
import { authEnabled, authToken } from "./auth";
import * as remote from "./dbServer";

const STORAGE_KEY = "vito.conversations.v1";

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
// Two backends behind one in-memory reactive store. When Neon Auth is enabled we
// persist to Neon Postgres, per-user, via the server functions in dbServer.ts.
// When it isn't (the no-login dev mode), we fall back to localStorage exactly as
// before. Mutations always update the in-memory store synchronously — the UI
// stays snappy — and the chosen backend is written through in the background.

// Remote writes run through a promise chain so they land in program order (a
// conversation is created before its messages are appended). Failures are logged,
// not fatal: the optimistic in-memory state is what the user sees.
let writeChain: Promise<unknown> = Promise.resolve();

function remoteWrite(op: (token: string) => Promise<void>): void {
  if (!authEnabled) return;
  writeChain = writeChain
    .then(async () => {
      const token = await authToken();
      if (!token) return; // Not signed in — nothing to scope the write to.
      await op(token);
    })
    .catch(error => console.error("[store] remote write failed:", error));
}

/** Load conversations for the current backend. Call on mount. */
export async function loadConversations(): Promise<void> {
  if (isServer) return;
  if (!authEnabled) {
    loadLocal();
    return;
  }
  try {
    const token = await authToken();
    setStore("conversations", token ? await remote.fetchConversations(token) : []);
  } catch (error) {
    console.error("[store] failed to load conversations:", error);
  }
}

function loadLocal(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Conversation[];
    if (Array.isArray(parsed)) setStore("conversations", parsed);
  } catch {
    // Corrupt storage — start fresh rather than crash.
  }
}

/** Wire up autosave. Call inside a component's onMount so the effect has an owner. */
export function setupPersistence(): void {
  if (isServer || authEnabled) return; // Remote mode writes through per-mutation.
  createEffect(() => {
    // Touch the field so the effect tracks it, then serialize.
    const snapshot = store.conversations;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(snapshot));
    } catch {
      // Quota or serialization failure — non-fatal for a local spike.
    }
  });
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
