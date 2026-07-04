import { createStore, produce } from "solid-js/store";
import { createEffect } from "solid-js";
import { isServer } from "solid-js/web";
import type { ChatMessage, Conversation } from "./types";

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

// MARK: - Persistence (localStorage). Load once on mount, then autosave on change.

export function loadFromStorage(): void {
  if (isServer) return;
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
  if (isServer) return;
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
  return conversation;
}

export function appendMessages(conversationId: string, messages: ChatMessage[]): void {
  setStore(
    produce(s => {
      const conversation = s.conversations.find(c => c.id === conversationId);
      if (!conversation) return;
      conversation.messages.push(...messages);
      conversation.updatedAt = new Date().toISOString();
    })
  );
}

export function setConversationTitle(conversationId: string, title: string): void {
  setStore(
    produce(s => {
      const conversation = s.conversations.find(c => c.id === conversationId);
      if (conversation) conversation.title = title;
    })
  );
}
