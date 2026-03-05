-- 003_messages.sql: Messages, Attachments, Reactions, Pins, Threads
-- =========================================================================

-- ── Threads (optional parent for threaded conversations) ───────────────

CREATE TABLE threads (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id      UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    starter_msg_id  UUID,           -- filled in after the first message is created
    name            TEXT,
    is_archived     BOOLEAN NOT NULL DEFAULT false,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_threads_channel ON threads (channel_id);

-- ── Messages ───────────────────────────────────────────────────────────

CREATE TABLE messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id          UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    author_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT,                       -- plaintext (may be NULL for E2EE)
    encrypted_content   BYTEA,                      -- ciphertext blob
    nonce               BYTEA,                      -- encryption nonce / IV
    is_edited           BOOLEAN NOT NULL DEFAULT false,
    is_pinned           BOOLEAN NOT NULL DEFAULT false,
    reply_to_id         UUID REFERENCES messages(id) ON DELETE SET NULL,
    thread_id           UUID REFERENCES threads(id) ON DELETE SET NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_channel    ON messages (channel_id, created_at DESC);
CREATE INDEX idx_messages_author     ON messages (author_id);
CREATE INDEX idx_messages_thread     ON messages (thread_id);

-- Back-fill thread starter reference
ALTER TABLE threads
    ADD CONSTRAINT fk_threads_starter FOREIGN KEY (starter_msg_id) REFERENCES messages(id) ON DELETE SET NULL;

-- ── Attachments ────────────────────────────────────────────────────────

CREATE TABLE attachments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id      UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    url             TEXT NOT NULL,
    encrypted_key   BYTEA,              -- per-attachment encryption key (encrypted for the recipient)
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_message ON attachments (message_id);

-- ── Reactions ──────────────────────────────────────────────────────────

CREATE TABLE reactions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji       TEXT NOT NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (message_id, user_id, emoji)
);

CREATE INDEX idx_reactions_message ON reactions (message_id);

-- ── Pins (denormalized for fast queries) ───────────────────────────────

CREATE TABLE pins (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    message_id  UUID NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
    pinned_by   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (channel_id, message_id)
);

CREATE INDEX idx_pins_channel ON pins (channel_id);
