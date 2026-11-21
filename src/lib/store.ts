import { createEffect, createSignal, createStore, onSettled } from "solid-js";
import { migrateLegacyConversation, type Conversation, type Turn } from "./types";

const STORAGE_KEY = "vito.conversations.v2";
const LEGACY_STORAGE_KEY = "vito.conversations.v1";

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
    if (raw) {
      const parsed = JSON.parse(raw) as Conversation[];
      if (Array.isArray(parsed)) setConversations(parsed);
      return;
    }
    // One-time migration from the v1 (OpenAI chat-completions shaped) format.
    const legacy = localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacy) {
      const parsed = JSON.parse(legacy);
      if (Array.isArray(parsed)) setConversations(parsed.map(migrateLegacyConversation));
    }
  } catch {
    // Corrupt storage — start fresh rather than crash.
  }
}

function setConversations(conversations: Conversation[]): void {
  setStore(draft => {
    draft.conversations = conversations;
  });
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
    document: "",
    turns: [],
  };
  setStore(draft => {
    draft.conversations.push(conversation);
    draft.selectedId = conversation.id;
  });
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
  let index = -1;
  updateConversation(conversationId, conversation => {
    index = conversation.turns.push(turn) - 1;
  });
  return index;
}

export function replaceTurn(conversationId: string, index: number, turn: Turn): void {
  updateConversation(conversationId, conversation => {
    if (index >= 0 && index < conversation.turns.length) conversation.turns[index] = turn;
  });
}

export function setDocument(conversationId: string, document: string): void {
  updateConversation(conversationId, conversation => {
    conversation.document = document;
  });
}

export function conversationById(id: string): Conversation | undefined {
  return store.conversations.find(c => c.id === id);
}

export function setConversationTitle(conversationId: string, title: string): void {
  setStore(draft => {
    const conversation = draft.conversations.find(c => c.id === conversationId);
    if (conversation) conversation.title = title;
  });
}
