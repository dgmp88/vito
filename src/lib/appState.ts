// The reactive orchestrator. Owns the Live voice session, turns its transcript
// and tool-call events into conversation turns, applies document edits, and runs
// expert handoffs. Conversations themselves live in the persisted store
// (store.ts); this module holds only ephemeral session/UI state.

import { createEffect, createSignal } from "solid-js";
import type { FunctionCall, FunctionResponse } from "@google/genai";
import { FunctionResponseScheduling } from "@google/genai";
import { askExpert } from "./expert";
import { LiveVoiceSession } from "./live";
import {
  TOOL_ASK_EXPERT,
  TOOL_REPLACE_SELECTION,
  TOOL_WRITE_DOCUMENT,
  documentContext,
  historyContext,
  selectionContext,
} from "./liveConfig";
import { clearSelection, currentSelection, selection } from "./selection";
import {
  appendTurn,
  conversationById,
  ensureConversation,
  replaceTurn,
  selectedConversation,
  setConversationTitle,
  setDocument,
} from "./store";
import { serializeTurns, titleFromUtterance, type Turn } from "./types";

export type Phase = "idle" | "connecting" | "live" | "error";

export interface ExpertJob {
  id: string;
  question: string;
  text: string;
}

/** How much prior conversation to replay into a fresh Live session. */
const HISTORY_SEED_CHARS = 20_000;
const SELECTION_SYNC_DEBOUNCE_MS = 250;

const [phase, setPhase] = createSignal<Phase>("idle");
const [errorMessage, setErrorMessage] = createSignal("");
const [notice, setNotice] = createSignal("");
/** The user's in-progress utterance (input transcription not yet committed). */
const [liveUser, setLiveUser] = createSignal("");
/** The model's in-progress spoken reply (output transcription not yet committed). */
const [liveAssistant, setLiveAssistant] = createSignal("");
const [speaking, setSpeaking] = createSignal(false);
const [muted, setMutedSignal] = createSignal(false);
const [expertJobs, setExpertJobs] = createSignal<ExpertJob[]>([]);

export { phase, errorMessage, notice, liveUser, liveAssistant, speaking, muted, expertJobs };

let session: LiveVoiceSession | undefined;
/** The conversation this session writes to (created lazily on the first turn). */
let sessionConversationId: string | null = null;
/** Index of the user turn committed during the current model turn, for late transcripts. */
let currentUserTurn = -1;
let pendingUser = "";
let pendingAssistant = "";
const cancelledToolCalls = new Set<string>();
let lastSentSelection: string | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;

export function isLive(): boolean {
  return phase() === "live";
}

/** True while switching chats would be unsafe (session open or expert running). */
export function isBusy(): boolean {
  return phase() === "connecting" || phase() === "live" || expertJobs().length > 0;
}

export function toggleSession(): void {
  switch (phase()) {
    case "live":
      stopSession();
      break;
    case "idle":
    case "error":
      void startSession();
      break;
    default:
      break;
  }
}

export function toggleMuted(): void {
  const next = !muted();
  setMutedSignal(next);
  session?.setMuted(next);
}

async function startSession(): Promise<void> {
  setErrorMessage("");
  resetTurnState();
  const conversation = selectedConversation();
  sessionConversationId = conversation?.id ?? null;
  const document = conversation?.document ?? "";

  const context = [documentContext(document)];
  const transcript = serializeTurns(conversation?.turns ?? []);
  if (transcript) context.push(historyContext(transcript.slice(-HISTORY_SEED_CHARS)));
  const sel = currentSelection(document);
  context.push(selectionContext(sel?.text ?? null));
  lastSentSelection = sel?.text ?? null;

  const live = new LiveVoiceSession({
    onInputTranscript: handleInputTranscript,
    onOutputTranscript: text => {
      commitUser();
      pendingAssistant += text;
      setLiveAssistant(tidy(pendingAssistant));
    },
    onToolCalls: calls => {
      commitUser();
      commitAssistant();
      for (const call of calls) handleToolCall(call);
    },
    onToolCancellation: ids => ids.forEach(id => cancelledToolCalls.add(id)),
    onInterrupted: () => {
      commitUser();
      commitAssistant();
      currentUserTurn = -1;
    },
    onTurnComplete: () => {
      commitUser();
      commitAssistant();
      currentUserTurn = -1;
    },
    onSpeakingChange: setSpeaking,
    onError: message => {
      stopSession();
      fail("Live session error", message);
    },
  });
  session = live;
  live.setMuted(muted());
  setPhase("connecting");
  try {
    await live.start(context);
    if (session === live) setPhase("live");
  } catch (error) {
    if (session === live) {
      stopSession();
      fail("Couldn't start", (error as Error).message);
    }
  }
}

function stopSession(): void {
  session?.stop();
  session = undefined;
  commitUser();
  commitAssistant();
  resetTurnState();
  setSpeaking(false);
  if (phase() !== "error") setPhase("idle");
}

function resetTurnState(): void {
  currentUserTurn = -1;
  pendingUser = "";
  pendingAssistant = "";
  cancelledToolCalls.clear();
  setLiveUser("");
  setLiveAssistant("");
}

// MARK: - Turns

function conversationId(): string {
  if (!sessionConversationId) sessionConversationId = ensureConversation().id;
  return sessionConversationId;
}

function handleInputTranscript(text: string): void {
  // A late fragment of an utterance we already committed this turn: extend it.
  const conversation = currentUserTurn >= 0 ? conversationById(conversationId()) : undefined;
  const existing = conversation?.turns[currentUserTurn];
  if (existing?.role === "user") {
    replaceTurn(conversation!.id, currentUserTurn, { ...existing, text: tidy(existing.text + text) });
    return;
  }
  pendingUser += text;
  setLiveUser(tidy(pendingUser));
}

function commitUser(): void {
  const text = tidy(pendingUser);
  pendingUser = "";
  setLiveUser("");
  if (!text) return;
  const id = conversationId();
  const conversation = conversationById(id);
  if (conversation && !conversation.title) setConversationTitle(id, titleFromUtterance(text));
  const sel = currentSelection(conversation?.document ?? "");
  const turn: Turn = sel ? { role: "user", text, selection: sel.text } : { role: "user", text };
  currentUserTurn = appendTurn(id, turn);
}

function commitAssistant(): void {
  const text = tidy(pendingAssistant);
  pendingAssistant = "";
  setLiveAssistant("");
  if (text) appendTurn(conversationId(), { role: "assistant", text });
}

// MARK: - Tools

function handleToolCall(call: FunctionCall): void {
  const args = (call.args ?? {}) as Record<string, unknown>;
  switch (call.name) {
    case TOOL_REPLACE_SELECTION:
      respond(call, replaceSelection(String(args.markdown ?? "")));
      break;
    case TOOL_WRITE_DOCUMENT:
      respond(call, writeDocument(String(args.markdown ?? "")));
      break;
    case TOOL_ASK_EXPERT:
      void runExpert(call, String(args.question ?? ""));
      break;
    default:
      respond(call, { error: `Unknown tool ${call.name}.` });
  }
}

function respond(call: FunctionCall, response: Record<string, unknown>, scheduling?: FunctionResponseScheduling): void {
  if (!call.id || cancelledToolCalls.has(call.id)) return;
  const reply: FunctionResponse = { id: call.id, name: call.name, response };
  if (scheduling) reply.scheduling = scheduling;
  session?.sendToolResponses([reply]);
}

function replaceSelection(markdown: string): Record<string, unknown> {
  const id = conversationId();
  const document = conversationById(id)?.document ?? "";
  const sel = currentSelection(document);
  if (!sel) {
    return { error: "Nothing is highlighted. Ask the user to highlight text, or use write_document." };
  }
  setDocument(id, document.slice(0, sel.start) + markdown + document.slice(sel.end));
  appendTurn(id, { role: "edit", scope: "selection", before: sel.text, after: markdown });
  clearSelection();
  lastSentSelection = null; // the model knows the highlight is gone; no need to tell it
  return { result: "Replaced the highlighted text. The highlight is now cleared." };
}

function writeDocument(markdown: string): Record<string, unknown> {
  if (!markdown.trim()) return { error: "The markdown was empty." };
  const id = conversationId();
  setDocument(id, markdown);
  appendTurn(id, { role: "edit", scope: "document" });
  clearSelection();
  lastSentSelection = null;
  return { result: "Document updated." };
}

async function runExpert(call: FunctionCall, question: string): Promise<void> {
  const id = conversationId();
  const conversation = conversationById(id);
  const document = conversation?.document ?? "";
  const jobId = call.id ?? crypto.randomUUID();
  setExpertJobs(jobs => [...jobs, { id: jobId, question, text: "" }]);
  const live = session;

  try {
    const result = await askExpert(
      {
        document,
        // Plain copy: store proxies don't serialize across the server-function boundary.
        turns: JSON.parse(JSON.stringify(conversation?.turns ?? [])) as Turn[],
        question,
        selection: currentSelection(document)?.text ?? null,
      },
      text => setExpertJobs(jobs => jobs.map(job => (job.id === jobId ? { ...job, text } : job))),
    );
    appendTurn(id, { role: "expert", question, answer: result.answer, model: result.model });
    // Give the voice model the answer for follow-ups, without having it read it out.
    if (live && live === session) {
      if (call.id && !cancelledToolCalls.has(call.id)) {
        respond(call, { answer_shown_to_user: result.answer }, FunctionResponseScheduling.SILENT);
      } else {
        live.sendContext([`[Expert] This answer is now shown to the user:\n${result.answer}`]);
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    showNotice(`Expert failed: ${message}`);
    if (live && live === session) respond(call, { error: message });
  } finally {
    setExpertJobs(jobs => jobs.filter(job => job.id !== jobId));
  }
}

// MARK: - Selection → Live context

/** Keeps the Live model informed of what's highlighted. Call once from a component. */
export function setupSelectionSync(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  createEffect(
    () => selection()?.text ?? null,
    text => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!session || phase() !== "live" || text === lastSentSelection) return;
        lastSentSelection = text;
        session.sendContext([selectionContext(text)]);
      }, SELECTION_SYNC_DEBOUNCE_MS);
    }
  );
}

// MARK: - Errors / notices

function fail(context: string, message: string): void {
  setErrorMessage(`${context}: ${message}`);
  setPhase("error");
}

function showNotice(message: string): void {
  clearTimeout(noticeTimer);
  setNotice(message);
  noticeTimer = setTimeout(() => setNotice(""), 6000);
}

/** Clears a stuck error back to idle (e.g. when the user switches chats). */
export function clearError(): void {
  if (phase() === "error") {
    setPhase("idle");
    setErrorMessage("");
  }
}

/** Collapse whitespace from concatenated transcription fragments. */
function tidy(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
