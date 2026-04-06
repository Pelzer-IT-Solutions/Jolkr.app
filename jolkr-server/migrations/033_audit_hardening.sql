-- 033_audit_hardening.sql: Audit fixes — constraints, indexes, webhook token hashing
-- =========================================================================

-- M4: Hash webhook tokens (SHA-256) instead of storing plaintext
-- Step 1: Add token_hash column
ALTER TABLE webhooks ADD COLUMN token_hash VARCHAR(64);

-- Step 2: Populate token_hash from existing plaintext tokens
UPDATE webhooks SET token_hash = encode(sha256(token::bytea), 'hex');

-- Step 3: Make token_hash NOT NULL and drop plaintext token
ALTER TABLE webhooks ALTER COLUMN token_hash SET NOT NULL;
ALTER TABLE webhooks DROP COLUMN token;

-- Step 4: Index on token_hash for lookups
DROP INDEX IF EXISTS idx_webhooks_token;
CREATE UNIQUE INDEX idx_webhooks_token_hash ON webhooks(token_hash);

-- M4: CHECK constraint on friendships.status
ALTER TABLE friendships ADD CONSTRAINT chk_friendships_status
    CHECK (status IN ('pending', 'accepted', 'blocked'));

-- M3/M11/H14: Validate channel_encryption_keys.channel_id references a real channel or DM
-- Cannot use simple FK because channel_id is polymorphic (channels.id OR dm_channels.id).
-- Use a trigger to validate on INSERT.
CREATE OR REPLACE FUNCTION validate_channel_encryption_key_channel()
RETURNS TRIGGER AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM channels WHERE id = NEW.channel_id)
       AND NOT EXISTS (SELECT 1 FROM dm_channels WHERE id = NEW.channel_id) THEN
        RAISE EXCEPTION 'channel_id % does not exist in channels or dm_channels', NEW.channel_id;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_validate_channel_enc_key_channel
    BEFORE INSERT ON channel_encryption_keys
    FOR EACH ROW
    EXECUTE FUNCTION validate_channel_encryption_key_channel();

-- M14: Extend index to include key_generation for faster lookups
DROP INDEX IF EXISTS idx_channel_enc_keys_recipient;
CREATE INDEX idx_channel_enc_keys_recipient
    ON channel_encryption_keys (channel_id, recipient_user_id, key_generation);
