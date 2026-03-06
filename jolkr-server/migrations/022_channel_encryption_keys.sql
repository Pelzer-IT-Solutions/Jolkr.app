-- 022_channel_encryption_keys.sql: Channel/Group E2EE key distribution (Sender Keys)
-- =========================================================================
-- Each channel/DM member receives an encrypted copy of the shared symmetric key.
-- The key is encrypted pairwise using the member's prekey bundle (hybrid PQ E2EE).
-- channel_id can reference either channels.id (server channels) or dm_channels.id (group DMs).

CREATE TABLE channel_encryption_keys (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    channel_id          UUID NOT NULL,  -- references channels.id OR dm_channels.id
    recipient_user_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    -- The shared symmetric key, encrypted for this recipient via their prekey bundle
    encrypted_key       TEXT NOT NULL,   -- base64(version || ephemeral_pub || [pq_ct] || ciphertext)
    nonce               TEXT NOT NULL,   -- base64(12-byte nonce)
    key_generation      INT NOT NULL DEFAULT 0,
    distributor_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Each recipient gets one key per generation
    UNIQUE(channel_id, recipient_user_id, key_generation)
);

CREATE INDEX idx_channel_enc_keys_recipient
    ON channel_encryption_keys (channel_id, recipient_user_id);

-- Track current key generation per channel
ALTER TABLE channels ADD COLUMN e2ee_key_generation INT NOT NULL DEFAULT 0;
