import { For, Match, Show, Switch } from "solid-js";
import { newConversation, resetStore, selectConversation, sortedConversations, store } from "~/lib/store";
import { clearError, isBusy } from "~/lib/appState";
import { authUser, signOut } from "~/lib/auth";

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

  const handleSignOut = async () => {
    if (isBusy()) return;
    await signOut();
    resetStore();
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
        <Switch>
          <Match when={store.status === "loading"}>
            <p class="sidebar__empty">Loading…</p>
          </Match>
          <Match when={store.status === "error"}>
            <p class="sidebar__empty">Couldn't load chats: {store.loadError}</p>
          </Match>
          <Match when={sortedConversations().length === 0}>
            <p class="sidebar__empty">No chats yet. Press record to start.</p>
          </Match>
          <Match when={true}>
            <For each={sortedConversations()}>
              {conv => (
                <button
                  class={{
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
          </Match>
        </Switch>
      </div>

      <Show when={authUser()}>
        {user => (
          <div class="sidebar__account">
            <span class="sidebar__user" title={user().email}>
              {user().name || user().email}
            </span>
            <button class="sidebar__signout" onClick={() => void handleSignOut()} disabled={isBusy()}>
              Sign out
            </button>
          </div>
        )}
      </Show>
    </aside>
  );
}
