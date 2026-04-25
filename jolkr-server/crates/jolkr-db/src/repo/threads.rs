use chrono::Utc;
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::ThreadRow;
use jolkr_common::JolkrError;

/// Repository for `thread` persistence.
pub struct ThreadRepo;

impl ThreadRepo {
    /// Create a new thread for a channel.
    /// Accepts both `&PgPool` and `&mut PgConnection` (for transactions).
    pub async fn create<'e, E: sqlx::PgExecutor<'e>>(
        executor: E,
        channel_id: Uuid,
        starter_msg_id: Option<Uuid>,
        name: Option<&str>,
    ) -> Result<ThreadRow, JolkrError> {
        let id = Uuid::new_v4();
        let now = Utc::now();
        let row = sqlx::query_as::<_, ThreadRow>(
            "
            INSERT INTO threads (id, channel_id, starter_msg_id, name, is_archived, created_at, updated_at)
            VALUES ($1, $2, $3, $4, false, $5, $5)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(channel_id)
        .bind(starter_msg_id)
        .bind(name)
        .bind(now)
        .fetch_one(executor)
        .await?;
        Ok(row)
    }

    /// Get a thread by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<ThreadRow, JolkrError> {
        let row = sqlx::query_as::<_, ThreadRow>(
            "SELECT * FROM threads WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Get thread by its starter message ID.
    pub async fn get_by_starter_msg(
        pool: &PgPool,
        starter_msg_id: Uuid,
    ) -> Result<Option<ThreadRow>, JolkrError> {
        let row = sqlx::query_as::<_, ThreadRow>(
            "SELECT * FROM threads WHERE starter_msg_id = $1",
        )
        .bind(starter_msg_id)
        .fetch_optional(pool)
        .await?;
        Ok(row)
    }

    /// List threads for a channel (max 100).
    pub async fn list_for_channel(
        pool: &PgPool,
        channel_id: Uuid,
        include_archived: bool,
    ) -> Result<Vec<ThreadRow>, JolkrError> {
        let rows = if include_archived {
            sqlx::query_as::<_, ThreadRow>(
                "SELECT * FROM threads WHERE channel_id = $1 ORDER BY updated_at DESC LIMIT 100",
            )
            .bind(channel_id)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, ThreadRow>(
                "SELECT * FROM threads WHERE channel_id = $1 AND is_archived = false ORDER BY updated_at DESC LIMIT 100",
            )
            .bind(channel_id)
            .fetch_all(pool)
            .await?
        };
        Ok(rows)
    }

    /// Update thread name.
    pub async fn update_name(
        pool: &PgPool,
        id: Uuid,
        name: Option<&str>,
    ) -> Result<ThreadRow, JolkrError> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, ThreadRow>(
            "UPDATE threads SET name = $2, updated_at = $3 WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .bind(name)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Set archived status.
    pub async fn set_archived(
        pool: &PgPool,
        id: Uuid,
        archived: bool,
    ) -> Result<ThreadRow, JolkrError> {
        let now = Utc::now();
        let row = sqlx::query_as::<_, ThreadRow>(
            "UPDATE threads SET is_archived = $2, updated_at = $3 WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .bind(archived)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(row)
    }

    /// Touch `updated_at` timestamp (e.g. when a new thread message is sent).
    pub async fn touch(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let now = Utc::now();
        sqlx::query("UPDATE threads SET updated_at = $2 WHERE id = $1")
            .bind(id)
            .bind(now)
            .execute(pool)
            .await?;
        Ok(())
    }

    /// Count messages in a single thread.
    pub async fn message_count(pool: &PgPool, thread_id: Uuid) -> Result<i64, JolkrError> {
        let row: (i64,) = sqlx::query_as(
            "SELECT COUNT(*) FROM messages WHERE thread_id = $1",
        )
        .bind(thread_id)
        .fetch_one(pool)
        .await?;
        Ok(row.0)
    }

    /// Batch count messages for multiple threads.
    pub async fn message_counts(
        pool: &PgPool,
        thread_ids: &[Uuid],
    ) -> Result<Vec<(Uuid, i64)>, JolkrError> {
        if thread_ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows: Vec<(Uuid, i64)> = sqlx::query_as(
            "
            SELECT thread_id, COUNT(*) as count
            FROM messages
            WHERE thread_id = ANY($1)
            GROUP BY thread_id
            ",
        )
        .bind(thread_ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }
}
