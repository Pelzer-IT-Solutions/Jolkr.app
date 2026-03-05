-- 004_dm.sql: Direct message channels and messages
-- =========================================================================

-- ── DM Channels ────────────────────────────────────────────────────────

CREATE TABLE dm_channels (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    is_group    BOOLEAN NOT NULL DEFAULT false,
    name        TEXT,                   -- only used for group DMs
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── DM Members ─────────────────────────────────────────────────────────

CREATE TABLE dm_members (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dm_channel_id   UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dm_channel_id, user_id)
);

CREATE INDEX idx_dm_members_channel ON dm_members (dm_channel_id);
CREATE INDEX idx_dm_members_user    ON dm_members (user_id);

-- ── DM Messages ────────────────────────────────────────────────────────

CREATE TABLE dm_messages (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dm_channel_id       UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    author_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    content             TEXT,
    encrypted_content   BYTEA,
    nonce               BYTEA,
    is_edited           BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_dm_messages_channel ON dm_messages (dm_channel_id, created_at DESC);
CREATE INDEX idx_dm_messages_author  ON dm_messages (author_id);
