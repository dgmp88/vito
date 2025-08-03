"use client";

import React, { FC, PropsWithChildren } from "react";
import { useEventStore, eventActions } from "@/stores/eventStore";

type EventContextValue = {
  loggedEvents: any[];
  logClientEvent: (eventObj: Record<string, any>, eventNameSuffix?: string) => void;
  logServerEvent: (eventObj: Record<string, any>, eventNameSuffix?: string) => void;
  logHistoryItem: (item: any) => void;
  toggleExpand: (id: number | string) => void;
};

export const EventProvider: FC<PropsWithChildren> = ({ children }) => {
  return <>{children}</>;
};

export function useEvent(): EventContextValue {
  const loggedEvents = useEventStore((state) => state.loggedEvents);
  const toggleExpand = useEventStore((state) => state.toggleExpand);
  
  return {
    loggedEvents,
    logClientEvent: eventActions.logClientEvent,
    logServerEvent: eventActions.logServerEvent,
    logHistoryItem: eventActions.logHistoryItem,
    toggleExpand,
  };
}