use chrono::{DateTime, Utc};
use sqlx::PgPool;
use uuid::Uuid;

use crate::models::MessageRow;
use jolkr_common::JolkrError;

/// Escape SQL LIKE metacharacters (`%`, `_`, `\`) in user input.
fn escape_like(input: &str) -> String {
    input
        .replace('\\', "\\\\")
        .replace('%', "\\%")
        .replace('_', "\\_")
}

/// Repository for `message` persistence.
pub struct MessageRepo;

impl MessageRepo {
    /// Insert a new message.
    pub async fn create_message(
        pool: &PgPool,
        id: Uuid,
        channel_id: Uuid,
        author_id: Uuid,
        content: Option<&str>,
        nonce: Option<&[u8]>,
        reply_to_id: Option<Uuid>,
    ) -> Result<MessageRow, JolkrError> {
        let now = Utc::now();
        let msg = sqlx::query_as::<_, MessageRow>(
            "
            INSERT INTO messages
                (id, channel_id, author_id, content, nonce,
                 is_edited, is_pinned, reply_to_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, false, false, $6, $7, $7)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(channel_id)
        .bind(author_id)
        .bind(content)
        .bind(nonce)
        .bind(reply_to_id)
        .bind(now)
        .fetch_one(pool)
        .await?;

        Ok(msg)
    }

    /// Get a single message by ID.
    pub async fn get_by_id(pool: &PgPool, id: Uuid) -> Result<MessageRow, JolkrError> {
        let msg = sqlx::query_as::<_, MessageRow>(
            "SELECT * FROM messages WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(msg)
    }

    /// Get multiple messages by IDs in a single query.
    pub async fn get_by_ids(pool: &PgPool, ids: &[Uuid]) -> Result<Vec<MessageRow>, JolkrError> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let rows = sqlx::query_as::<_, MessageRow>(
            "SELECT * FROM messages WHERE id = ANY($1)",
        )
        .bind(ids)
        .fetch_all(pool)
        .await?;
        Ok(rows)
    }

    /// Paginated message listing for a channel.
    ///
    /// - `before`: only messages created before this timestamp (cursor-based pagination)
    /// - `limit`: max number of rows (clamped to 100)
    pub async fn list_for_channel(
        pool: &PgPool,
        channel_id: Uuid,
        before: Option<DateTime<Utc>>,
        limit: i64,
    ) -> Result<Vec<MessageRow>, JolkrError> {
        let limit = limit.min(100).max(1);

        let messages = if let Some(before_ts) = before {
            sqlx::query_as::<_, MessageRow>(
                "
                SELECT * FROM messages
                WHERE channel_id = $1 AND created_at < $2 AND thread_id IS NULL
                ORDER BY created_at DESC
                LIMIT $3
                ",
            )
            .bind(channel_id)
            .bind(before_ts)
            .bind(limit)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, MessageRow>(
                "
                SELECT * FROM messages
                WHERE channel_id = $1 AND thread_id IS NULL
                ORDER BY created_at DESC
                LIMIT $2
                ",
            )
            .bind(channel_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };

        Ok(messages)
    }

    /// Get the most recent message by a specific author in a channel (for slowmode).
    /// Excludes thread messages since they have separate rate limiting.
    pub async fn last_by_author_in_channel(
        pool: &PgPool,
        channel_id: Uuid,
        author_id: Uuid,
    ) -> Result<Option<MessageRow>, JolkrError> {
        let msg = sqlx::query_as::<_, MessageRow>(
            "
            SELECT * FROM messages
            WHERE channel_id = $1 AND author_id = $2 AND thread_id IS NULL
            ORDER BY created_at DESC
            LIMIT 1
            ",
        )
        .bind(channel_id)
        .bind(author_id)
        .fetch_optional(pool)
        .await?;

        Ok(msg)
    }

    /// Edit the content of a message (sets `is_edited` = true).
    pub async fn update(
        pool: &PgPool,
        id: Uuid,
        content: &str,
        nonce: Option<&[u8]>,
    ) -> Result<MessageRow, JolkrError> {
        let now = Utc::now();
        let msg = sqlx::query_as::<_, MessageRow>(
            "
            UPDATE messages
            SET content = $1, nonce = $2, is_edited = true, updated_at = $3
            WHERE id = $4
            RETURNING *
            ",
        )
        .bind(content)
        .bind(nonce)
        .bind(now)
        .bind(id)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;

        Ok(msg)
    }

    /// Search messages in a channel by content (case-insensitive substring match).
    pub async fn search_in_channel(
        pool: &PgPool,
        channel_id: Uuid,
        query: &str,
        limit: i64,
    ) -> Result<Vec<MessageRow>, JolkrError> {
        let limit = limit.min(100).max(1);
        let pattern = format!("%{}%", escape_like(query));

        let messages = sqlx::query_as::<_, MessageRow>(
            "
            SELECT * FROM messages
            WHERE channel_id = $1
              AND content IS NOT NULL
              AND LOWER(content) LIKE LOWER($2)
              AND thread_id IS NULL
            ORDER BY created_at DESC
            LIMIT $3
            ",
        )
        .bind(channel_id)
        .bind(pattern)
        .bind(limit)
        .fetch_all(pool)
        .await?;

        Ok(messages)
    }

    /// Advanced search with filters: text content, author username, attachment type, date range.
    pub async fn search_advanced(
        pool: &PgPool,
        channel_id: Uuid,
        text_query: Option<&str>,
        from_user_id: Option<Uuid>,
        has_filter: Option<&str>,
        before: Option<DateTime<Utc>>,
        after: Option<DateTime<Utc>>,
        limit: i64,
    ) -> Result<Vec<MessageRow>, JolkrError> {
        let limit = limit.min(100).max(1);

        let mut sql = String::from(
            "SELECT m.* FROM messages m WHERE m.channel_id = $1 AND m.thread_id IS NULL"
        );
        let mut param_idx = 2u32;

        // Dynamic WHERE clauses built as string; bind values pushed to a vec
        // Since sqlx doesn't support truly dynamic parameters easily, we build the full query
        // and use raw SQL with indexed placeholders.

        // We'll collect conditions and use query_as with raw SQL
        let mut conditions = Vec::new();

        if text_query.is_some() {
            conditions.push(format!(
                "m.content IS NOT NULL AND LOWER(m.content) LIKE LOWER(${param_idx})"
            ));
            param_idx += 1;
        }

        if from_user_id.is_some() {
            conditions.push(format!("m.author_id = ${param_idx}"));
            param_idx += 1;
        }

        if let Some(has) = has_filter {
            match has {
                "file" => conditions.push(
                    "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id)".to_owned()
                ),
                "image" => conditions.push(
                    "EXISTS (SELECT 1 FROM attachments a WHERE a.message_id = m.id AND a.content_type LIKE 'image/%')".to_owned()
                ),
                "link" => conditions.push(
                    "m.content IS NOT NULL AND m.content ~ 'https?://'".to_owned()
                ),
                _ => {} // ignore unknown has values
            }
        }

        if before.is_some() {
            conditions.push(format!("m.created_at < ${param_idx}"));
            param_idx += 1;
        }

        if after.is_some() {
            conditions.push(format!("m.created_at > ${param_idx}"));
            param_idx += 1;
        }

        for cond in &conditions {
            sql.push_str(" AND ");
            sql.push_str(cond);
        }

        sql.push_str(&format!(" ORDER BY m.created_at DESC LIMIT ${param_idx}"));

        // Build the query with dynamic bindings
        let mut q = sqlx::query_as::<_, MessageRow>(&sql)
            .bind(channel_id);

        if let Some(text) = text_query {
            q = q.bind(format!("%{}%", escape_like(text)));
        }
        if let Some(uid) = from_user_id {
            q = q.bind(uid);
        }
        if let Some(b) = before {
            q = q.bind(b);
        }
        if let Some(a) = after {
            q = q.bind(a);
        }
        q = q.bind(limit);

        let messages = q.fetch_all(pool).await?;
        Ok(messages)
    }

    /// Set the `is_pinned` flag on a message.
    pub async fn set_pinned(pool: &PgPool, id: Uuid, pinned: bool) -> Result<MessageRow, JolkrError> {
        let now = Utc::now();
        let msg = sqlx::query_as::<_, MessageRow>(
            "
            UPDATE messages SET is_pinned = $2, updated_at = $3
            WHERE id = $1
            RETURNING *
            ",
        )
        .bind(id)
        .bind(pinned)
        .bind(now)
        .fetch_optional(pool)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(msg)
    }

    /// Insert a message with a `thread_id`.
    pub async fn create_message_in_thread(
        pool: &PgPool,
        id: Uuid,
        channel_id: Uuid,
        author_id: Uuid,
        content: Option<&str>,
        nonce: Option<&[u8]>,
        reply_to_id: Option<Uuid>,
        thread_id: Uuid,
    ) -> Result<MessageRow, JolkrError> {
        let now = Utc::now();
        let msg = sqlx::query_as::<_, MessageRow>(
            "
            INSERT INTO messages
                (id, channel_id, author_id, content, nonce,
                 is_edited, is_pinned, reply_to_id, thread_id, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, false, false, $6, $7, $8, $8)
            RETURNING *
            ",
        )
        .bind(id)
        .bind(channel_id)
        .bind(author_id)
        .bind(content)
        .bind(nonce)
        .bind(reply_to_id)
        .bind(thread_id)
        .bind(now)
        .fetch_one(pool)
        .await?;
        Ok(msg)
    }

    /// Paginated messages for a thread.
    pub async fn list_for_thread(
        pool: &PgPool,
        thread_id: Uuid,
        before: Option<DateTime<Utc>>,
        limit: i64,
    ) -> Result<Vec<MessageRow>, JolkrError> {
        let limit = limit.min(100).max(1);
        let messages = if let Some(before_ts) = before {
            sqlx::query_as::<_, MessageRow>(
                "
                SELECT * FROM messages
                WHERE thread_id = $1 AND created_at < $2
                ORDER BY created_at DESC
                LIMIT $3
                ",
            )
            .bind(thread_id)
            .bind(before_ts)
            .bind(limit)
            .fetch_all(pool)
            .await?
        } else {
            sqlx::query_as::<_, MessageRow>(
                "
                SELECT * FROM messages
                WHERE thread_id = $1
                ORDER BY created_at DESC
                LIMIT $2
                ",
            )
            .bind(thread_id)
            .bind(limit)
            .fetch_all(pool)
            .await?
        };
        Ok(messages)
    }

    /// Set `thread_id` on a message (used when creating a thread from an existing message).
    /// Accepts both `&PgPool` and `&mut PgConnection` (for transactions).
    pub async fn set_thread_id<'e, E: sqlx::PgExecutor<'e>>(
        executor: E,
        id: Uuid,
        thread_id: Uuid,
    ) -> Result<MessageRow, JolkrError> {
        let now = Utc::now();
        let msg = sqlx::query_as::<_, MessageRow>(
            "UPDATE messages SET thread_id = $2, updated_at = $3 WHERE id = $1 RETURNING *",
        )
        .bind(id)
        .bind(thread_id)
        .bind(now)
        .fetch_optional(executor)
        .await?
        .ok_or(JolkrError::NotFound)?;
        Ok(msg)
    }

    /// Delete a message.
    pub async fn delete(pool: &PgPool, id: Uuid) -> Result<(), JolkrError> {
        let result = sqlx::query("DELETE FROM messages WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;

        if result.rows_affected() == 0 {
            return Err(JolkrError::NotFound);
        }
        Ok(())
    }
}
