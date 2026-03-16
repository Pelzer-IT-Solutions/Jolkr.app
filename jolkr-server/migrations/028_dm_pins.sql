-- Add is_pinned flag to dm_messages
ALTER TABLE dm_messages ADD COLUMN is_pinned BOOLEAN NOT NULL DEFAULT false;

-- Separate pins table for DM messages (tracks who pinned and when)
CREATE TABLE dm_pins (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    dm_channel_id UUID NOT NULL REFERENCES dm_channels(id) ON DELETE CASCADE,
    message_id    UUID NOT NULL REFERENCES dm_messages(id) ON DELETE CASCADE,
    pinned_by     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    pinned_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (dm_channel_id, message_id)
);

CREATE INDEX idx_dm_pins_channel ON dm_pins(dm_channel_id);
