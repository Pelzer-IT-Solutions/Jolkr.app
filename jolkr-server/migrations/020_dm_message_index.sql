-- Add index for faster DM message queries (sorted by created_at DESC)
CREATE INDEX IF NOT EXISTS idx_dm_messages_channel_created ON dm_messages(dm_channel_id, created_at DESC);
