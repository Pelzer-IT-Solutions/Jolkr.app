-- 039_dm_message_hidden.sql: Per-user "hide DM message" support so users
-- can remove a message from their own view without affecting other members.
-- Hard deletion (author-only) continues to use plain DELETE on dm_messages
-- and the FK CASCADE below cleans up any hide-rows for that message.
CREATE TABLE dm_message_hidden_for_user (
    user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    message_id     UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    dm_channel_id  UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, message_id)
);

CREATE INDEX idx_dm_message_hidden_channel_user
    ON dm_message_hidden_for_user (dm_channel_id, user_id);
