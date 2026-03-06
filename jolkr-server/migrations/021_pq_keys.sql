-- 021_pq_keys.sql: Post-quantum key columns for hybrid X25519 + ML-KEM-768 E2EE
-- =========================================================================

ALTER TABLE user_keys
    ADD COLUMN pq_signed_prekey            BYTEA,  -- ML-KEM-768 encapsulation key (1184 bytes)
    ADD COLUMN pq_signed_prekey_signature   BYTEA;  -- Ed25519 signature over the PQ prekey (64 bytes)
