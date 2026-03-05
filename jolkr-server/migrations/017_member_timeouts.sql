-- Member timeouts: allow moderators to temporarily restrict member actions
ALTER TABLE members ADD COLUMN timeout_until TIMESTAMPTZ DEFAULT NULL;
