'use client';

import React, { FC, PropsWithChildren } from 'react';
import { useConversationStore } from '@/stores/conversationStore';
import { TranscriptItem } from '@/app/types';

export type TranscriptContextValue = {
  transcriptItems: TranscriptItem[];
  addTranscriptMessage: (
    itemId: string,
    role: 'user' | 'assistant',
    text: string,
    isHidden?: boolean,
  ) => void;
  updateTranscriptMessage: (
    itemId: string,
    text: string,
    isDelta: boolean,
  ) => void;
  addTranscriptBreadcrumb: (
    title: string,
    data?: Record<string, any>,
  ) => void;
  toggleTranscriptItemExpand: (itemId: string) => void;
  updateTranscriptItem: (
    itemId: string,
    updatedProperties: Partial<TranscriptItem>,
  ) => void;
};

export const TranscriptProvider: FC<PropsWithChildren> = ({ children }) => {
  return <>{children}</>;
};

export function useTranscript(): TranscriptContextValue {
  const transcriptItems = useConversationStore((state) => {
    const conv = state.conversations.find((c) => c.id === state.currentId);
    return conv?.transcriptItems ?? [];
  });
  const addTranscriptMessage = useConversationStore((state) => state.addTranscriptMessage);
  const updateTranscriptMessage = useConversationStore((state) => state.updateTranscriptMessage);
  const addTranscriptBreadcrumb = useConversationStore((state) => state.addTranscriptBreadcrumb);
  const toggleTranscriptItemExpand = useConversationStore((state) => state.toggleTranscriptItemExpand);
  const updateTranscriptItem = useConversationStore((state) => state.updateTranscriptItem);

  return {
    transcriptItems,
    addTranscriptMessage,
    updateTranscriptMessage,
    addTranscriptBreadcrumb,
    toggleTranscriptItemExpand,
    updateTranscriptItem,
  };
}

