# Vito (web)

A tiny **voice-in, text/document-out** assistant in the browser. You speak, it
transcribes in real time, and an LLM either replies in text or rewrites a
markdown document in the side pane.

This is a web port of the native macOS spike — same flow, same clean two-pane
aesthetic — built on SolidStart with OpenAI's realtime transcription and GPT-5.5.

## What it does

1. Press **Record** (or hit **Space**), speak, press **Stop**.
2. Realtime ASR (OpenAI `gpt-realtime-whisper` over WebRTC) streams the
   transcript live as you talk.
3. On Stop, the utterance goes to an LLM (`gpt-5.5`) which either:
   - replies in text (shown in the transcript pane), or
   - calls the `write_document` tool to create/replace the markdown document.

## Stack

- **SolidStart** (SolidJS + Vinxi/Nitro), TypeScript
- **ASR**: OpenAI Realtime API, `gpt-realtime-whisper`, browser ↔ OpenAI over
  WebRTC. The mic track is sent directly to OpenAI; transcript events come back
  on a data channel.
- **LLM**: OpenAI `gpt-5.5` via `/chat/completions`, streamed, multi-turn, with
  a `write_document` tool.
- **State**: conversations persisted to **localStorage** in OpenAI
  chat-completions shape (see [Data model](#data-model)).

### Where the API key lives

The OpenAI key is **server-side only** (`OPENAI_API_KEY`). The browser never
sees it. Two SolidStart server functions in `src/lib/openaiServer.ts` use it:

- `createRealtimeTranscriptionToken()` mints a short-lived ephemeral client
  secret for the transcription session. The browser uses that secret (not your
  key) to open the WebRTC connection.
- `streamChatCompletion()` proxies the streaming chat completion, attaching the
  system prompt and `write_document` tool, and pipes the SSE stream back to the
  browser through SolidStart's generated server-function endpoint.

## Running

```bash
npm install

# Set your OpenAI API key (server-side only). Get one at platform.openai.com.
cp .env.example .env
# edit .env and set OPENAI_API_KEY=sk-...

npm run dev          # http://localhost:3000
```

Other scripts: `npm run build` (production build), `npm start` (serve the
build), `npm run typecheck`.

> Microphone access requires a secure context. `localhost` counts as secure, so
> dev works out of the box; if you serve it elsewhere, use HTTPS.

Optional env overrides: `VITO_TRANSCRIBE_MODEL` (default `gpt-realtime-whisper`),
`VITO_CHAT_MODEL` (default `gpt-5.5`).

## Auth (optional)

Email + password login via [Neon Auth](https://neon.com/docs/auth/overview),
using the `@neondatabase/auth` SDK (Better Auth under the hood). To enable it:

1. Create a Neon project and enable **Auth** in the Neon Console.
2. Copy the **Auth Base URL** (Console → your project → Auth) into `.env`:

   ```bash
   VITE_NEON_AUTH_URL=https://ep-xxx.neonauth.us-east-2.aws.neon.build/neondb/auth
   ```

3. Restart the dev server. The app now shows a sign-in / sign-up screen and a
   sign-out button in the sidebar. Users are synced to the `neon_auth.user`
   table in your Neon database.

If `VITE_NEON_AUTH_URL` is unset, the login screen is skipped entirely and the
app behaves as before. The URL is a public endpoint (hence the `VITE_` prefix
exposing it to the browser); sessions are managed client-side by the SDK.
Conversations still live in localStorage — auth gates access to the app but
doesn't (yet) move data server-side.

## Data model

Conversations are stored in the **OpenAI chat-completions shape** so the message
list *is* the resumable request payload (load = decode, resume = re-send) and
drops straight into a database later with no reshaping. See `src/lib/types.ts`:

- `Conversation { id, title, createdAt, updatedAt, messages: ChatMessage[] }`
- `ChatMessage { role, content, tool_calls?, tool_call_id? }` — exactly an
  OpenAI message; tool-call `arguments` are stored as the spec JSON string.
- The **document** is derived as the markdown from the most recent
  `write_document` tool call; the **transcript** is derived from the user/assistant
  messages. Nothing is duplicated — both are projections of `messages`.

Today this lives in `localStorage`; swapping in a DB means persisting the same
`Conversation` records.

## Layout

```
src/
  app.tsx                    # Router root
  app.css                    # all styling (forest-green, macOS-flavored theme)
  entry-client.tsx / entry-server.tsx
  routes/
    index.tsx                # the whole app: sidebar + two panes + bottom bar
  lib/
    openaiServer.ts          # server functions for token minting + chat streaming
    auth.ts                  # Neon Auth client + session signals (sign in/up/out)
    types.ts                 # OAI-shaped Conversation/Message + document/transcript derivations
    store.ts                 # reactive store + localStorage persistence
    appState.ts              # phase orchestration: record → transcribe → respond
    realtime.ts              # WebRTC transcription client (mic → OpenAI → events)
    agent.ts                 # chat SSE consumer (text + write_document accumulation)
  components/
    AuthGate.tsx             # login screen; renders the app once signed in
    Sidebar.tsx  TranscriptPane.tsx  DocumentPane.tsx  BottomBar.tsx
public/logo.svg              # app mark / favicon
```
