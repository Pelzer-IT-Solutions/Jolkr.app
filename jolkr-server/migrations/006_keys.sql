-- 006_keys.sql: E2EE key storage (X3DH style)
-- =========================================================================

CREATE TABLE user_keys (
    id                          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id                     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id                   UUID NOT NULL REFERENCES devices(id) ON DELETE CASCADE,
    identity_key                BYTEA NOT NULL,
    signed_prekey               BYTEA NOT NULL,
    signed_prekey_signature     BYTEA NOT NULL,
    one_time_prekey             BYTEA,              -- NULL for the "base" row, populated for OTPKs
    is_used                     BOOLEAN NOT NULL DEFAULT false,
    created_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Unique constraint for the base key row (no one_time_prekey)
CREATE UNIQUE INDEX idx_user_keys_base
    ON user_keys (user_id, device_id)
    WHERE one_time_prekey IS NULL;

CREATE INDEX idx_user_keys_device     ON user_keys (user_id, device_id);
CREATE INDEX idx_user_keys_available  ON user_keys (user_id, device_id, is_used)
    WHERE one_time_prekey IS NOT NULL AND is_used = false;
