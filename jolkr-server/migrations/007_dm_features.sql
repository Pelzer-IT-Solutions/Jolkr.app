-- 007_dm_features.sql: Add reply, edit, delete, attachments, reactions to DMs
-- =========================================================================

-- ── Reply support ────────────────────────────────────────────────────
ALTER TABLE dm_messages ADD COLUMN IF NOT EXISTS reply_to_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_to ON dm_messages (reply_to_id);

-- ── DM Attachments ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm_attachments (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dm_message_id   UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    filename        TEXT NOT NULL,
    content_type    TEXT NOT NULL,
    size_bytes      BIGINT NOT NULL,
    url             TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dm_attachments_message ON dm_attachments (dm_message_id);

-- ── DM Reactions ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS dm_reactions (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dm_message_id   UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    emoji           TEXT NOT NULL,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dm_message_id, user_id, emoji)
);

CREATE INDEX IF NOT EXISTS idx_dm_reactions_message ON dm_reactions (dm_message_id);
