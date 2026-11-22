// Conversations: an in-memory Solid store, loaded from Neon Postgres after
// sign-in. Every mutation updates the store immediately and enqueues the
// matching write (sync.ts), so the UI never waits on the database.
//
// Solid 2 batches writes: a read in the same tick as a write still sees the old
// value (the flush runs on a microtask). So mutators that depend on current
// state (setTitleIfEmpty, editDocument) read it inside the setter, where pending
// writes are visible, rather than callers reading and then writing.

import { createStore } from "solid-js";
import { authToken } from "./auth";
import { loadConversations as fetchConversations } from "./dbServer";
import { clearQueue, enqueue } from "./sync";
import type { Conversation, Turn } from "./types";
import { addUsage, emptyUsage, type UsageTotals } from "./usage";

interface StoreShape {
  conversations: Conversation[];
  /** The chat shown. `null` = a fresh, not-yet-created chat (the "New" state). */
  selectedId: string | null;
  /** "loading" until the user's conversations have arrived. */
  status: "loading" | "ready" | "error";
  loadError: string;
}

const [store, setStore] = createStore<StoreShape>({
  conversations: [],
  selectedId: null,
  status: "loading",
  loadError: "",
});

export { store };

function uid(): string {
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

export function conversationById(id: string): Conversation | undefined {
  return store.conversations.find(c => c.id === id);
}

// MARK: - Loading

/** Load the signed-in user's conversations. Call once after sign-in. */
export async function loadConversations(): Promise<void> {
  setStore(draft => {
    draft.status = "loading";
    draft.loadError = "";
  });
  try {
    const conversations = await fetchConversations(await authToken());
    setStore(draft => {
      draft.conversations = conversations;
      draft.status = "ready";
    });
  } catch (error) {
    setStore(draft => {
      draft.status = "error";
      draft.loadError = (error as Error).message;
    });
  }
}

/** Forget everything (on sign-out). */
export function resetStore(): void {
  clearQueue();
  setStore(draft => {
    draft.conversations = [];
    draft.selectedId = null;
    draft.status = "loading";
    draft.loadError = "";
  });
}

// MARK: - Conversation management

/** Start a fresh chat. Creation is deferred to the first utterance. */
export function newConversation(): void {
  setStore(draft => {
    draft.selectedId = null;
  });
}

export function selectConversation(id: string): void {
  setStore(draft => {
    draft.selectedId = id;
  });
}

export function deleteConversation(id: string): void {
  setStore(draft => {
    draft.conversations = draft.conversations.filter(c => c.id !== id);
    if (draft.selectedId === id) draft.selectedId = null;
  });
  enqueue({ op: "deleteConversation", id });
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
    document: "",
    turns: [],
  };
  setStore(draft => {
    draft.conversations.push(conversation);
    draft.selectedId = conversation.id;
  });
  enqueue({ op: "createConversation", id: conversation.id, title: "", document: "", createdAt: now });
  return conversation;
}

function updateConversation(conversationId: string, update: (conversation: Conversation) => void): void {
  setStore(draft => {
    const conversation = draft.conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    update(conversation);
    conversation.updatedAt = new Date().toISOString();
  });
}

/** Appends a turn and returns its index. */
export function appendTurn(conversationId: string, turn: Turn): number {
  const stored = { ...turn, id: turn.id ?? uid() };
  let index = -1;
  updateConversation(conversationId, conversation => {
    index = conversation.turns.push(stored) - 1;
  });
  if (index >= 0) enqueue({ op: "putTurn", conversationId, turn: stored });
  return index;
}

/** Rewrites a turn in place (keeps its id). */
export function replaceTurn(conversationId: string, index: number, turn: Turn): void {
  let stored: (Turn & { id: string }) | undefined;
  updateConversation(conversationId, conversation => {
    if (index < 0 || index >= conversation.turns.length) return;
    stored = { ...turn, id: conversation.turns[index].id ?? uid() };
    conversation.turns[index] = stored;
  });
  if (stored) enqueue({ op: "putTurn", conversationId, turn: stored });
}

export function setDocument(conversationId: string, document: string): void {
  editDocument(conversationId, () => document);
}

/**
 * Derive the new document from the current one (including writes earlier in
 * this tick). `edit` returns null to leave it unchanged. Returns the new
 * document, or null if nothing changed.
 */
export function editDocument(conversationId: string, edit: (current: string) => string | null): string | null {
  let next = null as string | null; // assigned in the setter
  updateConversation(conversationId, conversation => {
    next = edit(conversation.document);
    if (next !== null) conversation.document = next;
  });
  if (next !== null) enqueue({ op: "updateConversation", id: conversationId, document: next });
  return next;
}

/** Title a conversation unless it already has one. */
export function setTitleIfEmpty(conversationId: string, title: string): void {
  let changed = false as boolean; // assigned in the setter
  setStore(draft => {
    const conversation = draft.conversations.find(c => c.id === conversationId);
    if (conversation && !conversation.title) {
      conversation.title = title;
      changed = true;
    }
  });
  if (changed) enqueue({ op: "updateConversation", id: conversationId, title });
}

export function recordUsage(conversationId: string, kind: "voice" | "expert", model: string, usage: UsageTotals): void {
  updateConversation(conversationId, conversation => {
    conversation.usage ??= {};
    conversation.usage[kind] = addUsage(conversation.usage[kind] ?? emptyUsage(), usage);
  });
  enqueue({ op: "recordUsage", conversationId, kind, model, usage });
}
