-- 026_dm_close.sql: Allow users to hide/close DM channels from their list
ALTER TABLE dm_members ADD COLUMN closed_at TIMESTAMPTZ;
