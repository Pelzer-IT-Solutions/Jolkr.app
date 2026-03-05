-- Per-channel and per-server notification settings (mute controls)
CREATE TABLE IF NOT EXISTS notification_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type VARCHAR(10) NOT NULL CHECK (target_type IN ('server', 'channel')),
    target_id UUID NOT NULL,
    muted BOOLEAN NOT NULL DEFAULT FALSE,
    mute_until TIMESTAMPTZ,                    -- NULL = muted indefinitely
    suppress_everyone BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, target_type, target_id)
);

CREATE INDEX idx_notification_settings_user ON notification_settings(user_id);
