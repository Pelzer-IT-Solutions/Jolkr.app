-- 029_cleanup_e2ee_devices.sql: Remove duplicate E2EE device entries
-- Keep only the most recent E2EE device per user
-- =========================================================================

DELETE FROM devices
WHERE device_type = 'e2ee'
  AND id NOT IN (
    SELECT DISTINCT ON (user_id) id
    FROM devices
    WHERE device_type = 'e2ee'
    ORDER BY user_id, created_at DESC
  );
