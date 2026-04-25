use sqlx::PgPool;
use uuid::Uuid;

use crate::models::DeviceRow;
use jolkr_common::JolkrError;

/// Repository for `device` persistence.
pub struct DeviceRepo;

impl DeviceRepo {
    /// Register a new device or update existing one.
    pub async fn upsert(
        pool: &PgPool,
        id: Uuid,
        user_id: Uuid,
        device_name: &str,
        device_type: &str,
        push_token: Option<&str>,
    ) -> Result<DeviceRow, JolkrError> {
        let row = sqlx::query_as::<_, DeviceRow>(
            "
            INSERT INTO devices (id, user_id, device_name, device_type, push_token, last_active_at)
            VALUES ($1, $2, $3, $4, $5, now())
            ON CONFLICT (id) DO UPDATE
            SET push_token = COALESCE($5, devices.push_token),
                device_name = $3,
                last_active_at = now()
            WHERE devices.user_id = $2
            RETURNING *
            ",
        )
        .bind(id)
        .bind(user_id)
        .bind(device_name)
        .bind(device_type)
        .bind(push_token)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Update push token for a device.
    pub async fn update_push_token(
        pool: &PgPool,
        device_id: Uuid,
        user_id: Uuid,
        push_token: &str,
    ) -> Result<DeviceRow, JolkrError> {
        let row = sqlx::query_as::<_, DeviceRow>(
            "
            UPDATE devices
            SET push_token = $3, last_active_at = now()
            WHERE id = $1 AND user_id = $2
            RETURNING *
            ",
        )
        .bind(device_id)
        .bind(user_id)
        .bind(push_token)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(row)
    }

    /// Get all devices for a user.
    pub async fn list_for_user(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DeviceRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DeviceRow>(
            "SELECT * FROM devices WHERE user_id = $1 ORDER BY last_active_at DESC NULLS LAST",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Get devices with push tokens for a user (for sending notifications).
    pub async fn get_pushable_devices(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<DeviceRow>, JolkrError> {
        let rows = sqlx::query_as::<_, DeviceRow>(
            "SELECT * FROM devices WHERE user_id = $1 AND push_token IS NOT NULL",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Get devices with push tokens for multiple users at once (batch query for push notifications).
    pub async fn get_pushable_devices_batch(
        pool: &PgPool,
        user_ids: &[Uuid],
    ) -> Result<Vec<DeviceRow>, JolkrError> {
        if user_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, DeviceRow>(
            "SELECT * FROM devices WHERE user_id = ANY($1) AND push_token IS NOT NULL",
        )
        .bind(user_ids)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// Delete a device.
    pub async fn delete(
        pool: &PgPool,
        device_id: Uuid,
        user_id: Uuid,
    ) -> Result<(), JolkrError> {
        let result = sqlx::query(
            "DELETE FROM devices WHERE id = $1 AND user_id = $2",
        )
        .bind(device_id)
        .bind(user_id)
        .execute(pool)
        .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }
}
