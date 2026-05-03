-- Privacy & Safety user settings.
--
-- `dm_filter` controls who can open a new DM with this user:
--   * 'all'     – anyone (default)
--   * 'friends' – only accepted friends
--   * 'none'    – nobody
-- Once a DM exists, message sending is unaffected; this gates `open_dm`
-- and group-DM creation.
--
-- `allow_friend_requests` gates incoming friend requests. When false,
-- `friendship_send_request` returns BadRequest with a user-facing message.
ALTER TABLE users
    ADD COLUMN dm_filter TEXT NOT NULL DEFAULT 'all'
        CHECK (dm_filter IN ('all', 'friends', 'none')),
    ADD COLUMN allow_friend_requests BOOLEAN NOT NULL DEFAULT true;

COMMENT ON COLUMN users.dm_filter IS 'Privacy: who can start a new DM with this user — all | friends | none';
COMMENT ON COLUMN users.allow_friend_requests IS 'Privacy: whether others can send friend requests to this user';
