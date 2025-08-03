import { create } from "zustand";
import { v4 as uuidv4 } from "uuid";
import { LoggedEvent } from "@/app/types";

interface EventStore {
  loggedEvents: LoggedEvent[];
  addLoggedEvent: (
    direction: "client" | "server",
    eventName: string,
    eventData: Record<string, any>,
  ) => void;
  toggleExpand: (id: number | string) => void;
}

export const useEventStore = create<EventStore>((set) => ({
  loggedEvents: [],
  addLoggedEvent: (direction, eventName, eventData) => {
    const id = eventData.event_id || uuidv4();
    set((state) => ({
      loggedEvents: [
        ...state.loggedEvents,
        {
          id,
          direction,
          eventName,
          eventData,
          timestamp: new Date().toLocaleTimeString(),
          expanded: false,
        },
      ],
    }));
  },
  toggleExpand: (id) => {
    set((state) => ({
      loggedEvents: state.loggedEvents.map((log) => {
        if (log.id === id) {
          return { ...log, expanded: !log.expanded };
        }
        return log;
      }),
    }));
  },
}));

// Export actions for use outside React components (e.g., in tool calls)
export const eventActions = {
  logClientEvent: (eventObj: Record<string, any>, eventNameSuffix = "") => {
    const name = `${eventObj.type || ""} ${eventNameSuffix || ""}`.trim();

    if (name.endsWith("delta")) {
      return;
    }

    useEventStore.getState().addLoggedEvent("client", name, eventObj);
  },
  logServerEvent: (eventObj: Record<string, any>, eventNameSuffix = "") => {
    const name = `${eventObj.type || ""} ${eventNameSuffix || ""}`.trim();
    useEventStore.getState().addLoggedEvent("server", name, eventObj);
  },
  logHistoryItem: (item: any) => {
    let eventName = item.type;
    if (item.type === "message") {
      eventName = `${item.role}.${item.status}`;
    }
    if (item.type === "function_call") {
      eventName = `function.${item.name}.${item.status}`;
    }
    useEventStore.getState().addLoggedEvent("server", eventName, item);
  },
  toggleExpand: (id: number | string) =>
    useEventStore.getState().toggleExpand(id),
};
