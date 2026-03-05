-- Add missing indexes for reply_to_id columns (used in reply-to IDOR validation)
CREATE INDEX IF NOT EXISTS idx_messages_reply_to_id ON messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_dm_messages_reply_to_id ON dm_messages (reply_to_id) WHERE reply_to_id IS NOT NULL;
