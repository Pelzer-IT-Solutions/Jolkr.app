-- Poll E2EE: question + option texts move into a single client-encrypted
-- payload (AES-256-GCM with the channel key), mirroring message encryption.
--
-- The client serializes `{ q: string, opts: string[] }` to JSON, encrypts it
-- once, and sends `encrypted_payload` (base64 ciphertext) + `nonce` (base64).
-- The server never sees the texts: `polls.question` and `poll_options.text`
-- are stored as empty strings for encrypted polls, and votes keep counting
-- by option id/position exactly as before.
--
-- Both columns are nullable so pre-existing plaintext polls keep working
-- unchanged (the frontend falls back to the plaintext fields when
-- `encrypted_payload` is absent).
ALTER TABLE polls
    ADD COLUMN encrypted_payload TEXT NULL;

ALTER TABLE polls
    ADD COLUMN nonce TEXT NULL;

COMMENT ON COLUMN polls.encrypted_payload IS
    'Base64 AES-256-GCM ciphertext of {"q": question, "opts": [option texts]}, '
    'encrypted client-side with the channel key. NULL for legacy plaintext polls.';

COMMENT ON COLUMN polls.nonce IS
    'Base64 AES-GCM nonce for encrypted_payload. NULL for legacy plaintext polls.';
