-- Per-user language preference for cross-device sync.
--
-- NULL = no preference set; the FE then falls back to its own
-- localStorage value or the hard default ('en-US'). The CHECK constraint
-- validates the BCP-47 lite shape (2-letter primary tag, optional 2-letter
-- region) so future additions to the supported set don't need a migration.
-- Whitelist enforcement (must be one of our currently-supported codes)
-- lives at the API layer.
ALTER TABLE users
    ADD COLUMN preferred_language TEXT NULL;

ALTER TABLE users
    ADD CONSTRAINT users_preferred_language_format
    CHECK (preferred_language IS NULL
        OR preferred_language ~ '^[a-z]{2}(-[A-Z]{2})?$');

COMMENT ON COLUMN users.preferred_language IS
    'Privacy-neutral preference: which language the UI should render in. '
    'Synced across the user''s sessions via WS UserUpdate fan-out (self-only).';
