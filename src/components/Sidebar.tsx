import { createSignal, For, Match, Show, Switch } from "solid-js";
import { newConversation, resetStore, selectConversation, sortedConversations, store } from "~/lib/store";
import { clearError, isBusy } from "~/lib/appState";
import { authUser, signOut } from "~/lib/auth";

const OPEN_KEY = "vito.sidebarPinned";

// Only rendered after sign-in on the client, so localStorage is available,
// but it can still throw (private mode, blocked storage).
function readOpen(): boolean {
  try {
    return localStorage.getItem(OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

const [sidebarOpen, setSidebarOpen] = createSignal(readOpen());
export { sidebarOpen };

export function toggleSidebar() {
  const next = !sidebarOpen();
  setSidebarOpen(next);
  try {
    localStorage.setItem(OPEN_KEY, next ? "1" : "0");
  } catch {
    // Not persisted; fine.
  }
}

/** The panel icon that opens/closes the sidebar. */
export function SidebarToggle(props: { class?: string }) {
  return (
    <button
      class={`sidebar__icon-btn ${props.class ?? ""}`}
      // Keep a document highlight from being dropped by focus moving to the button.
      onMouseDown={e => e.preventDefault()}
      onClick={toggleSidebar}
      aria-label={sidebarOpen() ? "Close sidebar" : "Open sidebar"}
      aria-expanded={sidebarOpen() ? "true" : "false"}
      title={sidebarOpen() ? "Close sidebar" : "Open sidebar"}
    >
      <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
        <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
        <path d="M7.5 4v12" />
      </svg>
    </button>
  );
}

/** Hidden entirely when closed; the toggle then lives in the transcript header. */
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
    <aside class={{ sidebar: true, "sidebar--open": sidebarOpen() }} inert={!sidebarOpen()}>
      <div class="sidebar__panel">
        <div class="sidebar__brand">
          <SidebarToggle />
          <img src="/logo.svg" class="sidebar__logo" alt="" />
          <span class="sidebar__title">Vito</span>
        </div>

        <button class="sidebar__row" onClick={handleNew} disabled={isBusy()} title="New chat">
          <span class="sidebar__row-icon">
            <svg viewBox="0 0 20 20" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true">
              <path d="M10 4.5v11M4.5 10h11" />
            </svg>
          </span>
          <span class="sidebar__row-label">New chat</span>
        </button>

        <div class="sidebar__section-label">Chats</div>

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
              <span class="sidebar__avatar" aria-hidden="true">
                {(user().name || user().email || "?").trim().charAt(0).toUpperCase()}
              </span>
              <span class="sidebar__user" title={user().email}>
                {user().name || user().email}
              </span>
              <button class="sidebar__signout" onClick={() => void handleSignOut()} disabled={isBusy()}>
                Sign out
              </button>
            </div>
          )}
        </Show>
      </div>
    </aside>
  );
}
