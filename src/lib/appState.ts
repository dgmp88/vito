// The reactive orchestrator. Owns the Live voice session, turns its transcript
// and tool-call events into conversation turns, applies document edits, and runs
// expert handoffs. Conversations themselves live in the persisted store
// (store.ts); this module holds only ephemeral session/UI state.

import { createEffect, createSignal } from "solid-js";
import type { FunctionCall, FunctionResponse } from "@google/genai";
import { applyEdits } from "./docEdits";
import { askExpert } from "./expert";
import { LiveVoiceSession } from "./live";
import { DOCUMENT_RESULT, SELECTION_RESULT, expertOutcome } from "./messages";
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
  recordUsage,
  replaceTurn,
  editDocument,
  selectedConversation,
  setDocument,
  setTitleIfEmpty,
} from "./store";
import { serializeTurns, titleFromUtterance, type Turn } from "./types";
import { liveUsage } from "./usage";

export type Phase = "idle" | "connecting" | "live" | "error";

export interface ExpertJob {
  id: string;
  question: string;
  /** Latest thought-summary heading, for a progress line. */
  thought: string;
  /** Summaries of edits applied so far. */
  edits: string[];
  reply: string;
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
const [expertJobs, setExpertJobs] = createSignal<ExpertJob[]>([]);

export { phase, errorMessage, notice, liveUser, liveAssistant, speaking, expertJobs };

let session: LiveVoiceSession | undefined;
/** The conversation this session writes to (created lazily on the first turn). */
let sessionConversationId: string | null = null;
/** The user turn committed during the current model turn, for late transcripts. */
let currentUserTurn: { index: number; turn: Turn & { role: "user" } } | null = null;
let pendingUser = "";
let pendingAssistant = "";
const cancelledToolCalls = new Set<string>();
let lastSentSelection: string | null = null;
/** Expert calls in flight. A plain counter: Solid 2 signal reads lag writes until flush. */
let activeExpertCalls = 0;
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
      // Handle after Solid has applied the turns just committed (store writes
      // flush on a microtask), so tools like ask_expert read the full log.
      queueMicrotask(() => calls.forEach(handleToolCall));
    },
    onToolCancellation: ids => ids.forEach(id => cancelledToolCalls.add(id)),
    onInterrupted: () => {
      commitUser();
      commitAssistant();
      currentUserTurn = null;
    },
    onTurnComplete: () => {
      commitUser();
      commitAssistant();
      currentUserTurn = null;
    },
    onSpeakingChange: setSpeaking,
    onUsage: (model, meta) => recordUsage(conversationId(), "voice", model, liveUsage(model, meta)),
    onError: message => {
      stopSession();
      fail("Live session error", message);
    },
  });
  session = live;
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
  currentUserTurn = null;
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
  if (currentUserTurn) {
    const turn = { ...currentUserTurn.turn, text: tidy(currentUserTurn.turn.text + text) };
    currentUserTurn = { ...currentUserTurn, turn };
    replaceTurn(conversationId(), currentUserTurn.index, turn);
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
  setTitleIfEmpty(id, titleFromUtterance(text));
  const sel = currentSelection(conversationById(id)?.document ?? "");
  const turn: Turn & { role: "user" } = sel ? { role: "user", text, selection: sel.text } : { role: "user", text };
  currentUserTurn = { index: appendTurn(id, turn), turn };
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
      respond(call, replaceSelection(String(args.markdown ?? ""), call.id));
      break;
    case TOOL_WRITE_DOCUMENT:
      respond(call, writeDocument(String(args.markdown ?? ""), call.id));
      break;
    case TOOL_ASK_EXPERT:
      void runExpert(call, String(args.question ?? ""));
      break;
    default:
      respond(call, { error: `Unknown tool ${call.name}.` });
  }
}

function respond(call: FunctionCall, response: object): void {
  if (!call.id || cancelledToolCalls.has(call.id)) return;
  const reply: FunctionResponse = { id: call.id, name: call.name, response: response as Record<string, unknown> };
  session?.sendToolResponses([reply]);
}

function replaceSelection(markdown: string, callId?: string): Record<string, unknown> {
  const id = conversationId();
  let replaced = null as string | null; // assigned in the setter
  editDocument(id, document => {
    const sel = currentSelection(document);
    if (!sel) return null;
    replaced = sel.text;
    return document.slice(0, sel.start) + markdown + document.slice(sel.end);
  });
  if (replaced === null) {
    return { error: "Nothing is highlighted. Ask the user to highlight text, or use write_document." };
  }
  appendTurn(id, { role: "edit", scope: "selection", before: replaced, after: markdown, callId });
  clearSelection();
  lastSentSelection = null; // the model knows the highlight is gone; no need to tell it
  return { result: SELECTION_RESULT };
}

function writeDocument(markdown: string, callId?: string): Record<string, unknown> {
  if (!markdown.trim()) return { error: "The markdown was empty." };
  const id = conversationId();
  setDocument(id, markdown);
  appendTurn(id, { role: "edit", scope: "document", after: markdown, callId });
  clearSelection();
  lastSentSelection = null;
  return { result: DOCUMENT_RESULT };
}

async function runExpert(call: FunctionCall, question: string): Promise<void> {
  const id = conversationId();
  const conversation = conversationById(id);
  const document = conversation?.document ?? "";
  const jobId = call.id ?? crypto.randomUUID();
  const job: ExpertJob = { id: jobId, question, thought: "", edits: [], reply: "" };
  const update = (patch: Partial<ExpertJob>) => {
    Object.assign(job, patch);
    setExpertJobs(jobs => jobs.map(j => (j.id === jobId ? { ...job, edits: [...job.edits] } : j)));
  };
  setExpertJobs(jobs => [...jobs, { ...job }]);
  const live = session;
  // ask_expert is blocking: mute the mic until it returns, so speech can't
  // interrupt (and cancel) the call or slip turns in before its result.
  activeExpertCalls++;
  live?.setInputPaused(true);
  let model = "";
  /** The document after the expert's latest edit (null until it edits). */
  let edited: string | null = null;

  // Edits are applied to the *current* document (including earlier edits from
  // this same stream chunk), validated again on the client as a safety net.
  const applyToDocument = (next: (current: string) => string | null, summary: string) => {
    const result = editDocument(id, next);
    if (result === null) {
      showNotice(`Couldn't apply an expert edit (the document changed): ${summary}`);
      return;
    }
    edited = result;
    update({ edits: [...job.edits, summary || "Edited the document"] });
  };

  try {
    await askExpert(
      {
        document,
        // Plain copy: store proxies don't serialize across the server-function boundary.
        turns: JSON.parse(JSON.stringify(conversation?.turns ?? [])) as Turn[],
        question,
        selection: currentSelection(document)?.text ?? null,
      },
      event => {
        switch (event.type) {
          case "thought":
            update({ thought: thoughtHeading(event.text) });
            break;
          case "edit":
            applyToDocument(current => {
              const result = applyEdits(current, event.edits);
              return result.ok ? result.document : null;
            }, event.summary);
            break;
          case "write":
            applyToDocument(() => event.markdown, event.summary);
            break;
          case "reply":
            update({ reply: job.reply ? `${job.reply}\n\n${event.markdown}` : event.markdown });
            break;
          case "done":
            model = event.model;
            recordUsage(id, "expert", event.model, event.usage);
            break;
        }
      }
    );
    const turn: Turn = { role: "expert", question, model, callId: call.id };
    if (job.edits.length) turn.edits = [...job.edits];
    if (job.reply) turn.reply = job.reply;
    appendTurn(id, turn);

    // Bring the voice model up to date, then return the outcome (the prompt
    // tells it to confirm briefly rather than read the reply out).
    if (live && live === session) {
      if (edited !== null) live.sendContext([documentContext(edited)]);
      const outcome = expertOutcome(turn);
      if (call.id && !cancelledToolCalls.has(call.id)) {
        respond(call, outcome);
      } else {
        live.sendContext([`[Expert] Finished: ${JSON.stringify(outcome)}`]);
      }
    }
  } catch (error) {
    const message = (error as Error).message;
    showNotice(`Expert failed: ${message}`);
    if (live && live === session) respond(call, { error: message });
  } finally {
    setExpertJobs(jobs => jobs.filter(j => j.id !== jobId));
    activeExpertCalls--;
    if (activeExpertCalls === 0) live?.setInputPaused(false);
  }
}

/** Thought summaries look like "**Heading**\n\nbody"; keep the heading. */
function thoughtHeading(text: string): string {
  const first = text.trim().split("\n")[0] ?? "";
  return first.replace(/^\*\*|\*\*$/g, "").trim();
}

// MARK: - Paste a document

/** True when a pasted document would start the conversation (nothing there yet). */
export function canPasteDocument(): boolean {
  const conversation = selectedConversation();
  return !conversation || (!conversation.document && conversation.turns.length === 0);
}

export function pasteDocument(text: string): void {
  const markdown = text.replace(/\r\n?/g, "\n").trim();
  if (!markdown || !canPasteDocument()) return;
  const id = session ? conversationId() : ensureConversation().id;
  setDocument(id, markdown + "\n");
  appendTurn(id, { role: "edit", by: "user", scope: "document", after: markdown + "\n" });
  setTitleIfEmpty(id, titleFromUtterance(markdown.replace(/^#+\s*/, "")));
  session?.sendContext([documentContext(markdown)]);
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
