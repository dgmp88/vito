import { onCleanup, onMount } from "solid-js";
import AuthGate from "~/components/AuthGate";
import Sidebar from "~/components/Sidebar";
import TranscriptPane from "~/components/TranscriptPane";
import DocumentPane from "~/components/DocumentPane";
import BottomBar from "~/components/BottomBar";
import { loadSession } from "~/lib/auth";
import { loadFromStorage, newConversation, setupPersistence } from "~/lib/store";
import { clearError, isBusy, toggleRecording } from "~/lib/appState";

export default function Home() {
  onMount(() => void loadSession());

  return (
    <AuthGate>
      <Workspace />
    </AuthGate>
  );
}

function Workspace() {
  onMount(() => {
    loadFromStorage();
    setupPersistence();

    const onKeyDown = (e: KeyboardEvent) => {
      // Ignore shortcuts while typing in a form field.
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;

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
