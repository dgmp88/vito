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
- **State**: conversations persisted to **Neon Postgres** (per user), in the
  OpenAI chat-completions shape (see [Data model](#data-model)).

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

3. Add your Neon Postgres connection string to `.env` (server-side only — this
   is where conversations are stored; find it in Console → your project →
   Connection Details):

   ```bash
   DATABASE_URL=postgresql://user:password@ep-xxx.aws.neon.build/neondb?sslmode=require
   ```

4. Restart the dev server. The app now shows a sign-in / sign-up screen and a
   sign-out button in the sidebar. Users are synced to the `neon_auth.user`
   table in your Neon database, and each user's conversations, messages, and
   documents are persisted to Postgres (see [Data model](#data-model)).

If `VITE_NEON_AUTH_URL` is unset, the login screen is skipped entirely and the
app runs without login; with no signed-in user there's no persistence backend,
so conversations live only in memory for the session. The URL is a public
endpoint (hence the `VITE_` prefix exposing it to the browser); sessions are
managed client-side by the SDK.

### How persistence is authenticated

The browser gets a short-lived session **JWT** from the Neon Auth SDK and passes
it to each persistence server function in `src/lib/dbServer.ts`. The server
verifies that token's signature against Neon Auth's JWKS
(`<VITE_NEON_AUTH_URL>/.well-known/jwks.json`) and checks the issuer, then reads
the `sub` claim — the id from `neon_auth.user`. Every read and write is scoped to
that user id, so the `DATABASE_URL` and verification key never leave the server.

The schema lives in `migrations/` as timestamped `.sql` files
(`{date}_{time}_{name}.sql`). On first database use the server applies any that
haven't run yet, in filename order, each in its own transaction and recorded in a
`schema_migrations` table — so no separate migration command is needed. To evolve
the schema, add a new file to `migrations/`.

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

### Neon tables

When Neon Auth is enabled, the same `Conversation` records live in three tables,
all carrying the owning `user_id` (from `neon_auth.user`):

- **`conversations`** — `id`, `user_id`, `title`, `created_at`, `updated_at`.
- **`messages`** — one row per `ChatMessage`: `seq` (a `bigserial` giving stable
  order), `conversation_id`, `user_id`, `role`, `content`, `tool_calls` (jsonb),
  `tool_call_id`. Deleting a conversation cascades to its messages.
- **`documents`** — the current markdown per conversation (`conversation_id`
  primary key, `user_id`, `content`, `updated_at`). This is a materialized
  projection of the latest `write_document` call, upserted whenever the document
  changes; the transcript panes still read from `messages`.

Loading decodes rows back into `Conversation[]`; mutations update the in-memory
store immediately and write through to Postgres in the background. Without a
signed-in user there's no backend, so conversations are kept only in memory.

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
    auth.ts                  # Neon Auth client + session signals (sign in/up/out) + JWT
    authServer.ts            # server-side JWT verification (JWKS → user id)
    db.ts                    # Neon Postgres client + migration runner (migrations/*.sql)
    dbServer.ts              # per-user CRUD server functions (conversations/messages/documents)
    types.ts                 # OAI-shaped Conversation/Message + document/transcript derivations
    store.ts                 # reactive store + Neon/localStorage persistence
    appState.ts              # phase orchestration: record → transcribe → respond
    realtime.ts              # WebRTC transcription client (mic → OpenAI → events)
    agent.ts                 # chat SSE consumer (text + write_document accumulation)
  components/
    AuthGate.tsx             # login screen; renders the app once signed in
    Sidebar.tsx  TranscriptPane.tsx  DocumentPane.tsx  BottomBar.tsx
public/logo.svg              # app mark / favicon
```
