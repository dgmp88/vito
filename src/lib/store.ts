import { createEffect, createSignal, createStore, onSettled } from "solid-js";
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

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Conversation[];
    if (Array.isArray(parsed)) {
      setStore(draft => {
        draft.conversations = parsed;
      });
    }
  } catch {
    // Corrupt storage — start fresh rather than crash.
  }
}

/** Restore after hydration, then track changes for autosave. */
export function setupPersistence(): void {
  const [loaded, setLoaded] = createSignal(false);
  onSettled(() => {
    loadFromStorage();
    setLoaded(true);
  });

  createEffect(
    () => loaded() ? JSON.stringify(store.conversations) : undefined,
    snapshot => {
      if (snapshot === undefined) return;
      try {
        localStorage.setItem(STORAGE_KEY, snapshot);
      } catch {
        // Quota or storage failure — non-fatal for a local spike.
      }
    }
  );
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
  setStore(draft => {
    draft.conversations.push(conversation);
    draft.selectedId = conversation.id;
  });
  return conversation;
}

export function appendMessages(conversationId: string, messages: ChatMessage[]): void {
  setStore(draft => {
    const conversation = draft.conversations.find(c => c.id === conversationId);
    if (!conversation) return;
    conversation.messages.push(...messages);
    conversation.updatedAt = new Date().toISOString();
  });
}

export function setConversationTitle(conversationId: string, title: string): void {
  setStore(draft => {
    const conversation = draft.conversations.find(c => c.id === conversationId);
    if (conversation) conversation.title = title;
  });
}
