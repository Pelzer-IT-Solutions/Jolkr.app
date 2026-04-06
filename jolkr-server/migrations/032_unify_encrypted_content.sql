-- Unify encrypted_content into content column.
-- All messages are E2EE: content always holds encrypted base64, nonce indicates encryption.

-- Channel messages: copy encrypted_content (BYTEA) as base64 text into content
UPDATE messages
SET content = encode(encrypted_content, 'base64')
WHERE encrypted_content IS NOT NULL;

ALTER TABLE messages DROP COLUMN IF EXISTS encrypted_content;

-- DM messages: same
UPDATE dm_messages
SET content = encode(encrypted_content, 'base64')
WHERE encrypted_content IS NOT NULL;

ALTER TABLE dm_messages DROP COLUMN IF EXISTS encrypted_content;
