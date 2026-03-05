-- 010_thread_fixes.sql: Thread integrity improvements
-- =========================================================================

-- Prevent duplicate threads for the same starter message (race condition fix)
CREATE UNIQUE INDEX idx_threads_starter_msg_unique
    ON threads (starter_msg_id) WHERE starter_msg_id IS NOT NULL;
