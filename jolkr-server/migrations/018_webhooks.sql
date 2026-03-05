-- Webhooks: allow external services to send messages to channels
CREATE TABLE webhooks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
    server_id UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    creator_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(80) NOT NULL,
    avatar_url TEXT,
    token VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX idx_webhooks_token ON webhooks(token);
CREATE INDEX idx_webhooks_channel_id ON webhooks(channel_id);

-- Add webhook_id to messages for tracking which webhook sent it
ALTER TABLE messages ADD COLUMN webhook_id UUID REFERENCES webhooks(id) ON DELETE SET NULL;
