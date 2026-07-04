import { For, Show } from "solid-js";
import { newConversation, selectConversation, sortedConversations, store } from "~/lib/store";
import { clearError, isBusy } from "~/lib/appState";

export default function Sidebar() {
  const handleNew = () => {
    if (isBusy()) return;
    newConversation();
    clearError();
  };

  const handleSelect = (id: string) => {
    if (isBusy()) return;
    selectConversation(id);
    clearError();
  };

  return (
    <aside class="sidebar">
      <div class="sidebar__brand">
        <img src="/logo.svg" class="sidebar__logo" alt="" />
        <span class="sidebar__title">Vito</span>
      </div>

      <button class="sidebar__new" onClick={handleNew} disabled={isBusy()}>
        <span>＋</span> New chat
      </button>

      <div class="sidebar__list">
        <Show
          when={sortedConversations().length > 0}
          fallback={<p class="sidebar__empty">No chats yet. Press record to start.</p>}
        >
          <For each={sortedConversations()}>
            {conv => (
              <button
                classList={{
                  "chat-item": true,
                  "chat-item--active": conv.id === store.selectedId,
                }}
                title={conv.title || "New Chat"}
                onClick={() => handleSelect(conv.id)}
              >
                {conv.title || "New Chat"}
              </button>
            )}
          </For>
        </Show>
      </div>
    </aside>
  );
}
