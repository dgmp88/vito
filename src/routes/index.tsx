import { onCleanup, onMount } from "solid-js";
import Sidebar from "~/components/Sidebar";
import TranscriptPane from "~/components/TranscriptPane";
import DocumentPane from "~/components/DocumentPane";
import BottomBar from "~/components/BottomBar";
import { loadFromStorage, newConversation, setupPersistence } from "~/lib/store";
import { clearError, isBusy, toggleRecording } from "~/lib/appState";

export default function Home() {
  onMount(() => {
    loadFromStorage();
    setupPersistence();

    const onKeyDown = (e: KeyboardEvent) => {
      // Space toggles recording (preventDefault stops it also activating a focused button).
      if (e.code === "Space" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        toggleRecording();
      } else if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") {
        e.preventDefault();
        if (!isBusy()) {
          newConversation();
          clearError();
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    onCleanup(() => window.removeEventListener("keydown", onKeyDown));
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
