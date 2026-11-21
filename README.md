# Vito (web)

A tiny **voice-in, text/document-out** assistant in the browser. You talk, a
realtime voice model handles the conversation and makes quick edits to a
markdown document in the side pane, and anything that needs real thought is
handed to a stronger model that edits the document directly or replies in text.

## What it does

1. Press **Record** (or hit **Space**) to open a live session. Talk naturally:
   turns are detected automatically (server-side VAD), and you can interrupt
   Vito mid-sentence. Press **Stop** to end the session.
2. **Highlight text** in the document and say what you want ("make this more
   formal", "is this argument convincing?"). The highlight stays put while you
   speak; **Esc** clears it.
3. The Live model (`gemini-3.8-live`) picks one of:
   - `replace_selection`: a quick rewrite of exactly the highlighted text,
   - `write_document`: a quick change to the whole document,
   - `ask_expert`: hand anything that needs thought (questions, feedback,
     drafting, restructuring) to `gemini-4-neon`,
   - or a few spoken words for chit-chat.
4. Starting a fresh chat? **Paste** (⌘V) a document anywhere to make it the
   conversation's document before you start talking.

Vito speaks only briefly ("Done.", "Let me get that for you."). The footer shows
the conversation's running cost, split into **Voice** and **Expert**. Hover
either one for input, cached, output, and reasoning tokens and cost.

## Stack

- **SolidStart** (Solid 2 + Vite, server functions), TypeScript
- **Voice**: Gemini Live API via `@google/genai`, browser ↔ Google over
  WebSocket. The mic is captured with an AudioWorklet as 16-bit PCM; replies
  come back as 24 kHz PCM plus input and output transcriptions.
- **Expert**: `gemini-4-neon` (thinking level `high`) via
  `generateContentStream`, in tool-only mode. Events stream to the browser as
  NDJSON.
- **State**: conversations persisted to **localStorage** (see
  [Data model](#data-model)).

### Where the API key lives

`GEMINI_API_KEY` is **server-side only**. Two server functions in
`src/lib/geminiServer.ts` use it:

- `createLiveSession()` mints a single-use **ephemeral token** with the whole
  Live config (system prompt, tools, VAD, transcription, context compression)
  locked in via `liveConnectConstraints`. Only `sessionResumption` is left
  unlocked so the client can reconnect with a resume handle.
- `streamExpert()` runs the expert handoff (`src/lib/expertAgent.ts`) and
  streams its edits, reply, and usage back.

### Expert agent

Neon acts **only through tool calls** (function calling mode `ANY`):

- `edit_document({ edits: [{ find, replace }], summary })`: targeted edits;
  each `find` must occur exactly once,
- `write_document({ markdown, summary })`: a full rewrite or a new document,
- `reply({ markdown })`: an answer shown in the transcript.

Edits are validated against a working copy on the server. If any call fails
(e.g. a `find` that doesn't match), the errors go back to the model for another
round, up to 3. The client then re-applies accepted edits to the *current*
document, since the voice model may have changed it in the meantime. When done,
the voice model gets the updated `[Document]` and a `SILENT` tool response
summarizing what happened.

### Prompts

`src/lib/prompts/voice.ts` (Live model) and `src/lib/prompts/expert.ts`
(Neon). Tool schemas live next to their callers: `liveConfig.ts` and
`expertPrompt.ts`.

### Live session details

- **Context injection**: the document, any prior conversation, and the current
  selection are sent as `sendClientContent({ turnComplete: false })` messages
  tagged `[Document]`, `[History]`, and `[Selection]`. They add context without
  triggering a reply. Selection changes are synced (debounced) while live.
- **Tools**: the edit tools are `BLOCKING`, so the model confirms only after the
  edit lands. `ask_expert` is `NON_BLOCKING`: the model keeps talking while Neon
  thinks, and the answer goes back as a `SILENT` tool response, so the model can
  use it in follow-ups without reading it aloud.
- **Long sessions**: sliding-window context compression is on. Connections
  last about 10 minutes; on `goAway` the client reconnects with the latest
  session-resumption handle, reusing the same token.

### Expert prompt and caching

Neon supports only **implicit** caching: prefix match, at least 4,096 tokens,
best-effort. The prompt is laid out so the stable part comes first
(`src/lib/expertPrompt.ts`):

```
systemInstruction: [instructions][document]                  ← changes only on edits
user:              [<conversation> log][</conversation> + handoff request]
                                       ↑ append-only            ↑ varies per call
```

Consecutive handoffs share instructions + document + the log up to the previous
handoff; an edit busts the cache from the document onward. Each handoff logs
`[expert] … in=N cached=M out=… reasoning=…` on the server so hit rates are
visible. In
testing, hits weren't guaranteed even with a shared prefix of 4.7k–9k tokens.

## Running

```bash
npm install

cp .env.example .env
# edit .env and set GEMINI_API_KEY=... (aistudio.google.com)

npm run dev          # http://localhost:3000
```

Other scripts: `npm run build` (production build), `npm start` (serve the
build), `npm run typecheck`.

> Microphone access requires a secure context. `localhost` counts as secure;
> elsewhere, use HTTPS. Use headphones if echo cancellation struggles. Speaker
> bleed can make Vito interrupt itself.

Optional env overrides: `VITO_LIVE_MODEL` (default `gemini-3.8-live`),
`VITO_EXPERT_MODEL` (default `gemini-4-neon`), `VITO_EXPERT_THINKING`
(default `high`; `minimal` / `low` / `medium` / `high` / `xhigh`).

## Cost tracking

`src/lib/usage.ts` holds per-model pricing (USD per 1M tokens, from
ai.google.dev/gemini-api/docs/pricing) and turns usage metadata into four
buckets: input, cached, output, and reasoning.

- **Voice**: the Live API sends one `usageMetadata` per turn whose prompt count
  covers the whole context window, which is what's billed. Audio and text are
  priced separately using the modality breakdown.
- **Expert**: summed across the agent's rounds.

Cost is computed when usage is recorded, using that model's pricing, and
accumulated on the conversation (`usage.voice`, `usage.expert`), so totals stay
right if models or prices change. Update `PRICING` when Google's prices change.

## Data model

See `src/lib/types.ts`:

- `Conversation { id, title, createdAt, updatedAt, document, turns: Turn[] }`
- `Turn` is one of `user` (with the highlighted text, if any), `assistant` (what
  Vito said), `edit` (a voice-model edit, or the user pasting in a document), or
  `expert` (the request, plus edit summaries and/or a reply).
- `usage` holds accumulated tokens and cost for `voice` and `expert`.
- The log is **append-only**. It drives the transcript pane, seeds new Live
  sessions, and is serialized deterministically for the expert prompt, which is
  what keeps that prompt's prefix stable.

v1 conversations (OpenAI chat-completions shape) are migrated on first load.

## Layout

```
src/
  app.tsx  app.css  Document.tsx
  routes/index.tsx           # the whole app: sidebar + two panes + bottom bar
  lib/
    geminiServer.ts          # server functions: Live token minting + expert streaming
    prompts/voice.ts         # Live model system prompt
    prompts/expert.ts        # expert system prompt
    liveConfig.ts            # Live tools, VAD, transcription, context message builders
    expertPrompt.ts          # expert tools + cache-friendly prompt layout
    expertAgent.ts           # expert tool-calling loop (server)
    docEdits.ts              # find/replace edit application
    usage.ts                 # pricing + usage → cost
    live.ts                  # browser Live client (connect, resume, events)
    audio.ts                 # mic capture (AudioWorklet → PCM16) + playback
    expert.ts                # NDJSON consumer for the expert stream
    selection.ts             # highlight → markdown source span mapping
    appState.ts              # orchestration: transcripts → turns, tools, handoffs
    store.ts                 # reactive store + localStorage persistence
    types.ts                 # Conversation / Turn + projections
  components/
    Sidebar.tsx  TranscriptPane.tsx  DocumentPane.tsx  BottomBar.tsx
public/logo.svg
```
