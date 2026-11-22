import { onSettled } from "solid-js";
import Sidebar from "~/components/Sidebar";
import TranscriptPane from "~/components/TranscriptPane";
import DocumentPane from "~/components/DocumentPane";
import BottomBar from "~/components/BottomBar";
import { loadConversations, newConversation } from "~/lib/store";
import { clearError, isBusy, setupSelectionSync, toggleSession } from "~/lib/appState";
import { clearSelection } from "~/lib/selection";

export default function Home() {
  setupSelectionSync();

  onSettled(() => {
    // Rendered only once signed in (AuthGate), so the session is ready.
    void loadConversations();

    const onKeyDown = (e: KeyboardEvent) => {
      // Space toggles the session (preventDefault stops it also activating a focused button).
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleSession();
      } else if (e.key === "Escape") {
        clearSelection();
        window.getSelection()?.removeAllRanges();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (!isBusy()) {
          newConversation();
          clearError();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  return (
    <main class="app">
      <Sidebar />
      <div class="main">
        <div class="panes">
          <TranscriptPane />
          <DocumentPane />
        </div>
        <BottomBar />
      </div>
    </main>
  );
}
