-- DM read receipts: track last read message per user per DM channel
ALTER TABLE dm_members ADD COLUMN last_read_message_id UUID REFERENCES dm_messages(id) ON DELETE SET NULL;

-- Privacy setting: allow users to hide read receipts
ALTER TABLE users ADD COLUMN show_read_receipts BOOLEAN NOT NULL DEFAULT true;
