-- Initial schema: per-user conversations, messages, and documents.
-- All tables carry user_id (the Neon Auth user, from neon_auth.user).

CREATE TABLE IF NOT EXISTS conversations (
  id         text PRIMARY KEY,
  user_id    text NOT NULL,
  title      text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS conversations_user_updated_idx
  ON conversations (user_id, updated_at DESC);

-- Messages in OpenAI chat-completions shape. seq gives a stable per-insert
-- ordering; tool_calls holds the spec JSON (arguments stay a JSON string).
CREATE TABLE IF NOT EXISTS messages (
  seq             bigserial PRIMARY KEY,
  conversation_id text NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  role            text NOT NULL,
  content         text,
  tool_calls      jsonb,
  tool_call_id    text,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS messages_conversation_seq_idx
  ON messages (conversation_id, seq);

-- The current markdown per conversation: a materialized projection of the latest
-- write_document tool call, upserted whenever the document changes.
CREATE TABLE IF NOT EXISTS documents (
  conversation_id text PRIMARY KEY REFERENCES conversations (id) ON DELETE CASCADE,
  user_id         text NOT NULL,
  content         text NOT NULL DEFAULT '',
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS documents_user_idx ON documents (user_id);
