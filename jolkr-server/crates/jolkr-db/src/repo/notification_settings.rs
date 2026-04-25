use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::NotificationSettingRow;
use jolkr_common::JolkrError;

/// Repository for `notificationsetting` persistence.
pub struct NotificationSettingRepo;

impl NotificationSettingRepo {
    /// Get a notification setting for a specific target.
    pub async fn get(
        pool: &PgPool,
        user_id: Uuid,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<Option<NotificationSettingRow>, JolkrError> {
        let row = sqlx::query_as::<_, NotificationSettingRow>(
            "SELECT * FROM notification_settings WHERE user_id = $1 AND target_type = $2 AND target_id = $3",
        )
        .bind(user_id)
        .bind(target_type)
        .bind(target_id)
        .fetch_optional(pool)
        .await?;

        Ok(row)
    }

    /// Upsert a notification setting.
    pub async fn upsert(
        pool: &PgPool,
        user_id: Uuid,
        target_type: &str,
        target_id: Uuid,
        muted: bool,
        mute_until: Option<chrono::DateTime<Utc>>,
        suppress_everyone: bool,
    ) -> Result<NotificationSettingRow, JolkrError> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = sqlx::query_as::<_, NotificationSettingRow>(
            "
            INSERT INTO notification_settings (id, user_id, target_type, target_id, muted, mute_until, suppress_everyone, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
            ON CONFLICT (user_id, target_type, target_id)
            DO UPDATE SET muted = $5, mute_until = $6, suppress_everyone = $7, updated_at = $8
            RETURNING *
            ",
        )
        .bind(id)
        .bind(user_id)
        .bind(target_type)
        .bind(target_id)
        .bind(muted)
        .bind(mute_until)
        .bind(suppress_everyone)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(row)
    }

    /// Delete a notification setting.
    pub async fn delete(
        pool: &PgPool,
        user_id: Uuid,
        target_type: &str,
        target_id: Uuid,
    ) -> Result<(), JolkrError> {
        sqlx::query(
            "DELETE FROM notification_settings WHERE user_id = $1 AND target_type = $2 AND target_id = $3",
        )
        .bind(user_id)
        .bind(target_type)
        .bind(target_id)
        .execute(pool)
        .await?;

        Ok(())
    }

    /// List all muted channels for a user (for filtering notifications).
    pub async fn list_muted_for_user(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<NotificationSettingRow>, JolkrError> {
        let rows = sqlx::query_as::<_, NotificationSettingRow>(
            "
            SELECT * FROM notification_settings
            WHERE user_id = $1 AND muted = TRUE
            AND (mute_until IS NULL OR mute_until > NOW())
            ",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }

    /// List all notification settings for a user (for syncing to frontend).
    pub async fn list_for_user(
        pool: &PgPool,
        user_id: Uuid,
    ) -> Result<Vec<NotificationSettingRow>, JolkrError> {
        let rows = sqlx::query_as::<_, NotificationSettingRow>(
            "SELECT * FROM notification_settings WHERE user_id = $1",
        )
        .bind(user_id)
        .fetch_all(pool)
        .await?;

        Ok(rows)
    }
}
