'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { v4 as uuidv4 } from 'uuid';
import { TranscriptItem } from '@/app/types';

export interface Conversation {
  id: string;
  startedAt: number;
  transcriptItems: TranscriptItem[];
  document: string;
}

interface ConversationState {
  conversations: Conversation[];
  currentId: string | null;
  createConversation: () => void;
  selectConversation: (id: string) => void;
  addTranscriptMessage: (
    itemId: string,
    role: 'user' | 'assistant',
    text: string,
    isHidden?: boolean,
  ) => void;
  updateTranscriptMessage: (
    itemId: string,
    text: string,
    append?: boolean,
  ) => void;
  addTranscriptBreadcrumb: (
    title: string,
    data?: Record<string, any>,
  ) => void;
  toggleTranscriptItemExpand: (itemId: string) => void;
  updateTranscriptItem: (
    itemId: string,
    updated: Partial<TranscriptItem>,
  ) => void;
  updateDocument: (content: string) => void;
  clearDocument: () => void;
}

function newTimestampPretty(): string {
  const now = new Date();
  const time = now.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const ms = now.getMilliseconds().toString().padStart(3, '0');
  return `${time}.${ms}`;
}

const updateCurrent = (
  set: any,
  get: any,
  updater: (conv: Conversation) => Conversation,
) => {
  const { currentId, conversations } = get() as ConversationState;
  if (!currentId) return;
  const idx = conversations.findIndex((c) => c.id === currentId);
  if (idx === -1) return;
  const updated = [...conversations];
  updated[idx] = updater(conversations[idx]);
  set({ conversations: updated });
};

export const useConversationStore = create<ConversationState>()(
  persist(
    (set, get) => ({
      conversations: [],
      currentId: null,
      createConversation: () => {
        const id = uuidv4();
        const startedAt = Date.now();
        set((state: ConversationState) => ({
          conversations: [
            ...state.conversations,
            { id, startedAt, transcriptItems: [], document: '' },
          ],
          currentId: id,
        }));
      },
      selectConversation: (id) => set({ currentId: id }),
      addTranscriptMessage: (itemId, role, text = '', isHidden = false) =>
        updateCurrent(set, get, (conv) => {
          if (conv.transcriptItems.some((l) => l.itemId === itemId)) {
            return conv;
          }
          const newItem: TranscriptItem = {
            itemId,
            type: 'MESSAGE',
            role,
            title: text,
            expanded: false,
            timestamp: newTimestampPretty(),
            createdAtMs: Date.now(),
            status: 'IN_PROGRESS',
            isHidden,
          } as TranscriptItem;
          return {
            ...conv,
            transcriptItems: [...conv.transcriptItems, newItem],
          };
        }),
      updateTranscriptMessage: (itemId, text, append = false) =>
        updateCurrent(set, get, (conv) => ({
          ...conv,
          transcriptItems: conv.transcriptItems.map((i) =>
            i.itemId === itemId && i.type === 'MESSAGE'
              ? { ...i, title: append ? (i.title ?? '') + text : text }
              : i,
          ),
        })),
      addTranscriptBreadcrumb: (title, data) =>
        updateCurrent(set, get, (conv) => ({
          ...conv,
          transcriptItems: [
            ...conv.transcriptItems,
            {
              itemId: `breadcrumb-${uuidv4()}`,
              type: 'BREADCRUMB',
              title,
              data,
              expanded: false,
              timestamp: newTimestampPretty(),
              createdAtMs: Date.now(),
              status: 'DONE',
              isHidden: false,
            },
          ],
        })),
      toggleTranscriptItemExpand: (itemId) =>
        updateCurrent(set, get, (conv) => ({
          ...conv,
          transcriptItems: conv.transcriptItems.map((l) =>
            l.itemId === itemId ? { ...l, expanded: !l.expanded } : l,
          ),
        })),
      updateTranscriptItem: (itemId, updated) =>
        updateCurrent(set, get, (conv) => ({
          ...conv,
          transcriptItems: conv.transcriptItems.map((i) =>
            i.itemId === itemId ? { ...i, ...updated } : i,
          ),
        })),
      updateDocument: (content) =>
        updateCurrent(set, get, (conv) => ({ ...conv, document: content })),
      clearDocument: () =>
        updateCurrent(set, get, (conv) => ({ ...conv, document: '' })),
    }),
    { name: 'conversation-store' },
  ),
);

export const conversationActions = {
  updateDocument: (content: string) =>
    useConversationStore.getState().updateDocument(content),
  getDocument: () => {
    const { conversations, currentId } = useConversationStore.getState();
    const conv = conversations.find((c) => c.id === currentId);
    return conv?.document ?? '';
  },
  createConversation: () => useConversationStore.getState().createConversation(),
  selectConversation: (id: string) =>
    useConversationStore.getState().selectConversation(id),
};

